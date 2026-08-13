/**
 * @mandujs/core/middleware/rate-limit
 *
 * Sliding-window rate limiter (Phase 6.1) with pluggable stores. Ships two
 * backends out of the box:
 *
 *   - {@link createInMemoryStore} — process-local `Map`, zero deps, dies on
 *     restart. The right choice for a single-process dev server or a small
 *     production deployment where a dropped-on-restart limiter is acceptable.
 *   - {@link createSqliteStore} — shared-file SQLite via `@mandujs/core/db`,
 *     WAL mode (per RFC 0001 Appendix D.4). Survives restarts and covers
 *     same-host multi-process; still NOT a distributed limiter (no
 *     multi-host coordination — add Redis in a follow-up phase if needed).
 *
 * ## Algorithm — sliding window via fixed bucket
 *
 * Each key owns a bucket `{ windowStart, count }`. On each hit:
 *
 *   - If `now - windowStart >= windowMs` → bucket rolls over: the new window
 *     starts at `now` with `count = 1`.
 *   - Else → `count++` inside the existing window.
 *
 * The request is `allowed` when `count <= limit`. `resetAt = windowStart +
 * windowMs`; `retryAfterSeconds = ceil((resetAt - now) / 1000)` when blocked.
 *
 * This is *not* a rolling-queue implementation (which would track every hit's
 * timestamp). For typical bursty traffic the observable behaviour is the
 * same — 1/ε the memory, 1/ε the work per hit, and no edge cases at the
 * window boundary. Token-bucket is explicitly deferred to v2 as an
 * alternative algorithm once a real-world use case justifies it.
 *
 * ## Usage
 *
 * ### As middleware
 *
 * ```ts
 * import { rateLimit } from "@mandujs/core/compat/middleware/rate-limit/index";
 *
 * export default Mandu.filling()
 *   .use(rateLimit({ limit: 60, windowMs: 60_000 }))
 *   .post((ctx) => ctx.ok({ ok: true }));
 * ```
 *
 * ### As a guard for non-HTTP call sites
 *
 * The auth flows in Phase 5.3 (`verify.send`, `reset.send`) documented their
 * lack of rate limiting explicitly. Wrap them with the guard:
 *
 * ```ts
 * const sendGuard = createRateLimitGuard({ limit: 1, windowMs: 60_000 });
 * // later, at a POST handler:
 * await sendGuard.enforce(`verify:${userId}`);
 * await verify.send(userId, email);
 * ```
 *
 * Throwing {@link RateLimitError} carries the full {@link RateLimitResult}
 * so the caller can shape its own 429 response.
 *
 * @module middleware/rate-limit
 */

import type { ManduContext } from "../../filling/context";

// ─── Public types ───────────────────────────────────────────────────────────

/** Outcome of a single `hit()` on a rate-limit store. */
export interface RateLimitResult {
  /** Whether the hit stayed within the configured budget. */
  allowed: boolean;
  /**
   * Remaining budget in the current window, after this hit. Always clamped
   * to `>= 0` — a blocked hit reports `0`.
   */
  remaining: number;
  /** Unix ms at which the current window ends and a fresh one begins. */
  resetAt: number;
  /**
   * `Math.ceil((resetAt - now) / 1000)` when blocked, `0` when allowed.
   * Consumed directly as the `Retry-After` header value on 429 responses.
   */
  retryAfterSeconds: number;
}

/**
 * Pluggable backing store. Each call to {@link hit} atomically records a
 * single request against `key` and returns the resulting state — there is no
 * separate "read then increment" path to avoid race conditions.
 */
export interface RateLimitStore {
  /**
   * Record one hit against `key` with `limit` / `windowMs` in effect. MUST
   * be atomic: concurrent callers racing on the same key must observe a
   * strictly-increasing count up to the rollover, never a lost update.
   */
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  /**
   * Delete entries whose window is older than `olderThanMs` ago. Returns
   * the number of entries purged. Safe to call on a hot store — the cron
   * schedulers may do so on a fixed tick.
   */
  gcNow(olderThanMs: number): Promise<number>;
  /** Release any held resources. Optional; safe to omit for in-memory stores. */
  close?(): Promise<void>;
}

/** Construction options for {@link rateLimit}. */
export interface RateLimitMiddlewareOptions {
  /** Maximum hits per window. Required. Must be a positive integer. */
  limit: number;
  /** Window duration in ms. Required. Must be a positive integer. */
  windowMs: number;
  /** Store backend. Default: a fresh in-memory store (per middleware instance). */
  store?: RateLimitStore;
  /**
   * Compute the rate-limit key for the current request. Returning `null`
   * skips limiting for this request — the middleware passes through
   * without touching the store.
   *
   * Default: first entry of `x-forwarded-for` header → `x-real-ip` →
   * `"unknown"`. Production behind a trusted proxy should set XFF; otherwise
   * use a session-user-id key via a custom `keyFn` to limit authenticated
   * traffic per account instead of per (shared) IP.
   */
  keyFn?: (ctx: ManduContext) => string | null;
  /**
   * Predicate to bypass limiting for specific requests. Return `true` to
   * skip entirely — the store is not consulted, no headers are emitted.
   * Default: never skips.
   */
  skip?: (ctx: ManduContext) => boolean;
  /**
   * Build the 429 response body on block. Default: JSON
   * `{ error: "rate_limited", retryAfterSeconds }`. Callers can override to
   * match their app's error envelope.
   */
  handler?: (ctx: ManduContext, result: RateLimitResult) => Response;
}

/** Middleware signature matching `csrf.ts` / `session.ts`. */
export type RateLimitMiddleware = (
  ctx: ManduContext,
) => Promise<Response | void>;

/** Construction options for {@link createRateLimitGuard}. */
export interface RateLimitGuardOptions {
  limit: number;
  windowMs: number;
  /** Store backend. Default: a fresh in-memory store (per guard instance). */
  store?: RateLimitStore;
}

/**
 * Imperative rate-limit handle for non-middleware call sites. Use
 * {@link RateLimitGuard.enforce} to wrap sensitive operations like
 * `verify.send(userId)` that don't live behind HTTP middleware.
 */
export interface RateLimitGuard {
  /**
   * Record one hit and return the full result. Never throws — inspect
   * `result.allowed` to branch.
   */
  check(key: string): Promise<RateLimitResult>;
  /**
   * Record one hit and throw {@link RateLimitError} when blocked. Resolves
   * silently when allowed. Ideal for `await guard.enforce(...)` prologues.
   */
  enforce(key: string): Promise<void>;
}

/**
 * Error thrown by {@link RateLimitGuard.enforce} when a hit is blocked.
 * Carries the full {@link RateLimitResult} so the caller can format the
 * response with accurate `Retry-After` / `X-RateLimit-Reset` information.
 */
export class RateLimitError extends Error {
  /** Public so handlers can derive `Retry-After` without downcasting. */
  readonly result: RateLimitResult;
  constructor(result: RateLimitResult, message?: string) {
    super(
      message ??
        `rate_limited: retry after ${result.retryAfterSeconds}s (reset at ${new Date(
          result.resetAt,
        ).toISOString()})`,
    );
    this.name = "RateLimitError";
    this.result = result;
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_KEY_UNKNOWN = "unknown";

/**
 * Clock injector. Kept module-scoped (not per-store) so tests can freeze time
 * across both the middleware and any stores it calls during a single
 * scenario. Override via {@link _setClockForTests}; production callers never
 * touch this.
 *
 * @internal
 */
let __now: () => number = () => Date.now();

/**
 * Replace the module-level clock. Test-only hook; not exported from the
 * package surface.
 *
 * @internal
 */
export function _setClockForTests(fn: (() => number) | null): void {
  __now = fn ?? (() => Date.now());
}

// ─── Key derivation ─────────────────────────────────────────────────────────

/**
 * Default key derivation. Reads the first hop of `x-forwarded-for` (the
 * client IP when a trusted reverse proxy is in front), falling back to
 * `x-real-ip`, and finally a literal `"unknown"` bucket.
 *
 * The `"unknown"` fallback is intentionally a single shared bucket: when the
 * edge has not forwarded either header, we cannot tell callers apart, and a
 * hostile client could otherwise bypass the limit by simply stripping the
 * header. Shared throttling keeps the limiter safe but may be harsh on
 * no-proxy dev setups — set a custom `keyFn` that uses a session id, API
 * key, or user id for production traffic.
 */
function defaultKeyFn(ctx: ManduContext): string {
  const xff = ctx.request.headers.get("x-forwarded-for");
  if (typeof xff === "string" && xff.length > 0) {
    // XFF is a comma-separated chain; the client is the first entry.
    const first = xff.split(",")[0]?.trim();
    if (first && first.length > 0) return first;
  }
  const realIp = ctx.request.headers.get("x-real-ip");
  if (typeof realIp === "string" && realIp.length > 0) return realIp.trim();
  return DEFAULT_KEY_UNKNOWN;
}

// ─── Middleware factory ─────────────────────────────────────────────────────

function assertPositiveInt(name: string, value: number): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    Math.floor(value) !== value
  ) {
    throw new TypeError(
      `[@mandujs/core/middleware/rate-limit] '${name}' must be a positive integer; got ${String(
        value,
      )}.`,
    );
  }
}

/**
 * Sliding-window rate-limit middleware.
 *
 * Behaviour:
 *   1. If `skip(ctx)` returns `true`, the middleware returns void immediately
 *      — no store access, no headers.
 *   2. Otherwise, `keyFn(ctx)` produces a key. `null` skips the store (useful
 *      for "only limit authenticated traffic" policies).
 *   3. `store.hit(key, limit, windowMs)` records and evaluates.
 *   4. On block: returns 429 with `Retry-After` + `X-RateLimit-*` headers and
 *      a JSON body (or whatever `handler` returns). The caller's handler
 *      pipeline is short-circuited.
 *   5. On allow: returns void. No response mutation is performed here — the
 *      middleware surface has no afterHandle hook on this variant. Callers
 *      who want `X-RateLimit-*` headers on allowed responses should use
 *      {@link rateLimitPlugin} (exposes beforeHandle + afterHandle) instead.
 */
export function rateLimit(
  options: RateLimitMiddlewareOptions,
): RateLimitMiddleware {
  if (!options || typeof options !== "object") {
    throw new TypeError(
      "[@mandujs/core/middleware/rate-limit] rateLimit: options object required.",
    );
  }
  assertPositiveInt("limit", options.limit);
  assertPositiveInt("windowMs", options.windowMs);

  const limit = options.limit;
  const windowMs = options.windowMs;
  const store = options.store ?? createInMemoryStore();
  const keyFn = options.keyFn ?? defaultKeyFn;
  const skip = options.skip;
  const handler = options.handler ?? defaultBlockedHandler;

  return async (ctx: ManduContext): Promise<Response | void> => {
    if (skip && skip(ctx)) {
      return;
    }
    const key = keyFn(ctx);
    if (key === null) {
      // Caller's key function explicitly opts out for this request.
      return;
    }

    const result = await store.hit(key, limit, windowMs);

    if (!result.allowed) {
      const res = handler(ctx, result);
      // The caller's `handler` may return a pre-built Response that already
      // carries rate-limit headers. We only stamp them when absent so a
      // custom handler that wants to hide the Retry-After (rare) can do so.
      return applyRateLimitHeaders(res, limit, result);
    }

    // Allowed: pass through. Callers who need `X-RateLimit-*` headers on
    // successful responses should layer {@link rateLimitPlugin} on top of
    // the filling chain — this plain-middleware variant cannot mutate the
    // outgoing Response without an afterHandle hook.
    return;
  };
}

/**
 * Default 429 response body. Intentionally small — exposes only what a
 * well-behaved client legitimately needs. `resetAt` is Unix-ms so clients
 * don't have to negotiate timezone interpretation.
 */
function defaultBlockedHandler(
  _ctx: ManduContext,
  result: RateLimitResult,
): Response {
  return Response.json(
    {
      error: "rate_limited",
      retryAfterSeconds: result.retryAfterSeconds,
      resetAt: result.resetAt,
    },
    { status: 429 },
  );
}

/**
 * Stamp `Retry-After` + `X-RateLimit-*` headers on a blocked response. The
 * `X-RateLimit-Reset` value is Unix-seconds (not ms) to match the informal
 * convention used by GitHub / Twitter / Stripe — see GitHub's API docs.
 *
 * Preserves any header the caller's handler has already set (checked with
 * `Headers.has`) so custom handlers can override values at will.
 */
function applyRateLimitHeaders(
  response: Response,
  limit: number,
  result: RateLimitResult,
): Response {
  const headers = new Headers(response.headers);
  if (!headers.has("Retry-After")) {
    headers.set("Retry-After", String(result.retryAfterSeconds));
  }
  if (!headers.has("X-RateLimit-Limit")) {
    headers.set("X-RateLimit-Limit", String(limit));
  }
  if (!headers.has("X-RateLimit-Remaining")) {
    headers.set("X-RateLimit-Remaining", String(result.remaining));
  }
  if (!headers.has("X-RateLimit-Reset")) {
    headers.set(
      "X-RateLimit-Reset",
      String(Math.floor(result.resetAt / 1000)),
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ─── Guard (imperative) ─────────────────────────────────────────────────────

/**
 * Construct an imperative rate-limit guard. Use when the protected operation
 * is NOT an HTTP handler — e.g. an outbound email from a server-side action.
 *
 * Every guard owns its own store by default, so two guards with the same
 * `{ limit, windowMs }` are independent. Share a store explicitly when two
 * guards must consume the same budget.
 */
export function createRateLimitGuard(
  options: RateLimitGuardOptions,
): RateLimitGuard {
  if (!options || typeof options !== "object") {
    throw new TypeError(
      "[@mandujs/core/middleware/rate-limit] createRateLimitGuard: options object required.",
    );
  }
  assertPositiveInt("limit", options.limit);
  assertPositiveInt("windowMs", options.windowMs);

  const limit = options.limit;
  const windowMs = options.windowMs;
  const store = options.store ?? createInMemoryStore();

  return {
    async check(key: string): Promise<RateLimitResult> {
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError(
          "[@mandujs/core/middleware/rate-limit] check: key must be a non-empty string.",
        );
      }
      return await store.hit(key, limit, windowMs);
    },
    async enforce(key: string): Promise<void> {
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError(
          "[@mandujs/core/middleware/rate-limit] enforce: key must be a non-empty string.",
        );
      }
      const result = await store.hit(key, limit, windowMs);
      if (!result.allowed) {
        throw new RateLimitError(result);
      }
    },
  };
}

// ─── In-memory store ────────────────────────────────────────────────────────

interface Bucket {
  windowStart: number;
  count: number;
}

/**
 * Process-local in-memory store. No external dependencies, no persistence
 * across restarts. Concurrency-safe within a single event loop (Map reads
 * and writes are not preempted mid-operation in JS); no locking needed.
 *
 * Not safe across processes or hosts — use {@link createSqliteStore} for
 * same-host multi-process, or a distributed store (future Redis backend)
 * for multi-host.
 */
export function createInMemoryStore(): RateLimitStore {
  const buckets = new Map<string, Bucket>();
  let closed = false;

  return {
    async hit(
      key: string,
      limit: number,
      windowMs: number,
    ): Promise<RateLimitResult> {
      if (closed) {
        throw new Error(
          "[@mandujs/core/middleware/rate-limit] in-memory store is closed.",
        );
      }
      const now = __now();
      const existing = buckets.get(key);

      let bucket: Bucket;
      if (!existing || now - existing.windowStart >= windowMs) {
        // Window rollover (or first hit). Start a fresh window anchored at
        // `now` — the simplest model that still reports a precise resetAt.
        bucket = { windowStart: now, count: 1 };
      } else {
        // Still inside the current window — increment.
        bucket = { windowStart: existing.windowStart, count: existing.count + 1 };
      }
      buckets.set(key, bucket);

      const resetAt = bucket.windowStart + windowMs;
      const allowed = bucket.count <= limit;
      // `remaining` reports post-hit budget; clamped at 0 so a blocked hit
      // never reports negative remaining (would confuse clients rendering a
      // progress indicator).
      const remaining = Math.max(0, limit - bucket.count);
      const retryAfterSeconds = allowed
        ? 0
        : Math.max(1, Math.ceil((resetAt - now) / 1000));

      return { allowed, remaining, resetAt, retryAfterSeconds };
    },

    async gcNow(olderThanMs: number): Promise<number> {
      if (closed) return 0;
      if (typeof olderThanMs !== "number" || olderThanMs < 0) {
        throw new TypeError(
          "[@mandujs/core/middleware/rate-limit] gcNow: olderThanMs must be a non-negative number.",
        );
      }
      const now = __now();
      let deleted = 0;
      // Iterating + deleting from a Map during traversal is safe per the
      // ES spec — entries visited before deletion yield, already-visited
      // entries are skipped. We still collect keys into a throwaway array
      // to keep the hot-path clean across engines.
      const stale: string[] = [];
      for (const [key, bucket] of buckets) {
        if (now - bucket.windowStart > olderThanMs) {
          stale.push(key);
        }
      }
      for (const key of stale) {
        buckets.delete(key);
        deleted++;
      }
      return deleted;
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      buckets.clear();
    },
  };
}

// ─── SQLite store (re-export) ───────────────────────────────────────────────

// The SQLite store lives in its own module so callers who never need it
// don't pay the import cost of `@mandujs/core/db`.
export {
  createSqliteStore,
  type SqliteRateLimitStoreOptions,
} from "./sqlite-store";
