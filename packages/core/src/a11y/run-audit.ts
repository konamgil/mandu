/**
 * @mandujs/core/a11y — accessibility audit runner (Phase 18.χ).
 *
 * # Design contract
 *
 * 1. **Zero runtime cost when unused.** axe-core (~1 MB) and jsdom are
 *    declared as optional peer dependencies in `@mandujs/core` —
 *    neither is pulled into user bundles. `runAudit` uses dynamic
 *    `import()` for both, so the axe-core bytes never reach Node's
 *    module graph unless the caller actually asked for an audit.
 *
 * 2. **Graceful degradation.** When axe-core is absent the runner
 *    returns `outcome: "axe-missing"` with an actionable `note` rather
 *    than throwing. CLI callers translate that into a single-line
 *    informational message and exit 0 (quality is opt-in).
 *
 * 3. **DOM provider preference.** JSDOM is the canonical host because
 *    axe-core was written against it. When jsdom is not installed we
 *    try HappyDOM (Mandu already uses `@happy-dom/global-registrator`
 *    as a dev-dep) which covers the 80% path. If neither provider is
 *    available we return `axe-missing` with a note that names which
 *    piece is missing — jsdom, HappyDOM, or both.
 *
 * 4. **Bounded work.** `maxFiles` caps the input list (default 500) so
 *    a misconfigured project that prerenders 10k routes can't hang CI.
 *    Each file is audited sequentially; axe-core is CPU-bound and
 *    parallelising across Bun's event loop offers zero wall-clock win.
 *
 * 5. **Testable.** `axeLoader` / `domLoader` options short-circuit the
 *    module resolution so `run-audit.test.ts` can inject deterministic
 *    fakes without mutating Bun's module cache.
 */

import fs from "fs/promises";
import path from "path";
import { AUDIT_IMPACT_ORDER, impactAtLeast } from "./types";
import type {
  AuditImpact,
  AuditNode,
  AuditReport,
  AuditViolation,
  RunAuditOptions,
} from "./types";
import { getFixHint } from "./fix-hints";

/** Minimal structural typing for the axe-core handle we actually use. */
interface AxeLike {
  run(context: unknown, options?: unknown): Promise<AxeRunResult>;
}

/** axe-core's result shape (only the fields we consume). */
interface AxeRunResult {
  violations: Array<{
    id: string;
    impact: AuditImpact | null;
    help: string;
    helpUrl?: string;
    nodes: Array<{
      target?: string[] | string;
      failureSummary?: string;
      html?: string;
    }>;
  }>;
}

/** Minimal structural typing for the DOM provider handle. */
interface DomProvider {
  kind: "jsdom" | "happy-dom";
  fromHtml(html: string, url: string): Promise<{ window: unknown; dispose: () => Promise<void> }>;
}

const DEFAULT_MAX_FILES = 500;
const DEFAULT_MIN_IMPACT: AuditImpact = "minor";
const AXE_CORE_MODULE = "axe-core";
const JSDOM_MODULE = "jsdom";
const HAPPY_DOM_MODULE = "happy-dom";

/**
 * Zero every entry in an impact-count record. Returned by value so
 * callers never mutate a shared singleton.
 */
function emptyImpactCounts(): Record<AuditImpact, number> {
  return { minor: 0, moderate: 0, serious: 0, critical: 0 };
}

/**
 * Resolve the axe-core module. Tries the caller-supplied loader first
 * (test-only path), then falls back to dynamic `import("axe-core")`.
 * Returns `null` when the package is not installed — NEVER throws.
 */
async function resolveAxe(options: RunAuditOptions): Promise<AxeLike | null> {
  const tryLoad = async (loader: () => Promise<unknown>): Promise<AxeLike | null> => {
    try {
      const mod = await loader();
      if (!mod) return null;
      // axe-core exports `.default` under ESM/CJS interop. Accept either.
      const candidate = (mod as { default?: unknown }).default ?? mod;
      if (candidate && typeof (candidate as AxeLike).run === "function") {
        return candidate as AxeLike;
      }
      return null;
    } catch {
      return null;
    }
  };

  if (options.axeLoader) return tryLoad(options.axeLoader);
  return tryLoad(() => import(AXE_CORE_MODULE));
}

/**
 * Resolve a DOM provider. Prefers jsdom; falls back to HappyDOM via
 * `happy-dom`'s `Window` export (the same class Mandu's test harness
 * already depends on).
 */
async function resolveDomProvider(options: RunAuditOptions): Promise<DomProvider | null> {
  // Caller override — used exclusively by tests that inject a fake
  // with a `.kind` field.
  if (options.domLoader) {
    try {
      const mod = await options.domLoader();
      if (mod && typeof mod === "object" && "kind" in mod && "fromHtml" in mod) {
        return mod as DomProvider;
      }
    } catch {
      return null;
    }
    return null;
  }

  // Preferred path — jsdom.
  try {
    const jsdom = await import(JSDOM_MODULE);
    const JSDOMCtor = (jsdom as { JSDOM?: new (html: string, opts?: unknown) => unknown }).JSDOM;
    if (JSDOMCtor) {
      return {
        kind: "jsdom",
        async fromHtml(html: string, url: string) {
          const instance = new JSDOMCtor(html, { url });
          const window = (instance as { window: unknown }).window;
          return {
            window,
            async dispose() {
              const w = window as { close?: () => void };
              if (typeof w.close === "function") {
                try { w.close(); } catch { /* no-op */ }
              }
            },
          };
        },
      };
    }
  } catch {
    // jsdom not installed — fall through to HappyDOM.
  }

  // Fallback path — HappyDOM.
  try {
    const happy = await import(HAPPY_DOM_MODULE);
    const WindowCtor = (happy as { Window?: new (opts?: { url?: string; innerWidth?: number }) => unknown }).Window;
    if (WindowCtor) {
      return {
        kind: "happy-dom",
        async fromHtml(html: string, url: string) {
          const window = new WindowCtor({ url, innerWidth: 1024 }) as {
            document: { write: (html: string) => void; close: () => void };
            close?: () => Promise<void>;
          };
          window.document.write(html);
          window.document.close();
          return {
            window,
            async dispose() {
              if (typeof window.close === "function") {
                try { await window.close(); } catch { /* no-op */ }
              }
            },
          };
        },
      };
    }
  } catch {
    // HappyDOM not installed — both providers exhausted.
  }

  return null;
}

/**
 * Flatten axe-core's node shape into our slim `AuditNode`. axe emits
 * `target` as either a string or `string[]` depending on iframe
 * context; we normalize to a single selector chain joined by `>`.
 */
function normalizeNodes(
  raw: AxeRunResult["violations"][number]["nodes"]
): AuditNode[] {
  const nodes: AuditNode[] = [];
  for (const n of raw.slice(0, 10)) {
    let target: string;
    if (Array.isArray(n.target)) {
      target = n.target.filter((s) => typeof s === "string").join(" > ");
    } else if (typeof n.target === "string") {
      target = n.target;
    } else {
      target = "(unknown)";
    }
    const html = typeof n.html === "string" && n.html.length > 300
      ? n.html.slice(0, 297) + "..."
      : n.html;
    nodes.push({
      target,
      failureSummary: n.failureSummary ?? "",
      ...(html ? { html } : {}),
    });
  }
  return nodes;
}

/**
 * Audit a single HTML file. Returns the violations discovered (already
 * filtered by `minImpact`) or `null` when the file could not be read —
 * caller decides whether to warn or abort.
 */
async function auditFile(
  absFile: string,
  axe: AxeLike,
  dom: DomProvider,
  minImpact: AuditImpact
): Promise<AuditViolation[] | null> {
  let html: string;
  try {
    html = await fs.readFile(absFile, "utf-8");
  } catch {
    return null;
  }

  const pageUrl = "file://" + absFile.replace(/\\/g, "/");
  let handle: { window: unknown; dispose: () => void | Promise<void> };
  try {
    handle = await dom.fromHtml(html, pageUrl);
  } catch {
    return null;
  }

  try {
    // axe-core accepts a `document` as context. Both jsdom and HappyDOM
    // expose `.window.document`.
    const w = handle.window as { document?: unknown };
    const context = w.document ?? handle.window;
    const result = await axe.run(context);
    const out: AuditViolation[] = [];
    for (const v of result.violations) {
      if (!impactAtLeast(v.impact ?? null, minImpact)) continue;
      out.push({
        file: absFile,
        rule: v.id,
        impact: v.impact ?? null,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: normalizeNodes(v.nodes),
        ...(getFixHint(v.id) ? { fixHint: getFixHint(v.id)! } : {}),
      });
    }
    return out;
  } catch {
    return null;
  } finally {
    await handle.dispose();
  }
}

/**
 * Public entry. Run axe-core against every HTML file in `htmlFiles`
 * and aggregate the results. See `./types.ts` for the full report
 * shape; this function never throws — every failure mode is surfaced
 * via `outcome` + `note`.
 */
export async function runAudit(
  htmlFiles: string[],
  options: RunAuditOptions = {}
): Promise<AuditReport> {
  const started = performance.now();
  const minImpact = options.minImpact ?? DEFAULT_MIN_IMPACT;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const bounded = htmlFiles.slice(0, maxFiles);

  const axe = await resolveAxe(options);
  if (!axe) {
    return {
      outcome: "axe-missing",
      filesScanned: 0,
      violations: [],
      impactCounts: emptyImpactCounts(),
      minImpact,
      note: "axe-core not installed — skipping audit (bun add -d axe-core jsdom)",
      durationMs: 0,
    };
  }

  const dom = await resolveDomProvider(options);
  if (!dom) {
    return {
      outcome: "axe-missing",
      filesScanned: 0,
      violations: [],
      impactCounts: emptyImpactCounts(),
      minImpact,
      note: "No DOM provider available — install jsdom (recommended) or happy-dom",
      durationMs: 0,
    };
  }

  const allViolations: AuditViolation[] = [];
  const impactCounts = emptyImpactCounts();
  let scanned = 0;

  for (const file of bounded) {
    const abs = path.resolve(file);
    const perFile = await auditFile(abs, axe, dom, minImpact);
    if (perFile === null) continue; // unreadable — counts as not scanned
    scanned += 1;
    for (const v of perFile) {
      allViolations.push(v);
      if (v.impact) impactCounts[v.impact] += 1;
    }
  }

  return {
    outcome: allViolations.length > 0 ? "violations" : "ok",
    filesScanned: scanned,
    violations: allViolations,
    impactCounts,
    minImpact,
    durationMs: Math.round(performance.now() - started),
  };
}

/**
 * Pretty-print an audit report as a multi-line ASCII table suitable
 * for CLI output. Separate from `runAudit` so JSON consumers stay
 * unaffected by formatting concerns.
 */
export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [];
  lines.push("Accessibility audit (axe-core)");
  lines.push("=".repeat(50));

  if (report.outcome === "axe-missing") {
    lines.push(report.note ?? "axe-core not installed — skipping audit");
    lines.push("");
    lines.push("  Install the optional peers to enable:");
    lines.push("    bun add -d axe-core jsdom");
    return lines.join("\n");
  }

  lines.push(
    `  Files scanned: ${report.filesScanned}  ·  ` +
      `Violations: ${report.violations.length}  ·  ` +
      `Duration: ${report.durationMs}ms`
  );
  lines.push(
    `  By impact: ` +
      AUDIT_IMPACT_ORDER
        .map((i) => `${i}=${report.impactCounts[i]}`)
        .join("  ")
  );
  lines.push(`  Min impact: ${report.minImpact}`);
  lines.push("");

  if (report.outcome === "ok") {
    lines.push("  No violations at or above minImpact. PASS.");
    return lines.join("\n");
  }

  // Group by rule id so the table is navigable.
  const byRule = new Map<string, AuditViolation[]>();
  for (const v of report.violations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    byRule.get(v.rule)!.push(v);
  }

  for (const [rule, violations] of byRule) {
    const first = violations[0];
    const impact = first.impact ?? "unknown";
    lines.push(`  [${impact.toUpperCase()}] ${rule}  —  ${first.help}`);
    if (first.fixHint) lines.push(`     Fix: ${first.fixHint}`);
    const totalNodes = violations.reduce((n, v) => n + v.nodes.length, 0);
    lines.push(`     ${violations.length} file(s), ${totalNodes} node(s)`);
    if (first.helpUrl) lines.push(`     Docs: ${first.helpUrl}`);
    lines.push("");
  }

  return lines.join("\n");
}
