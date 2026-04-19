/**
 * Concurrency-limited wrapper around `Bun.build`.
 *
 * Why this exists:
 * - `Bun.build` exhibits failure modes under high concurrent invocation —
 *   observed as `AggregateError: Bundle failed` with missing output shims
 *   (e.g. `_react-dom-client.js`) when 5+ builds fire in parallel and
 *   multiple test worker processes pile on simultaneously.
 * - Our own `buildClientBundles` fans out vendor-shim builds via `Promise.all`
 *   (5 concurrent). Combined with parallel test workers or concurrent dev-mode
 *   rebuilds, total concurrent `Bun.build` invocations can exceed what the
 *   runtime/OS resolves reliably, yielding intermittent failures that are
 *   hard to diagnose.
 *
 * Design:
 * - Process-wide semaphore. Default cap: `2` concurrent `Bun.build` per
 *   process. Tunable via `MANDU_BUN_BUILD_CONCURRENCY` (positive integer).
 * - FIFO queue — no priority, no cancellation. Callers get `Bun.build`'s
 *   `BuildOutput` result (or exception) transparently.
 * - In-process only. Cross-worker coordination is not this module's job;
 *   per-worker throttling already prevents the observed failure modes in
 *   our test matrix.
 *
 * Correctness — slot handoff:
 * - The semaphore does slot *handoff* rather than release-then-acquire. When
 *   a build completes with waiters queued, the slot is transferred directly
 *   to the next waiter (active count never drops). A previous revision had
 *   a classic acquire race: `releaseSlot()` decremented `active` before the
 *   waiter's `active++` ran, which opened a microtask-sized window where a
 *   concurrent `safeBuild()` call could observe `active < max`, skip the
 *   wait, and join in — yielding `cap+1` concurrent builds.
 */

import type { BuildConfig, BuildOutput } from "bun";

const DEFAULT_MAX_CONCURRENT = 2;

function parseMaxConcurrent(): number {
  const raw = process.env.MANDU_BUN_BUILD_CONCURRENCY;
  if (!raw) return DEFAULT_MAX_CONCURRENT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_CONCURRENT;
  return parsed;
}

const maxConcurrent = parseMaxConcurrent();
let active = 0;
const waiters: Array<() => void> = [];

/**
 * Acquire a slot. When `active < max`, increment synchronously and return.
 * Otherwise, queue and await a direct handoff from a completing build —
 * the completing build does NOT decrement `active`; it resolves our waiter,
 * and `active` stays at `max` through the transition. This prevents a
 * microtask-window race where a third caller could see `active < max` and
 * skip the wait entirely.
 */
function acquireSlot(): Promise<void> {
  if (active < maxConcurrent) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
  });
}

/**
 * Release a slot. If a waiter is queued, hand the slot off directly (keep
 * `active` at `max`, resolve the waiter). Otherwise decrement `active`.
 */
function releaseSlot(): void {
  const next = waiters.shift();
  if (next) {
    // Direct handoff — `active` stays at max, waiter resumes holding the slot.
    next();
  } else {
    active--;
  }
}

/**
 * Runs `Bun.build(options)` subject to a process-wide concurrency cap.
 * Preserves the exact return type and error semantics of `Bun.build`.
 *
 * Note: this wrapper only caps concurrency *within* a single process. Test
 * harnesses that spawn multiple worker processes still see each worker run
 * up to `maxConcurrent` concurrent builds — see Phase 0.6 for cross-process
 * coordination work.
 */
export async function safeBuild(options: BuildConfig): Promise<BuildOutput> {
  await acquireSlot();
  try {
    return await Bun.build(options);
  } finally {
    releaseSlot();
  }
}

/** Exposed for tests — not part of the public API. */
export function _getConcurrencyState() {
  return { active, queued: waiters.length, max: maxConcurrent };
}
