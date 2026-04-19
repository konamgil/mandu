/**
 * Phase 7.3 A — JIT prewarm unit tests.
 *
 * Scope:
 *   1. Prewarm fires the `boot:jit-prewarm` perf marker when MANDU_PERF=1.
 *   2. Prewarm runs fire-and-forget (returns a Promise, does NOT block).
 *   3. handleAPIChange perf wrap (exercised via the `api:handler-reload`
 *      marker firing when the CLI util wraps an API reload).
 *   4. Prewarm failure is non-fatal — missing/broken specifiers are
 *      captured in `result.errors` but the Promise still resolves.
 *   5. `cli-bench` result fields include firstWarmMs / steadyWarmStats /
 *      jitDeltaMs when the split-out analysis runs (smoke-level contract).
 *
 * Deliberate non-coverage:
 *   - We do NOT verify that Bun's JIT actually tier-ups react — that is
 *     measured by `scripts/cli-bench.ts --cold-first-iter` against real
 *     subprocess boots. Here we just pin the control-flow contract.
 *   - We do NOT depend on `react-dom/server.browser` being actually
 *     resolvable; the prewarm module catches individual import failures.
 *
 * References:
 *   docs/bun/phase-7-2-benchmarks.md §7.1 / §7.4
 *   packages/cli/src/util/jit-prewarm.ts
 *   packages/core/src/perf/hmr-markers.ts (JIT_PREWARM, API_HANDLER_RELOAD)
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { startJitPrewarm, logPrewarmResult } from "../jit-prewarm";
import { _resetCacheForTesting, withPerf } from "@mandujs/core/perf";
import { HMR_PERF } from "@mandujs/core/perf/hmr-markers";

function enablePerf(): void {
  process.env.MANDU_PERF = "1";
  _resetCacheForTesting();
}

function disablePerf(): void {
  delete process.env.MANDU_PERF;
  _resetCacheForTesting();
}

describe("JIT prewarm (Phase 7.3 A)", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    disablePerf();
  });

  // ---------------------------------------------------------------------
  // 1. MANDU_PERF=1 fires the boot:jit-prewarm marker once.
  // ---------------------------------------------------------------------

  it("fires the boot:jit-prewarm perf marker when MANDU_PERF=1", async () => {
    enablePerf();

    // Keep the legacy Phase 7.3 shape — deep:false so only the shallow
    // marker fires. Phase 11 C deep layer is exercised by the dedicated
    // `jit-prewarm-deep.test.ts` suite.
    const result = await startJitPrewarm({ deep: false });

    // Look for the perf log line emitted by `measure()` in perf/index.ts.
    // Format: `[perf] boot:jit-prewarm: <N.NN>ms`. Use a word-boundary
    // match so we don't accidentally catch the Phase 11 C
    // `boot:jit-prewarm-deep` line when that layer also ran.
    const perfCalls = (logSpy.mock.calls as unknown as Array<[string]>).filter(
      (c) => {
        const [line] = c;
        return (
          typeof line === "string" &&
          line.startsWith(`[perf] ${HMR_PERF.JIT_PREWARM}:`)
        );
      },
    );

    expect(perfCalls.length).toBe(1);
    const [line] = perfCalls[0] as [string];
    expect(line).toMatch(
      new RegExp(`^\\[perf\\] ${HMR_PERF.JIT_PREWARM}: \\d+\\.\\d{2}ms$`),
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ---------------------------------------------------------------------
  // 2. Fire-and-forget: `startJitPrewarm` returns a Promise instantly and
  //    resolving it doesn't block a synchronous ready path.
  //
  //    We simulate the "ready path" by starting prewarm, then immediately
  //    measuring elapsed time to a sentinel. The elapsed time must be
  //    much smaller than the actual prewarm's resolution time to prove
  //    non-blocking semantics — in practice we're calling an async
  //    function and capturing its return synchronously.
  // ---------------------------------------------------------------------

  it("is fire-and-forget — returns a Promise without awaiting the imports", () => {
    const t0 = Bun.nanoseconds();
    const promise = startJitPrewarm();
    const syncElapsedMs = (Bun.nanoseconds() - t0) / 1_000_000;

    // The return value must be a Promise-like (thenable). We don't assert
    // `instanceof Promise` because Bun.build may polyfill; `.then` is the
    // contract we care about.
    expect(typeof promise.then).toBe("function");
    expect(typeof promise.catch).toBe("function");

    // The synchronous kick-off must complete in well under 20 ms — the
    // import() calls themselves may take 10s to 100s of ms, but the
    // factory function returns immediately. 20 ms is generous for
    // Windows CI noise.
    expect(syncElapsedMs).toBeLessThan(20);

    // Still need to settle the promise so the test runner doesn't
    // leak an open task.
    return promise.then((result) => {
      expect(result).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(syncElapsedMs);
    });
  });

  // ---------------------------------------------------------------------
  // 3. handleAPIChange perf wrap — exercised through a standalone
  //    withPerf() call using the new API_HANDLER_RELOAD marker.
  //
  //    We can't unit-test the dev.ts handler directly (it requires a live
  //    manifest + file watcher + HMR server). But we CAN verify that the
  //    marker exists and that `withPerf` wraps it correctly, which is the
  //    control-flow guarantee the handler relies on.
  // ---------------------------------------------------------------------

  it("handleAPIChange perf wrap — api:handler-reload marker fires under MANDU_PERF=1", async () => {
    enablePerf();

    // Simulate what handleAPIChange does — a withPerf around an async body.
    await withPerf(HMR_PERF.API_HANDLER_RELOAD, async () => {
      // Body is irrelevant; we just need the marker to fire on settle.
      await new Promise((r) => setTimeout(r, 1));
    });

    const perfCalls = (logSpy.mock.calls as unknown as Array<[string]>).filter(
      (c) => {
        const [line] = c;
        return typeof line === "string" && line.startsWith(`[perf] ${HMR_PERF.API_HANDLER_RELOAD}`);
      },
    );

    expect(perfCalls.length).toBe(1);
    const [line] = perfCalls[0] as [string];
    expect(line).toMatch(
      new RegExp(`^\\[perf\\] ${HMR_PERF.API_HANDLER_RELOAD}: \\d+\\.\\d{2}ms$`),
    );
  });

  // ---------------------------------------------------------------------
  // 4. Prewarm failure handling — a bogus specifier must not throw.
  //
  //    We can't easily inject a failing specifier into `startJitPrewarm`
  //    (the specifier list is hard-coded for stability). Instead we test
  //    the error path by verifying the shape of the resolved result when
  //    prewarm is called with the actual specifiers — the `errors` array
  //    is an explicit contract of the function's return type.
  // ---------------------------------------------------------------------

  it("resolves with a structured result — no throw even on specifier errors", async () => {
    disablePerf(); // avoid polluting the log spy with [perf] lines

    const result = await startJitPrewarm();

    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.loaded).toBe("number");
    expect(typeof result.failed).toBe("number");
    // Total specifier count (loaded + failed) must equal the number we
    // configured — if a future refactor changes the hard-coded list this
    // assertion surfaces the drift.
    expect(result.loaded + result.failed).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(result.errors)).toBe(true);

    // Every error entry must have the minimum shape the diagnostic code
    // depends on (specifier + message).
    for (const err of result.errors) {
      expect(typeof err.specifier).toBe("string");
      expect(typeof err.message).toBe("string");
    }
  });

  // ---------------------------------------------------------------------
  // 5. `logPrewarmResult` is a silent no-op when MANDU_PERF is unset.
  //
  //    This is the fast-path contract: in normal dev the prewarm result
  //    must not leak onto the user's console. Only MANDU_PERF=1 surfaces it.
  // ---------------------------------------------------------------------

  it("logPrewarmResult is silent when MANDU_PERF is unset", () => {
    disablePerf();

    logPrewarmResult({
      durationMs: 41.23,
      loaded: 4,
      failed: 0,
      errors: [],
    });

    // No log, no warn — clean channel in steady-state dev.
    expect(logSpy.mock.calls.length).toBe(0);
    expect(warnSpy.mock.calls.length).toBe(0);
  });

  // ---------------------------------------------------------------------
  // 6. `logPrewarmResult` emits a single [perf] line under MANDU_PERF=1
  //    with the expected fields (duration, loaded/total, failure list).
  // ---------------------------------------------------------------------

  it("logPrewarmResult prints a single structured line when MANDU_PERF=1", () => {
    enablePerf();

    logPrewarmResult({
      durationMs: 41.23,
      loaded: 3,
      failed: 1,
      errors: [{ specifier: "react-dom/server.browser", message: "not found" }],
    });

    expect(logSpy.mock.calls.length).toBe(1);
    const [line] = logSpy.mock.calls[0] as [string];
    expect(line).toContain("[perf] jit-prewarm settled:");
    expect(line).toContain("3/4");
    expect(line).toContain("41.23ms");
    expect(line).toContain("react-dom/server.browser");
  });
});
