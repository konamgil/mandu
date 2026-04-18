/**
 * Phase 7.0 R3 Agent F — Hard-assertion performance gate.
 *
 * Enforces the `HMR_PERF_TARGETS` thresholds as `bun:test` assertions so
 * CI can catch a regression before it lands in main.
 *
 * # Why a separate spec
 *
 * `matrix.spec.ts` uses SOFT assertions (console.warn on miss) — it owns
 * the 36-cell correctness contract. This file owns the performance
 * contract. Keeping them separate lets `matrix.spec.ts` stay green even
 * when a Windows fs.watch hiccup produces a single slow iteration, while
 * this file aggregates across many samples to stabilize the judgement.
 *
 * # Gating
 *
 * This suite runs only when BOTH:
 *   - `CI=1` is set (so local devs don't pay the ~2-3 minute cost on
 *     every `bun test` invocation)
 *   - `MANDU_SKIP_BUNDLER_TESTS !== "1"` (respect the existing Phase 4c
 *     bundler-test opt-out)
 *
 * Local dry-run:
 *
 *   CI=1 bun test packages/core/tests/hmr-matrix/perf.spec.ts
 *
 * # Fixture choice
 *
 * We run a reduced benchmark (`CELLS_ONLY=hybrid`, 5 iter) for the CI
 * assertion because a full 36-cell × 20-iter run costs 5-10 minutes.
 * The hybrid form exercises EVERY behavior variant (island, ssr, css,
 * code-regen, server-restart, prerender-regen is n/a here — pure-ssg
 * owns it). Island + SSR + common-dir targets are the ones the CI gate
 * actually polices.
 *
 * # Measurement semantics
 *
 * The assertions compare against the `REBUILD_TOTAL` scope (what
 * `HMR_PERF_TARGETS` is defined against), not the end-to-end wall-clock.
 * See `scripts/hmr-bench.ts` module docstring for the scope boundary.
 */

import { describe, test, expect } from "bun:test";
import { runBenchmark } from "../../../../scripts/hmr-bench";
import { HMR_PERF_TARGETS } from "../../src/perf/hmr-markers";

const gate =
  process.env.CI !== "1" ||
  process.env.MANDU_SKIP_BUNDLER_TESTS === "1";

/**
 * All four assertions share one benchmark run to amortize the fixture
 * setup cost (bundler boot × form × iterations). `beforeAll` doesn't
 * return data to tests in `bun:test`, so we cache the result on a shared
 * module-level promise that each test awaits.
 *
 * NOTE: This pattern intentionally diverges from `matrix.spec.ts` (which
 * re-scaffolds per cell). At CI-gate iteration counts (5), running 4
 * separate benchmarks would triple the wall-clock without improving
 * assertion quality — the samples are independent across forms/cells
 * inside the single run.
 */
let benchPromise: ReturnType<typeof runBenchmark> | null = null;
function getBench(): ReturnType<typeof runBenchmark> {
  if (benchPromise === null) {
    benchPromise = runBenchmark({
      iterations: 5,
      skipCold: true, // Cold start is noisy on CI runners — assert separately.
      cellsOnly: "hybrid",
    });
  }
  return benchPromise;
}

describe.skipIf(gate)("Phase 7.0 perf targets — hard assertions", () => {
  test(
    `SSR rebuild P95 <= ${HMR_PERF_TARGETS.SSR_REBUILD_P95_MS} ms`,
    async () => {
      const report = await getBench();
      const p95 = report.hardAssertions.ssrP95Ms;
      // A null here means the aggregate pool was empty — the harness
      // produced no SSR samples. That's a correctness failure, not a
      // performance failure, so we fail loudly rather than ignoring.
      expect(p95).not.toBeNull();
      expect(p95!).toBeLessThanOrEqual(HMR_PERF_TARGETS.SSR_REBUILD_P95_MS);
    },
    180_000,
  );

  test(
    `Island rebuild P95 <= ${HMR_PERF_TARGETS.ISLAND_REBUILD_P95_MS} ms`,
    async () => {
      const report = await getBench();
      const p95 = report.hardAssertions.islandP95Ms;
      expect(p95).not.toBeNull();
      expect(p95!).toBeLessThanOrEqual(HMR_PERF_TARGETS.ISLAND_REBUILD_P95_MS);
    },
    180_000,
  );

  test(
    `Common-dir rebuild P95 <= ${HMR_PERF_TARGETS.COMMON_DIR_REBUILD_P95_MS} ms`,
    async () => {
      const report = await getBench();
      const p95 = report.hardAssertions.commonDirP95Ms;
      expect(p95).not.toBeNull();
      expect(p95!).toBeLessThanOrEqual(
        HMR_PERF_TARGETS.COMMON_DIR_REBUILD_P95_MS,
      );
    },
    180_000,
  );
});

/**
 * Cold start is measured separately with its own targeted iteration count.
 *
 * - `SKIP_COLD=1` env override respected (CI may disable if the runner's
 *   bun subprocess startup is consistently flaky).
 * - 3 reps × 3 fixtures = 9 samples pool — enough to compute a P95 within
 *   the gate's <120s budget.
 *
 * Why not reuse the shared `benchPromise`: the `cellsOnly: "hybrid"`
 * above intentionally excludes pure-SSG and full-interactive cold starts.
 * Running them here means we always get coverage across fixture shapes
 * even when the matrix suite is truncated.
 */
describe.skipIf(gate || process.env.SKIP_COLD === "1")(
  "Phase 7.0 perf targets — cold start",
  () => {
    test(
      `Cold dev start P95 <= ${HMR_PERF_TARGETS.COLD_START_MS} ms`,
      async () => {
        const report = await runBenchmark({
          // Skip the 36-cell sweep — we only need the cold-start pool here.
          iterations: 0,
          skipCold: false,
        });
        const p95 = report.hardAssertions.coldStartP95Ms;
        expect(p95).not.toBeNull();
        expect(p95!).toBeLessThanOrEqual(HMR_PERF_TARGETS.COLD_START_MS);
      },
      120_000,
    );
  },
);
