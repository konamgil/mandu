/**
 * Timeout Middleware Plugin
 * filling.use(timeout(5000))
 */

import type { MiddlewarePlugin } from "../filling/filling";
import type { ManduContext } from "../filling/context";

export interface TimeoutMiddlewareOptions {
  /** 타임아웃 (ms) */
  ms: number;
  /** 타임아웃 시 응답 메시지 */
  message?: string;
  /** 타임아웃 시 HTTP 상태 코드 (기본: 408) */
  status?: number;
}

/**
 * 요청 타임아웃 미들웨어
 *
 * @example
 * ```typescript
 * import { timeout } from "@mandujs/core/middleware";
 *
 * export default Mandu.filling()
 *   .use(timeout({ ms: 5000 }))
 *   .get(async (ctx) => { ... });
 * ```
 */
export function timeout(options: TimeoutMiddlewareOptions | number): MiddlewarePlugin {
  const config = typeof options === "number"
    ? { ms: options, message: "Request Timeout", status: 408 }
    : { message: "Request Timeout", status: 408, ...options };

  return {
    beforeHandle: async (ctx: ManduContext): Promise<Response | void> => {
      // 타임아웃 타이머 설정 — 핸들러가 완료 전에 만료되면 408 반환
      ctx.set("_timeout_timer", setTimeout(() => {
        ctx.set("_timeout_expired", true);
      }, config.ms));
    },
    afterHandle: async (ctx: ManduContext, response: Response): Promise<Response> => {
      // 타이머 정리
      const timer = ctx.get<ReturnType<typeof setTimeout>>("_timeout_timer");
      if (timer) clearTimeout(timer);

      // 타임아웃 만료 확인
      if (ctx.get<boolean>("_timeout_expired")) {
        return ctx.json({ error: config.message }, config.status);
      }

      return response;
    },
  };
}
