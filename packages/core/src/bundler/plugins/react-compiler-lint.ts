/**
 * React Compiler bailout detector (#240 Phase 2).
 *
 * React Compiler silently skips components it can't safely memoize
 * ("15% bailout"). Developers have no way to know which components
 * are in the skipped set without this static pass.
 *
 * This module runs `eslint-plugin-react-compiler` in-process against a
 * caller-supplied list of files (islands / `"use client"` pages /
 * partials — the same files the bundler's `manduClientPlugins` gate
 * picks up) and returns normalized diagnostics. `mandu check` wires
 * this up behind `experimental.reactCompiler.enabled`.
 *
 * ## Why ESLint, not oxlint?
 *
 * The canonical rule lives at `react-compiler/react-compiler` in
 * `eslint-plugin-react-compiler`. Oxlint has no port at the time of
 * writing. When oxlint gains the rule we can swap this runner for a
 * thin `oxlint --rule react-compiler/react-compiler` shell without
 * changing callers — the `runReactCompilerLint` signature stays.
 *
 * ## Graceful degradation
 *
 * `eslint` and `eslint-plugin-react-compiler` are **optional** peer
 * dependencies. If either is missing the runner returns `[]` and logs
 * a single warning — the build is never blocked.
 */

import path from "node:path";

export interface ReactCompilerDiagnostic {
  /** Absolute path to the offending file. */
  file: string;
  /** 1-indexed line. */
  line: number;
  /** 1-indexed column. */
  column: number;
  /** Human-readable message produced by the rule. */
  message: string;
  /** Always `"react-compiler/react-compiler"`. */
  ruleId: string;
  /** ESLint severity — "error" (`2`) or "warning" (`1`). */
  severity: "warning" | "error";
}

export interface RunReactCompilerLintOptions {
  /**
   * Project root — used to resolve `eslint` / the plugin from the
   * project's own `node_modules` before falling back to Mandu's.
   */
  projectRoot: string;
  /**
   * Absolute file paths to lint. Callers should pass only files the
   * bundler would run through the Compiler (islands / client pages /
   * partials). Passing server files wastes CPU — the rule still runs
   * but the diagnostics are irrelevant.
   */
  targetFiles: readonly string[];
  /**
   * Severity level used for the rule. Default `"warning"`. `"error"`
   * makes the diagnostic a hard failure in strict mode.
   */
  severity?: "warning" | "error";
}

export interface RunReactCompilerLintResult {
  /** All diagnostics found. Empty array on success or graceful skip. */
  diagnostics: ReactCompilerDiagnostic[];
  /** When `true` the runner could not load its peers and returned `[]`. */
  skipped: boolean;
  /** Human-readable explanation when `skipped` is `true`. */
  skipReason?: string;
}

// Minimal structural types for ESLint's flat-config API. We avoid a
// hard dependency on `@types/eslint` because eslint is an optional
// peer dep; the real module is imported dynamically at runtime.
type ESLintMessage = {
  ruleId: string | null;
  severity: number;
  message: string;
  line?: number;
  column?: number;
};
type ESLintLintResult = {
  filePath: string;
  messages: ESLintMessage[];
};
type ESLintCtor = new (opts: { overrideConfigFile?: boolean; overrideConfig?: unknown }) => {
  lintFiles: (patterns: readonly string[]) => Promise<ESLintLintResult[]>;
};

async function resolvePeers(
  _projectRoot: string,
): Promise<{ ESLint: ESLintCtor; plugin: unknown } | { error: string }> {
  try {
    const eslintMod = (await import(/* @vite-ignore */ "eslint" as string)) as {
      ESLint?: ESLintCtor;
      default?: { ESLint: ESLintCtor };
    };
    const ESLint = eslintMod.ESLint ?? eslintMod.default?.ESLint;
    if (!ESLint) {
      return { error: "`eslint` loaded but `ESLint` constructor not exported" };
    }
    const pluginMod = (await import(
      /* @vite-ignore */ "eslint-plugin-react-compiler" as string
    )) as { default?: unknown };
    const plugin = pluginMod.default ?? pluginMod;
    return { ESLint, plugin };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function mapSeverity(raw: number): "warning" | "error" {
  return raw >= 2 ? "error" : "warning";
}

/**
 * Run the `react-compiler/react-compiler` rule against a list of
 * files. Does **not** read any ESLint config from disk — we assemble
 * an inline flat config so the result is deterministic regardless of
 * the host project's ESLint setup.
 */
export async function runReactCompilerLint(
  options: RunReactCompilerLintOptions,
): Promise<RunReactCompilerLintResult> {
  if (options.targetFiles.length === 0) {
    return { diagnostics: [], skipped: false };
  }

  const peers = await resolvePeers(options.projectRoot);
  if ("error" in peers) {
    console.warn(
      "[Mandu React Compiler] Skipping bailout diagnostics — " +
        "install `eslint` and `eslint-plugin-react-compiler` to enable. " +
        `Reason: ${peers.error}`,
    );
    return {
      diagnostics: [],
      skipped: true,
      skipReason: peers.error,
    };
  }
  const { ESLint, plugin } = peers;
  const severityNumber = options.severity === "error" ? 2 : 1;

  // Flat config — no eslintrc resolution, no plugin auto-discovery.
  // The override is evaluated for every target file.
  const overrideConfig = [
    {
      files: ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"],
      plugins: { "react-compiler": plugin },
      rules: { "react-compiler/react-compiler": severityNumber },
    },
  ];

  let linter;
  try {
    linter = new ESLint({ overrideConfigFile: true, overrideConfig });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      `[Mandu React Compiler] ESLint construction failed — skipping diagnostics. ${reason}`,
    );
    return { diagnostics: [], skipped: true, skipReason: reason };
  }

  const results = await linter.lintFiles(options.targetFiles.slice());
  const diagnostics: ReactCompilerDiagnostic[] = [];
  for (const result of results) {
    for (const msg of result.messages) {
      if (msg.ruleId !== "react-compiler/react-compiler") continue;
      diagnostics.push({
        file: result.filePath,
        line: msg.line ?? 1,
        column: msg.column ?? 1,
        message: msg.message,
        ruleId: "react-compiler/react-compiler",
        severity: mapSeverity(msg.severity),
      });
    }
  }
  return { diagnostics, skipped: false };
}

// ─────────────────────────────────────────────────────────────────────────
// Report formatter — kept pure so the CLI can render or tests can snapshot
// ─────────────────────────────────────────────────────────────────────────

export interface FormatCompilerReportOptions {
  /** Omit absolute-path prefixes starting with this root. */
  projectRoot?: string;
  /** Max diagnostics shown. Excess is summarised as "... N more". Default 25. */
  limit?: number;
}

/**
 * Format diagnostics as a plain-text block suitable for the `mandu
 * check` console output. Returns a single string so the caller can
 * `log()` it in one shot.
 */
export function formatCompilerReport(
  diagnostics: readonly ReactCompilerDiagnostic[],
  options: FormatCompilerReportOptions = {},
): string {
  if (diagnostics.length === 0) {
    return "🧠 React Compiler — no bailouts detected";
  }
  const projectRoot = options.projectRoot;
  const limit = options.limit ?? 25;
  const byFile = new Map<string, ReactCompilerDiagnostic[]>();
  for (const d of diagnostics) {
    const list = byFile.get(d.file) ?? [];
    list.push(d);
    byFile.set(d.file, list);
  }

  const fileCount = byFile.size;
  const lines: string[] = [];
  lines.push(
    `🧠 React Compiler — ${diagnostics.length} bailout(s) in ${fileCount} file(s)`,
  );
  lines.push("");

  const shown: ReactCompilerDiagnostic[] = [];
  for (const ds of byFile.values()) {
    for (const d of ds) {
      if (shown.length >= limit) break;
      shown.push(d);
    }
    if (shown.length >= limit) break;
  }
  for (const d of shown) {
    const relative = projectRoot ? path.relative(projectRoot, d.file) : d.file;
    lines.push(`  ${relative}:${d.line}:${d.column}`);
    lines.push(`    ${d.message}`);
  }
  if (diagnostics.length > shown.length) {
    lines.push(`  … and ${diagnostics.length - shown.length} more`);
  }
  lines.push("");
  lines.push(
    "→ These components will NOT be auto-memoized. Most bailouts come from " +
      "conditional hook calls, ref escape, or mutation of shared values.",
  );
  lines.push(
    "→ See https://react.dev/learn/react-compiler for common patterns.",
  );
  return lines.join("\n");
}
