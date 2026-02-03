/**
 * Mandu Filling - 만두소 🥟
 * 체이닝 API로 비즈니스 로직 정의
 */

import { ManduContext, ValidationError } from "./context";
import { AuthenticationError, AuthorizationError } from "./auth";
import { ErrorClassifier, formatErrorResponse, ErrorCode } from "../error";
import { TIMEOUTS } from "../constants";
import { createContract, type ContractDefinition, type ContractInstance } from "../contract";
import {
  type Middleware as RuntimeMiddleware,
  type MiddlewareEntry,
  compose,
} from "../runtime/compose";
import {
  type LifecycleStore,
  type OnRequestHandler,
  type OnParseHandler,
  type BeforeHandleHandler,
  type AfterHandleHandler,
  type MapResponseHandler,
  type OnErrorHandler,
  type AfterResponseHandler,
  createLifecycleStore,
  executeLifecycle,
  type ExecuteOptions,
} from "../runtime/lifecycle";

/** Handler function type */
export type Handler = (ctx: ManduContext) => Response | Promise<Response>;

/** Guard function type (alias of BeforeHandle) */
export type Guard = BeforeHandleHandler;

/** HTTP methods */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** Loader function type - SSR 데이터 로딩 */
export type Loader<T = unknown> = (ctx: ManduContext) => T | Promise<T>;

/** Loader 실행 옵션 */
export interface LoaderOptions<T = unknown> {
  /** 타임아웃 (ms), 기본값 5000 */
  timeout?: number;
  /** 타임아웃 또는 에러 시 반환할 fallback 데이터 */
  fallback?: T;
}

/** Loader 타임아웃 에러 */
export class LoaderTimeoutError extends Error {
  constructor(timeout: number) {
    super(`Loader timed out after ${timeout}ms`);
    this.name = "LoaderTimeoutError";
  }
}

interface FillingConfig<TLoaderData = unknown> {
  handlers: Map<HttpMethod, Handler>;
  loader?: Loader<TLoaderData>;
  lifecycle: LifecycleStore;
  middleware: MiddlewareEntry[];
}

export class ManduFilling<TLoaderData = unknown> {
  private config: FillingConfig<TLoaderData> = {
    handlers: new Map(),
    lifecycle: createLifecycleStore(),
    middleware: [],
  };

  loader(loaderFn: Loader<TLoaderData>): this {
    this.config.loader = loaderFn;
    return this;
  }

  async executeLoader(
    ctx: ManduContext,
    options: LoaderOptions<TLoaderData> = {}
  ): Promise<TLoaderData | undefined> {
    if (!this.config.loader) {
      return undefined;
    }
    const { timeout = TIMEOUTS.LOADER_DEFAULT, fallback } = options;
    try {
      const loaderPromise = Promise.resolve(this.config.loader(ctx));
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new LoaderTimeoutError(timeout)), timeout);
      });
      return await Promise.race([loaderPromise, timeoutPromise]);
    } catch (error) {
      if (fallback !== undefined) {
        console.warn(`[Mandu] Loader failed, using fallback:`, error instanceof Error ? error.message : String(error));
        return fallback;
      }
      throw error;
    }
  }

  hasLoader(): boolean {
    return !!this.config.loader;
  }

  get(handler: Handler): this {
    this.config.handlers.set("GET", handler);
    return this;
  }

  post(handler: Handler): this {
    this.config.handlers.set("POST", handler);
    return this;
  }

  put(handler: Handler): this {
    this.config.handlers.set("PUT", handler);
    return this;
  }

  patch(handler: Handler): this {
    this.config.handlers.set("PATCH", handler);
    return this;
  }

  delete(handler: Handler): this {
    this.config.handlers.set("DELETE", handler);
    return this;
  }

  head(handler: Handler): this {
    this.config.handlers.set("HEAD", handler);
    return this;
  }

  options(handler: Handler): this {
    this.config.handlers.set("OPTIONS", handler);
    return this;
  }

  all(handler: Handler): this {
    const methods: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    methods.forEach((method) => this.config.handlers.set(method, handler));
    return this;
  }

  /**
   * 요청 시작 훅
   */
  onRequest(fn: OnRequestHandler): this {
    this.config.lifecycle.onRequest.push({ fn, scope: "local" });
    return this;
  }

  /**
   * Compose-style middleware (Hono/Koa 스타일)
   * lifecycle의 handler 단계에서 실행됨
   */
  middleware(fn: RuntimeMiddleware, name?: string): this {
    this.config.middleware.push({
      fn,
      name: name || fn.name || `middleware_${this.config.middleware.length}`,
      isAsync: fn.constructor.name === "AsyncFunction",
    });
    return this;
  }

  /**
   * 바디 파싱 훅
   * body를 읽을 때는 req.clone() 사용 권장
   */
  onParse(fn: OnParseHandler): this {
    this.config.lifecycle.onParse.push({ fn, scope: "local" });
    return this;
  }

  beforeHandle(fn: BeforeHandleHandler): this {
    this.config.lifecycle.beforeHandle.push({ fn, scope: "local" });
    return this;
  }

  /**
   * Guard alias (beforeHandle와 동일)
   * 인증/인가, 요청 차단 등에 사용
   */
  guard(fn: Guard): this {
    return this.beforeHandle(fn);
  }

  /**
   * Middleware alias (guard와 동일)
   */
  use(fn: Guard): this {
    return this.guard(fn);
  }

  /**
   * 핸들러 후 훅
   */
  afterHandle(fn: AfterHandleHandler): this {
    this.config.lifecycle.afterHandle.push({ fn, scope: "local" });
    return this;
  }

  /**
   * 최종 응답 매핑 훅
   */
  mapResponse(fn: MapResponseHandler): this {
    this.config.lifecycle.mapResponse.push({ fn, scope: "local" });
    return this;
  }

  /**
   * 에러 핸들링 훅
   */
  onError(fn: OnErrorHandler): this {
    this.config.lifecycle.onError.push({ fn, scope: "local" });
    return this;
  }

  /**
   * 응답 후 훅 (비동기)
   */
  afterResponse(fn: AfterResponseHandler): this {
    this.config.lifecycle.afterResponse.push({ fn, scope: "local" });
    return this;
  }

  async handle(
    request: Request,
    params: Record<string, string> = {},
    routeContext?: { routeId: string; pattern: string },
    options?: ExecuteOptions
  ): Promise<Response> {
    const ctx = new ManduContext(request, params);
    const method = request.method.toUpperCase() as HttpMethod;
    const handler = this.config.handlers.get(method);
    if (!handler) {
      return ctx.json({ status: "error", message: `Method ${method} not allowed`, allowed: Array.from(this.config.handlers.keys()) }, 405);
    }
    const lifecycleWithDefaults = this.createLifecycleWithDefaults(routeContext);
    const runHandler = async () => {
      if (this.config.middleware.length === 0) {
        return handler(ctx);
      }
      const chain: MiddlewareEntry[] = [
        ...this.config.middleware,
        {
          fn: async (innerCtx) => handler(innerCtx),
          name: "handler",
          isAsync: true,
        },
      ];
      const composed = compose(chain);
      return composed(ctx);
    };
    return executeLifecycle(lifecycleWithDefaults, ctx, runHandler, options);
  }

  private createLifecycleWithDefaults(routeContext?: { routeId: string; pattern: string }): LifecycleStore {
    const lifecycle: LifecycleStore = {
      onRequest: [...this.config.lifecycle.onRequest],
      onParse: [...this.config.lifecycle.onParse],
      beforeHandle: [...this.config.lifecycle.beforeHandle],
      afterHandle: [...this.config.lifecycle.afterHandle],
      mapResponse: [...this.config.lifecycle.mapResponse],
      afterResponse: [...this.config.lifecycle.afterResponse],
      onError: [...this.config.lifecycle.onError],
    };
    const defaultErrorHandler: OnErrorHandler = (ctx, error) => {
      if (error instanceof AuthenticationError) {
        return ctx.json({ errorType: "AUTH_ERROR", code: "AUTHENTICATION_REQUIRED", message: error.message, summary: "인증 필요 - 로그인 후 다시 시도하세요", timestamp: new Date().toISOString() }, 401);
      }
      if (error instanceof AuthorizationError) {
        return ctx.json({ errorType: "AUTH_ERROR", code: "ACCESS_DENIED", message: error.message, summary: "권한 없음 - 접근 권한이 부족합니다", requiredRoles: error.requiredRoles, timestamp: new Date().toISOString() }, 403);
      }
      if (error instanceof ValidationError) {
        return ctx.json({ errorType: "LOGIC_ERROR", code: ErrorCode.SLOT_VALIDATION_ERROR, message: "Validation failed", summary: "입력 검증 실패 - 요청 데이터 확인 필요", fix: { file: routeContext ? `spec/slots/${routeContext.routeId}.slot.ts` : "spec/slots/", suggestion: "요청 데이터가 스키마와 일치하는지 확인하세요" }, route: routeContext, errors: error.errors, timestamp: new Date().toISOString() }, 400);
      }
      const classifier = new ErrorClassifier(null, routeContext);
      const manduError = classifier.classify(error);
      console.error(`[Mandu] ${manduError.errorType}:`, manduError.message);
      const response = formatErrorResponse(manduError, { isDev: process.env.NODE_ENV !== "production" });
      return ctx.json(response, 500);
    };
    lifecycle.onError.push({ fn: defaultErrorHandler, scope: "local" });
    return lifecycle;
  }

  getMethods(): HttpMethod[] {
    return Array.from(this.config.handlers.keys());
  }

  hasMethod(method: HttpMethod): boolean {
    return this.config.handlers.has(method);
  }
}

/**
 * Mandu Filling factory functions
 * Note: These are also available via the main `Mandu` namespace
 */
export const ManduFillingFactory = {
  filling<TLoaderData = unknown>(): ManduFilling<TLoaderData> {
    return new ManduFilling<TLoaderData>();
  },
  contract<T extends ContractDefinition>(definition: T): T & ContractInstance {
    return createContract(definition);
  },
  context(request: Request, params?: Record<string, string>): ManduContext {
    return new ManduContext(request, params);
  },
};
