/**
 * Mandu Context - 만두 접시 🥟
 * Request/Response를 래핑하여 편리한 API 제공
 *
 * DNA-002: 의존성 주입 패턴 지원
 */

import type { ZodSchema } from "zod";
import type { ContractSchema, ContractMethod } from "../contract/schema";
import type { InferBody, InferHeaders, InferParams, InferQuery, InferResponse } from "../contract/types";
import { ContractValidator, type ContractValidatorOptions } from "../contract/validator";
import { getCookieCodec } from "./cookie-codec";
import { type FillingDeps, globalDeps } from "./deps";
import { createSSEConnection, type SSEOptions, type SSEConnection } from "./sse";

type ContractInput<
  TContract extends ContractSchema,
  TMethod extends ContractMethod,
> = {
  query: InferQuery<TContract, TMethod>;
  body: InferBody<TContract, TMethod>;
  params: InferParams<TContract, TMethod>;
  headers: InferHeaders<TContract, TMethod>;
};

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
 *
 * Parse + serialize I/O is delegated to a {@link CookieCodec} selected at
 * module load time (Bun.CookieMap when available, pure-JS legacy codec
 * otherwise). The codec is a private implementation detail; the public API
 * on this class is unchanged.
 */
export class CookieManager {
  private requestCookies: Map<string, string>;
  private responseCookies: Map<string, { value: string; options: CookieOptions }>;
  private deletedCookies: Set<string>;
  /**
   * Pre-serialized Set-Cookie strings queued for the response. Bypasses the
   * codec serializer — used when the Set-Cookie value was produced by an
   * upstream source (e.g. `SessionStorage.commitSession`) that already
   * emitted a fully-formed header. Advanced escape hatch; prefer `set()`.
   */
  private extraSetCookie: string[] = [];

  constructor(request: Request) {
    this.requestCookies = getCookieCodec().parseRequestHeader(
      request.headers.get("cookie")
    );
    this.responseCookies = new Map();
    this.deletedCookies = new Set();
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
   * Append a pre-serialized Set-Cookie header value, bypassing the codec.
   *
   * Intended for integrations that produce their own fully-formed Set-Cookie
   * strings (e.g. `SessionStorage.commitSession()`). Coexists with `set()` —
   * both land in the final header list emitted by {@link applyToResponse}.
   *
   * Empty / non-string inputs are silently ignored so callers can pass the
   * output of an async producer without null-guarding.
   */
  appendRawSetCookie(setCookieString: string): void {
    if (typeof setCookieString === "string" && setCookieString.length > 0) {
      this.extraSetCookie.push(setCookieString);
    }
  }

  /**
   * Set-Cookie 헤더 값들 생성
   */
  getSetCookieHeaders(): string[] {
    const codec = getCookieCodec();
    const headers: string[] = [];
    for (const [name, { value, options }] of this.responseCookies) {
      headers.push(codec.serializeSetCookie(name, value, options));
    }
    // Raw-appended strings emit after codec-serialized cookies so that order
    // in the final `Set-Cookie` header list mirrors call order: `set()` first,
    // then `appendRawSetCookie()`. Callers relying on "last write wins" for
    // a given cookie name should prefer `set()`.
    for (const raw of this.extraSetCookie) {
      headers.push(raw);
    }
    return headers;
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
    return this.responseCookies.size > 0 || this.extraSetCookie.length > 0;
  }

  /**
   * 서명된 쿠키 읽기 (HMAC-SHA256 검증)
   * @returns 값(검증 성공), null(쿠키 없음), false(서명 불일치)
   * @example
   * const userId = await ctx.cookies.getSigned('session', SECRET);
   * if (userId === false) return ctx.unauthorized('Invalid session');
   * if (userId === null) return ctx.unauthorized('No session');
   */
  async getSigned(name: string, secret: string): Promise<string | null | false> {
    const raw = this.get(name);
    if (!raw) return null;
    const dotIndex = raw.lastIndexOf(".");
    if (dotIndex === -1) return false;
    const value = raw.slice(0, dotIndex);
    const signature = raw.slice(dotIndex + 1);
    if (!value || !signature) return false;
    const expected = await hmacSign(value, secret);
    return signature === expected ? decodeURIComponent(value) : false;
  }

  /**
   * 서명된 쿠키 설정 (HMAC-SHA256)
   * @example
   * await ctx.cookies.setSigned('session', userId, SECRET, { httpOnly: true });
   */
  async setSigned(name: string, value: string, secret: string, options?: CookieOptions): Promise<void> {
    const encoded = encodeURIComponent(value);
    const signature = await hmacSign(encoded, secret);
    this.set(name, `${encoded}.${signature}`, options);
  }

  /**
   * JSON 쿠키를 스키마로 파싱 + 검증 (Zod 호환 duck typing)
   * @returns 파싱된 값 또는 null(쿠키 없음/파싱 실패/검증 실패)
   * @example
   * const prefs = ctx.cookies.getParsed('prefs', z.object({ theme: z.string() }));
   */
  getParsed<T>(name: string, schema: { parse: (v: unknown) => T }): T | null {
    const raw = this.get(name);
    if (raw == null) return null;
    try {
      const decoded = decodeURIComponent(raw);
      const parsed = JSON.parse(decoded);
      return schema.parse(parsed);
    } catch {
      return null;
    }
  }
}

/**
 * HMAC-SHA256 서명 생성 (WebCrypto API)
 */
async function hmacSign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, "");
}

// ========== ManduContext ==========

export class ManduContext {
  private store: Map<string, unknown> = new Map();
  private _params: Record<string, string>;
  private _query: Record<string, string>;
  private _cookies: CookieManager;
  private _deps: FillingDeps;

  constructor(
    public readonly request: Request,
    params: Record<string, string> = {},
    deps?: FillingDeps
  ) {
    this._params = params;
    this._query = this.parseQuery();
    this._cookies = new CookieManager(request);
    this._deps = deps ?? globalDeps.get();
  }

  /**
   * DNA-002: 의존성 접근
   *
   * @example
   * ```ts
   * // 데이터베이스 쿼리
   * const users = await ctx.deps.db?.query("SELECT * FROM users");
   *
   * // 캐시 사용
   * const cached = await ctx.deps.cache?.get("user:123");
   *
   * // 로깅
   * ctx.deps.logger?.info("User logged in", { userId });
   *
   * // 현재 시간 (테스트에서 목킹 가능)
   * const now = ctx.deps.now?.() ?? new Date();
   * ```
   */
  get deps(): FillingDeps {
    return this._deps;
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

  /** Shorthand for request */
  get req(): Request {
    return this.request;
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

  /**
   * Parse and validate request input via Contract
   * @example
   * const input = await ctx.input(userContract, "POST", { id: "123" })
   */
  async input<
    TContract extends ContractSchema,
    TMethod extends ContractMethod,
  >(
    contract: TContract,
    method: TMethod,
    pathParams: Record<string, string> = {},
    options: ContractValidatorOptions = {}
  ): Promise<ContractInput<TContract, TMethod>> {
    const validator = new ContractValidator(contract, options);
    const result = await validator.validateAndNormalizeRequest(
      this.request,
      method,
      pathParams
    );

    if (!result.success) {
      throw new ValidationError(result.errors ?? []);
    }

    return (result.data ?? {}) as ContractInput<TContract, TMethod>;
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

  /**
   * Validate and send response via Contract
   * @example
   * return ctx.output(userContract, 200, { data: users })
   */
  output<
    TContract extends ContractSchema,
    TStatus extends keyof TContract["response"],
  >(
    contract: TContract,
    status: TStatus,
    data: InferResponse<TContract, TStatus>,
    options: ContractValidatorOptions = {}
  ): Response {
    const validator = new ContractValidator(contract, options);
    const result = validator.validateResponse(data, Number(status));

    if (!result.success) {
      if (options.mode === "strict") {
        const errorResponse = Response.json(
          {
            errorType: "CONTRACT_VIOLATION",
            code: "MANDU_C001",
            message: "Response does not match contract schema",
            summary: "응답이 Contract 스키마와 일치하지 않습니다",
            statusCode: Number(status),
            violations: result.errors,
            timestamp: new Date().toISOString(),
          },
          { status: 500 }
        );
        return this.withCookies(errorResponse);
      }

      console.warn(
        "\x1b[33m[Mandu] Contract violation in response:\x1b[0m",
        result.errors
      );
    }

    const payload = result.success ? result.data : data;
    return this.json(payload as InferResponse<TContract, TStatus>, Number(status));
  }

  /** 200 OK with Contract validation */
  okContract<TContract extends ContractSchema>(
    contract: TContract,
    data: InferResponse<TContract, 200>,
    options: ContractValidatorOptions = {}
  ): Response {
    return this.output(contract, 200 as keyof TContract["response"], data, options);
  }

  /** 201 Created with Contract validation */
  createdContract<TContract extends ContractSchema>(
    contract: TContract,
    data: InferResponse<TContract, 201>,
    options: ContractValidatorOptions = {}
  ): Response {
    return this.output(contract, 201 as keyof TContract["response"], data, options);
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

  /**
   * Create a Server-Sent Events (SSE) response.
   *
   * @example
   * return ctx.sse((sse) => {
   *   sse.event("ready", { ok: true });
   *   const stop = sse.heartbeat(15000);
   *   sse.onClose(() => stop());
   * });
   */
  sse(setup?: (connection: SSEConnection) => void | Promise<void>, options: SSEOptions = {}): Response {
    const connection = createSSEConnection(this.request.signal, options);

    if (setup) {
      Promise.resolve(setup(connection)).catch(() => {
        void connection.close();
      });
    }

    return this.withCookies(connection.response);
  }

  // ============================================
  // 🥟 상태 저장 (Lifecycle → Handler 전달)
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
}

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
