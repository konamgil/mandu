/**
 * Mandu Lifecycle Hooks 🔄
 * Elysia 스타일 라이프사이클 훅 체계
 *
 * @see https://elysiajs.com/life-cycle/overview.html
 *
 * 요청 흐름:
 * 1. onRequest    - 요청 시작
 * 2. onParse      - 바디 파싱 (POST, PUT, PATCH)
 * 3. beforeHandle - 핸들러 전 (Guard 역할)
 * 4. [Handler]    - 메인 핸들러 실행
 * 5. afterHandle  - 핸들러 후 (응답 변환)
 * 6. mapResponse  - 응답 매핑
 * 7. afterResponse - 응답 후 (로깅, 정리)
 *
 * 에러 발생 시:
 * - onError       - 에러 핸들링
 */

import type { ManduContext } from "../filling/context";
import { createTracer } from "./trace";

/**
 * 훅 스코프
 * - global: 모든 라우트에 적용
 * - scoped: 현재 플러그인/라우트 그룹에 적용
 * - local: 현재 라우트에만 적용
 */
export type HookScope = "global" | "scoped" | "local";

/**
 * 훅 컨테이너
 */
export interface HookContainer<T extends Function = Function> {
  fn: T;
  scope: HookScope;
  name?: string;
  checksum?: number; // 중복 제거용
}

// ============================================
// 훅 타입 정의
// ============================================

/** 요청 시작 훅 */
export type OnRequestHandler = (ctx: ManduContext) => void | Promise<void>;

/** 바디 파싱 훅 */
export type OnParseHandler = (ctx: ManduContext) => void | Promise<void>;

/** 핸들러 전 훅 (Guard 역할) - Response 반환 시 체인 중단 */
export type BeforeHandleHandler = (
  ctx: ManduContext
) => Response | void | Promise<Response | void>;

/** 핸들러 후 훅 - 응답 변환 가능 */
export type AfterHandleHandler = (
  ctx: ManduContext,
  response: Response
) => Response | Promise<Response>;

/** 응답 매핑 훅 */
export type MapResponseHandler = (
  ctx: ManduContext,
  response: Response
) => Response | Promise<Response>;

/** 응답 후 훅 (비동기, 응답에 영향 없음) */
export type AfterResponseHandler = (ctx: ManduContext) => void | Promise<void>;

/** 에러 핸들링 훅 - Response 반환 시 에러 응답으로 사용 */
export type OnErrorHandler = (
  ctx: ManduContext,
  error: Error
) => Response | void | Promise<Response | void>;

// ============================================
// 라이프사이클 스토어
// ============================================

/**
 * 라이프사이클 훅 스토어
 */
export interface LifecycleStore {
  onRequest: HookContainer<OnRequestHandler>[];
  onParse: HookContainer<OnParseHandler>[];
  beforeHandle: HookContainer<BeforeHandleHandler>[];
  afterHandle: HookContainer<AfterHandleHandler>[];
  mapResponse: HookContainer<MapResponseHandler>[];
  afterResponse: HookContainer<AfterResponseHandler>[];
  onError: HookContainer<OnErrorHandler>[];
}

/**
 * 빈 라이프사이클 스토어 생성
 */
export function createLifecycleStore(): LifecycleStore {
  return {
    onRequest: [],
    onParse: [],
    beforeHandle: [],
    afterHandle: [],
    mapResponse: [],
    afterResponse: [],
    onError: [],
  };
}

// ============================================
// 라이프사이클 실행
// ============================================

/**
 * 라이프사이클 실행 옵션
 */
export interface ExecuteOptions {
  /** 바디 파싱이 필요한 메서드 */
  parseBodyMethods?: string[];
  /** 트레이스 활성화 */
  trace?: boolean;
}

const DEFAULT_PARSE_BODY_METHODS = ["POST", "PUT", "PATCH"];

/**
 * 라이프사이클 실행
 *
 * @param lifecycle 라이프사이클 스토어
 * @param ctx ManduContext
 * @param handler 메인 핸들러
 * @param options 옵션
 *
 * @example
 * ```typescript
 * const lifecycle = createLifecycleStore();
 * lifecycle.onRequest.push({ fn: (ctx) => console.log('Request started'), scope: 'local' });
 * lifecycle.beforeHandle.push({ fn: authGuard, scope: 'local' });
 *
 * const response = await executeLifecycle(
 *   lifecycle,
 *   ctx,
 *   async () => ctx.ok({ data: 'hello' })
 * );
 * ```
 */
export async function executeLifecycle(
  lifecycle: LifecycleStore,
  ctx: ManduContext,
  handler: () => Promise<Response>,
  options: ExecuteOptions = {}
): Promise<Response> {
  const { parseBodyMethods = DEFAULT_PARSE_BODY_METHODS } = options;
  const tracer = createTracer(ctx, options.trace);
  let response: Response;

  try {
    // 1. onRequest
    const endRequest = tracer.begin("request");
    for (const hook of lifecycle.onRequest) {
      await hook.fn(ctx);
    }
    endRequest();

    // 2. onParse (바디가 있는 메서드만)
    if (parseBodyMethods.includes(ctx.req.method)) {
      const endParse = tracer.begin("parse");
      for (const hook of lifecycle.onParse) {
        await hook.fn(ctx);
      }
      endParse();
    }

    // 3. beforeHandle (Guard 역할)
    const endBefore = tracer.begin("beforeHandle");
    for (const hook of lifecycle.beforeHandle) {
      const result = await hook.fn(ctx);
      if (result instanceof Response) {
        // Response 반환 시 체인 중단, afterHandle/mapResponse 건너뜀
        response = result;
        endBefore();
        // afterResponse는 실행
        scheduleAfterResponse(lifecycle.afterResponse, ctx, tracer);
        return response;
      }
    }
    endBefore();

    // 4. 메인 핸들러 실행
    const endHandle = tracer.begin("handle");
    response = await handler();
    endHandle();

    // 5. afterHandle
    const endAfter = tracer.begin("afterHandle");
    for (const hook of lifecycle.afterHandle) {
      response = await hook.fn(ctx, response);
    }
    endAfter();

    // 6. mapResponse
    const endMap = tracer.begin("mapResponse");
    for (const hook of lifecycle.mapResponse) {
      response = await hook.fn(ctx, response);
    }
    endMap();

    // 7. afterResponse (비동기)
    scheduleAfterResponse(lifecycle.afterResponse, ctx, tracer);

    return response;
  } catch (err) {
    // onError 처리
    const error = err instanceof Error ? err : new Error(String(err));
    tracer.error("error", error);

    for (const hook of lifecycle.onError) {
      const result = await hook.fn(ctx, error);
      if (result instanceof Response) {
        // afterResponse는 에러 시에도 실행
        scheduleAfterResponse(lifecycle.afterResponse, ctx, tracer);
        return result;
      }
    }

    // 에러 핸들러가 Response를 반환하지 않으면 재throw
    throw error;
  }
}

/**
 * afterResponse 훅 비동기 실행 (응답 후)
 */
function scheduleAfterResponse(
  hooks: HookContainer<AfterResponseHandler>[],
  ctx: ManduContext,
  tracer?: ReturnType<typeof createTracer>
): void {
  if (hooks.length === 0) return;

  // queueMicrotask로 응답 후 실행
  queueMicrotask(async () => {
    const endAfterResponse = tracer?.begin("afterResponse") ?? (() => {});
    for (const hook of hooks) {
      try {
        await hook.fn(ctx);
      } catch (err) {
        console.error("[Mandu] afterResponse hook error:", err);
      }
    }
    endAfterResponse();
  });
}

// ============================================
// 라이프사이클 빌더
// ============================================

/**
 * 라이프사이클 빌더
 *
 * @example
 * ```typescript
 * const lifecycle = new LifecycleBuilder()
 *   .onRequest((ctx) => console.log('Request:', ctx.req.url))
 *   .beforeHandle(authGuard)
 *   .afterHandle((ctx, res) => {
 *     // 응답 헤더 추가
 *     res.headers.set('X-Custom', 'value');
 *     return res;
 *   })
 *   .onError((ctx, err) => ctx.json({ error: err.message }, 500))
 *   .build();
 * ```
 */
export class LifecycleBuilder {
  private store: LifecycleStore = createLifecycleStore();

  /**
   * 요청 시작 훅 추가
   */
  onRequest(fn: OnRequestHandler, scope: HookScope = "local"): this {
    this.store.onRequest.push({ fn, scope });
    return this;
  }

  /**
   * 바디 파싱 훅 추가
   */
  onParse(fn: OnParseHandler, scope: HookScope = "local"): this {
    this.store.onParse.push({ fn, scope });
    return this;
  }

  /**
   * 핸들러 전 훅 추가 (Guard 역할)
   */
  beforeHandle(fn: BeforeHandleHandler, scope: HookScope = "local"): this {
    this.store.beforeHandle.push({ fn, scope });
    return this;
  }

  /**
   * 핸들러 후 훅 추가
   */
  afterHandle(fn: AfterHandleHandler, scope: HookScope = "local"): this {
    this.store.afterHandle.push({ fn, scope });
    return this;
  }

  /**
   * 응답 매핑 훅 추가
   */
  mapResponse(fn: MapResponseHandler, scope: HookScope = "local"): this {
    this.store.mapResponse.push({ fn, scope });
    return this;
  }

  /**
   * 응답 후 훅 추가
   */
  afterResponse(fn: AfterResponseHandler, scope: HookScope = "local"): this {
    this.store.afterResponse.push({ fn, scope });
    return this;
  }

  /**
   * 에러 핸들링 훅 추가
   */
  onError(fn: OnErrorHandler, scope: HookScope = "local"): this {
    this.store.onError.push({ fn, scope });
    return this;
  }

  /**
   * 라이프사이클 스토어 빌드
   */
  build(): LifecycleStore {
    return { ...this.store };
  }

  /**
   * 다른 라이프사이클과 병합
   */
  merge(other: LifecycleStore): this {
    this.store.onRequest.push(...other.onRequest);
    this.store.onParse.push(...other.onParse);
    this.store.beforeHandle.push(...other.beforeHandle);
    this.store.afterHandle.push(...other.afterHandle);
    this.store.mapResponse.push(...other.mapResponse);
    this.store.afterResponse.push(...other.afterResponse);
    this.store.onError.push(...other.onError);
    return this;
  }
}

// ============================================
// 유틸리티
// ============================================

/**
 * 훅 중복 제거 (checksum 기반)
 */
export function deduplicateHooks<T extends HookContainer>(hooks: T[]): T[] {
  const seen = new Set<number>();
  return hooks.filter((hook) => {
    if (hook.checksum === undefined) return true;
    if (seen.has(hook.checksum)) return false;
    seen.add(hook.checksum);
    return true;
  });
}

/**
 * 스코프별 훅 필터링
 */
export function filterHooksByScope<T extends HookContainer>(
  hooks: T[],
  scopes: HookScope[]
): T[] {
  return hooks.filter((hook) => scopes.includes(hook.scope));
}
