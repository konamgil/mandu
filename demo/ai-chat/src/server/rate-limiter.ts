/**
 * In-memory sliding window rate limiter.
 *
 * Each IP maintains a list of request timestamps. On every check the window
 * is trimmed to the last `windowMs` milliseconds and the request is allowed
 * only when the count is below `maxRequests`.
 */

export interface RateLimiterOptions {
  /** Maximum number of requests allowed within the window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

interface BucketEntry {
  timestamps: number[];
}

export class RateLimiter {
  private buckets = new Map<string, BucketEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;

    // Periodically purge stale entries to prevent unbounded memory growth.
    this.cleanupTimer = setInterval(() => this.cleanup(), options.windowMs * 2);
    // Allow the process to exit even if the timer is still active.
    if (typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check whether a request from `key` (typically an IP) is allowed.
   *
   * @returns An object describing the result:
   *   - `allowed` – whether the request may proceed
   *   - `remaining` – how many requests the client has left in the window
   *   - `resetMs` – ms until the oldest tracked request falls out of the window
   */
  check(key: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let entry = this.buckets.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.buckets.set(key, entry);
    }

    // Trim timestamps outside the current window.
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    if (entry.timestamps.length >= this.maxRequests) {
      const oldestInWindow = entry.timestamps[0];
      const resetMs = oldestInWindow + this.windowMs - now;
      return { allowed: false, remaining: 0, resetMs: Math.max(resetMs, 0) };
    }

    entry.timestamps.push(now);
    const remaining = this.maxRequests - entry.timestamps.length;
    const resetMs = entry.timestamps[0] + this.windowMs - now;
    return { allowed: true, remaining, resetMs: Math.max(resetMs, 0) };
  }

  /** Remove entries that have had no requests within the last window. */
  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, entry] of this.buckets) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) {
        this.buckets.delete(key);
      }
    }
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
    this.buckets.clear();
  }
}

// ---------------------------------------------------------------------------
// Pre-configured limiters for the demo routes
// ---------------------------------------------------------------------------

/** Chat route: 20 requests per minute */
export const chatRateLimiter = new RateLimiter({
  maxRequests: 20,
  windowMs: 60_000,
});

/** Sessions route: 60 requests per minute */
export const sessionsRateLimiter = new RateLimiter({
  maxRequests: 60,
  windowMs: 60_000,
});

/**
 * Extract client IP from the request.
 * Checks common proxy headers first, falls back to a constant for localhost.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  // Bun's Request doesn't expose a socket address directly —
  // default to a constant so the limiter still works per-server.
  return "127.0.0.1";
}
