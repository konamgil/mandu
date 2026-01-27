/**
 * Mandu Context - 만두 접시 🥟
 * Request/Response를 래핑하여 편리한 API 제공
 */

import type { ZodSchema } from "zod";

export class ManduContext {
  private store: Map<string, unknown> = new Map();
  private _params: Record<string, string>;
  private _query: Record<string, string>;
  private _shouldContinue: boolean = true;
  private _response: Response | null = null;

  constructor(
    public readonly request: Request,
    params: Record<string, string> = {}
  ) {
    this._params = params;
    this._query = this.parseQuery();
  }

  private parseQuery(): Record<string, string> {
    const url = new URL(this.request.url);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    return query;
  }

  // ============================================
  // 🥟 Request 읽기
  // ============================================

  /** Path parameters (e.g., /users/:id → { id: '123' }) */
  get params(): Record<string, string> {
    return this._params;
  }

  /** Query parameters (e.g., ?name=mandu → { name: 'mandu' }) */
  get query(): Record<string, string> {
    return this._query;
  }

  /** Request headers */
  get headers(): Headers {
    return this.request.headers;
  }

  /** HTTP method */
  get method(): string {
    return this.request.method;
  }

  /** Request URL */
  get url(): string {
    return this.request.url;
  }

  /**
   * Parse request body with optional Zod validation
   * @example
   * const data = await ctx.body() // any
   * const data = await ctx.body(UserSchema) // typed & validated
   */
  async body<T = unknown>(schema?: ZodSchema<T>): Promise<T> {
    const contentType = this.request.headers.get("content-type") || "";
    let data: unknown;

    if (contentType.includes("application/json")) {
      data = await this.request.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await this.request.formData();
      data = Object.fromEntries(formData.entries());
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await this.request.formData();
      data = Object.fromEntries(formData.entries());
    } else {
      data = await this.request.text();
    }

    if (schema) {
      const result = schema.safeParse(data);
      if (!result.success) {
        throw new ValidationError(result.error.errors);
      }
      return result.data;
    }

    return data as T;
  }

  // ============================================
  // 🥟 Response 보내기
  // ============================================

  /** 200 OK */
  ok<T>(data: T): Response {
    return this.json(data, 200);
  }

  /** 201 Created */
  created<T>(data: T): Response {
    return this.json(data, 201);
  }

  /** 204 No Content */
  noContent(): Response {
    return new Response(null, { status: 204 });
  }

  /** 400 Bad Request */
  error(message: string, details?: unknown): Response {
    return this.json({ status: "error", message, details }, 400);
  }

  /** 401 Unauthorized */
  unauthorized(message: string = "Unauthorized"): Response {
    return this.json({ status: "error", message }, 401);
  }

  /** 403 Forbidden */
  forbidden(message: string = "Forbidden"): Response {
    return this.json({ status: "error", message }, 403);
  }

  /** 404 Not Found */
  notFound(message: string = "Not Found"): Response {
    return this.json({ status: "error", message }, 404);
  }

  /** 500 Internal Server Error */
  fail(message: string = "Internal Server Error"): Response {
    return this.json({ status: "error", message }, 500);
  }

  /** Custom JSON response */
  json<T>(data: T, status: number = 200): Response {
    return Response.json(data, { status });
  }

  /** Custom text response */
  text(data: string, status: number = 200): Response {
    return new Response(data, {
      status,
      headers: { "Content-Type": "text/plain" },
    });
  }

  /** Custom HTML response */
  html(data: string, status: number = 200): Response {
    return new Response(data, {
      status,
      headers: { "Content-Type": "text/html" },
    });
  }

  /** Redirect response */
  redirect(url: string, status: 301 | 302 | 307 | 308 = 302): Response {
    return Response.redirect(url, status);
  }

  // ============================================
  // 🥟 상태 저장 (Guard → Handler 전달)
  // ============================================

  /** Store value for later use */
  set<T>(key: string, value: T): void {
    this.store.set(key, value);
  }

  /** Get stored value */
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  /** Check if key exists */
  has(key: string): boolean {
    return this.store.has(key);
  }

  // ============================================
  // 🥟 Guard 제어
  // ============================================

  /** Continue to next guard/handler */
  next(): symbol {
    this._shouldContinue = true;
    return NEXT_SYMBOL;
  }

  /** Check if should continue */
  get shouldContinue(): boolean {
    return this._shouldContinue;
  }

  /** Set early response (from guard) */
  setResponse(response: Response): void {
    this._shouldContinue = false;
    this._response = response;
  }

  /** Get early response */
  getResponse(): Response | null {
    return this._response;
  }
}

/** Symbol to indicate continue to next */
export const NEXT_SYMBOL = Symbol("mandu:next");

/** Route context for error reporting */
export interface ValidationRouteContext {
  routeId: string;
  pattern: string;
}

/** Validation error with details */
export class ValidationError extends Error {
  constructor(
    public readonly errors: unknown[],
    public readonly routeContext?: ValidationRouteContext
  ) {
    super("Validation failed");
    this.name = "ValidationError";
  }
}
