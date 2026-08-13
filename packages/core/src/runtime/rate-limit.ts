export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  statusCode?: number;
  headers?: boolean;
  /**
   * Reverse proxy 헤더를 신뢰할지 여부
   * - false(기본): X-Forwarded-For 등을 읽지만 spoofing 가능성을 표시
   * - true: 전달된 클라이언트 IP를 완전히 신뢰
   * 주의: trustProxy: false여도 클라이언트 구분을 위해 헤더를 사용하므로
   *       IP spoofing이 가능합니다. 신뢰할 수 있는 프록시 뒤에서만 사용하세요.
   */
  trustProxy?: boolean;
  /**
   * 메모리 보호를 위한 최대 key 수
   * - 초과 시 오래된 key부터 제거
   */
  maxKeys?: number;
}

export interface NormalizedRateLimitOptions {
  windowMs: number;
  max: number;
  message: string;
  statusCode: number;
  headers: boolean;
  trustProxy: boolean;
  maxKeys: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export class MemoryRateLimiter {
  private readonly store = new Map<string, { count: number; resetAt: number }>();
  private lastCleanupAt = 0;

  consume(req: Request, routeId: string, options: NormalizedRateLimitOptions): RateLimitDecision {
    const now = Date.now();
    this.maybeCleanup(now, options);

    const key = `${this.getClientKey(req, options)}:${routeId}`;
    const current = this.store.get(key);

    if (!current || current.resetAt <= now) {
      const resetAt = now + options.windowMs;
      this.store.set(key, { count: 1, resetAt });
      this.enforceMaxKeys(options.maxKeys);
      return { allowed: true, limit: options.max, remaining: Math.max(0, options.max - 1), resetAt };
    }

    current.count += 1;
    this.store.set(key, current);

    return {
      allowed: current.count <= options.max,
      limit: options.max,
      remaining: Math.max(0, options.max - current.count),
      resetAt: current.resetAt,
    };
  }

  private maybeCleanup(now: number, options: NormalizedRateLimitOptions): void {
    if (now - this.lastCleanupAt < Math.max(1_000, options.windowMs)) {
      return;
    }

    this.lastCleanupAt = now;
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
      }
    }
  }

  private enforceMaxKeys(maxKeys: number): void {
    while (this.store.size > maxKeys) {
      const oldestKey = this.store.keys().next().value;
      if (!oldestKey) break;
      this.store.delete(oldestKey);
    }
  }

  private getClientKey(req: Request, options: NormalizedRateLimitOptions): string {
    const candidates = [
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      req.headers.get("x-real-ip")?.trim(),
      req.headers.get("cf-connecting-ip")?.trim(),
      req.headers.get("true-client-ip")?.trim(),
      req.headers.get("fly-client-ip")?.trim(),
    ];

    for (const candidate of candidates) {
      if (candidate) {
        const sanitized = candidate.slice(0, 64);
        return options.trustProxy ? sanitized : `unverified:${sanitized}`;
      }
    }

    return "default";
  }
}

export function normalizeRateLimitOptions(
  options: boolean | RateLimitOptions | undefined
): NormalizedRateLimitOptions | false {
  if (!options) return false;
  if (options === true) {
    return {
      windowMs: 60_000,
      max: 100,
      message: "Too Many Requests",
      statusCode: 429,
      headers: true,
      trustProxy: false,
      maxKeys: 10_000,
    };
  }

  const windowMs = Number.isFinite(options.windowMs) ? Math.max(1_000, options.windowMs!) : 60_000;
  const max = Number.isFinite(options.max) ? Math.max(1, Math.floor(options.max!)) : 100;
  const statusCode = Number.isFinite(options.statusCode)
    ? Math.min(599, Math.max(400, Math.floor(options.statusCode!)))
    : 429;
  const maxKeys = Number.isFinite(options.maxKeys)
    ? Math.max(100, Math.floor(options.maxKeys!))
    : 10_000;

  return {
    windowMs,
    max,
    message: options.message ?? "Too Many Requests",
    statusCode,
    headers: options.headers ?? true,
    trustProxy: options.trustProxy ?? false,
    maxKeys,
  };
}

export function appendRateLimitHeaders(
  response: Response,
  decision: RateLimitDecision,
  options: NormalizedRateLimitOptions
): Response {
  if (!options.headers) return response;

  const headers = new Headers(response.headers);
  const retryAfterSec = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000));

  headers.set("X-RateLimit-Limit", String(decision.limit));
  headers.set("X-RateLimit-Remaining", String(decision.remaining));
  headers.set("X-RateLimit-Reset", String(Math.floor(decision.resetAt / 1000)));
  headers.set("Retry-After", String(retryAfterSec));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createRateLimitResponse(
  decision: RateLimitDecision,
  options: NormalizedRateLimitOptions
): Response {
  const response = Response.json(
    {
      error: "rate_limit_exceeded",
      message: options.message,
      limit: decision.limit,
      remaining: decision.remaining,
      retryAfter: Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000)),
    },
    { status: options.statusCode }
  );

  return appendRateLimitHeaders(response, decision, options);
}

/**
 * Create standalone rate limiter for custom API handlers.
 *
 * @example
 * ```typescript
 * import { createRateLimiter } from '@mandujs/core/compat/runtime/server';
 *
 * const limiter = createRateLimiter({ max: 5, windowMs: 60000 });
 *
 * export async function POST(req: Request) {
 *   const decision = limiter.check(req, 'my-api-route');
 *   if (!decision.allowed) return limiter.createResponse(decision);
 *   return new Response('OK');
 * }
 * ```
 */
export function createRateLimiter(options?: RateLimitOptions) {
  const normalized = normalizeRateLimitOptions(options || true);
  if (!normalized) {
    throw new Error("Rate limiter options must be truthy");
  }

  const limiter = new MemoryRateLimiter();

  return {
    /**
     * Check if request is allowed.
     */
    check(req: Request, routeId: string): RateLimitDecision {
      return limiter.consume(req, routeId, normalized);
    },

    /**
     * Create 429 response for denied request.
     */
    createResponse(decision: RateLimitDecision): Response {
      return createRateLimitResponse(decision, normalized);
    },

    /**
     * Add rate limit headers to successful response.
     */
    addHeaders(response: Response, decision: RateLimitDecision): Response {
      return appendRateLimitHeaders(response, decision, normalized);
    },
  };
}
