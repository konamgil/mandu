/**
 * Mandu Context - 만두 접시 🥟
 * Request/Response를 래핑하여 편리한 API 제공
 */

import type { ZodSchema } from "zod";

// ========== Cookie Types ==========

export interface CookieOptions {
  /** 쿠키 만료 시간 (Date 객체 또는 문자열) */
  expires?: Date | string;
  /** 쿠키 유효 기간 (초) */
  maxAge?: number;
  /** 쿠키 도메인 */
  domain?: string;
  /** 쿠키 경로 */
  path?: string;
  /** HTTPS에서만 전송 */
  secure?: boolean;
  /** JavaScript에서 접근 불가 */
  httpOnly?: boolean;
  /** Same-Site 정책 */
  sameSite?: "strict" | "lax" | "none";
  /** 파티션 키 (CHIPS) */
  partitioned?: boolean;
}

/**
 * Cookie Manager - 쿠키 읽기/쓰기 관리
 */
export class CookieManager {
  private requestCookies: Map<string, string>;
  private responseCookies: Map<string, { value: string; options: CookieOptions }>;
  private deletedCookies: Set<string>;

  constructor(request: Request) {
    this.requestCookies = this.parseRequestCookies(request);
    this.responseCookies = new Map();
    this.deletedCookies = new Set();
  }

  private parseRequestCookies(request: Request): Map<string, string> {
    const cookies = new Map<string, string>();
    const cookieHeader = request.headers.get("cookie");

    if (cookieHeader) {
      const pairs = cookieHeader.split(";");
      for (const pair of pairs) {
        const [name, ...rest] = pair.trim().split("=");
        if (name) {
          const rawValue = rest.join("=");
          try {
            cookies.set(name, decodeURIComponent(rawValue));
          } catch {
            // 잘못된 URL 인코딩 시 원본 값 사용
            cookies.set(name, rawValue);
          }
        }
      }
    }

    return cookies;
  }

  /**
   * 쿠키 값 읽기
   * @example
   * const session = ctx.cookies.get('session');
   */
  get(name: string): string | undefined {
    return this.requestCookies.get(name);
  }

  /**
   * 쿠키 존재 여부 확인
   */
  has(name: string): boolean {
    return this.requestCookies.has(name);
  }

  /**
   * 모든 쿠키 가져오기
   */
  getAll(): Record<string, string> {
    return Object.fromEntries(this.requestCookies);
  }

  /**
   * 쿠키 설정
   * @example
   * ctx.cookies.set('session', 'abc123', { httpOnly: true, maxAge: 3600 });
   */
  set(name: string, value: string, options: CookieOptions = {}): void {
    this.responseCookies.set(name, { value, options });
    this.deletedCookies.delete(name);
  }

  /**
   * 쿠키 삭제
   * @example
   * ctx.cookies.delete('session');
   */
  delete(name: string, options: Pick<CookieOptions, "domain" | "path"> = {}): void {
    this.responseCookies.delete(name);
    this.deletedCookies.add(name);
    // 삭제용 쿠키 설정 (maxAge=0)
    this.responseCookies.set(name, {
      value: "",
      options: {
        ...options,
        maxAge: 0,
        expires: new Date(0),
      },
    });
  }

  /**
   * Set-Cookie 헤더 값들 생성
   */
  getSetCookieHeaders(): string[] {
    const headers: string[] = [];

    for (const [name, { value, options }] of this.responseCookies) {
      headers.push(this.serializeCookie(name, value, options));
    }

    return headers;
  }

  /**
   * 쿠키를 Set-Cookie 헤더 형식으로 직렬화
   */
  private serializeCookie(name: string, value: string, options: CookieOptions): string {
    const parts: string[] = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

    if (options.maxAge !== undefined) {
      parts.push(`Max-Age=${options.maxAge}`);
    }

    if (options.expires) {
      const expires =
        options.expires instanceof Date
          ? options.expires.toUTCString()
          : options.expires;
      parts.push(`Expires=${expires}`);
    }

    if (options.domain) {
      parts.push(`Domain=${options.domain}`);
    }

    if (options.path) {
      parts.push(`Path=${options.path}`);
    } else {
      parts.push("Path=/"); // 기본값
    }

    if (options.secure) {
      parts.push("Secure");
    }

    if (options.httpOnly) {
      parts.push("HttpOnly");
    }

    if (options.sameSite) {
      parts.push(`SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`);
    }

    if (options.partitioned) {
      parts.push("Partitioned");
    }

    return parts.join("; ");
  }

  /**
   * Response에 Set-Cookie 헤더들 적용
   */
  applyToResponse(response: Response): Response {
    const setCookieHeaders = this.getSetCookieHeaders();

    if (setCookieHeaders.length === 0) {
      return response;
    }

    // Headers를 복사하여 수정
    const newHeaders = new Headers(response.headers);

    for (const setCookie of setCookieHeaders) {
      newHeaders.append("Set-Cookie", setCookie);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  /**
   * 응답에 적용할 쿠키가 있는지 확인
   */
  hasPendingCookies(): boolean {
    return this.responseCookies.size > 0;
  }
}

// ========== ManduContext ==========

export class ManduContext {
  private store: Map<string, unknown> = new Map();
  private _params: Record<string, string>;
  private _query: Record<string, string>;
  private _shouldContinue: boolean = true;
  private _response: Response | null = null;
  private _cookies: CookieManager;

  constructor(
    public readonly request: Request,
    params: Record<string, string> = {}
  ) {
    this._params = params;
    this._query = this.parseQuery();
    this._cookies = new CookieManager(request);
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
   * Cookie Manager
   * @example
   * // 쿠키 읽기
   * const session = ctx.cookies.get('session');
   *
   * // 쿠키 설정
   * ctx.cookies.set('session', 'abc123', { httpOnly: true, maxAge: 3600 });
   *
   * // 쿠키 삭제
   * ctx.cookies.delete('session');
   */
  get cookies(): CookieManager {
    return this._cookies;
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

  /**
   * Response에 쿠키 헤더 적용 (내부 사용)
   */
  private withCookies(response: Response): Response {
    if (this._cookies.hasPendingCookies()) {
      return this._cookies.applyToResponse(response);
    }
    return response;
  }

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
    return this.withCookies(new Response(null, { status: 204 }));
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
    const response = Response.json(data, { status });
    return this.withCookies(response);
  }

  /** Custom text response */
  text(data: string, status: number = 200): Response {
    const response = new Response(data, {
      status,
      headers: { "Content-Type": "text/plain" },
    });
    return this.withCookies(response);
  }

  /** Custom HTML response */
  html(data: string, status: number = 200): Response {
    const response = new Response(data, {
      status,
      headers: { "Content-Type": "text/html" },
    });
    return this.withCookies(response);
  }

  /** Redirect response */
  redirect(url: string, status: 301 | 302 | 307 | 308 = 302): Response {
    const response = Response.redirect(url, status);
    return this.withCookies(response);
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
