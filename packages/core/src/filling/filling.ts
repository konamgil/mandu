/**
 * Mandu Filling - 만두소 🥟
 * 체이닝 API로 비즈니스 로직 정의
 */

import { ManduContext, NEXT_SYMBOL, ValidationError } from "./context";

/** Handler function type */
export type Handler = (ctx: ManduContext) => Response | Promise<Response>;

/** Guard function type - returns next() or Response */
export type Guard = (ctx: ManduContext) => symbol | Response | Promise<symbol | Response>;

/** HTTP methods */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

interface FillingConfig {
  handlers: Map<HttpMethod, Handler>;
  guards: Guard[];
  methodGuards: Map<HttpMethod, Guard[]>;
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
 */
export class ManduFilling {
  private config: FillingConfig = {
    handlers: new Map(),
    guards: [],
    methodGuards: new Map(),
  };

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
   */
  async handle(request: Request, params: Record<string, string> = {}): Promise<Response> {
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
          return ctx.getResponse()!;
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
          return ctx.getResponse()!;
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
      // Handle validation errors
      if (error instanceof ValidationError) {
        return ctx.json(
          {
            status: "error",
            message: "Validation failed",
            errors: error.errors,
          },
          400
        );
      }

      // Handle other errors
      console.error(`[Mandu] Handler error:`, error);
      return ctx.fail(
        error instanceof Error ? error.message : "Internal Server Error"
      );
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
   */
  filling(): ManduFilling {
    return new ManduFilling();
  },

  /**
   * Create context manually (for testing)
   */
  context(request: Request, params?: Record<string, string>): ManduContext {
    return new ManduContext(request, params);
  },
};
