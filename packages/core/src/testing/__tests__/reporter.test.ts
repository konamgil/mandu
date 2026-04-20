/**
 * Phase 18.σ — Regression tests for the unified test reporter.
 *
 * Covers:
 *   - `summarizeReport` counter math
 *   - `formatHuman` — color-on/color-off parity, grouping, error body
 *   - `formatJson` — schema version + round-trip stability
 *   - `formatJunit` — root element + per-suite buckets + XML escape
 *   - `formatLcov` — body passthrough + synthetic fallback
 *   - `mergeReports` — empty / single / multi-report shapes
 *   - `checkCoverageThresholds` — pass / fail / no-config / missing metric
 *   - `formatThresholdFailure` — per-metric breakdown
 *   - `parseLcovSummary` — LF/LH/BRF/BRH/FNF/FNH aggregation
 */

import { describe, it, expect } from "bun:test";
import {
  formatReport,
  formatHuman,
  formatJson,
  formatJunit,
  formatLcov,
  mergeReports,
  summarizeReport,
  checkCoverageThresholds,
  formatThresholdFailure,
  parseLcovSummary,
  emptyReport,
  type TestReport,
} from "../reporter";

function makeReport(overrides: Partial<TestReport> = {}): TestReport {
  return {
    suite: "unit",
    kind: "unit",
    tests: [
      { name: "adds 1+1", status: "passed", durationMs: 2, suite: "math" },
      {
        name: "divides by zero",
        status: "failed",
        durationMs: 5,
        suite: "math",
        error: { message: "Infinity, not NaN" },
      },
      { name: "draft", status: "skipped", durationMs: 0, suite: "misc" },
    ],
    durationMs: 7,
    timestamp: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// summarizeReport
// ═══════════════════════════════════════════════════════════════════════════

describe("summarizeReport", () => {
  it("counts each status bucket correctly", () => {
    const s = summarizeReport(makeReport());
    expect(s.total).toBe(3);
    expect(s.passed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.skipped).toBe(1);
    expect(s.todo).toBe(0);
    expect(s.durationMs).toBe(7);
  });

  it("handles an empty report without NaNs", () => {
    const s = summarizeReport(emptyReport("unit", "unit"));
    expect(s.total).toBe(0);
    expect(s.passed).toBe(0);
    expect(s.durationMs).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatHuman
// ═══════════════════════════════════════════════════════════════════════════

describe("formatHuman", () => {
  it("emits the suite heading and every test line", () => {
    const out = formatHuman(makeReport(), { noColor: true });
    expect(out).toContain("mandu test · unit");
    expect(out).toContain("adds 1+1");
    expect(out).toContain("divides by zero");
    expect(out).toContain("draft");
  });

  it("prints the failure message beneath failed tests", () => {
    const out = formatHuman(makeReport(), { noColor: true });
    expect(out).toContain("Infinity, not NaN");
  });

  it("emits summary counters on the final summary line", () => {
    const out = formatHuman(makeReport(), { noColor: true });
    expect(out).toContain("1 passed");
    expect(out).toContain("1 failed");
    expect(out).toContain("1 skipped");
    expect(out).toContain("3 total");
  });

  it("prints the coverage block when present", () => {
    const out = formatHuman(
      makeReport({
        coverage: {
          lines: { hit: 80, found: 100, pct: 80 },
          lcovPath: ".mandu/coverage/lcov.info",
        },
      }),
      { noColor: true },
    );
    expect(out).toContain("Coverage");
    expect(out).toContain("80.00%");
    expect(out).toContain(".mandu/coverage/lcov.info");
  });

  it("produces identical text content with and without color", () => {
    const colored = formatHuman(makeReport(), { noColor: false });
    const plain = formatHuman(makeReport(), { noColor: true });
    // Strip ANSI — the visible text should match.
    // eslint-disable-next-line no-control-regex
    const stripped = colored.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toBe(plain);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatJson
// ═══════════════════════════════════════════════════════════════════════════

describe("formatJson", () => {
  it("emits a parseable document with the schema version", () => {
    const out = formatJson(makeReport());
    const parsed = JSON.parse(out);
    expect(parsed.schema).toBe("mandu-test-report/v1");
    expect(parsed.suite).toBe("unit");
    expect(parsed.kind).toBe("unit");
    expect(parsed.summary.total).toBe(3);
    expect(Array.isArray(parsed.tests)).toBe(true);
    expect(parsed.tests).toHaveLength(3);
  });

  it("includes structured failure data", () => {
    const parsed = JSON.parse(formatJson(makeReport()));
    const failed = parsed.tests.find((t: { status: string }) => t.status === "failed");
    expect(failed).toBeDefined();
    expect(failed.error.message).toBe("Infinity, not NaN");
  });

  it("preserves coverage metrics when present", () => {
    const parsed = JSON.parse(
      formatJson(
        makeReport({
          coverage: {
            lines: { hit: 80, found: 100, pct: 80 },
            branches: { hit: 10, found: 20, pct: 50 },
          },
        }),
      ),
    );
    expect(parsed.coverage.lines).toEqual({ hit: 80, found: 100, pct: 80 });
    expect(parsed.coverage.branches.pct).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatJunit
// ═══════════════════════════════════════════════════════════════════════════

describe("formatJunit", () => {
  it("emits an XML document with the testsuites root", () => {
    const out = formatJunit(makeReport());
    expect(out.startsWith("<?xml")).toBe(true);
    expect(out).toContain(`<testsuites name="unit"`);
    expect(out).toContain(`tests="3"`);
    expect(out).toContain(`failures="1"`);
    expect(out).toContain(`skipped="1"`);
  });

  it("buckets cases into per-suite <testsuite> blocks", () => {
    const out = formatJunit(makeReport());
    expect(out).toContain(`<testsuite name="math"`);
    expect(out).toContain(`<testsuite name="misc"`);
  });

  it("emits <failure> for failed tests with the error message", () => {
    const out = formatJunit(makeReport());
    expect(out).toContain(
      `<failure message="Infinity, not NaN" type="AssertionError">`,
    );
  });

  it("escapes XML-dangerous characters in names and messages", () => {
    const report = makeReport({
      tests: [
        {
          name: `weird <name> & "quoted"`,
          status: "failed",
          durationMs: 1,
          error: { message: `fail <body> & "q"` },
        },
      ],
      suite: "x",
      kind: "unit",
    });
    const out = formatJunit(report);
    expect(out).not.toContain(`weird <name>`);
    expect(out).toContain(`&lt;name&gt;`);
    expect(out).toContain(`&quot;quoted&quot;`);
    expect(out).toContain(`fail &lt;body&gt;`);
  });

  it("emits <skipped/> for skipped and todo tests", () => {
    const out = formatJunit(makeReport());
    expect(out).toContain(`<skipped/>`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatLcov
// ═══════════════════════════════════════════════════════════════════════════

describe("formatLcov", () => {
  it("returns empty string when no coverage is attached", () => {
    expect(formatLcov(makeReport())).toBe("");
  });

  it("passes through lcovBody when present", () => {
    const body = "SF:x.ts\nLF:10\nLH:7\nend_of_record\n";
    const out = formatLcov(
      makeReport({
        coverage: { lines: { hit: 7, found: 10, pct: 70 }, lcovBody: body },
      }),
    );
    expect(out).toBe(body);
  });

  it("synthesizes a minimal summary when lcovBody is missing", () => {
    const out = formatLcov(
      makeReport({
        coverage: { lines: { hit: 7, found: 10, pct: 70 } },
      }),
    );
    expect(out).toContain("LF:10");
    expect(out).toContain("LH:7");
    expect(out).toContain("end_of_record");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatReport dispatch
// ═══════════════════════════════════════════════════════════════════════════

describe("formatReport", () => {
  it("dispatches to the correct formatter", () => {
    const r = makeReport();
    expect(formatReport(r, "human", { noColor: true })).toBe(
      formatHuman(r, { noColor: true }),
    );
    expect(formatReport(r, "json")).toBe(formatJson(r));
    expect(formatReport(r, "junit")).toBe(formatJunit(r));
    expect(formatReport(r, "lcov")).toBe(formatLcov(r));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// mergeReports
// ═══════════════════════════════════════════════════════════════════════════

describe("mergeReports", () => {
  it("returns a synthetic empty report for zero inputs", () => {
    const r = mergeReports();
    expect(r.suite).toBe("combined");
    expect(r.kind).toBe("combined");
    expect(r.tests).toHaveLength(0);
    expect(r.durationMs).toBe(0);
  });

  it("returns the input verbatim when called with one report", () => {
    const r = makeReport();
    expect(mergeReports(r)).toBe(r);
  });

  it("concatenates tests and sums durations", () => {
    const a = makeReport({ suite: "unit" });
    const b = makeReport({
      suite: "integration",
      tests: [{ name: "it works", status: "passed", durationMs: 3 }],
      durationMs: 3,
      timestamp: "2026-04-20T12:00:00.000Z",
    });
    const merged = mergeReports(a, b);
    expect(merged.suite).toBe("combined");
    expect(merged.kind).toBe("combined");
    expect(merged.tests).toHaveLength(4);
    expect(merged.durationMs).toBe(10);
    expect(merged.timestamp).toBe("2026-04-20T12:00:00.000Z");
  });

  it("picks the last non-empty coverage block", () => {
    const a = makeReport({
      coverage: { lines: { hit: 5, found: 10, pct: 50 } },
    });
    const b = makeReport({
      coverage: { lines: { hit: 8, found: 10, pct: 80 } },
    });
    const merged = mergeReports(a, b);
    expect(merged.coverage?.lines?.pct).toBe(80);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// checkCoverageThresholds
// ═══════════════════════════════════════════════════════════════════════════

describe("checkCoverageThresholds", () => {
  const coverage = {
    lines: { hit: 80, found: 100, pct: 80 },
    branches: { hit: 30, found: 60, pct: 50 },
    functions: { hit: 9, found: 10, pct: 90 },
  };

  it("passes when all metrics are at or above target", () => {
    const res = checkCoverageThresholds(coverage, {
      lines: 80,
      branches: 50,
      functions: 90,
    });
    expect(res.ok).toBe(true);
    expect(res.breakdown).toHaveLength(3);
    expect(res.breakdown.every((b) => b.ok)).toBe(true);
  });

  it("fails when a metric is below target", () => {
    const res = checkCoverageThresholds(coverage, { branches: 80 });
    expect(res.ok).toBe(false);
    expect(res.breakdown).toHaveLength(1);
    expect(res.breakdown[0]!.metric).toBe("branches");
    expect(res.breakdown[0]!.ok).toBe(false);
    expect(res.breakdown[0]!.actual).toBe(50);
    expect(res.breakdown[0]!.expected).toBe(80);
  });

  it("returns ok=true and empty breakdown when thresholds undefined", () => {
    const res = checkCoverageThresholds(coverage, undefined);
    expect(res.ok).toBe(true);
    expect(res.breakdown).toHaveLength(0);
  });

  it("treats missing metric as actual=0 when threshold is set", () => {
    const res = checkCoverageThresholds(
      { lines: { hit: 80, found: 100, pct: 80 } },
      { statements: 50 },
    );
    expect(res.ok).toBe(false);
    expect(res.breakdown[0]!.actual).toBe(0);
  });

  it("skips metrics with zero or negative thresholds", () => {
    const res = checkCoverageThresholds(coverage, {
      lines: 0,
      branches: -5,
      functions: 80,
    });
    expect(res.breakdown).toHaveLength(1);
    expect(res.breakdown[0]!.metric).toBe("functions");
  });

  it("tolerates float-precision near-match at the threshold", () => {
    // 80.0 minus a sub-nanosecond rounding artefact still counts as meeting
    // the threshold, thanks to the 1e-9 tolerance.
    const res = checkCoverageThresholds(
      { lines: { hit: 80, found: 100, pct: 80 - 1e-12 } },
      { lines: 80 },
    );
    expect(res.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatThresholdFailure
// ═══════════════════════════════════════════════════════════════════════════

describe("formatThresholdFailure", () => {
  it("lists every failing metric with actual/expected values", () => {
    const res = checkCoverageThresholds(
      {
        lines: { hit: 5, found: 10, pct: 50 },
        branches: { hit: 1, found: 10, pct: 10 },
      },
      { lines: 80, branches: 50 },
    );
    const out = formatThresholdFailure(res);
    expect(out).toContain("Coverage below threshold:");
    expect(out).toContain("lines");
    expect(out).toContain("50.00%");
    expect(out).toContain("< 80%");
    expect(out).toContain("branches");
    expect(out).toContain("10.00%");
  });

  it("returns empty string when no metric fails", () => {
    const res = checkCoverageThresholds(
      { lines: { hit: 80, found: 100, pct: 80 } },
      { lines: 80 },
    );
    expect(formatThresholdFailure(res)).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseLcovSummary
// ═══════════════════════════════════════════════════════════════════════════

describe("parseLcovSummary", () => {
  it("aggregates LF/LH/BRF/BRH/FNF/FNH across records", () => {
    const body = [
      "SF:a.ts",
      "FNF:2",
      "FNH:1",
      "BRF:4",
      "BRH:2",
      "LF:10",
      "LH:7",
      "end_of_record",
      "SF:b.ts",
      "FNF:3",
      "FNH:3",
      "LF:5",
      "LH:5",
      "end_of_record",
    ].join("\n");
    const c = parseLcovSummary(body);
    expect(c.lines).toEqual({ hit: 12, found: 15, pct: 80 });
    expect(c.branches).toEqual({ hit: 2, found: 4, pct: 50 });
    expect(c.functions).toEqual({ hit: 4, found: 5, pct: 80 });
    expect(c.files).toBe(2);
    expect(c.lcovBody).toBe(body);
  });

  it("omits metric blocks with zero records", () => {
    const body = "SF:a.ts\nLF:0\nLH:0\nend_of_record\n";
    const c = parseLcovSummary(body);
    expect(c.lines).toBeUndefined();
    expect(c.branches).toBeUndefined();
    expect(c.functions).toBeUndefined();
  });

  it("is tolerant to CRLF line endings", () => {
    const body = "SF:a.ts\r\nLF:10\r\nLH:5\r\nend_of_record\r\n";
    const c = parseLcovSummary(body);
    expect(c.lines?.pct).toBe(50);
  });
});
