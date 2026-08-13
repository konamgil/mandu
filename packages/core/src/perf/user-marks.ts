/**
 * Phase 18.ψ — user-facing performance marks API
 *
 * Layered on top of the Phase 0 `@mandujs/core/perf` gate (`MANDU_PERF=1`),
 * this module exposes a developer-friendly surface for measuring custom
 * operations in application code. The existing module-level
 * {@link import("./index").mark} + {@link import("./index").measure} remain
 * unchanged for framework-internal callers; this file adds new primitives
 * that close the ergonomic gap identified in user feedback:
 *
 * ```ts
 * import { time, timeAsync, createPerf } from "@mandujs/core/compat/perf/index";
 *
 * // 1. Basic scoped timing — returns a close-over end() function.
 * const end = time("db-query");
 * const rows = await db.query("SELECT ...");
 * end();                               // emits measurement
 *
 * // 2. Async scope — auto-closed, resolved value forwarded, errors rethrown.
 * const data = await timeAsync("fetch-user", async () => {
 *   return await fetch("/api/user/123").then((r) => r.json());
 * });
 *
 * // 3. Scoped instance (dependency-injection / opt-in per-module):
 * const perf = createPerf({ enabled: process.env.MANDU_PERF === "1" });
 * perf.time("foo")();                  // no-op when disabled, zero overhead
 * ```
 *
 * Design contracts:
 *   - **Zero overhead when gated off.** When {@link isPerfEnabled} is
 *     `false`, every function is a single branch that returns a
 *     stable no-op (see `NOOP_END`). No `Map` allocation, no histogram
 *     entry, no span creation, no console output.
 *   - **Gate is shared.** Framework-internal marks (HMR, SSR, bundler)
 *     and user marks honor the same `MANDU_PERF=1` switch. Users do not
 *     need a separate env var.
 *   - **OTel integration is automatic.** When Phase 18.θ's request tracer
 *     is enabled, every user mark becomes a child span under the active
 *     request span. Attribute `mandu.perf.category = "user" | "framework"
 *     | "bundler" | "ssr"` differentiates mark origin in the trace view.
 *     Opt-out via `{ trace: false }`.
 *   - **Bounded histogram buffer.** The last 1000 recorded measurements
 *     are retained in a ring buffer for `/_mandu/heap` inspection. Older
 *     entries are dropped in insertion order. Same cap as Phase 17's
 *     event-bus recent buffer.
 *   - **No new runtime deps.** Timing uses `Bun.nanoseconds()` when
 *     available, `performance.now()` elsewhere.
 *
 * Rationale vs `mark()` + `measure()` (framework-internal):
 *   - `mark(name)` records a start timestamp, then a later `measure(label,
 *     name)` call computes the delta. That signature is great for
 *     framework code where start/end happen in separate functions, but
 *     forces users to invent unique `name` strings and wire them through
 *     closures. The `time() => end()` shape is more natural for
 *     application code where both ends live in the same lexical scope.
 *   - Both APIs coexist; `time()` internally uses `Bun.nanoseconds()`
 *     directly and does NOT share the framework's `marks: Map<string,
 *     number>`. This avoids collisions between user-chosen names and
 *     framework markers (e.g., if a user named a span `"hmr:rebuild-total"`).
 *
 * @module perf/user-marks
 */

import { isPerfEnabled } from "./index";
import { getTracer, runWithSpan, type Span } from "../observability/tracing";

// ─── Types ──────────────────────────────────────────────────────────────

/**
 * Origin of a mark. Framework code sets this to the appropriate value
 * when bridging `mark()`/`measure()` calls into the histogram. User
 * `time()` / `timeAsync()` always records `"user"`.
 */
export type PerfCategory = "user" | "framework" | "bundler" | "ssr";

/** Options accepted by {@link time} / {@link timeAsync} and {@link Perf.time}. */
export interface PerfMarkOptions {
  /**
   * Span category for histogram attribution + OTel attribute. Default:
   * `"user"`. Framework code sets this explicitly.
   */
  category?: PerfCategory;
  /**
   * When `true` (default) and a tracer is active, the mark creates a
   * child span on `end()` with attributes `mandu.perf.category` and
   * duration. When `false`, histogram still records but no span emits.
   */
  trace?: boolean;
  /**
   * Extra attributes attached to the OTel child span (when
   * `trace !== false` and a tracer is active). Ignored otherwise.
   */
  attributes?: Record<string, string | number | boolean>;
}

/** Zero-arg function returned by {@link time}. Idempotent — safe to call twice. */
export type PerfEndFn = () => number;

/** One entry in the bounded histogram buffer. */
export interface PerfMarkEntry {
  /** Mark label. */
  name: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Category as set by caller. */
  category: PerfCategory;
  /** Unix epoch millis when the mark was closed. */
  timestamp: number;
}

/** Statistical summary per unique mark name. */
export interface PerfHistogramEntry {
  name: string;
  count: number;
  mean: number;
  /** 50th percentile. */
  p50: number;
  /** 95th percentile. */
  p95: number;
  /** 99th percentile. */
  p99: number;
  /** Minimum observed duration (ms). */
  min: number;
  /** Maximum observed duration (ms). */
  max: number;
}

/** Shape of the `perf` block appended to `/_mandu/heap` JSON. */
export interface PerfDashboardSnapshot {
  enabled: boolean;
  /** Total closed marks since process start (NOT the buffer size). */
  totalCount: number;
  /** Current number of entries retained in the ring buffer. */
  bufferedCount: number;
  /** Max ring-buffer capacity. */
  bufferLimit: number;
  /** Per-name histogram, sorted by descending `count`. */
  histogram: PerfHistogramEntry[];
  /** The most-recent N marks (up to 50), newest last. */
  recent: PerfMarkEntry[];
}

// ─── Timing primitive ───────────────────────────────────────────────────

/**
 * High-resolution timestamp in milliseconds as a float. Prefers
 * `Bun.nanoseconds()` (monotonic, integer-nanos precision) and falls
 * back to `performance.now()` for non-Bun runtimes (tests that spawn
 * Node, edge worker shims).
 */
function nowMs(): number {
  const bun = (globalThis as { Bun?: { nanoseconds?: () => number } }).Bun;
  if (bun && typeof bun.nanoseconds === "function") {
    return bun.nanoseconds() / 1_000_000;
  }
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

// ─── Ring buffer + running stats ─────────────────────────────────────────

/**
 * Max entries retained in the recent-marks ring buffer. Matches the
 * Phase 17 event-bus recent buffer so operators get a consistent
 * "last N" window across `/_mandu/heap` and `/_mandu/events/recent`.
 */
export const PERF_BUFFER_LIMIT = 1000;

/**
 * Per-name running state. We store the raw observations for percentile
 * computation (bounded per-name at `PER_NAME_OBS_LIMIT` to cap memory
 * across a long dev session). For O(1) scrape, we also maintain count /
 * min / max / sum — percentiles are the only O(n log n) piece.
 */
const PER_NAME_OBS_LIMIT = 500;

interface PerNameStats {
  count: number;
  sum: number;
  min: number;
  max: number;
  /** Bounded window of observations (FIFO) for percentile calc. */
  observations: number[];
  /** Next write index into the ring. */
  obsHead: number;
  obsFull: boolean;
}

/** Ring buffer of most-recent `PerfMarkEntry` values (capacity `PERF_BUFFER_LIMIT`). */
const ringBuffer: (PerfMarkEntry | undefined)[] = new Array(PERF_BUFFER_LIMIT);
let ringHead = 0;
let ringFull = false;

/** Monotonic counter of closed marks since process start. */
let totalClosedCount = 0;

/** Per-name stats map. Only populated when perf is enabled. */
const perNameStats = new Map<string, PerNameStats>();

function getOrCreateStats(name: string): PerNameStats {
  let s = perNameStats.get(name);
  if (!s) {
    s = {
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      observations: new Array(PER_NAME_OBS_LIMIT),
      obsHead: 0,
      obsFull: false,
    };
    perNameStats.set(name, s);
  }
  return s;
}

/** Append a closed mark to the ring buffer + update per-name stats. */
function recordEntry(entry: PerfMarkEntry): void {
  // Ring buffer append.
  ringBuffer[ringHead] = entry;
  ringHead = (ringHead + 1) % PERF_BUFFER_LIMIT;
  if (ringHead === 0) ringFull = true;
  totalClosedCount++;

  // Per-name stats update.
  const s = getOrCreateStats(entry.name);
  s.count++;
  s.sum += entry.durationMs;
  if (entry.durationMs < s.min) s.min = entry.durationMs;
  if (entry.durationMs > s.max) s.max = entry.durationMs;
  s.observations[s.obsHead] = entry.durationMs;
  s.obsHead = (s.obsHead + 1) % PER_NAME_OBS_LIMIT;
  if (s.obsHead === 0) s.obsFull = true;
}

/** Compute the p-th percentile (0..100) of a sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Nearest-rank method — simple, deterministic, no interpolation
  // artifacts on small samples.
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.max(0, Math.min(sorted.length - 1, rank - 1));
  return sorted[idx] ?? 0;
}

function buildHistogramEntry(name: string, s: PerNameStats): PerfHistogramEntry {
  const obs = s.obsFull
    ? s.observations.slice(0, PER_NAME_OBS_LIMIT)
    : s.observations.slice(0, s.obsHead);
  const sorted = [...obs].sort((a, b) => a - b);
  return {
    name,
    count: s.count,
    mean: s.count > 0 ? s.sum / s.count : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: s.min === Number.POSITIVE_INFINITY ? 0 : s.min,
    max: s.max === Number.NEGATIVE_INFINITY ? 0 : s.max,
  };
}

// ─── No-op sentinel ─────────────────────────────────────────────────────

const NOOP_END: PerfEndFn = () => 0;

// ─── Public functions ───────────────────────────────────────────────────

/**
 * Open a performance measurement. Returns an `end()` function that,
 * when called, closes the measurement and records it in the histogram
 * + OTel span (if tracing is active).
 *
 * When {@link isPerfEnabled} is `false`, returns a shared no-op end
 * function. Zero allocations on the disabled path.
 *
 * Calling `end()` more than once is a no-op on the second call; the
 * duration recorded is always the delta from the first `time()` call
 * to the first `end()` call.
 */
export function time(name: string, options: PerfMarkOptions = {}): PerfEndFn {
  if (!isPerfEnabled()) return NOOP_END;
  const category: PerfCategory = options.category ?? "user";
  const traceEnabled = options.trace !== false;
  const startMs = nowMs();

  // Open an OTel span lazily: only if tracing is enabled AND the active
  // tracer is recording. We create the span now (so attributes can be
  // set on it pre-end), but only end it when the user calls end().
  let span: Span | undefined;
  if (traceEnabled) {
    const tracer = getTracer();
    if (tracer.enabled) {
      span = tracer.startSpan(name, {
        kind: "internal",
        attributes: {
          "mandu.perf.category": category,
          ...(options.attributes ?? {}),
        },
      });
    }
  }

  let closed = false;
  return function endMark(): number {
    if (closed) return 0;
    closed = true;
    const durationMs = nowMs() - startMs;
    const entry: PerfMarkEntry = {
      name,
      durationMs,
      category,
      timestamp: Date.now(),
    };
    recordEntry(entry);
    if (span) {
      // Attach the measured duration so downstream consumers can read it
      // from trace attributes without having to compute `endTime - startTime`.
      span.setAttribute("mandu.perf.duration_ms", durationMs);
      span.setStatus("ok");
      span.end();
    }
    return durationMs;
  };
}

/**
 * Measure the wall-clock duration of `fn`. Propagates the resolved
 * value and rethrows errors (closing the mark with `status=error` on
 * the OTel span before rethrow).
 *
 * Works for both sync and async `fn`: the return type is always
 * `Promise<T>` because the common case is `await`ing an async body.
 * For a sync-only variant that preserves the sync return type, use
 * {@link time} directly.
 *
 * When perf is disabled, `fn` is invoked directly and the result is
 * returned unchanged — a single branch adds near-zero overhead.
 */
export async function timeAsync<T>(
  name: string,
  fn: () => T | Promise<T>,
  options: PerfMarkOptions = {},
): Promise<T> {
  if (!isPerfEnabled()) return await fn();

  // When tracing is active, put the child span in the ALS scope so any
  // further `time()` / `timeAsync()` calls inside `fn` nest correctly.
  const category: PerfCategory = options.category ?? "user";
  const traceEnabled = options.trace !== false;
  const tracer = getTracer();
  const useSpanScope = traceEnabled && tracer.enabled;

  const startMs = nowMs();
  let span: Span | undefined;
  if (useSpanScope) {
    span = tracer.startSpan(name, {
      kind: "internal",
      attributes: {
        "mandu.perf.category": category,
        ...(options.attributes ?? {}),
      },
    });
  }

  const finalize = (status: "ok" | "error", errorMsg?: string): number => {
    const durationMs = nowMs() - startMs;
    recordEntry({
      name,
      durationMs,
      category,
      timestamp: Date.now(),
    });
    if (span) {
      span.setAttribute("mandu.perf.duration_ms", durationMs);
      span.setStatus(status, errorMsg);
      span.end();
    }
    return durationMs;
  };

  try {
    const result = span
      ? await runWithSpan(span, () => Promise.resolve(fn()))
      : await fn();
    finalize("ok");
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finalize("error", msg);
    throw err;
  }
}

// ─── Scoped instance (createPerf) ────────────────────────────────────────

/** Subset of the top-level API, bound to a specific enabled flag. */
export interface Perf {
  readonly enabled: boolean;
  time(name: string, options?: PerfMarkOptions): PerfEndFn;
  timeAsync<T>(
    name: string,
    fn: () => T | Promise<T>,
    options?: PerfMarkOptions,
  ): Promise<T>;
}

export interface CreatePerfOptions {
  /**
   * Override the gate. When `false`, all operations are no-ops
   * regardless of `MANDU_PERF`. Useful to wire perf through a DI
   * container that already resolves the env var.
   */
  enabled?: boolean;
}

/**
 * Create a scoped perf instance. Equivalent to the module-level
 * {@link time} / {@link timeAsync} when `opts.enabled` is unset (defaults
 * to the global gate), but allows libraries / tests to force-disable
 * without mutating env.
 *
 * The scoped instance shares the global histogram — all marks flow
 * into the same `/_mandu/heap` buffer regardless of which factory
 * created them.
 */
export function createPerf(opts: CreatePerfOptions = {}): Perf {
  const enabled = opts.enabled ?? isPerfEnabled();
  if (!enabled) {
    return {
      enabled: false,
      time: () => NOOP_END,
      timeAsync: async <T>(_n: string, fn: () => T | Promise<T>): Promise<T> => await fn(),
    };
  }
  return {
    enabled: true,
    time,
    timeAsync,
  };
}

// ─── Dashboard snapshot ──────────────────────────────────────────────────

/**
 * Number of recent marks to include verbatim in {@link collectPerfSnapshot}.
 * Kept small so the `/_mandu/heap` payload stays tight.
 */
const RECENT_SNAPSHOT_SIZE = 50;

/**
 * Extract entries from the ring buffer in chronological order (oldest
 * first). Returns up to `limit` most-recent entries.
 */
function readRing(limit: number): PerfMarkEntry[] {
  const out: PerfMarkEntry[] = [];
  if (!ringFull && ringHead === 0) return out;
  const total = ringFull ? PERF_BUFFER_LIMIT : ringHead;
  const start = ringFull ? ringHead : 0;
  for (let i = 0; i < total; i++) {
    const idx = (start + i) % PERF_BUFFER_LIMIT;
    const entry = ringBuffer[idx];
    if (entry) out.push(entry);
  }
  if (limit > 0 && out.length > limit) return out.slice(out.length - limit);
  return out;
}

/**
 * Build the perf dashboard snapshot for `/_mandu/heap`. Safe to call
 * even when perf is disabled — returns `{ enabled: false, ... }` with
 * empty arrays.
 */
export function collectPerfSnapshot(): PerfDashboardSnapshot {
  const histogram: PerfHistogramEntry[] = [];
  for (const [name, stats] of perNameStats) {
    histogram.push(buildHistogramEntry(name, stats));
  }
  histogram.sort((a, b) => b.count - a.count);

  const bufferedCount = ringFull ? PERF_BUFFER_LIMIT : ringHead;

  return {
    enabled: isPerfEnabled(),
    totalCount: totalClosedCount,
    bufferedCount,
    bufferLimit: PERF_BUFFER_LIMIT,
    histogram,
    recent: readRing(RECENT_SNAPSHOT_SIZE),
  };
}

// ─── Framework bridge ────────────────────────────────────────────────────

/**
 * Bridge hook — framework modules (`bundler/*`, `runtime/streaming-ssr`,
 * `cli/commands/dev`, etc.) can optionally record their own measurements
 * into the same histogram so the `/_mandu/heap` view shows a unified
 * picture. Callers should only invoke when `isPerfEnabled()` is already
 * known to be `true` (the check is duplicated here for safety).
 *
 * Framework code remains free to keep using `mark()`/`measure()` for
 * console logging — this bridge is additive.
 *
 * @internal — public only so bundler / runtime packages can reach it;
 * not part of the documented app-facing API.
 */
export function recordFrameworkMeasurement(
  name: string,
  durationMs: number,
  category: Exclude<PerfCategory, "user"> = "framework",
): void {
  if (!isPerfEnabled()) return;
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  recordEntry({
    name,
    durationMs,
    category,
    timestamp: Date.now(),
  });
}

// ─── Test helpers ───────────────────────────────────────────────────────

/**
 * Test-only: clear all buffered marks and per-name stats. Does NOT
 * touch the `MANDU_PERF` gate — pair with
 * {@link import("./index")._resetCacheForTesting} when you need both.
 *
 * @internal
 */
export function _resetUserMarksForTesting(): void {
  for (let i = 0; i < PERF_BUFFER_LIMIT; i++) ringBuffer[i] = undefined;
  ringHead = 0;
  ringFull = false;
  totalClosedCount = 0;
  perNameStats.clear();
}

/**
 * Test-only: peek at the last closed mark (or undefined if the buffer
 * is empty). Useful for end-to-end assertions without exposing the
 * full ring buffer internals.
 *
 * @internal
 */
export function _peekLastMarkForTesting(): PerfMarkEntry | undefined {
  if (!ringFull && ringHead === 0) return undefined;
  const lastIdx = (ringHead - 1 + PERF_BUFFER_LIMIT) % PERF_BUFFER_LIMIT;
  return ringBuffer[lastIdx];
}
