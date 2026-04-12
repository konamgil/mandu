/**
 * Mandu Fetch Handler Factory
 * 런타임 중립적 fetch handler 생성
 * Bun.serve, Node.js http, Cloudflare Workers 등에서 공통 사용
 */

import type { Router } from "./router";
import type { ServerRegistry } from "./server";
import type {
  MiddlewareFn,
  MiddlewareConfig,
} from "./middleware";
import { createMiddlewareContext, matchesMiddlewarePath } from "./middleware";
import { type CorsOptions, isCorsRequest, applyCorsToResponse } from "./cors";

export interface FetchHandlerOptions {
  router: Router;
  registry: ServerRegistry;
  corsOptions: CorsOptions | false;
  middlewareFn: MiddlewareFn | null;
  middlewareConfig: MiddlewareConfig | null;
  handleRequest: (req: Request, router: Router, registry: ServerRegistry) => Promise<Response>;
}

/**
 * 런타임 중립적 fetch handler 생성
 * 미들웨어, CORS, 라우트 디스패치를 모두 포함
 */
export function createFetchHandler(options: FetchHandlerOptions): (req: Request) => Promise<Response> {
  const { router, registry, corsOptions, handleRequest, middlewareFn, middlewareConfig } = options;

  return async function fetchHandler(req: Request): Promise<Response> {
    // 글로벌 미들웨어 실행 (라우트 매칭 전)
    if (middlewareFn) {
      const url = new URL(req.url);
      if (matchesMiddlewarePath(url.pathname, middlewareConfig)) {
        const mwCtx = createMiddlewareContext(req);
        try {
          const response = await middlewareFn(mwCtx, async () => {
            return handleRequest(req, router, registry);
          });

          if (corsOptions && isCorsRequest(req)) {
            return applyCorsToResponse(response, req, corsOptions);
          }
          return response;
        } catch (error) {
          console.error("[Mandu Middleware] Error:", error);
          return new Response("Internal Server Error", { status: 500 });
        }
      }
    }

    const response = await handleRequest(req, router, registry);

    if (corsOptions && isCorsRequest(req)) {
      return applyCorsToResponse(response, req, corsOptions);
    }

    return response;
  };
}
