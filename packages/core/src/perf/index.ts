/**
 * Mandu Perf Module
 *
 * Lightweight, opt-in measurement markers built on `Bun.nanoseconds()`.
 *
 * Enable at process boot with `MANDU_PERF=1`. When disabled, every function is
 * a single-branch no-op (no allocation, no Map lookups, no logging) so it is
 * safe to sprinkle markers across hot paths.
 *
 * Rationale for `console.log` (not the structured logger):
 * measurement is a cross-cutting concern and must not depend on the log
 * pipeline it may itself be measuring. Keeping the output path trivial also
 * preserves the "zero-overhead when disabled, minimal overhead when enabled"
 * contract.
 *
 * @example
 * ```ts
 * import { mark, measure, withPerf } from "@mandujs/core/perf";
 *
 * mark("build:start");
 * await doWork();
 * measure("full build", "build:start");
 *
 * const result = await withPerf("ssr:render", () => render(route));
 * ```
 *
 * @module perf
 */

// Module-load snapshot. `isPerfEnabled()` is a stable answer per process.
let enabled: boolean = process.env.MANDU_PERF === "1";

// Lazily-initialized marker table. Stays `null` when disabled so no allocation
// occurs on the disabled fast path.
let marks: Map<string, number> | null = null;

/**
 * Whether perf markers are active for this process.
 *
 * Cached at module load from `MANDU_PERF=1`; changing the env var afterwards
 * has no effect (see `_resetCacheForTesting` for test-only overrides).
 */
export function isPerfEnabled(): boolean {
  return enabled;
}

/**
 * Record a start marker. Later passed to {@link measure} as `startName`.
 *
 * No-op when perf is disabled.
 */
export function mark(name: string): void {
  if (!enabled) return;
  if (marks === null) marks = new Map<string, number>();
  marks.set(name, Bun.nanoseconds());
}

/**
 * Log elapsed milliseconds since `startName` was marked and return the value.
 *
 * Returns `0` (and does not log or throw) if `startName` was never marked, so
 * callers can safely remove a `mark()` without breaking a `measure()` site.
 * No-op (returns `0`) when perf is disabled.
 */
export function measure(label: string, startName: string): number {
  if (!enabled) return 0;
  if (marks === null) return 0;
  const start = marks.get(startName);
  if (start === undefined) return 0;
  const ms = (Bun.nanoseconds() - start) / 1_000_000;
  console.log(`[perf] ${label}: ${ms.toFixed(2)}ms`);
  return ms;
}

/**
 * Measure the duration of `fn` and log on completion. Propagates the resolved
 * value and re-throws errors (still logging the elapsed time before rethrow).
 *
 * When perf is disabled, `fn` is invoked directly with no wrapping overhead
 * beyond a single branch and a `Promise.resolve`.
 */
export async function withPerf<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
  if (!enabled) return await fn();
  const start = Bun.nanoseconds();
  try {
    return await fn();
  } finally {
    const ms = (Bun.nanoseconds() - start) / 1_000_000;
    console.log(`[perf] ${label}: ${ms.toFixed(2)}ms`);
  }
}

/**
 * Test-only: re-read `MANDU_PERF` from the environment and clear marker state.
 *
 * Not part of the public surface; intentionally prefixed with `_` and excluded
 * from the module-level TSDoc examples. Stable across the test suite only.
 *
 * @internal
 */
export function _resetCacheForTesting(): void {
  enabled = process.env.MANDU_PERF === "1";
  marks = null;
}
