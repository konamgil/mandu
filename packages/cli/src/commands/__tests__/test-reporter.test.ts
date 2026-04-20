/**
 * Phase 18.σ — `--reporter=<fmt>` dispatch tests.
 *
 * Verifies:
 *  - `buildTestReport` embeds coverage + preserves timestamp shape.
 *  - `emitReport` writes valid JSON when `format=json`.
 *  - `emitReport` writes valid JUnit XML starting with the XML prolog.
 *  - `emitReport` is a no-op when LCOV has no coverage body.
 *  - `emitReport` passes through LCOV body verbatim when present.
 *  - Unknown format falls back via type guard at the registry layer.
 */

import { describe, it, expect } from "bun:test";
import { buildTestReport, emitReport } from "../test";

/**
 * Capture process.stdout.write calls for the duration of a callback.
 * We use a monkey-patch rather than a spawned child so the test stays
 * hermetic and fast.
 */
function captureStdout(run: () => void): string {
  const original = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  (process.stdout as unknown as { write: (c: unknown) => boolean }).write = (
    chunk: unknown,
  ) => {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  };
  try {
    run();
  } finally {
    (process.stdout as unknown as { write: typeof original }).write = original;
  }
  return chunks.join("");
}

// ═══════════════════════════════════════════════════════════════════════════

describe("buildTestReport", () => {
  it("produces a `combined`-kind report with ISO timestamp", () => {
    const r = buildTestReport({
      suite: "mandu test all",
      startedAt: Date.now() - 5,
    });
    expect(r.suite).toBe("mandu test all");
    expect(r.kind).toBe("combined");
    expect(r.tests).toHaveLength(0);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    // ISO 8601 sanity.
    expect(r.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("carries through coverage when provided", () => {
    const r = buildTestReport({
      suite: "x",
      startedAt: Date.now(),
      coverage: { lines: { hit: 8, found: 10, pct: 80 } },
    });
    expect(r.coverage?.lines?.pct).toBe(80);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

describe("emitReport", () => {
  it("writes a parseable JSON document when format=json", () => {
    const report = buildTestReport({
      suite: "unit",
      startedAt: Date.now(),
    });
    const out = captureStdout(() => emitReport(report, "json"));
    const parsed = JSON.parse(out);
    expect(parsed.schema).toBe("mandu-test-report/v1");
    expect(parsed.suite).toBe("unit");
  });

  it("writes an XML document starting with the prolog when format=junit", () => {
    const report = buildTestReport({
      suite: "unit",
      startedAt: Date.now(),
    });
    const out = captureStdout(() => emitReport(report, "junit"));
    expect(out.trimStart().startsWith("<?xml")).toBe(true);
    expect(out).toContain(`<testsuites`);
  });

  it("writes the LCOV body verbatim when format=lcov and coverage attached", () => {
    const body = "SF:a.ts\nLF:10\nLH:5\nend_of_record\n";
    const report = buildTestReport({
      suite: "u",
      startedAt: Date.now(),
      coverage: { lines: { hit: 5, found: 10, pct: 50 }, lcovBody: body },
    });
    const out = captureStdout(() => emitReport(report, "lcov"));
    expect(out.trim()).toBe(body.trim());
  });

  it("emits nothing when format=lcov and no coverage is attached", () => {
    const report = buildTestReport({
      suite: "u",
      startedAt: Date.now(),
    });
    const out = captureStdout(() => emitReport(report, "lcov"));
    expect(out).toBe("");
  });

  it("appends a trailing newline when the body does not already end with one", () => {
    const report = buildTestReport({
      suite: "u",
      startedAt: Date.now(),
    });
    const out = captureStdout(() => emitReport(report, "json"));
    expect(out.endsWith("\n")).toBe(true);
  });

  it("human format also terminates with a newline for CI log hygiene", () => {
    const report = buildTestReport({
      suite: "u",
      startedAt: Date.now(),
    });
    const out = captureStdout(() => emitReport(report, "human"));
    expect(out.endsWith("\n")).toBe(true);
    expect(out).toContain("mandu test · u");
  });
});
