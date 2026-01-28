/**
 * Mandu Middleware Compose 🔗
 * Hono 스타일 미들웨어 조합 패턴
 *
 * @see https://github.com/honojs/hono/blob/main/src/compose.ts
 */

import type { ManduContext } from "../filling/context";

/**
 * Next 함수 타입
 */
export type Next = () => Promise<void>;

/**
 * 미들웨어 함수 타입
 * - Response 반환: 체인 중단 (Guard 역할)
 * - void 반환: 다음 미들웨어 실행
 */
export type Middleware = (
  ctx: ManduContext,
  next: Next
) => Response | void | Promise<Response | void>;

/**
 * 에러 핸들러 타입
 */
export type ErrorHandler = (
  error: Error,
  ctx: ManduContext
) => Response | Promise<Response>;

/**
 * NotFound 핸들러 타입
 */
export type NotFoundHandler = (ctx: ManduContext) => Response | Promise<Response>;

/**
 * 미들웨어 엔트리 (메타데이터 포함)
 */
export interface MiddlewareEntry {
  fn: Middleware;
  name?: string;
  isAsync?: boolean;
}

/**
 * Compose 옵션
 */
export interface ComposeOptions {
  onError?: ErrorHandler;
  onNotFound?: NotFoundHandler;
}

/**
 * 미들웨어 함수들을 하나의 실행 함수로 조합
 *
 * @example
 * ```typescript
 * const middleware = [
 *   { fn: async (ctx, next) => { console.log('before'); await next(); console.log('after'); } },
 *   { fn: async (ctx, next) => { return ctx.ok({ data: 'hello' }); } },
 * ];
 *
 * const handler = compose(middleware, {
 *   onError: (err, ctx) => ctx.json({ error: err.message }, 500),
 *   onNotFound: (ctx) => ctx.notFound(),
 * });
 *
 * const response = await handler(context);
 * ```
 */
export function compose(
  middleware: MiddlewareEntry[],
  options: ComposeOptions = {}
): (ctx: ManduContext) => Promise<Response> {
  const { onError, onNotFound } = options;

  return async (ctx: ManduContext): Promise<Response> => {
    let index = -1;
    let finalResponse: Response | undefined;

    /**
     * 미들웨어 순차 실행
     * @param i 현재 인덱스
     */
    async function dispatch(i: number): Promise<void> {
      // next() 이중 호출 방지
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;

      const entry = middleware[i];

      if (!entry) {
        // 모든 미들웨어 통과 후 핸들러 없음
        if (!finalResponse && onNotFound) {
          finalResponse = await onNotFound(ctx);
        }
        return;
      }

      try {
        const result = await entry.fn(ctx, () => dispatch(i + 1));

        // Response 반환 시 체인 중단
        if (result instanceof Response) {
          finalResponse = result;
          return;
        }
      } catch (err) {
        if (err instanceof Error && onError) {
          finalResponse = await onError(err, ctx);
          return;
        }
        throw err;
      }
    }

    await dispatch(0);

    // 응답이 없으면 404
    if (!finalResponse) {
      if (onNotFound) {
        finalResponse = await onNotFound(ctx);
      } else {
        finalResponse = new Response("Not Found", { status: 404 });
      }
    }

    return finalResponse;
  };
}

/**
 * 미들웨어 배열 생성 헬퍼
 *
 * @example
 * ```typescript
 * const mw = createMiddleware([
 *   authGuard,
 *   rateLimitGuard,
 *   mainHandler,
 * ]);
 * ```
 */
export function createMiddleware(
  fns: Middleware[]
): MiddlewareEntry[] {
  return fns.map((fn, i) => ({
    fn,
    name: fn.name || `middleware_${i}`,
    isAsync: fn.constructor.name === "AsyncFunction",
  }));
}

/**
 * 미들웨어 체인 빌더
 *
 * @example
 * ```typescript
 * const chain = new MiddlewareChain()
 *   .use(authGuard)
 *   .use(rateLimitGuard)
 *   .use(mainHandler)
 *   .onError((err, ctx) => ctx.json({ error: err.message }, 500))
 *   .build();
 *
 * const response = await chain(ctx);
 * ```
 */
export class MiddlewareChain {
  private middleware: MiddlewareEntry[] = [];
  private errorHandler?: ErrorHandler;
  private notFoundHandler?: NotFoundHandler;

  /**
   * 미들웨어 추가
   */
  use(fn: Middleware, name?: string): this {
    this.middleware.push({
      fn,
      name: name || fn.name || `middleware_${this.middleware.length}`,
      isAsync: fn.constructor.name === "AsyncFunction",
    });
    return this;
  }

  /**
   * 에러 핸들러 설정
   */
  onError(handler: ErrorHandler): this {
    this.errorHandler = handler;
    return this;
  }

  /**
   * NotFound 핸들러 설정
   */
  onNotFound(handler: NotFoundHandler): this {
    this.notFoundHandler = handler;
    return this;
  }

  /**
   * 미들웨어 체인 빌드
   */
  build(): (ctx: ManduContext) => Promise<Response> {
    return compose(this.middleware, {
      onError: this.errorHandler,
      onNotFound: this.notFoundHandler,
    });
  }

  /**
   * 미들웨어 목록 조회
   */
  getMiddleware(): MiddlewareEntry[] {
    return [...this.middleware];
  }
}
