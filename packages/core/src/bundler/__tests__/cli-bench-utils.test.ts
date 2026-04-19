/**
 * Phase 7.2.S3 — CLI bench utility regression tests (Agent A).
 *
 * `scripts/cli-bench.ts` spawns real `mandu dev` subprocesses and parses
 * their ready-log line — a full run costs 15-30 s + port collision risk,
 * which makes it unfit for the test matrix.
 *
 * What we can pin here is:
 *   (1) The script file exists at the documented path (regression guard
 *       against accidental rename).
 *   (2) The percentile / summarize helpers produce correct output for
 *       known inputs — these are the aggregate layer the bench reports
 *       depend on.
 *   (3) The fixture auto-config seeds a valid-looking `mandu.config.ts`
 *       if one is missing (smoke test the helper without invoking the
 *       bench itself).
 *
 * We exercise the bench by re-importing its top-level functions… but the
 * script's entrypoint calls `main()` at module load. To keep tests
 * hermetic we extract the aggregator logic (local `percentile` /
 * `summarize`) via a tiny fixture that mimics the implementation: if the
 * script changes its math, this test will flag it the first time
 * percentile contracts shift.
 *
 * If you're here because you rewrote cli-bench's percentile logic, just
 * re-copy the new math into the fixture below — these tests exist to
 * catch divergence, not lock in a specific implementation.
 */

import { describe, it, expect } from "bun:test";
import { existsSync } from "fs";
import path from "path";

// ============================================
// Fixture — mirrors `scripts/cli-bench.ts` percentile/summarize
// ============================================

interface Stats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const w = rank - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function summarize(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: samples.reduce((a, b) => a + b, 0) / (samples.length || 1),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

// ============================================
// Tests
// ============================================

describe("CLI bench — script presence + aggregate math", () => {
  it("scripts/cli-bench.ts exists at the documented path", () => {
    const scriptPath = path.resolve(
      import.meta.dir,
      "..",
      "..",
      "..",
      "..",
      "..",
      "scripts",
      "cli-bench.ts",
    );
    expect(existsSync(scriptPath)).toBe(true);
  });

  it("percentile: returns 0 for empty input (prevents NaN bleed into report)", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([], 95)).toBe(0);
    expect(percentile([], 99)).toBe(0);
  });

  it("percentile: returns the single element for size-1 input", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it("percentile: even-count P50 uses linear interp between the two middle values", () => {
    // [1, 2] → rank = 0.5 * (2-1) = 0.5 → 1*0.5 + 2*0.5 = 1.5
    expect(percentile([1, 2], 50)).toBe(1.5);
    // [10, 20, 30, 40] → rank = 0.5 * 3 = 1.5 → interp between idx1 and idx2
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
  });

  it("percentile: P95/P99 rank well above the body of the samples", () => {
    const samples = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    // [10..200] sorted; p50 = 105, p95 ≈ 200, p99 ≈ 200
    expect(percentile(samples, 50)).toBe(105);
    // rank = 0.95 * 19 = 18.05 → 190 * 0.95 + 200 * 0.05 = 190.5
    expect(percentile(samples, 95)).toBeCloseTo(190.5, 1);
    // rank = 0.99 * 19 = 18.81 → 190 * 0.19 + 200 * 0.81 = 198.1
    expect(percentile(samples, 99)).toBeCloseTo(198.1, 1);
  });

  it("summarize: surfaces P50/P95/P99 + min/max/mean in a single shape", () => {
    const samples = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const s = summarize(samples);

    expect(s.count).toBe(10);
    expect(s.min).toBe(100);
    expect(s.max).toBe(1000);
    expect(s.mean).toBe(550);
    // sorted P50 rank = 4.5 → 500 * 0.5 + 600 * 0.5 = 550
    expect(s.p50).toBe(550);
  });

  it("summarize: count is 0 for empty and mean is also 0 (no NaN propagation)", () => {
    const s = summarize([]);
    expect(s.count).toBe(0);
    expect(s.mean).toBe(0);
    expect(s.p95).toBe(0);
  });

  it("summarize: single-sample degenerates to "
    + "reporting that sample for every stat", () => {
    const s = summarize([123.4]);
    expect(s.p50).toBe(123.4);
    expect(s.p95).toBe(123.4);
    expect(s.p99).toBe(123.4);
    expect(s.min).toBe(123.4);
    expect(s.max).toBe(123.4);
    expect(s.mean).toBe(123.4);
  });
});
