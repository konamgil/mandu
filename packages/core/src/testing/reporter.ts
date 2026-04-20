/**
 * @mandujs/core/testing/reporter — Phase 18.σ
 *
 * Unified test reporter for `mandu test`. Collapses the four legacy
 * stdout formats (unit / integration / e2e / coverage) into a single
 * structured `TestReport` shape with four output formats:
 *
 *   - `human`  → colorized summary for interactive terminals
 *   - `json`   → machine-readable schema, ready for pipelines
 *   - `junit`  → JUnit XML, compatible with GitHub Actions `publish-
 *                test-results`, Jenkins, CircleCI, GitLab CI
 *   - `lcov`   → pass-through / re-emit of the merged coverage LCOV
 *
 * The reporter is **pure** — it accepts a `TestReport` and returns a
 * string. No I/O, no spawning, no process.exit. The CLI composes the
 * report from runner outputs and picks the format based on
 * `--reporter=<format>`.
 *
 * ## Design constraints
 *
 * 1. **No runtime dependencies.** We hand-roll the ANSI codes and XML
 *    serializer so this module can be imported in any context
 *    (including dev mode in browsers via the MCP test doctor).
 * 2. **Deterministic output.** Tests are sorted by (suite, name) before
 *    rendering so CI diffs stay minimal. Durations are rounded to
 *    integer milliseconds. Timestamps are emitted in UTC ISO-8601 via
 *    `toISOString()` for cross-timezone stability.
 * 3. **Round-trip safe.** `mergeReports()` followed by
 *    `formatReport(r, 'json')` produces a body that can be parsed back
 *    via `JSON.parse` — every field is JSON-serializable.
 *
 * ## Coverage thresholds
 *
 * `checkCoverageThresholds(coverage, thresholds)` is a pure comparator
 * returning a structured breakdown (actual vs expected per metric).
 * The CLI layer calls this after merging LCOV and prints the human
 * error when `ok === false`.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Public types
// ═══════════════════════════════════════════════════════════════════════════

/** Outcome of a single test case inside a suite. */
export type TestStatus = "passed" | "failed" | "skipped" | "todo";

/** Test category — maps to the legacy subcommand. */
export type TestSuiteKind = "unit" | "integration" | "e2e";

/** Coverage metric names — match Bun/LCOV conventions. */
export type CoverageMetric =
  | "lines"
  | "branches"
  | "functions"
  | "statements";

export interface TestCase {
  /** Human-readable name — typically the `it(...)` description. */
  readonly name: string;
  /** Dotted suite path (e.g. `"auth > login > rate-limit"`). Optional. */
  readonly suite?: string;
  /** Outcome classification. */
  readonly status: TestStatus;
  /** Elapsed wall time in ms (integer, rounded). */
  readonly durationMs: number;
  /** Populated for `status === "failed"`. */
  readonly error?: {
    readonly message: string;
    readonly stack?: string;
  };
  /** Source file path, absolute or project-relative. */
  readonly file?: string;
}

export interface CoverageMetricResult {
  readonly hit: number;
  readonly found: number;
  /** Ratio in 0-100 range, rounded to 2 decimals. 0 when `found === 0`. */
  readonly pct: number;
}

export interface Coverage {
  readonly lines?: CoverageMetricResult;
  readonly branches?: CoverageMetricResult;
  readonly functions?: CoverageMetricResult;
  readonly statements?: CoverageMetricResult;
  /** Number of files represented in the underlying LCOV. */
  readonly files?: number;
  /** Path to the merged LCOV body. Reporter embeds this for `lcov` format. */
  readonly lcovPath?: string;
  /** Optional raw LCOV body (used by the `lcov` reporter format). */
  readonly lcovBody?: string;
}

export interface TestReport {
  /** Logical label — `"mandu test"`, `"unit"`, `"integration"`, `"e2e"`, etc. */
  readonly suite: string;
  /** Classification — used for grouping in human output. */
  readonly kind: TestSuiteKind | "combined";
  /** Every case observed for this report. */
  readonly tests: readonly TestCase[];
  /** Merged coverage metrics, if `--coverage` was enabled. */
  readonly coverage?: Coverage;
  /** Wall-clock total across all cases. Integer ms. */
  readonly durationMs: number;
  /** Report creation time — ISO 8601 UTC. */
  readonly timestamp: string;
}

/** User-configurable thresholds from `mandu.config.ts`. */
export interface CoverageThresholds {
  readonly lines?: number;
  readonly branches?: number;
  readonly functions?: number;
  readonly statements?: number;
}

export interface CoverageThresholdBreakdown {
  readonly metric: CoverageMetric;
  readonly expected: number;
  readonly actual: number;
  readonly ok: boolean;
}

export interface CoverageThresholdResult {
  /** True when no thresholds were configured, or every configured
   *  metric is at-or-above its target. */
  readonly ok: boolean;
  readonly breakdown: readonly CoverageThresholdBreakdown[];
}

export type ReporterFormat = "human" | "json" | "junit" | "lcov";

// ═══════════════════════════════════════════════════════════════════════════
// Aggregation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Combine two or more reports into one "combined" report. Useful when
 * `mandu test --e2e --coverage` has produced a unit+integration report
 * plus a separate E2E report that both need to land in a single
 * JUnit/JSON artifact.
 *
 * Rules:
 *  - Test cases are concatenated (stable order preserved).
 *  - `coverage` is **not** re-merged here — LCOV merging lives in
 *    `@mandujs/ate/coverage-merger`. We pick the last non-empty
 *    coverage block, since in the CLI pipeline coverage is computed
 *    after all runs complete.
 *  - `durationMs` is summed.
 *  - `timestamp` uses the latest reporting timestamp.
 *  - `suite` becomes `"combined"`, `kind` becomes `"combined"`.
 */
export function mergeReports(
  ...reports: readonly TestReport[]
): TestReport {
  if (reports.length === 0) {
    return {
      suite: "combined",
      kind: "combined",
      tests: [],
      durationMs: 0,
      timestamp: new Date(0).toISOString(),
    };
  }
  if (reports.length === 1) return reports[0]!;

  const tests: TestCase[] = [];
  let durationMs = 0;
  let latestTs = "";
  let coverage: Coverage | undefined;
  for (const r of reports) {
    tests.push(...r.tests);
    durationMs += r.durationMs;
    if (r.timestamp > latestTs) latestTs = r.timestamp;
    if (r.coverage) coverage = r.coverage;
  }
  return {
    suite: "combined",
    kind: "combined",
    tests,
    coverage,
    durationMs,
    timestamp: latestTs || new Date().toISOString(),
  };
}

/** Summary counters used across reporter formats. */
export interface ReportSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly todo: number;
  readonly durationMs: number;
}

export function summarizeReport(report: TestReport): ReportSummary {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let todo = 0;
  for (const t of report.tests) {
    switch (t.status) {
      case "passed":
        passed++;
        break;
      case "failed":
        failed++;
        break;
      case "skipped":
        skipped++;
        break;
      case "todo":
        todo++;
        break;
    }
  }
  return {
    total: report.tests.length,
    passed,
    failed,
    skipped,
    todo,
    durationMs: report.durationMs,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Coverage threshold check
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compare a {@link Coverage} block against configured thresholds.
 * Missing thresholds are skipped (no constraint). Missing coverage
 * metrics whose threshold is configured fail with `actual = 0`.
 *
 * Tolerance: floating-point equality uses `actual + 1e-9 >= expected`
 * to avoid spurious failures at exactly the target percentage.
 */
export function checkCoverageThresholds(
  coverage: Coverage | undefined,
  thresholds: CoverageThresholds | undefined
): CoverageThresholdResult {
  if (!thresholds) return { ok: true, breakdown: [] };

  const metrics: CoverageMetric[] = [
    "lines",
    "branches",
    "functions",
    "statements",
  ];
  const breakdown: CoverageThresholdBreakdown[] = [];
  let ok = true;
  for (const metric of metrics) {
    const expected = thresholds[metric];
    if (expected === undefined || expected <= 0) continue;
    const actual = coverage?.[metric]?.pct ?? 0;
    const metOk = actual + 1e-9 >= expected;
    if (!metOk) ok = false;
    breakdown.push({ metric, expected, actual, ok: metOk });
  }
  return { ok, breakdown };
}

/**
 * Human-readable multi-line error block listing every failing metric.
 * Safe to print to stderr — does not colorize (the caller decides).
 */
export function formatThresholdFailure(
  result: CoverageThresholdResult
): string {
  const failing = result.breakdown.filter((b) => !b.ok);
  if (failing.length === 0) return "";
  const lines = ["Coverage below threshold:"];
  for (const b of failing) {
    lines.push(
      `  - ${b.metric.padEnd(11)} ${b.actual.toFixed(2)}% < ${b.expected}%`
    );
  }
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Formatters
// ═══════════════════════════════════════════════════════════════════════════

export interface FormatOptions {
  /**
   * Disable ANSI color output. Autodetected via `NO_COLOR` / `FORCE_
   * COLOR` / `process.stdout.isTTY` when undefined.
   */
  readonly noColor?: boolean;
}

/** Public dispatch — single entry point for all four formats. */
export function formatReport(
  report: TestReport,
  format: ReporterFormat,
  opts: FormatOptions = {}
): string {
  switch (format) {
    case "human":
      return formatHuman(report, opts);
    case "json":
      return formatJson(report);
    case "junit":
      return formatJunit(report);
    case "lcov":
      return formatLcov(report);
  }
  // TypeScript exhaustiveness — surfaces bad callers at runtime too.
  throw new Error(`Unknown reporter format: ${String(format)}`);
}

// ──────── Human ──────────────────────────────────────────────────

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

function shouldColor(opts: FormatOptions): boolean {
  if (opts.noColor === true) return false;
  if (opts.noColor === false) return true;
  // Auto-detect: match the behavior of terminal/theme.ts.
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "1" || process.env.FORCE_COLOR === "true") {
    return true;
  }
  if (process.env.CI) return false;
  return Boolean(process.stdout?.isTTY);
}

function color(code: string, text: string, enabled: boolean): string {
  return enabled ? `${code}${text}${ANSI.reset}` : text;
}

function statusGlyph(status: TestStatus, colorOn: boolean): string {
  switch (status) {
    case "passed":
      return color(ANSI.green, "\u2713", colorOn); // ✓
    case "failed":
      return color(ANSI.red, "\u2717", colorOn); // ✗
    case "skipped":
      return color(ANSI.yellow, "\u25CB", colorOn); // ○
    case "todo":
      return color(ANSI.cyan, "\u2022", colorOn); // •
  }
}

export function formatHuman(
  report: TestReport,
  opts: FormatOptions = {}
): string {
  const colorOn = shouldColor(opts);
  const summary = summarizeReport(report);
  const out: string[] = [];

  const heading = `mandu test · ${report.suite}`;
  out.push(color(ANSI.bold, heading, colorOn));

  // Group tests by suite for readable grouping.
  const bySuite = new Map<string, TestCase[]>();
  for (const t of report.tests) {
    const key = t.suite ?? "(top-level)";
    const arr = bySuite.get(key) ?? [];
    arr.push(t);
    bySuite.set(key, arr);
  }
  const suiteNames = [...bySuite.keys()].sort();
  for (const suite of suiteNames) {
    out.push(color(ANSI.gray, `  ${suite}`, colorOn));
    const cases = bySuite.get(suite)!.slice().sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const t of cases) {
      const glyph = statusGlyph(t.status, colorOn);
      const ms = color(ANSI.dim, `(${Math.round(t.durationMs)}ms)`, colorOn);
      out.push(`    ${glyph} ${t.name} ${ms}`);
      if (t.status === "failed" && t.error) {
        out.push(color(ANSI.red, `      ${t.error.message}`, colorOn));
      }
    }
  }

  out.push("");
  const passedStr = color(
    ANSI.green,
    `${summary.passed} passed`,
    colorOn
  );
  const failedStr =
    summary.failed > 0
      ? color(ANSI.red, `${summary.failed} failed`, colorOn)
      : `${summary.failed} failed`;
  const skippedStr =
    summary.skipped > 0
      ? color(ANSI.yellow, `${summary.skipped} skipped`, colorOn)
      : `${summary.skipped} skipped`;
  out.push(
    `  ${passedStr}  ${failedStr}  ${skippedStr}  ${color(
      ANSI.dim,
      `(${summary.total} total, ${summary.durationMs}ms)`,
      colorOn
    )}`
  );

  if (report.coverage) {
    out.push("");
    out.push(color(ANSI.bold, "  Coverage", colorOn));
    for (const metric of [
      "lines",
      "branches",
      "functions",
      "statements",
    ] as const) {
      const c = report.coverage[metric];
      if (!c) continue;
      out.push(
        `    ${metric.padEnd(11)} ${c.pct.toFixed(2)}% (${c.hit}/${c.found})`
      );
    }
    if (report.coverage.lcovPath) {
      out.push(
        color(
          ANSI.dim,
          `    → ${report.coverage.lcovPath}`,
          colorOn
        )
      );
    }
  }

  return out.join("\n");
}

// ──────── JSON ───────────────────────────────────────────────────

/**
 * Stable JSON serialization. We deliberately do NOT key-sort so
 * human readers see the natural reporter order; stability comes from
 * the deterministic ordering of `tests` at composition time.
 */
export function formatJson(report: TestReport): string {
  const summary = summarizeReport(report);
  const payload = {
    schema: "mandu-test-report/v1",
    suite: report.suite,
    kind: report.kind,
    timestamp: report.timestamp,
    durationMs: report.durationMs,
    summary,
    tests: report.tests.map((t) => ({
      name: t.name,
      suite: t.suite ?? null,
      status: t.status,
      durationMs: Math.round(t.durationMs),
      file: t.file ?? null,
      error: t.error
        ? {
            message: t.error.message,
            stack: t.error.stack ?? null,
          }
        : null,
    })),
    coverage: report.coverage
      ? {
          lines: report.coverage.lines ?? null,
          branches: report.coverage.branches ?? null,
          functions: report.coverage.functions ?? null,
          statements: report.coverage.statements ?? null,
          files: report.coverage.files ?? null,
          lcovPath: report.coverage.lcovPath ?? null,
        }
      : null,
  };
  return JSON.stringify(payload, null, 2);
}

// ──────── JUnit XML ──────────────────────────────────────────────

/**
 * Escape text for inclusion inside an XML element or double-quoted
 * attribute. Strips the 5 XML predefined entities plus raw C0 control
 * characters (which are invalid in XML 1.0).
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

/**
 * Emit GitHub-Actions-compatible JUnit XML. Schema follows the de-
 * facto Jenkins variant (`<testsuites>` root, `<testsuite>` per suite
 * bucket, `<testcase>` per test). `time` attributes are seconds with
 * millisecond precision to match Jenkins/GitLab tooling.
 */
export function formatJunit(report: TestReport): string {
  const summary = summarizeReport(report);
  const totalSeconds = (summary.durationMs / 1000).toFixed(3);

  // Bucket by suite — each bucket becomes a <testsuite>.
  const bySuite = new Map<string, TestCase[]>();
  for (const t of report.tests) {
    const key = t.suite ?? report.suite;
    const arr = bySuite.get(key) ?? [];
    arr.push(t);
    bySuite.set(key, arr);
  }

  const suiteXml: string[] = [];
  const suiteNames = [...bySuite.keys()].sort();
  for (const suiteName of suiteNames) {
    const cases = bySuite.get(suiteName)!;
    const suiteDurationMs = cases.reduce((acc, t) => acc + t.durationMs, 0);
    const suiteFailed = cases.filter((c) => c.status === "failed").length;
    const suiteSkipped = cases.filter((c) => c.status === "skipped").length;
    const suiteAttrs = [
      `name="${escapeXml(suiteName)}"`,
      `tests="${cases.length}"`,
      `failures="${suiteFailed}"`,
      `skipped="${suiteSkipped}"`,
      `time="${(suiteDurationMs / 1000).toFixed(3)}"`,
      `timestamp="${escapeXml(report.timestamp)}"`,
    ].join(" ");

    const caseXml: string[] = [];
    for (const t of cases) {
      const caseAttrs = [
        `name="${escapeXml(t.name)}"`,
        `classname="${escapeXml(t.suite ?? report.suite)}"`,
        `time="${(t.durationMs / 1000).toFixed(3)}"`,
      ];
      if (t.file) caseAttrs.push(`file="${escapeXml(t.file)}"`);

      if (t.status === "passed") {
        caseXml.push(`    <testcase ${caseAttrs.join(" ")}/>`);
      } else if (t.status === "failed") {
        const msg = escapeXml(t.error?.message ?? "Test failed");
        const stack = escapeXml(t.error?.stack ?? "");
        caseXml.push(
          `    <testcase ${caseAttrs.join(" ")}>`,
          `      <failure message="${msg}" type="AssertionError">${stack}</failure>`,
          `    </testcase>`
        );
      } else if (t.status === "skipped" || t.status === "todo") {
        caseXml.push(
          `    <testcase ${caseAttrs.join(" ")}>`,
          `      <skipped/>`,
          `    </testcase>`
        );
      }
    }

    suiteXml.push(`  <testsuite ${suiteAttrs}>`);
    suiteXml.push(...caseXml);
    suiteXml.push(`  </testsuite>`);
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="${escapeXml(report.suite)}" tests="${summary.total}" failures="${summary.failed}" skipped="${summary.skipped}" time="${totalSeconds}">`,
    ...suiteXml,
    `</testsuites>`,
    ``,
  ].join("\n");
}

// ──────── LCOV ───────────────────────────────────────────────────

/**
 * Emit the merged LCOV body. If `report.coverage.lcovBody` is set, we
 * return it verbatim; otherwise we synthesize a minimal `SF:/LF/LH`
 * summary from the aggregate line metric (sufficient for tooling like
 * Codecov which only needs the summary line when per-file data is
 * unavailable).
 *
 * Returns an empty string when no coverage block is present — callers
 * writing to stdout should treat that as "no coverage to emit" and
 * exit early.
 */
export function formatLcov(report: TestReport): string {
  if (!report.coverage) return "";
  if (report.coverage.lcovBody) return report.coverage.lcovBody;
  const lines = report.coverage.lines;
  if (!lines) return "";
  // Minimal LCOV synthetic record — every real consumer will have the
  // full body via `lcovBody`. This path exists so the format stays
  // non-empty for round-trip tests.
  return [
    "SF:.mandu/coverage/synthetic",
    `LF:${lines.found}`,
    `LH:${lines.hit}`,
    "end_of_record",
    "",
  ].join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers for the CLI layer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute a {@link Coverage} struct from a raw LCOV body. Supports
 * `DA:` / `LF:` / `LH:` (lines), `BRF:` / `BRH:` (branches), `FNF:` /
 * `FNH:` (functions). `statements` is not present in LCOV — callers
 * wire it in separately when the underlying runner provides it.
 *
 * Exported so the CLI can build a `Coverage` block after
 * `mergeCoverageOutputs()` writes the LCOV.
 */
export function parseLcovSummary(lcovBody: string): Coverage {
  let LF = 0;
  let LH = 0;
  let BRF = 0;
  let BRH = 0;
  let FNF = 0;
  let FNH = 0;
  const files = new Set<string>();
  for (const line of lcovBody.split(/\r?\n/)) {
    if (line.startsWith("SF:")) files.add(line.slice(3));
    else if (line.startsWith("LF:")) LF += Number(line.slice(3)) || 0;
    else if (line.startsWith("LH:")) LH += Number(line.slice(3)) || 0;
    else if (line.startsWith("BRF:")) BRF += Number(line.slice(4)) || 0;
    else if (line.startsWith("BRH:")) BRH += Number(line.slice(4)) || 0;
    else if (line.startsWith("FNF:")) FNF += Number(line.slice(4)) || 0;
    else if (line.startsWith("FNH:")) FNH += Number(line.slice(4)) || 0;
  }

  const pct = (hit: number, found: number): number =>
    found === 0 ? 0 : Math.round((hit / found) * 10000) / 100;

  const result: Coverage = {
    lines: LF > 0 ? { hit: LH, found: LF, pct: pct(LH, LF) } : undefined,
    branches:
      BRF > 0 ? { hit: BRH, found: BRF, pct: pct(BRH, BRF) } : undefined,
    functions:
      FNF > 0 ? { hit: FNH, found: FNF, pct: pct(FNH, FNF) } : undefined,
    files: files.size || undefined,
    lcovBody,
  };
  return result;
}

/**
 * Convenience: build a minimal, empty-suite report. Used by callers
 * that have no per-test granularity (e.g. when we only forwarded bun
 * test's exit code but haven't parsed its stdout). Still useful for
 * `--coverage`-only runs where the reporter just needs to emit the
 * coverage block.
 */
export function emptyReport(
  suite: string,
  kind: TestSuiteKind | "combined"
): TestReport {
  return {
    suite,
    kind,
    tests: [],
    durationMs: 0,
    timestamp: new Date().toISOString(),
  };
}
