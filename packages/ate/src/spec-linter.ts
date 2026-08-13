/**
 * Phase A.3 — spec lint helper.
 *
 * Shared linter for agent-generated test files. Called by the MCP tool
 * `mandu_ate_save` before persisting content to disk. Also exported so
 * CLIs and editors can run the same checks.
 *
 * Diagnostic kinds:
 *
 *   - syntax_error (blocking)    — content is not syntactically valid TS.
 *   - banned_import (blocking)   — import path is a known LLM typo
 *                                  (e.g. "@mandu/core" → "@mandujs/core").
 *   - unknown_barrel (blocking)  — @mandujs/* import that isn't a registered
 *                                  barrel name.
 *   - unresolved_import (warn)   — relative import doesn't resolve to a file
 *                                  on disk near `path`.
 *   - unused_import (warn)       — named import appears only in its own
 *                                  import statement.
 *   - bare_localhost (blocking)  — URL uses 'localhost:<port>' (use 127.0.0.1).
 *   - hand_rolled_csrf (blocking)— raw "__csrf=" / "_csrf=" without
 *                                  createTestSession import.
 *   - db_mock (blocking)         — vi.mock / jest.mock against a db-ish path.
 *
 * Live in @mandujs/ate because this is where ts-morph is already a direct
 * dependency — the MCP package wraps the exported function.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type LintSeverity = "error" | "warning";

export interface LintDiagnostic {
  severity: LintSeverity;
  code: string;
  message: string;
  line?: number;
  column?: number;
  /** True if this diagnostic prevents the write from happening. */
  blocking: boolean;
}

const KNOWN_MANDU_BARRELS = new Set([
  "@mandujs/core",
  "@mandujs/core/testing",
  "@mandujs/core/client",
  "@mandujs/core/compat/server",
  "@mandujs/core/compat/filling/index",
  "@mandujs/core/contract",
  "@mandujs/core/middleware",
  "@mandujs/core/compat/auth/index",
  "@mandujs/core/compat/perf/index",
  "@mandujs/core/compat/id/index",
  "@mandujs/core/compat/bundler/safe-build",
  "@mandujs/ate",
  "@mandujs/cli",
  "@mandujs/mcp",
  "@mandujs/skills",
  "@mandujs/edge",
  "@mandujs/playground-runner",
  "@playwright/test",
  "bun:test",
  "bun",
  "bun:sqlite",
  "bun:ffi",
]);

const BANNED_IMPORT_PATHS: Record<string, string> = {
  "@mandu/core": "@mandujs/core (note the 'js' suffix)",
  "@mandu/core/testing": "@mandujs/core/testing",
  "@manduj/core": "@mandujs/core",
  "@mandu-js/core": "@mandujs/core",
};

/**
 * Lint a proposed test file's content. Pure function: does not write.
 *
 * @param specPath  Absolute or project-relative path where the content would
 *                  land — used to resolve relative imports.
 * @param content   The full TypeScript source.
 */
export async function lintSpecContent(
  specPath: string,
  content: string
): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];

  // 1. Syntax check via ts-morph parse. Semantic (type) errors are ignored —
  //    they produce far too many false positives in this environment
  //    (missing @types, workspace resolution, etc).
  const parse = await parseTs(specPath, content);
  if (!parse.ok) {
    diagnostics.push({
      severity: "error",
      code: "syntax_error",
      message: parse.error,
      blocking: true,
    });
  }

  // 2. Import checks — only run when the parse succeeded.
  if (parse.ok && parse.sourceFile) {
    diagnostics.push(...checkImports(specPath, parse.sourceFile, content));
  }

  // 3. Regex-level anti-patterns (independent of parse success).
  diagnostics.push(...checkBareLocalhost(content));
  diagnostics.push(...checkHandRolledCsrf(content));
  diagnostics.push(...checkDbMocks(content));

  return diagnostics;
}

type TsImport = {
  getModuleSpecifierValue(): string;
  getNamedImports(): Array<{ getName(): string }>;
  getStartLineNumber(): number;
};

interface ParsedSource {
  getImportDeclarations(): TsImport[];
}

type ParseOk = { ok: true; sourceFile: ParsedSource };
type ParseErr = { ok: false; error: string };

async function parseTs(specPath: string, content: string): Promise<ParseOk | ParseErr> {
  if (containsUnmatchedBraces(content)) {
    return { ok: false, error: "Unbalanced braces / parens / brackets in content" };
  }
  try {
    const mod = (await import("ts-morph")) as unknown as {
      Project: new (opts?: unknown) => {
        createSourceFile(p: string, t: string, o?: { overwrite?: boolean }): ParsedSource;
      };
    };
    const project = new mod.Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        noEmit: true,
        strict: false,
      },
    });
    const sf = project.createSourceFile(specPath, content, { overwrite: true });
    return { ok: true, sourceFile: sf };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `ts-morph parse failed: ${msg}` };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// containsUnmatchedBraces — scans ignoring strings/comments. Used as a fast
// pre-filter so "obviously broken" content can't leak past the lint even if
// ts-morph's parser recovers silently (it sometimes does).
// ──────────────────────────────────────────────────────────────────────────

function containsUnmatchedBraces(src: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let brace = 0;
  let paren = 0;
  let bracket = 0;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];

    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (c === "\\") { i++; continue; }
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === "\\") { i++; continue; }
      if (c === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (c === "\\") { i++; continue; }
      if (c === "`") inTemplate = false;
      continue;
    }

    if (c === "/" && next === "/") { inLineComment = true; i++; continue; }
    if (c === "/" && next === "*") { inBlockComment = true; i++; continue; }
    if (c === "'") { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
    if (c === "`") { inTemplate = true; continue; }
    if (c === "{") brace++;
    else if (c === "}") brace--;
    else if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "[") bracket++;
    else if (c === "]") bracket--;

    if (brace < 0 || paren < 0 || bracket < 0) return true;
  }

  return brace !== 0 || paren !== 0 || bracket !== 0;
}

// ──────────────────────────────────────────────────────────────────────────
// Import checks
// ──────────────────────────────────────────────────────────────────────────

function checkImports(
  specPath: string,
  sf: ParsedSource,
  content: string
): LintDiagnostic[] {
  const diag: LintDiagnostic[] = [];

  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    const line = imp.getStartLineNumber();

    if (BANNED_IMPORT_PATHS[spec]) {
      diag.push({
        severity: "error",
        code: "banned_import",
        message: `Import '${spec}' is wrong — use '${BANNED_IMPORT_PATHS[spec]}'`,
        line,
        blocking: true,
      });
      continue;
    }

    if (spec.startsWith("@mandujs/")) {
      if (!KNOWN_MANDU_BARRELS.has(spec) && !spec.startsWith("@mandujs/core/")) {
        diag.push({
          severity: "error",
          code: "unknown_barrel",
          message: `Import '${spec}' does not match any known @mandujs/* barrel`,
          line,
          blocking: true,
        });
        continue;
      }
    }

    if (spec.startsWith("./") || spec.startsWith("../")) {
      const resolved = resolveRelative(specPath, spec);
      if (resolved && !existsWithTsExtensions(resolved)) {
        diag.push({
          severity: "warning",
          code: "unresolved_import",
          message: `Relative import '${spec}' does not resolve to a file on disk (looked near ${resolved})`,
          line,
          blocking: false,
        });
      }
    }

    for (const named of imp.getNamedImports()) {
      const name = named.getName();
      const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "g");
      const matches = content.match(re);
      if (matches && matches.length <= 1) {
        diag.push({
          severity: "warning",
          code: "unused_import",
          message: `Imported name '${name}' appears unused`,
          line,
          blocking: false,
        });
      }
    }
  }

  return diag;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveRelative(specPath: string, rel: string): string | null {
  try {
    return resolve(dirname(specPath), rel);
  } catch {
    return null;
  }
}

function existsWithTsExtensions(base: string): boolean {
  const candidates = [
    base,
    base + ".ts",
    base + ".tsx",
    base + ".js",
    base + ".jsx",
    base + "/index.ts",
    base + "/index.tsx",
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return true;
    } catch {
      // fall through
    }
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────────────
// Anti-pattern checks
// ──────────────────────────────────────────────────────────────────────────

function checkBareLocalhost(content: string): LintDiagnostic[] {
  const diag: LintDiagnostic[] = [];
  const re = /https?:\/\/localhost:\d+/;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]) && !/^\s*\/\//.test(lines[i])) {
      diag.push({
        severity: "error",
        code: "bare_localhost",
        message:
          "URL uses 'localhost' — prefer '127.0.0.1' to avoid IPv6 DNS flakes on Windows CI (roadmap §9.2, issue #224)",
        line: i + 1,
        blocking: true,
      });
    }
  }
  return diag;
}

function checkHandRolledCsrf(content: string): LintDiagnostic[] {
  const diag: LintDiagnostic[] = [];
  const usesHandRolled = /["'`]__csrf=|['"`]_csrf=/.test(content);
  const importsCreateTestSession = /\bcreateTestSession\b/.test(content);
  if (usesHandRolled && !importsCreateTestSession) {
    diag.push({
      severity: "error",
      code: "hand_rolled_csrf",
      message:
        "Test assembles a CSRF cookie / field manually. Use createTestSession() from @mandujs/core/testing — it emits a matching cookie + token pair.",
      blocking: true,
    });
  }
  return diag;
}

function checkDbMocks(content: string): LintDiagnostic[] {
  const diag: LintDiagnostic[] = [];
  const mockPatterns = [
    /\bvi\.mock\s*\(\s*["'`][^"'`]*db[^"'`]*["'`]/i,
    /\bjest\.mock\s*\(\s*["'`][^"'`]*db[^"'`]*["'`]/i,
    /\bmock\s*\(\s*["'`][^"'`]*db[^"'`]*["'`]/i,
  ];
  if (mockPatterns.some((p) => p.test(content))) {
    diag.push({
      severity: "error",
      code: "db_mock",
      message:
        "Test mocks the database. Mandu provides `createTestDb()` (in-memory bun:sqlite) from @mandujs/core/testing — use that instead.",
      blocking: true,
    });
  }
  return diag;
}
