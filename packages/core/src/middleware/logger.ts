/**
 * Logger Middleware Plugin
 * filling.use(logger())
 */

import type { MiddlewarePlugin } from "../filling/filling";
import type { ManduContext } from "../filling/context";

export interface LoggerMiddlewareOptions {
  /** 로그 포맷 (기본: "short") */
  format?: "short" | "detailed";
  /** 커스텀 로거 (기본: console.log) */
  log?: (message: string) => void;
  /** 느린 요청 경고 임계값 (ms, 기본: 3000) */
  slowThreshold?: number;
}

/**
 * 요청/응답 로깅 미들웨어
 *
 * @example
 * ```typescript
 * import { logger } from "@mandujs/core/middleware";
 *
 * export default Mandu.filling()
 *   .use(logger({ format: "detailed", slowThreshold: 1000 }))
 *   .get((ctx) => ctx.ok({ data: "logged" }));
 * ```
 */
export function logger(options?: LoggerMiddlewareOptions): MiddlewarePlugin {
  const format = options?.format ?? "short";
  const log = options?.log ?? console.log;
  const slowThreshold = options?.slowThreshold ?? 3000;

  return {
    beforeHandle: async (ctx: ManduContext): Promise<void> => {
      ctx.set("_logger_start", Date.now());
    },
    afterHandle: async (ctx: ManduContext, response: Response): Promise<Response> => {
      const start = ctx.get<number>("_logger_start");
      if (start === undefined) return response;

      const duration = Date.now() - start;
      const method = ctx.request.method;
      const pathname = new URL(ctx.request.url).pathname;
      const status = response.status;
      const slow = duration > slowThreshold ? " ⚠️ SLOW" : "";

      if (format === "detailed") {
        log(`${method} ${pathname} → ${status} (${duration}ms)${slow}`);
      } else {
        log(`${method} ${pathname} ${status} ${duration}ms${slow}`);
      }

      return response;
    },
  };
}
