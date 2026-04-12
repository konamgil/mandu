/**
 * CORS Middleware Plugin
 * filling.use(cors({ origin: "https://example.com" }))
 */

import type { MiddlewarePlugin } from "../filling/filling";
import type { ManduContext } from "../filling/context";
import {
  type CorsOptions,
  handlePreflightRequest,
  applyCorsToResponse,
} from "../runtime/cors";

export type CorsMiddlewareOptions = CorsOptions;

/**
 * CORS 미들웨어
 *
 * @example
 * ```typescript
 * import { cors } from "@mandujs/core/middleware";
 *
 * export default Mandu.filling()
 *   .use(cors({ origin: ["https://example.com"], credentials: true }))
 *   .get((ctx) => ctx.ok({ data: "protected" }));
 * ```
 */
export function cors(options?: CorsMiddlewareOptions): MiddlewarePlugin {
  return {
    beforeHandle: async (ctx: ManduContext): Promise<Response | void> => {
      const origin = ctx.headers.get("Origin");
      if (!origin) return;

      // Preflight
      if (ctx.request.method === "OPTIONS") {
        return handlePreflightRequest(ctx.request, options);
      }

      // 실제 요청 — afterHandle에서 CORS 헤더 추가하기 위해 플래그 저장
      ctx.set("_cors_apply", true);
    },
    afterHandle: async (ctx: ManduContext, response: Response): Promise<Response> => {
      if (!ctx.get<boolean>("_cors_apply")) return response;
      return applyCorsToResponse(response, ctx.request, options);
    },
  };
}
