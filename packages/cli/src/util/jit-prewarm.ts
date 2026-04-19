/**
 * Phase 7.3 A / Phase 11 C — JIT prewarm for `mandu dev`.
 *
 * # Problem
 *
 * `scripts/cli-bench.ts` Phase 7.2 F benchmarks (docs/bun/phase-7-2-benchmarks.md
 * §7.1) showed a consistent +41 ms gap between the first warm iteration and
 * steady-state (P95 38.9 ms vs 17.6 ms on SSR page reload). Root cause: Bun's
 * JIT tier compiles react / react-dom / react-dom/server the FIRST time the
 * SSR pipeline calls `getRenderToString()` — which is only ever triggered by
 * the first inbound page request, not by boot itself. So the user always
 * eats the tier-up cost on their very first edit.
 *
 * Phase 7.3 A closed the gap from 41 ms to ~25 ms by prewarming the React hot
 * set. The residual ~15 ms was attributed by R0.3 diagnostics to three deeper
 * paths that only warm up on the FIRST `handleSSRChange` invocation:
 *   - `@mandujs/core/bundler/safe-build` — the `safeBuild` semaphore wrapper
 *     that ALL `Bun.build` invocations flow through.
 *   - `@mandujs/cli/src/util/bun` — `createBundledImporter` + `ImportGraph`
 *     factory + first `Bun.build` execution with the framework's external
 *     allowlist.
 *   - `@mandujs/cli/src/util/handlers` — `registerManifestHandlers`
 *     (layout-loader setup, page registration, API method dispatch).
 *
 * Phase 11 C adds a **deep-import** layer to close this last gap. Target:
 * first-iter ≤ 15 ms (hard) / ≤ 20 ms (soft).
 *
 * # Approach
 *
 * Fire off the imports immediately after boot-seed (`validateAndReport`)
 * settles. The Promise is NEVER awaited on the `dev()` critical path —
 * "ready in Nms" is still emitted as soon as `Bun.serve` listens. By the
 * time the user has opened their browser (~100-200 ms of UI latency) and
 * hit `?cmd+s` on their editor, the JIT has already seen the hot functions
 * and promoted them to the Baseline/DFG tier.
 *
 * The hot set targeted (vendor + framework):
 *   - `react`                 — JSX runtime
 *   - `react-dom`             — hydration primitives
 *   - `react-dom/server`      — `renderToString` (dev uses string path
 *                               unless `config.server.streaming === true`).
 *   - `react-dom/server.browser` — `renderToReadableStream` (streaming path).
 *
 * The **deep** set (Phase 11 C — lazy, kicks off after shallow settles):
 *   - `@mandujs/core/bundler/safe-build` — semaphore around `Bun.build`
 *   - `../util/bun`                       — `createBundledImporter` + graph
 *   - `./handlers`                        — `registerManifestHandlers`
 *
 * The deep specifiers are intentionally loaded AFTER the shallow set because
 * (a) shallow covers the 90% case — a web-only project that never triggers
 * bundled import on the critical path, and (b) resolving the deep set
 * cascades through `cli/src/util/handlers` which drags in `@mandujs/core`'s
 * registrar exports. Sequencing keeps the marker-level timing interpretable.
 *
 * # Non-goals
 *
 * - NOT a bundler prewarm: we're not asking Bun to rebuild vendor shims
 *   early. Tier 2 vendor cache (Phase 7.2 R1) already handles cold → warm
 *   shim rebuilds.
 * - NOT a compile-ahead: no AOT, no precomputation of React trees. Just
 *   pushing modules through Bun's module loader so the functions exist
 *   in memory when the first SSR call dereferences them.
 * - NOT an attempt to move to single-digit "ready in Nms" — we are paying
 *   the load cost in the background AFTER the server is listening. If the
 *   dev server receives an HTTP request before prewarm completes, the
 *   request still pays full tier-up; this is an optimization for the
 *   steady-state "edit → reload" loop, which is the loudest UX complaint.
 *
 * # Safety
 *
 * - `startJitPrewarm()` returns a Promise that NEVER rejects. Any import
 *   failure (e.g. react-dom/server unreachable in an edge env) is logged
 *   under `MANDU_PERF=1` as a warning and swallowed. Dev boot MUST NOT
 *   block on, or fail because of, prewarm.
 * - `import()` calls are unconditional but wrapped in individual
 *   `.catch()` handlers so one failing specifier doesn't short-circuit
 *   the others (e.g. projects without `react-dom/server.browser` still
 *   prewarm react + react-dom).
 * - The returned Promise is intentionally discarded in `dev.ts` (no
 *   `await`) so that even a stalled import cannot delay the ready log.
 * - Deep-import specifiers may be unreachable in unusual installations
 *   (e.g. isolated-linker pnpm installs where `@mandujs/cli` modules are
 *   hoisted). Individual catches keep this non-fatal — shallow prewarm
 *   still lands.
 */

import { mark, measure } from "@mandujs/core/perf";
import { HMR_PERF } from "@mandujs/core/perf/hmr-markers";

/**
 * Modules to pull into Bun's module loader early so JIT can see their
 * exports before the first SSR render. Ordered by expected hit weight:
 *   1. react (cheapest, used by EVERY SSR path)
 *   2. react-dom (hydration, small)
 *   3. react-dom/server (renderToString — used by non-streaming dev)
 *   4. react-dom/server.browser (renderToReadableStream — streaming opt-in)
 */
const PREWARM_SPECIFIERS = [
  "react",
  "react-dom",
  "react-dom/server",
  "react-dom/server.browser",
] as const;

/**
 * Phase 11 C deep-path specifiers. These are Mandu-internal modules that
 * the first `handleSSRChange` triggers — prewarming them absorbs the
 * residual ~15 ms that Phase 7.3 A could not eliminate.
 *
 * Order matters — `safe-build` is a pure CPU primitive (no I/O), the `bun`
 * util eagerly reads `package.json` via `readPackageDepNames`, and
 * `handlers` registers `@mandujs/core`'s manifest registrar exports. We
 * load `safe-build` first so the semaphore internals are tier-warmed before
 * the bun-util first `safeBuild()` call flow is even resolved.
 *
 * These are specified as BARE module specifiers so this file remains
 * portable between dev runs and a future `--compile` binary (bundler
 * resolves them at build time). Relative specifiers (`../util/bun`) are
 * statically resolvable by Bun; `@mandujs/core/...` crosses the package
 * boundary and requires the workspace/export map to be present — which is
 * always true for `mandu dev` since the CLI itself is what's running.
 */
const PREWARM_DEEP_SPECIFIERS = [
  "@mandujs/core/bundler/safe-build",
  "../util/bun",
  "./handlers",
] as const;

export interface PrewarmResult {
  /** Wall-clock ms from `startJitPrewarm()` to all imports settled. */
  durationMs: number;
  /** Count of specifiers that resolved successfully. */
  loaded: number;
  /** Count of specifiers that failed to resolve (non-fatal). */
  failed: number;
  /** Optional: list of failure reasons for MANDU_PERF diagnostics. */
  errors: Array<{ specifier: string; message: string }>;
  /**
   * Phase 11 C — summary of the deep-import phase. `null` when the deep
   * layer was not enabled or completed (e.g. the caller used
   * `startJitPrewarm({ deep: false })`), otherwise a narrow mirror of the
   * shallow result shape. The deep phase runs AFTER the shallow imports
   * settle so that the marker timing is cleanly attributable.
   *
   * Optional (with explicit `null` allowed) so the existing Phase 7.3 test
   * fixtures that construct `PrewarmResult` objects by hand keep compiling.
   */
  deep?: PrewarmDeepResult | null;
}

export interface PrewarmDeepResult {
  /** Wall-clock ms for the deep-import Promise only. */
  durationMs: number;
  loaded: number;
  failed: number;
  errors: Array<{ specifier: string; message: string }>;
}

export interface PrewarmOptions {
  /**
   * Phase 11 C — enable the deep-import layer. Default `true`. Set `false`
   * in test fixtures that want the legacy Phase 7.3 shape (e.g. tests
   * whose assertions pre-date Phase 11 C).
   */
  deep?: boolean;
}

/**
 * Run an array of import specifiers in parallel with per-specifier catches.
 * Returns the aggregated results without ever rejecting.
 *
 * Exported as `_runImportBatch` for tests; NOT part of the public module
 * surface. See the `__tests__/jit-prewarm-deep.test.ts` for motivation.
 *
 * @internal
 */
export async function _runImportBatch(
  specifiers: readonly string[],
  importer: (spec: string) => Promise<unknown>,
): Promise<{
  loaded: number;
  failed: number;
  errors: Array<{ specifier: string; message: string }>;
}> {
  const errors: Array<{ specifier: string; message: string }> = [];
  const settle = await Promise.all(
    specifiers.map((spec) =>
      importer(spec)
        .then(() => ({ ok: true as const, spec }))
        .catch((err: unknown) => {
          errors.push({
            specifier: spec,
            message: err instanceof Error ? err.message : String(err),
          });
          return { ok: false as const, spec };
        }),
    ),
  );
  const loaded = settle.filter((r) => r.ok).length;
  const failed = settle.length - loaded;
  return { loaded, failed, errors };
}

/**
 * Kick off SSR hot-module imports as a fire-and-forget background task.
 *
 * Contract:
 *   - Caller MUST NOT `await` the returned Promise on any critical-path
 *     boot step. Attach `.then(logPrewarmResult)` for observability only.
 *   - Promise resolves once ALL imports have settled (success OR failure).
 *     Never rejects — use `result.errors` to inspect failures.
 *   - Safe to call multiple times; Bun's module cache makes subsequent
 *     calls cheap (but still allocates the Promise array — prefer single
 *     call per process).
 *   - Phase 11 C: when `options.deep !== false`, the deep-import layer
 *     runs AFTER the shallow imports settle. Both layers are merged into
 *     the top-level `loaded` / `failed` / `errors` counts AND mirrored
 *     into `result.deep` for diagnostics.
 */
export function startJitPrewarm(
  options: PrewarmOptions = {},
): Promise<PrewarmResult> {
  const perfEnabled = process.env.MANDU_PERF === "1";
  const deepEnabled = options.deep !== false;
  if (perfEnabled) mark(HMR_PERF.JIT_PREWARM);

  const t0 = Bun.nanoseconds();

  return _runImportBatch(PREWARM_SPECIFIERS, (spec) => import(spec)).then(
    async (shallow) => {
      const shallowDurationMs = (Bun.nanoseconds() - t0) / 1_000_000;

      if (perfEnabled) {
        // Use `measure` so the perf log line is consistent with other
        // boot markers. `measure` tolerates a missing `mark` (returns 0),
        // so even if MANDU_PERF was toggled mid-boot we won't throw.
        measure(HMR_PERF.JIT_PREWARM, HMR_PERF.JIT_PREWARM);
      }

      if (!deepEnabled) {
        return {
          durationMs: shallowDurationMs,
          loaded: shallow.loaded,
          failed: shallow.failed,
          errors: shallow.errors,
          deep: null,
        };
      }

      // Phase 11 C — deep import batch. Mark separately so the critical
      // path timing and the deep layer timing are independently visible
      // in the perf log.
      if (perfEnabled) mark(HMR_PERF.JIT_PREWARM_DEEP);
      const deepT0 = Bun.nanoseconds();
      const deep = await _runImportBatch(
        PREWARM_DEEP_SPECIFIERS,
        // Dynamic import with the specifier as a computed argument. Bun
        // resolves bare specifiers at runtime against the process's
        // resolution graph; relative specifiers resolve against THIS
        // module (packages/cli/src/util/jit-prewarm.ts). The `.catch`
        // layer inside `_runImportBatch` keeps broken specifiers
        // non-fatal.
        (spec) => import(spec),
      );
      const deepDurationMs = (Bun.nanoseconds() - deepT0) / 1_000_000;
      if (perfEnabled) {
        measure(HMR_PERF.JIT_PREWARM_DEEP, HMR_PERF.JIT_PREWARM_DEEP);
      }

      const totalDurationMs = (Bun.nanoseconds() - t0) / 1_000_000;

      return {
        durationMs: totalDurationMs,
        loaded: shallow.loaded + deep.loaded,
        failed: shallow.failed + deep.failed,
        errors: shallow.errors.concat(deep.errors),
        deep: {
          durationMs: deepDurationMs,
          loaded: deep.loaded,
          failed: deep.failed,
          errors: deep.errors,
        },
      };
    },
  );
}

/**
 * Optional: pretty-print prewarm result. Used by `dev.ts` only when
 * `MANDU_PERF=1` is set, so the steady-state dev output stays clean.
 *
 * Phase 11 C: when `result.deep` is populated, emits a second-line split
 * so the shallow (vendor) vs. deep (framework) wall-clock is visible in
 * the perf tail.
 */
export function logPrewarmResult(result: PrewarmResult): void {
  if (process.env.MANDU_PERF !== "1") return;
  const failSuffix =
    result.failed > 0
      ? ` (${result.failed} failed: ${result.errors
          .map((e) => e.specifier)
          .join(", ")})`
      : "";
  // Intentionally console.log, matching the rest of the perf module's
  // output channel contract (see packages/core/src/perf/index.ts header).
  console.log(
    `[perf] jit-prewarm settled: ${result.loaded}/${
      result.loaded + result.failed
    } in ${result.durationMs.toFixed(2)}ms${failSuffix}`,
  );
  if (result.deep) {
    const deepTotal = result.deep.loaded + result.deep.failed;
    const deepFailSuffix =
      result.deep.failed > 0
        ? ` (${result.deep.failed} failed: ${result.deep.errors
            .map((e) => e.specifier)
            .join(", ")})`
        : "";
    console.log(
      `[perf] jit-prewarm-deep settled: ${result.deep.loaded}/${deepTotal} in ${result.deep.durationMs.toFixed(2)}ms${deepFailSuffix}`,
    );
  }
}
