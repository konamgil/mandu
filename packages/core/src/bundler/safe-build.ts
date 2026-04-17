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

function waitForSlot(): Promise<void> {
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
  });
}

function releaseSlot(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
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
  if (active >= maxConcurrent) {
    await waitForSlot();
  }
  active++;
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
