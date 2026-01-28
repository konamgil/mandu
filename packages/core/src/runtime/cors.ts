/**
 * Mandu CORS Support
 *
 * Cross-Origin Resource Sharing (CORS) 미들웨어
 */

export interface CorsOptions {
  /**
   * 허용할 Origin 목록
   * - "*" : 모든 Origin 허용
   * - string : 특정 Origin만 허용
   * - string[] : 여러 Origin 허용
   * - RegExp : 정규식으로 Origin 매칭
   * - (origin: string) => boolean : 커스텀 함수로 판단
   */
  origin?: "*" | string | string[] | RegExp | ((origin: string) => boolean);

  /**
   * 허용할 HTTP 메서드 목록
   * @default ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"]
   */
  methods?: string[];

  /**
   * 허용할 요청 헤더 목록
   * @default ["Content-Type", "Authorization", "X-Requested-With"]
   */
  allowedHeaders?: string[];

  /**
   * 클라이언트에게 노출할 응답 헤더 목록
   */
  exposedHeaders?: string[];

  /**
   * 자격 증명(쿠키, 인증 헤더) 포함 허용 여부
   * @default false
   */
  credentials?: boolean;

  /**
   * Preflight 요청 캐시 시간 (초)
   * @default 86400 (24시간)
   */
  maxAge?: number;

  /**
   * Preflight OPTIONS 요청 자동 처리 여부
   * @default true
   */
  preflightContinue?: boolean;

  /**
   * OPTIONS 요청 성공 응답 상태 코드
   * @default 204
   */
  optionsSuccessStatus?: number;
}

/**
 * 기본 CORS 옵션
 */
export const DEFAULT_CORS_OPTIONS: Required<CorsOptions> = {
  origin: "*",
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: [],
  credentials: false,
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

/**
 * Origin 검증
 */
function isOriginAllowed(
  requestOrigin: string | null,
  allowedOrigin: CorsOptions["origin"]
): boolean {
  if (!requestOrigin) return false;

  if (allowedOrigin === "*") {
    return true;
  }

  if (typeof allowedOrigin === "string") {
    return requestOrigin === allowedOrigin;
  }

  if (Array.isArray(allowedOrigin)) {
    return allowedOrigin.includes(requestOrigin);
  }

  if (allowedOrigin instanceof RegExp) {
    return allowedOrigin.test(requestOrigin);
  }

  if (typeof allowedOrigin === "function") {
    return allowedOrigin(requestOrigin);
  }

  return false;
}

/**
 * CORS 헤더 생성
 */
export function createCorsHeaders(
  req: Request,
  options: CorsOptions = {}
): Headers {
  const opts = { ...DEFAULT_CORS_OPTIONS, ...options };
  const headers = new Headers();
  const requestOrigin = req.headers.get("origin");

  // Access-Control-Allow-Origin
  if (opts.origin === "*" && !opts.credentials) {
    headers.set("Access-Control-Allow-Origin", "*");
  } else if (requestOrigin && isOriginAllowed(requestOrigin, opts.origin)) {
    headers.set("Access-Control-Allow-Origin", requestOrigin);
    headers.set("Vary", "Origin");
  }

  // Access-Control-Allow-Credentials
  if (opts.credentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  // Access-Control-Expose-Headers
  if (opts.exposedHeaders && opts.exposedHeaders.length > 0) {
    headers.set("Access-Control-Expose-Headers", opts.exposedHeaders.join(", "));
  }

  return headers;
}

/**
 * Preflight 요청 헤더 생성
 */
export function createPreflightHeaders(
  req: Request,
  options: CorsOptions = {}
): Headers {
  const opts = { ...DEFAULT_CORS_OPTIONS, ...options };
  const headers = createCorsHeaders(req, options);

  // Access-Control-Allow-Methods
  headers.set("Access-Control-Allow-Methods", opts.methods.join(", "));

  // Access-Control-Allow-Headers
  const requestHeaders = req.headers.get("access-control-request-headers");
  if (requestHeaders) {
    // Echo back requested headers (or use allowedHeaders)
    headers.set("Access-Control-Allow-Headers", requestHeaders);
  } else if (opts.allowedHeaders && opts.allowedHeaders.length > 0) {
    headers.set("Access-Control-Allow-Headers", opts.allowedHeaders.join(", "));
  }

  // Access-Control-Max-Age
  if (opts.maxAge) {
    headers.set("Access-Control-Max-Age", String(opts.maxAge));
  }

  return headers;
}

/**
 * Preflight OPTIONS 요청 처리
 */
export function handlePreflightRequest(
  req: Request,
  options: CorsOptions = {}
): Response {
  const opts = { ...DEFAULT_CORS_OPTIONS, ...options };
  const headers = createPreflightHeaders(req, options);

  return new Response(null, {
    status: opts.optionsSuccessStatus,
    headers,
  });
}

/**
 * CORS 적용된 Response 생성
 */
export function applyCorsToResponse(
  response: Response,
  req: Request,
  options: CorsOptions = {}
): Response {
  const corsHeaders = createCorsHeaders(req, options);

  // 기존 응답 헤더에 CORS 헤더 추가
  const newHeaders = new Headers(response.headers);
  corsHeaders.forEach((value, key) => {
    newHeaders.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

/**
 * CORS 검사 (요청이 CORS 요청인지)
 */
export function isCorsRequest(req: Request): boolean {
  return req.headers.has("origin");
}

/**
 * Preflight 요청인지 확인
 */
export function isPreflightRequest(req: Request): boolean {
  return (
    req.method === "OPTIONS" &&
    req.headers.has("origin") &&
    req.headers.has("access-control-request-method")
  );
}

/**
 * 간편 CORS 헬퍼 - Guard에서 사용
 *
 * @example
 * ```typescript
 * import { Mandu, cors } from "@mandujs/core";
 *
 * export default Mandu.filling()
 *   .guard(cors({ origin: "https://example.com" }))
 *   .get((ctx) => ctx.ok({ data: "hello" }));
 * ```
 */
export function cors(options: CorsOptions = {}) {
  return async (ctx: { request: Request; next: () => symbol }) => {
    // Preflight 요청 처리
    if (isPreflightRequest(ctx.request)) {
      return handlePreflightRequest(ctx.request, options);
    }

    // 일반 요청 - next()로 계속 진행
    return ctx.next();
  };
}

/**
 * CORS 옵션 프리셋
 */
export const corsPresets = {
  /**
   * 모든 Origin 허용 (개발용)
   */
  development: (): CorsOptions => ({
    origin: "*",
    credentials: false,
  }),

  /**
   * 특정 도메인만 허용
   */
  production: (allowedOrigins: string[]): CorsOptions => ({
    origin: allowedOrigins,
    credentials: true,
    maxAge: 86400,
  }),

  /**
   * 동일 도메인 + 특정 서브도메인 허용
   */
  sameOriginWithSubdomains: (baseDomain: string): CorsOptions => ({
    origin: new RegExp(`^https?://([a-z0-9-]+\\.)?${baseDomain.replace(".", "\\.")}$`),
    credentials: true,
  }),
};
