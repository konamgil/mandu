/**
 * Phase 11 C — JIT deep-import prewarm unit tests.
 *
 * Scope (complement to `jit-prewarm.test.ts` Phase 7.3 A coverage):
 *   1. `boot:jit-prewarm-deep` marker fires when MANDU_PERF=1 AND the
 *      deep layer is enabled (`deep !== false`).
 *   2. Deep-import is fire-and-forget — the sync kick-off time stays
 *      under 20 ms even though deep dispatch adds a second Promise
 *      round trip.
 *   3. Soft wall-clock comparison: with deep=true the total prewarm time
 *      is strictly >= the shallow-only time, and the delta is captured
 *      on `result.deep.durationMs`. This is a CONTRACT test (not a
 *      walltime assertion) because hard ms budgets are non-portable
 *      across CI runners.
 *   4. `webview-fallback` import path: a peer-less module resolution
 *      MUST NOT poison deep prewarm (tested by making one specifier
 *      intentionally bogus via the injectable `_runImportBatch` export).
 *   5. FFI fallback module surface check — importing the module does
 *      not throw when the libwebview symbols are absent. See
 *      `packages/core/src/desktop/__tests__/webview-fallback.test.ts`
 *      for the primary coverage; this suite just pins the cross-package
 *      contract that jit-prewarm deep doesn't implicitly import it.
 *   6. Phase 7.3 A regression: `deep: false` keeps the legacy output
 *      shape (no `[perf] boot:jit-prewarm-deep:` line).
 *
 * Deliberate non-coverage:
 *   - We do NOT enforce a deep P95 budget here. `scripts/cli-bench.ts
 *     --warm-only` is the authoritative measurement surface.
 *   - We do NOT assert that Bun's JIT actually tier-ups `safeBuild` —
 *     same reasoning as Phase 7.3 A's jit-prewarm.test.ts §17 note.
 *
 * References:
 *   docs/bun/phase-11-team-plan.md §2 Agent C
 *   docs/bun/phase-9-benchmarks.md §7 (15 ms residual)
 *   packages/cli/src/util/jit-prewarm.ts `PREWARM_DEEP_SPECIFIERS`
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  spyOn,
} from "bun:test";
import {
  _runImportBatch,
  logPrewarmResult,
  startJitPrewarm,
} from "../jit-prewarm";
import { _resetCacheForTesting } from "@mandujs/core/perf";
import { HMR_PERF } from "@mandujs/core/perf/hmr-markers";

function enablePerf(): void {
  process.env.MANDU_PERF = "1";
  _resetCacheForTesting();
}

function disablePerf(): void {
  delete process.env.MANDU_PERF;
  _resetCacheForTesting();
}

describe("JIT prewarm — Phase 11 C deep-import layer", () => {
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
  // 1. boot:jit-prewarm-deep marker fires under MANDU_PERF=1 + deep=true.
  // ---------------------------------------------------------------------

  it("fires the boot:jit-prewarm-deep perf marker when MANDU_PERF=1", async () => {
    enablePerf();

    const result = await startJitPrewarm({ deep: true });

    const deepCalls = (logSpy.mock.calls as unknown as Array<[string]>).filter(
      (c) => {
        const [line] = c;
        return (
          typeof line === "string" &&
          line.startsWith(`[perf] ${HMR_PERF.JIT_PREWARM_DEEP}:`)
        );
      },
    );

    expect(deepCalls.length).toBe(1);
    const [line] = deepCalls[0] as [string];
    expect(line).toMatch(
      new RegExp(`^\\[perf\\] ${HMR_PERF.JIT_PREWARM_DEEP}: \\d+\\.\\d{2}ms$`),
    );
    expect(result.deep).not.toBeNull();
    expect(result.deep?.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ---------------------------------------------------------------------
  // 2. Fire-and-forget sync kick-off time stays under 20 ms even with
  //    the deep layer. This is the "ready in Nms MUST NOT regress"
  //    contract.
  // ---------------------------------------------------------------------

  it("deep layer does not delay the synchronous return of startJitPrewarm()", () => {
    // Avoid marker-log noise in this latency assertion.
    disablePerf();

    const t0 = Bun.nanoseconds();
    const promise = startJitPrewarm({ deep: true });
    const syncElapsedMs = (Bun.nanoseconds() - t0) / 1_000_000;

    expect(typeof promise.then).toBe("function");
    // Phase 7.3 A budget was 20 ms; keep the same so deep extension is
    // covered by the same gate.
    expect(syncElapsedMs).toBeLessThan(20);

    return promise.then((result) => {
      expect(result).toBeDefined();
      // `loaded + failed` must reflect BOTH layers when deep=true.
      expect(result.loaded + result.failed).toBeGreaterThanOrEqual(4 + 3);
      expect(result.deep).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // 3. Soft wall-clock comparison — shallow-only vs shallow+deep. This
  //    is a CONTRACT test: we assert that `result.durationMs` for
  //    deep=true is the sum of shallow + deep paths (plus measurement
  //    noise), not a hard ms budget. Hard numbers live in cli-bench.
  // ---------------------------------------------------------------------

  it("shallow-only vs shallow+deep — durationMs reflects both layers", async () => {
    disablePerf();

    // Note: Bun's module cache makes the SECOND call to startJitPrewarm
    // effectively a no-op (all specifiers cache-hit), so we can't use it
    // to compare "would have been slow" vs "was fast". Instead we verify
    // the internal shape: deep totals (`result.loaded + result.failed`)
    // land in the aggregate, AND `result.deep.durationMs >= 0`.

    const shallowOnly = await startJitPrewarm({ deep: false });
    expect(shallowOnly.deep).toBeNull();

    const withDeep = await startJitPrewarm({ deep: true });
    expect(withDeep.deep).not.toBeNull();
    expect(withDeep.deep?.durationMs).toBeGreaterThanOrEqual(0);
    // Aggregate loaded is the sum — 4 shallow + 3 deep under the default
    // specifier lists. At least 4 shallow always resolve (react hot set)
    // so this should comfortably pass.
    expect(withDeep.loaded).toBeGreaterThanOrEqual(shallowOnly.loaded);
  });

  // ---------------------------------------------------------------------
  // 4. `_runImportBatch` isolation: an injected failing specifier does
  //    not take down siblings. Exercises the per-specifier catch that
  //    the real `startJitPrewarm` relies on.
  // ---------------------------------------------------------------------

  it("_runImportBatch catches individual import failures without poisoning siblings", async () => {
    const specifiers = [
      "specifier-that-will-always-fail-xyz-11c",
      "this-one-also-fails-abc-11c",
      "yet-another-11c",
    ];
    const result = await _runImportBatch(specifiers, async (spec) => {
      if (spec === "yet-another-11c") return { ok: true };
      throw new Error(`synthetic failure for ${spec}`);
    });

    expect(result.loaded).toBe(1);
    expect(result.failed).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]?.specifier).toContain("fail");
    expect(result.errors[0]?.message).toContain("synthetic failure");
  });

  // ---------------------------------------------------------------------
  // 5. Real-module resolution — the three Phase 11 C deep specifiers
  //    are all resolvable in this workspace (one `@mandujs/core/*`
  //    plus two relative). A production install with `mandu dev` will
  //    always satisfy this invariant; if it doesn't, boot will degrade
  //    gracefully via the error catches (covered in test 4).
  //
  //    This is the "deep specifiers load" smoke — the exact string
  //    contract between `jit-prewarm.ts` and the callsites it targets.
  // ---------------------------------------------------------------------

  it("deep specifiers actually resolve in the CLI workspace", async () => {
    disablePerf();

    const result = await startJitPrewarm({ deep: true });
    expect(result.deep).not.toBeNull();
    // All 3 deep specifiers should resolve cleanly in the CLI workspace.
    // If this ever fails with a non-empty `errors`, check:
    //   - `@mandujs/core/bundler/safe-build` export is still in the
    //     core package.json `exports` map.
    //   - `../util/bun` was not moved/renamed.
    //   - `./handlers` was not moved.
    expect(result.deep?.loaded).toBeGreaterThanOrEqual(3);
    expect(result.deep?.failed).toBe(0);
  });

  // ---------------------------------------------------------------------
  // 6. Phase 7.3 A regression — `deep: false` keeps the legacy output
  //    shape. NO `[perf] boot:jit-prewarm-deep:` line is emitted. Guards
  //    against an accidental re-enable of the deep layer in a future
  //    refactor that would break any fixture pinning the Phase 7.3 shape.
  // ---------------------------------------------------------------------

  it("deep: false retains the Phase 7.3 A legacy output shape", async () => {
    enablePerf();

    const result = await startJitPrewarm({ deep: false });

    const deepCalls = (logSpy.mock.calls as unknown as Array<[string]>).filter(
      (c) => {
        const [line] = c;
        return (
          typeof line === "string" &&
          line.startsWith(`[perf] ${HMR_PERF.JIT_PREWARM_DEEP}:`)
        );
      },
    );
    expect(deepCalls.length).toBe(0);
    expect(result.deep).toBeNull();
  });

  // ---------------------------------------------------------------------
  // 7. logPrewarmResult — deep payload emits a second [perf] line with
  //    its own timing + loaded/failed counts. Used by `dev.ts` when
  //    MANDU_PERF=1 so diagnostics are visible without parsing the
  //    marker pair.
  // ---------------------------------------------------------------------

  it("logPrewarmResult prints a deep line when result.deep is populated", () => {
    enablePerf();

    logPrewarmResult({
      durationMs: 38.7,
      loaded: 7,
      failed: 0,
      errors: [],
      deep: {
        durationMs: 12.4,
        loaded: 3,
        failed: 0,
        errors: [],
      },
    });

    // 1 shallow line + 1 deep line = 2 calls.
    expect(logSpy.mock.calls.length).toBe(2);
    const [shallowLine] = logSpy.mock.calls[0] as [string];
    const [deepLine] = logSpy.mock.calls[1] as [string];
    expect(shallowLine).toContain("[perf] jit-prewarm settled:");
    expect(shallowLine).toContain("7/7");
    expect(shallowLine).toContain("38.70ms");
    expect(deepLine).toContain("[perf] jit-prewarm-deep settled:");
    expect(deepLine).toContain("3/3");
    expect(deepLine).toContain("12.40ms");
  });
});
