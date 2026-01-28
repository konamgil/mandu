/**
 * Mandu Filling - 만두소 🥟
 * 체이닝 API로 비즈니스 로직 정의
 */

import { ManduContext, NEXT_SYMBOL, ValidationError } from "./context";
import { ErrorClassifier, formatErrorResponse, ErrorCode } from "../error";
import { createContract, type ContractDefinition, type ContractInstance } from "../contract";

/** Handler function type */
export type Handler = (ctx: ManduContext) => Response | Promise<Response>;

/** Guard function type - returns next() or Response */
export type Guard = (ctx: ManduContext) => symbol | Response | Promise<symbol | Response>;

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
  guards: Guard[];
  methodGuards: Map<HttpMethod, Guard[]>;
  loader?: Loader<TLoaderData>;
}

/**
 * Mandu Filling Builder
 * @example
 * ```typescript
 * export default Mandu.filling()
 *   .guard(authCheck)
 *   .get(ctx => ctx.ok({ message: 'Hello!' }))
 *   .post(ctx => ctx.created({ id: 1 }))
 * ```
 *
 * @example with loader
 * ```typescript
 * export default Mandu.filling<{ todos: Todo[] }>()
 *   .loader(async (ctx) => {
 *     const todos = await db.todos.findMany();
 *     return { todos };
 *   })
 *   .get(ctx => ctx.ok(ctx.get('loaderData')))
 * ```
 */
export class ManduFilling<TLoaderData = unknown> {
  private config: FillingConfig<TLoaderData> = {
    handlers: new Map(),
    guards: [],
    methodGuards: new Map(),
  };

  // ============================================
  // 🥟 SSR Loader
  // ============================================

  /**
   * Define SSR data loader
   * 페이지 렌더링 전 서버에서 데이터를 로드합니다.
   * 로드된 데이터는 클라이언트로 전달되어 hydration에 사용됩니다.
   *
   * @example
   * ```typescript
   * .loader(async (ctx) => {
   *   const todos = await db.todos.findMany();
   *   return { todos, user: ctx.get('user') };
   * })
   * ```
   */
  loader(loaderFn: Loader<TLoaderData>): this {
    this.config.loader = loaderFn;
    return this;
  }

  /**
   * Execute loader and return data
   * @internal Used by SSR runtime
   * @param ctx ManduContext
   * @param options Loader 실행 옵션 (timeout, fallback)
   */
  async executeLoader(
    ctx: ManduContext,
    options: LoaderOptions<TLoaderData> = {}
  ): Promise<TLoaderData | undefined> {
    if (!this.config.loader) {
      return undefined;
    }

    const { timeout = 5000, fallback } = options;

    try {
      const loaderPromise = Promise.resolve(this.config.loader(ctx));

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new LoaderTimeoutError(timeout)), timeout);
      });

      return await Promise.race([loaderPromise, timeoutPromise]);
    } catch (error) {
      if (fallback !== undefined) {
        console.warn(
          `[Mandu] Loader failed, using fallback:`,
          error instanceof Error ? error.message : String(error)
        );
        return fallback;
      }
      throw error;
    }
  }

  /**
   * Check if loader is defined
   */
  hasLoader(): boolean {
    return !!this.config.loader;
  }

  // ============================================
  // 🥟 HTTP Method Handlers
  // ============================================

  /** Handle GET requests */
  get(handler: Handler): this {
    this.config.handlers.set("GET", handler);
    return this;
  }

  /** Handle POST requests */
  post(handler: Handler): this {
    this.config.handlers.set("POST", handler);
    return this;
  }

  /** Handle PUT requests */
  put(handler: Handler): this {
    this.config.handlers.set("PUT", handler);
    return this;
  }

  /** Handle PATCH requests */
  patch(handler: Handler): this {
    this.config.handlers.set("PATCH", handler);
    return this;
  }

  /** Handle DELETE requests */
  delete(handler: Handler): this {
    this.config.handlers.set("DELETE", handler);
    return this;
  }

  /** Handle HEAD requests */
  head(handler: Handler): this {
    this.config.handlers.set("HEAD", handler);
    return this;
  }

  /** Handle OPTIONS requests */
  options(handler: Handler): this {
    this.config.handlers.set("OPTIONS", handler);
    return this;
  }

  /** Handle all methods with single handler */
  all(handler: Handler): this {
    const methods: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    methods.forEach((method) => this.config.handlers.set(method, handler));
    return this;
  }

  // ============================================
  // 🥟 Guards (만두 찜기)
  // ============================================

  /**
   * Add guard for all methods or specific methods
   * @example
   * .guard(authCheck)                    // all methods
   * .guard(authCheck, 'POST', 'PUT')     // specific methods
   */
  guard(guardFn: Guard, ...methods: HttpMethod[]): this {
    if (methods.length === 0) {
      // Apply to all methods
      this.config.guards.push(guardFn);
    } else {
      // Apply to specific methods
      methods.forEach((method) => {
        const guards = this.config.methodGuards.get(method) || [];
        guards.push(guardFn);
        this.config.methodGuards.set(method, guards);
      });
    }
    return this;
  }

  /** Alias for guard - more semantic for middleware */
  use(guardFn: Guard, ...methods: HttpMethod[]): this {
    return this.guard(guardFn, ...methods);
  }

  // ============================================
  // 🥟 Execution
  // ============================================

  /**
   * Handle incoming request
   * Called by generated route handler
   * @param request The incoming request
   * @param params URL path parameters
   * @param routeContext Route context for error reporting
   */
  async handle(
    request: Request,
    params: Record<string, string> = {},
    routeContext?: { routeId: string; pattern: string }
  ): Promise<Response> {
    const ctx = new ManduContext(request, params);
    const method = request.method.toUpperCase() as HttpMethod;

    try {
      // Run global guards
      for (const guard of this.config.guards) {
        const result = await guard(ctx);
        if (result !== NEXT_SYMBOL) {
          return result as Response;
        }
        if (!ctx.shouldContinue) {
          const response = ctx.getResponse();
          if (!response) {
            throw new Error("Guard set shouldContinue=false but no response was provided");
          }
          return response;
        }
      }

      // Run method-specific guards
      const methodGuards = this.config.methodGuards.get(method) || [];
      for (const guard of methodGuards) {
        const result = await guard(ctx);
        if (result !== NEXT_SYMBOL) {
          return result as Response;
        }
        if (!ctx.shouldContinue) {
          const response = ctx.getResponse();
          if (!response) {
            throw new Error("Guard set shouldContinue=false but no response was provided");
          }
          return response;
        }
      }

      // Get handler for method
      const handler = this.config.handlers.get(method);
      if (!handler) {
        return ctx.json(
          {
            status: "error",
            message: `Method ${method} not allowed`,
            allowed: Array.from(this.config.handlers.keys()),
          },
          405
        );
      }

      // Execute handler
      return await handler(ctx);
    } catch (error) {
      // Handle validation errors with enhanced error format
      if (error instanceof ValidationError) {
        return ctx.json(
          {
            errorType: "LOGIC_ERROR",
            code: ErrorCode.SLOT_VALIDATION_ERROR,
            message: "Validation failed",
            summary: "입력 검증 실패 - 요청 데이터 확인 필요",
            fix: {
              file: routeContext ? `spec/slots/${routeContext.routeId}.slot.ts` : "spec/slots/",
              suggestion: "요청 데이터가 스키마와 일치하는지 확인하세요",
            },
            route: routeContext,
            errors: error.errors,
            timestamp: new Date().toISOString(),
          },
          400
        );
      }

      // Handle other errors with error classification
      const classifier = new ErrorClassifier(null, routeContext);
      const manduError = classifier.classify(error);

      console.error(`[Mandu] ${manduError.errorType}:`, manduError.message);

      const response = formatErrorResponse(manduError, {
        isDev: process.env.NODE_ENV !== "production",
      });

      return ctx.json(response, 500);
    }
  }

  /**
   * Get list of registered methods
   */
  getMethods(): HttpMethod[] {
    return Array.from(this.config.handlers.keys());
  }

  /**
   * Check if method is registered
   */
  hasMethod(method: HttpMethod): boolean {
    return this.config.handlers.has(method);
  }
}

/**
 * Mandu namespace with factory methods
 */
export const Mandu = {
  /**
   * Create a new filling (slot logic builder)
   * @example
   * ```typescript
   * import { Mandu } from '@mandujs/core'
   *
   * export default Mandu.filling()
   *   .get(ctx => ctx.ok({ message: 'Hello!' }))
   * ```
   *
   * @example with loader data type
   * ```typescript
   * import { Mandu } from '@mandujs/core'
   *
   * interface LoaderData {
   *   todos: Todo[];
   *   user: User | null;
   * }
   *
   * export default Mandu.filling<LoaderData>()
   *   .loader(async (ctx) => {
   *     const todos = await db.todos.findMany();
   *     return { todos, user: null };
   *   })
   *   .get(ctx => ctx.ok(ctx.get('loaderData')))
   * ```
   */
  filling<TLoaderData = unknown>(): ManduFilling<TLoaderData> {
    return new ManduFilling<TLoaderData>();
  },

  /**
   * Create an API contract (schema-first definition)
   *
   * Contract-first 방식으로 API 스키마를 정의합니다.
   * 정의된 스키마는 다음에 활용됩니다:
   * - TypeScript 타입 추론 (Slot에서 자동 완성)
   * - 런타임 요청/응답 검증
   * - OpenAPI 문서 자동 생성
   * - Guard의 Contract-Slot 일관성 검사
   *
   * @example
   * ```typescript
   * import { z } from "zod";
   * import { Mandu } from "@mandujs/core";
   *
   * const UserSchema = z.object({
   *   id: z.string().uuid(),
   *   email: z.string().email(),
   *   name: z.string().min(2),
   * });
   *
   * export default Mandu.contract({
   *   description: "사용자 관리 API",
   *   tags: ["users"],
   *
   *   request: {
   *     GET: {
   *       query: z.object({
   *         page: z.coerce.number().default(1),
   *         limit: z.coerce.number().default(10),
   *       }),
   *     },
   *     POST: {
   *       body: UserSchema.omit({ id: true }),
   *     },
   *   },
   *
   *   response: {
   *     200: z.object({ data: z.array(UserSchema) }),
   *     201: z.object({ data: UserSchema }),
   *     400: z.object({ error: z.string() }),
   *   },
   * });
   * ```
   */
  contract<T extends ContractDefinition>(definition: T): T & ContractInstance {
    return createContract(definition);
  },

  /**
   * Create context manually (for testing)
   */
  context(request: Request, params?: Record<string, string>): ManduContext {
    return new ManduContext(request, params);
  },
};
