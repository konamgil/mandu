/**
 * Mandu Global Middleware
 * 라우트 매칭 전에 실행되는 글로벌 미들웨어 시스템
 *
 * 프로젝트 루트의 middleware.ts 파일에서 자동 로드
 */

import { CookieManager } from "../filling/context";

// ========== Types ==========

export interface MiddlewareContext {
  /** 원본 Request */
  request: Request;
  /** 파싱된 URL */
  url: URL;
  /** Cookie 매니저 */
  cookies: CookieManager;
  /** matcher에서 추출된 파라미터 */
  params: Record<string, string>;

  /** 리다이렉트 응답 생성 */
  redirect(url: string, status?: 301 | 302 | 307 | 308): Response;
  /** JSON 응답 생성 */
  json(data: unknown, status?: number): Response;
  /** 내부 라우트 재작성 (URL 변경 없이 다른 라우트 처리) */
  rewrite(url: string): Request;

  /** 다음 핸들러에 데이터 전달 */
  set(key: string, value: unknown): void;
  /** 전달된 데이터 읽기 */
  get<T>(key: string): T | undefined;
}

export type MiddlewareNext = () => Promise<Response>;

export type MiddlewareFn = (
  ctx: MiddlewareContext,
  next: MiddlewareNext
) => Response | Promise<Response>;

export interface MiddlewareConfig {
  /** 미들웨어를 적용할 경로 패턴 */
  matcher?: string[];
  /** 제외할 경로 패턴 */
  exclude?: string[];
}

// ========== Implementation ==========

/**
 * MiddlewareContext 생성
 */
export function createMiddlewareContext(request: Request): MiddlewareContext {
  const url = new URL(request.url);
  const cookies = new CookieManager(request);
  const store = new Map<string, unknown>();

  return {
    request,
    url,
    cookies,
    params: {},

    redirect(target: string, status: 301 | 302 | 307 | 308 = 302): Response {
      return Response.redirect(new URL(target, url.origin).href, status);
    },

    json(data: unknown, status: number = 200): Response {
      return Response.json(data, { status });
    },

    rewrite(target: string): Request {
      const rewriteUrl = new URL(target, url.origin);
      return new Request(rewriteUrl.href, {
        method: request.method,
        headers: request.headers,
        body: request.clone().body, // 원본 request body 소비 방지
      });
    },

    set(key: string, value: unknown): void {
      store.set(key, value);
    },

    get<T>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
  };
}

/**
 * 경로가 matcher 패턴과 일치하는지 확인
 * :path* → 와일드카드 매칭
 */
export function matchesMiddlewarePath(
  pathname: string,
  config: MiddlewareConfig | null
): boolean {
  // config 없으면 모든 경로에 적용
  if (!config) return true;

  // exclude 패턴 먼저 확인
  if (config.exclude) {
    for (const pattern of config.exclude) {
      if (matchPattern(pathname, pattern)) return false;
    }
  }

  // matcher가 없으면 모든 경로에 적용
  if (!config.matcher || config.matcher.length === 0) return true;

  // matcher 패턴 중 하나라도 일치하면 적용
  return config.matcher.some(pattern => matchPattern(pathname, pattern));
}

/**
 * 단순 경로 패턴 매칭
 * - /api/* → /api/ 하위 모든 경로
 * - /dashboard/:path* → /dashboard/ 하위 모든 경로
 * - /about → 정확히 /about
 */
function matchPattern(pathname: string, pattern: string): boolean {
  // 와일드카드 패턴: /api/* → /api, /api/anything 모두 매칭
  if (pattern.endsWith("*") || pattern.endsWith(":path*")) {
    const prefix = pattern.replace(/[:*]path\*$/, "").replace(/\*$/, "");
    // prefix 자체 또는 prefix 하위 경로 매칭
    return pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix);
  }

  // 정확한 매칭
  return pathname === pattern;
}

/**
 * middleware.ts 파일에서 미들웨어 로드 (async)
 */
export async function loadMiddleware(
  rootDir: string
): Promise<{ fn: MiddlewareFn; config: MiddlewareConfig | null } | null> {
  const possiblePaths = [
    `${rootDir}/middleware.ts`,
    `${rootDir}/middleware.js`,
  ];

  for (const mwPath of possiblePaths) {
    try {
      const file = Bun.file(mwPath);
      if (await file.exists()) {
        const mod = await import(mwPath);
        return validateMiddlewareModule(mod);
      }
    } catch (error) {
      console.warn(`[Mandu] middleware.ts 로드 실패:`, error);
    }
  }

  return null;
}

/**
 * middleware.ts 동기 로드 (서버 시작 시 사용 — 첫 요청부터 미들웨어 보장)
 */
export function loadMiddlewareSync(
  rootDir: string
): { fn: MiddlewareFn; config: MiddlewareConfig | null } | null {
  const fs = require("fs") as typeof import("fs");
  const possiblePaths = [
    `${rootDir}/middleware.ts`,
    `${rootDir}/middleware.js`,
  ];

  for (const mwPath of possiblePaths) {
    try {
      if (fs.existsSync(mwPath)) {
        // Bun에서 require()는 .ts도 동기 로드 가능
        const mod = require(mwPath);
        return validateMiddlewareModule(mod);
      }
    } catch (error) {
      console.warn(`[Mandu] middleware.ts 로드 실패:`, error);
    }
  }

  return null;
}

function validateMiddlewareModule(
  mod: Record<string, unknown>
): { fn: MiddlewareFn; config: MiddlewareConfig | null } | null {
  const fn = mod.default as MiddlewareFn;
  const config = (mod.config as MiddlewareConfig) ?? null;

  if (typeof fn !== "function") {
    console.warn(`[Mandu] middleware.ts의 default export가 함수가 아닙니다.`);
    return null;
  }

  return { fn, config };
}
