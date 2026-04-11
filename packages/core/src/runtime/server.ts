import type { Server } from "bun";
import type { RoutesManifest, RouteSpec, HydrationConfig } from "../spec/schema";
import type { BundleManifest } from "../bundler/types";
import type { ManduFilling } from "../filling/filling";
import { ManduContext, type CookieManager } from "../filling/context";
import { Router } from "./router";
import { renderSSR, renderStreamingResponse } from "./ssr";
import { type ErrorFallbackProps } from "./boundary";
import React, { type ReactNode } from "react";
import path from "path";
import fs from "fs/promises";
import { PORTS } from "../constants";
import {
  createNotFoundResponse,
  createHandlerNotFoundResponse,
  createPageLoadErrorResponse,
  createSSRErrorResponse,
  errorToResponse,
  err,
  ok,
  type Result,
} from "../error";
import {
  type CorsOptions,
  isPreflightRequest,
  handlePreflightRequest,
  applyCorsToResponse,
  isCorsRequest,
} from "./cors";
import { validateImportPath } from "./security";
import { KITCHEN_PREFIX, KitchenHandler } from "../kitchen/kitchen-handler";

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  statusCode?: number;
  headers?: boolean;
  /**
   * Reverse proxy 헤더를 신뢰할지 여부
   * - false(기본): X-Forwarded-For 등을 읽지만 spoofing 가능성을 표시
   * - true: 전달된 클라이언트 IP를 완전히 신뢰
   * 주의: trustProxy: false여도 클라이언트 구분을 위해 헤더를 사용하므로
   *       IP spoofing이 가능합니다. 신뢰할 수 있는 프록시 뒤에서만 사용하세요.
   */
  trustProxy?: boolean;
  /**
   * 메모리 보호를 위한 최대 key 수
   * - 초과 시 오래된 key부터 제거
   */
  maxKeys?: number;
}

interface NormalizedRateLimitOptions {
  windowMs: number;
  max: number;
  message: string;
  statusCode: number;
  headers: boolean;
  trustProxy: boolean;
  maxKeys: number;
}

interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

class MemoryRateLimiter {
  private readonly store = new Map<string, { count: number; resetAt: number }>();
  private lastCleanupAt = 0;

  consume(req: Request, routeId: string, options: NormalizedRateLimitOptions): RateLimitDecision {
    const now = Date.now();
    this.maybeCleanup(now, options);

    const key = `${this.getClientKey(req, options)}:${routeId}`;
    const current = this.store.get(key);

    if (!current || current.resetAt <= now) {
      const resetAt = now + options.windowMs;
      this.store.set(key, { count: 1, resetAt });
      this.enforceMaxKeys(options.maxKeys);
      return { allowed: true, limit: options.max, remaining: Math.max(0, options.max - 1), resetAt };
    }

    current.count += 1;
    this.store.set(key, current);

    return {
      allowed: current.count <= options.max,
      limit: options.max,
      remaining: Math.max(0, options.max - current.count),
      resetAt: current.resetAt,
    };
  }

  private maybeCleanup(now: number, options: NormalizedRateLimitOptions): void {
    if (now - this.lastCleanupAt < Math.max(1_000, options.windowMs)) {
      return;
    }

    this.lastCleanupAt = now;
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
      }
    }
  }

  private enforceMaxKeys(maxKeys: number): void {
    while (this.store.size > maxKeys) {
      const oldestKey = this.store.keys().next().value;
      if (!oldestKey) break;
      this.store.delete(oldestKey);
    }
  }

  private getClientKey(req: Request, options: NormalizedRateLimitOptions): string {
    const candidates = [
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      req.headers.get("x-real-ip")?.trim(),
      req.headers.get("cf-connecting-ip")?.trim(),
      req.headers.get("true-client-ip")?.trim(),
      req.headers.get("fly-client-ip")?.trim(),
    ];

    for (const candidate of candidates) {
      if (candidate) {
        const sanitized = candidate.slice(0, 64);
        // trustProxy: false면 경고를 위해 prefix 추가 (spoofing 가능)
        return options.trustProxy ? sanitized : `unverified:${sanitized}`;
      }
    }

    // 헤더가 전혀 없는 경우만 fallback (로컬 개발 환경)
    return "default";
  }
}

function normalizeRateLimitOptions(options: boolean | RateLimitOptions | undefined): NormalizedRateLimitOptions | false {
  if (!options) return false;
  if (options === true) {
    return {
      windowMs: 60_000,
      max: 100,
      message: "Too Many Requests",
      statusCode: 429,
      headers: true,
      trustProxy: false,
      maxKeys: 10_000,
    };
  }

  const windowMs = Number.isFinite(options.windowMs) ? Math.max(1_000, options.windowMs!) : 60_000;
  const max = Number.isFinite(options.max) ? Math.max(1, Math.floor(options.max!)) : 100;
  const statusCode = Number.isFinite(options.statusCode)
    ? Math.min(599, Math.max(400, Math.floor(options.statusCode!)))
    : 429;
  const maxKeys = Number.isFinite(options.maxKeys)
    ? Math.max(100, Math.floor(options.maxKeys!))
    : 10_000;

  return {
    windowMs,
    max,
    message: options.message ?? "Too Many Requests",
    statusCode,
    headers: options.headers ?? true,
    trustProxy: options.trustProxy ?? false,
    maxKeys,
  };
}

function appendRateLimitHeaders(response: Response, decision: RateLimitDecision, options: NormalizedRateLimitOptions): Response {
  if (!options.headers) return response;

  const headers = new Headers(response.headers);
  const retryAfterSec = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000));

  headers.set("X-RateLimit-Limit", String(decision.limit));
  headers.set("X-RateLimit-Remaining", String(decision.remaining));
  headers.set("X-RateLimit-Reset", String(Math.floor(decision.resetAt / 1000)));
  headers.set("Retry-After", String(retryAfterSec));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function createRateLimitResponse(decision: RateLimitDecision, options: NormalizedRateLimitOptions): Response {
  const response = Response.json(
    {
      error: "rate_limit_exceeded",
      message: options.message,
      limit: decision.limit,
      remaining: decision.remaining,
      retryAfter: Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000)),
    },
    { status: options.statusCode }
  );

  return appendRateLimitHeaders(response, decision, options);
}

// ========== MIME Types ==========
const MIME_TYPES: Record<string, string> = {
  // JavaScript
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".ts": "application/typescript",
  // CSS
  ".css": "text/css",
  // HTML
  ".html": "text/html",
  ".htm": "text/html",
  // JSON
  ".json": "application/json",
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  // Fonts
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  // Documents
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".xml": "application/xml",
  // Media
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  // Archives
  ".zip": "application/zip",
  ".gz": "application/gzip",
  // WebAssembly
  ".wasm": "application/wasm",
  // Source maps
  ".map": "application/json",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

// ========== Server Options ==========
export interface ServerOptions {
  port?: number;
  hostname?: string;
  /** 프로젝트 루트 디렉토리 */
  rootDir?: string;
  /** 개발 모드 여부 */
  isDev?: boolean;
  /** HMR 포트 (개발 모드에서 사용) */
  hmrPort?: number;
  /** 번들 매니페스트 (Island hydration용) */
  bundleManifest?: BundleManifest;
  /** Public 디렉토리 경로 (기본: 'public') */
  publicDir?: string;
  /**
   * CORS 설정
   * - true: 모든 Origin 허용
   * - false: CORS 비활성화 (기본값)
   * - CorsOptions: 세부 설정
   */
  cors?: boolean | CorsOptions;
  /**
   * Streaming SSR 활성화
   * - true: 모든 페이지에 Streaming SSR 적용
   * - false: 기존 renderToString 사용 (기본값)
   */
  streaming?: boolean;
  /**
   * API 라우트 Rate Limit 설정
   */
  rateLimit?: boolean | RateLimitOptions;
  /**
   * CSS 파일 경로 (SSR 링크 주입용)
   * - string: 해당 경로로 <link> 주입 (예: "/.mandu/client/globals.css")
   * - false: CSS 링크 주입 비활성화 (Tailwind 미사용 시)
   * - undefined: false로 처리 (404 방지, dev/build에서 명시적 전달 필요)
   */
  cssPath?: string | false;
  /**
   * 커스텀 레지스트리 (핸들러/설정 분리)
   * - 제공하지 않으면 기본 전역 레지스트리 사용
   * - 테스트나 멀티앱 시나리오에서 createServerRegistry()로 생성한 인스턴스 전달
   */
  registry?: ServerRegistry;
  /**
   * Guard config for Kitchen dev dashboard (dev mode only)
   */
  guardConfig?: import("../guard/types").GuardConfig | null;
}

export interface ManduServer {
  server: Server<undefined>;
  router: Router;
  /** 이 서버 인스턴스의 레지스트리 */
  registry: ServerRegistry;
  stop: () => void;
}

export type ApiHandler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;
export type PageLoader = () => Promise<{ default: React.ComponentType<{ params: Record<string, string> }> }>;

/**
 * Layout 컴포넌트 타입
 * children을 받아서 감싸는 구조
 */
export type LayoutComponent = React.ComponentType<{
  children: React.ReactNode;
  params?: Record<string, string>;
}>;

/**
 * Layout 로더 타입
 */
export type LayoutLoader = () => Promise<{ default: LayoutComponent }>;

/**
 * Loading 컴포넌트 타입
 */
export type LoadingComponent = React.ComponentType<Record<string, never>>;

/**
 * Error 컴포넌트 타입
 */
export type ErrorComponent = React.ComponentType<ErrorFallbackProps>;

/**
 * Loading/Error 로더 타입
 */
export type LoadingLoader = () => Promise<{ default: LoadingComponent }>;
export type ErrorLoader = () => Promise<{ default: ErrorComponent }>;

/**
 * Page 등록 정보
 * - component: React 컴포넌트
 * - filling: Slot의 ManduFilling 인스턴스 (loader 포함)
 */
export interface PageRegistration {
  component: React.ComponentType<{ params: Record<string, string>; loaderData?: unknown }>;
  filling?: ManduFilling<unknown>;
}

/**
 * Page Handler - 컴포넌트와 filling을 함께 반환
 */
export type PageHandler = () => Promise<PageRegistration>;

export interface AppContext {
  routeId: string;
  url: string;
  params: Record<string, string>;
  /** SSR loader에서 로드한 데이터 */
  loaderData?: unknown;
}

type RouteComponent = (props: { params: Record<string, string>; loaderData?: unknown }) => React.ReactElement;
type CreateAppFn = (context: AppContext) => React.ReactElement;

// ========== Server Registry (인스턴스별 분리) ==========

/**
 * 서버 인스턴스별 핸들러/설정 레지스트리
 * 같은 프로세스에서 여러 서버를 띄울 때 핸들러가 섞이는 문제 방지
 */
export interface ServerRegistrySettings {
  isDev: boolean;
  hmrPort?: number;
  bundleManifest?: BundleManifest;
  rootDir: string;
  publicDir: string;
  cors?: CorsOptions | false;
  streaming: boolean;
  rateLimit?: NormalizedRateLimitOptions | false;
  /**
   * CSS 파일 경로 (SSR 링크 주입용)
   * - string: 해당 경로로 <link> 주입
   * - false: CSS 링크 주입 비활성화
   * - undefined: false로 처리 (404 방지)
   */
  cssPath?: string | false;
}

export class ServerRegistry {
  readonly apiHandlers: Map<string, ApiHandler> = new Map();
  readonly pageLoaders: Map<string, PageLoader> = new Map();
  readonly pageHandlers: Map<string, PageHandler> = new Map();
  readonly routeComponents: Map<string, RouteComponent> = new Map();
  /** Layout 컴포넌트 캐시 (모듈 경로 → 컴포넌트) */
  readonly layoutComponents: Map<string, LayoutComponent> = new Map();
  /** Layout 로더 (모듈 경로 → 로더 함수) */
  readonly layoutLoaders: Map<string, LayoutLoader> = new Map();
  /** Loading 컴포넌트 캐시 (모듈 경로 → 컴포넌트) */
  readonly loadingComponents: Map<string, LoadingComponent> = new Map();
  /** Loading 로더 (모듈 경로 → 로더 함수) */
  readonly loadingLoaders: Map<string, LoadingLoader> = new Map();
  /** Error 컴포넌트 캐시 (모듈 경로 → 컴포넌트) */
  readonly errorComponents: Map<string, ErrorComponent> = new Map();
  /** Error 로더 (모듈 경로 → 로더 함수) */
  readonly errorLoaders: Map<string, ErrorLoader> = new Map();
  createAppFn: CreateAppFn | null = null;
  rateLimiter: MemoryRateLimiter | null = null;
  /** Kitchen dev dashboard handler (dev mode only) */
  kitchen: KitchenHandler | null = null;
  settings: ServerRegistrySettings = {
    isDev: false,
    rootDir: process.cwd(),
    publicDir: "public",
    cors: false,
    streaming: false,
    rateLimit: false,
  };

  registerApiHandler(routeId: string, handler: ApiHandler): void {
    this.apiHandlers.set(routeId, handler);
  }

  registerPageLoader(routeId: string, loader: PageLoader): void {
    this.pageLoaders.set(routeId, loader);
  }

  registerPageHandler(routeId: string, handler: PageHandler): void {
    this.pageHandlers.set(routeId, handler);
  }

  registerRouteComponent(routeId: string, component: RouteComponent): void {
    this.routeComponents.set(routeId, component);
  }

  /**
   * Layout 로더 등록
   */
  registerLayoutLoader(modulePath: string, loader: LayoutLoader): void {
    this.layoutLoaders.set(modulePath, loader);
  }

  /**
   * Loading 로더 등록
   */
  registerLoadingLoader(modulePath: string, loader: LoadingLoader): void {
    this.loadingLoaders.set(modulePath, loader);
  }

  /**
   * Error 로더 등록
   */
  registerErrorLoader(modulePath: string, loader: ErrorLoader): void {
    this.errorLoaders.set(modulePath, loader);
  }

  /**
   * 제네릭 컴포넌트 로더 (DRY)
   * 캐시 → 로더 → 동적 import 순서로 시도
   */
  private async getComponentByType<T>(
    type: "layout" | "loading" | "error",
    modulePath: string
  ): Promise<T | null> {
    // 타입별 캐시/로더 맵 선택
    const cacheMap = {
      layout: this.layoutComponents,
      loading: this.loadingComponents,
      error: this.errorComponents,
    }[type] as Map<string, T>;

    const loaderMap = {
      layout: this.layoutLoaders,
      loading: this.loadingLoaders,
      error: this.errorLoaders,
    }[type] as Map<string, () => Promise<{ default: T }>>;

    // 1. 캐시 확인
    const cached = cacheMap.get(modulePath);
    if (cached) return cached;

    // 2. 등록된 로더 시도
    const loader = loaderMap.get(modulePath);
    if (loader) {
      try {
        const module = await loader();
        const component = module.default;
        cacheMap.set(modulePath, component);
        return component;
      } catch (error) {
        console.error(`[Mandu] Failed to load ${type}: ${modulePath}`, error);
        return null;
      }
    }

    // 3. 동적 import 시도 (보안 검증 포함)
    const validation = validateImportPath(this.settings.rootDir, modulePath);
    if (!validation.ok) {
      console.error(`[Mandu Security] ${validation.error.message}`);
      return null;
    }

    try {
      const module = await import(validation.value);
      const component = module.default;
      cacheMap.set(modulePath, component);
      return component;
    } catch (error) {
      // layout은 에러 로깅, loading/error는 조용히 실패
      if (type === "layout") {
        console.error(`[Mandu] Failed to load ${type}: ${modulePath}`, error);
      }
      return null;
    }
  }

  /**
   * Layout 컴포넌트 가져오기
   */
  async getLayoutComponent(modulePath: string): Promise<LayoutComponent | null> {
    return this.getComponentByType<LayoutComponent>("layout", modulePath);
  }

  /**
   * Loading 컴포넌트 가져오기
   */
  async getLoadingComponent(modulePath: string): Promise<LoadingComponent | null> {
    return this.getComponentByType<LoadingComponent>("loading", modulePath);
  }

  /**
   * Error 컴포넌트 가져오기
   */
  async getErrorComponent(modulePath: string): Promise<ErrorComponent | null> {
    return this.getComponentByType<ErrorComponent>("error", modulePath);
  }

  setCreateApp(fn: CreateAppFn): void {
    this.createAppFn = fn;
  }

  /**
   * 모든 핸들러/컴포넌트 초기화 (테스트용)
   */
  clear(): void {
    this.apiHandlers.clear();
    this.pageLoaders.clear();
    this.pageHandlers.clear();
    this.routeComponents.clear();
    this.layoutComponents.clear();
    this.layoutLoaders.clear();
    this.loadingComponents.clear();
    this.loadingLoaders.clear();
    this.errorComponents.clear();
    this.errorLoaders.clear();
    this.createAppFn = null;
    this.rateLimiter = null;
  }
}

/**
 * 기본 전역 레지스트리 (하위 호환성)
 */
const defaultRegistry = new ServerRegistry();

/**
 * 새 레지스트리 인스턴스 생성
 * 테스트나 멀티앱 시나리오에서 사용
 */
export function createServerRegistry(): ServerRegistry {
  return new ServerRegistry();
}

/**
 * 기본 레지스트리 초기화 (테스트용)
 */
export function clearDefaultRegistry(): void {
  defaultRegistry.clear();
}

// ========== 하위 호환성을 위한 전역 함수들 (defaultRegistry 사용) ==========

export function registerApiHandler(routeId: string, handler: ApiHandler): void {
  defaultRegistry.registerApiHandler(routeId, handler);
}

export function registerPageLoader(routeId: string, loader: PageLoader): void {
  defaultRegistry.registerPageLoader(routeId, loader);
}

/**
 * Page Handler 등록 (컴포넌트 + filling)
 * filling이 있으면 loader를 실행하여 serverData 전달
 */
export function registerPageHandler(routeId: string, handler: PageHandler): void {
  defaultRegistry.registerPageHandler(routeId, handler);
}

export function registerRouteComponent(routeId: string, component: RouteComponent): void {
  defaultRegistry.registerRouteComponent(routeId, component);
}

export function setCreateApp(fn: CreateAppFn): void {
  defaultRegistry.setCreateApp(fn);
}

/**
 * Layout 로더 등록 (전역)
 */
export function registerLayoutLoader(modulePath: string, loader: LayoutLoader): void {
  defaultRegistry.registerLayoutLoader(modulePath, loader);
}

/**
 * Loading 로더 등록 (전역)
 */
export function registerLoadingLoader(modulePath: string, loader: LoadingLoader): void {
  defaultRegistry.registerLoadingLoader(modulePath, loader);
}

/**
 * Error 로더 등록 (전역)
 */
export function registerErrorLoader(modulePath: string, loader: ErrorLoader): void {
  defaultRegistry.registerErrorLoader(modulePath, loader);
}

/**
 * 레이아웃 체인으로 컨텐츠 래핑
 *
 * @param content 페이지 컴포넌트로 렌더된 React Element
 * @param layoutChain 레이아웃 모듈 경로 배열 (외부 → 내부)
 * @param registry ServerRegistry 인스턴스
 * @param params URL 파라미터
 * @returns 래핑된 React Element
 */
async function wrapWithLayouts(
  content: React.ReactElement,
  layoutChain: string[],
  registry: ServerRegistry,
  params: Record<string, string>
): Promise<React.ReactElement> {
  if (!layoutChain || layoutChain.length === 0) {
    return content;
  }

  // 레이아웃 로드 (병렬)
  const layouts = await Promise.all(
    layoutChain.map((modulePath) => registry.getLayoutComponent(modulePath))
  );

  // 내부 → 외부 순서로 래핑 (역순)
  let wrapped = content;
  for (let i = layouts.length - 1; i >= 0; i--) {
    const Layout = layouts[i];
    if (Layout) {
      wrapped = React.createElement(Layout, { params, children: wrapped });
    }
  }

  return wrapped;
}

// Default createApp implementation (registry 기반)
function createDefaultAppFactory(registry: ServerRegistry) {
  return function defaultCreateApp(context: AppContext): React.ReactElement {
    const Component = registry.routeComponents.get(context.routeId);

    if (!Component) {
      return React.createElement("div", null,
        React.createElement("h1", null, "404 - Route Not Found"),
        React.createElement("p", null, `Route ID: ${context.routeId}`)
      );
    }

    return React.createElement(Component, {
      params: context.params,
      loaderData: context.loaderData,
    });
  };
}

// ========== Static File Serving ==========

interface StaticFileResult {
  handled: boolean;
  response?: Response;
}

function createStaticErrorResponse(status: 400 | 403 | 404 | 500): Response {
  const body = {
    400: "Bad Request",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
  }[status];

  return new Response(body, { status });
}

/**
 * 경로가 허용된 디렉토리 내에 있는지 검증
 * Path traversal 공격 방지
 */
async function isPathSafe(filePath: string, allowedDir: string): Promise<boolean> {
  try {
    const resolvedPath = path.resolve(filePath);
    const resolvedAllowedDir = path.resolve(allowedDir);

    if (!resolvedPath.startsWith(resolvedAllowedDir + path.sep) &&
        resolvedPath !== resolvedAllowedDir) {
      return false;
    }

    // 파일이 없으면 안전 (존재하지 않는 경로)
    try {
      await fs.access(resolvedPath);
    } catch {
      return true;
    }

    // Symlink 해결 후 재검증
    const realPath = await fs.realpath(resolvedPath);
    const realAllowedDir = await fs.realpath(resolvedAllowedDir);

    return realPath.startsWith(realAllowedDir + path.sep) ||
           realPath === realAllowedDir;
  } catch (error) {
    console.warn(`[Mandu Security] Path validation failed: ${filePath}`, error);
    return false;
  }
}

/**
 * 정적 파일 서빙
 * - /.mandu/client/* : 클라이언트 번들 (Island hydration)
 * - /public/* : 정적 에셋 (이미지, CSS 등)
 * - /favicon.ico : 파비콘
 *
 * 보안: Path traversal 공격 방지를 위해 모든 경로를 검증합니다.
 */
async function serveStaticFile(pathname: string, settings: ServerRegistrySettings): Promise<StaticFileResult> {
  let filePath: string | null = null;
  let isBundleFile = false;
  let allowedBaseDir: string;
  let relativePath: string;

  // 1. 클라이언트 번들 파일 (/.mandu/client/*)
  if (pathname.startsWith("/.mandu/client/")) {
    // pathname에서 prefix 제거 후 안전하게 조합
    relativePath = pathname.slice("/.mandu/client/".length);
    allowedBaseDir = path.join(settings.rootDir, ".mandu", "client");
    isBundleFile = true;
  }
  // 2. Public 폴더 파일 (/public/*)
  else if (pathname.startsWith("/public/")) {
    relativePath = pathname.slice("/public/".length);
    allowedBaseDir = path.join(settings.rootDir, settings.publicDir);
  }
  // 3. Public 폴더의 루트 파일 (favicon.ico, robots.txt 등)
  else if (
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.json"
  ) {
    // 고정된 파일명만 허용 (이미 위에서 정확히 매칭됨)
    relativePath = path.basename(pathname);
    allowedBaseDir = path.join(settings.rootDir, settings.publicDir);
  } else {
    return { handled: false }; // 정적 파일이 아님
  }

  // URL 디코딩 (실패 시 차단)
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch {
    return { handled: true, response: createStaticErrorResponse(400) };
  }

  // 정규화 + Null byte 방지
  const normalizedPath = path.posix.normalize(decodedPath);
  if (normalizedPath.includes("\0")) {
    console.warn(`[Mandu Security] Null byte attack detected: ${pathname}`);
    return { handled: true, response: createStaticErrorResponse(400) };
  }

  const normalizedSegments = normalizedPath.split("/");
  if (normalizedSegments.some((segment) => segment === "..")) {
    return { handled: true, response: createStaticErrorResponse(403) };
  }

  // 선행 슬래시 제거 → path.join이 base를 무시하지 않도록 보장
  const safeRelativePath = normalizedPath.replace(/^\/+/, "");
  filePath = path.join(allowedBaseDir, safeRelativePath);

  // 최종 경로 검증: 허용된 디렉토리 내에 있는지 확인
  if (!(await isPathSafe(filePath, allowedBaseDir!))) {
    console.warn(`[Mandu Security] Path traversal attempt blocked: ${pathname}`);
    return { handled: true, response: createStaticErrorResponse(403) };
  }

  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      return { handled: true, response: createStaticErrorResponse(404) };
    }

    const mimeType = getMimeType(filePath);

    // Cache-Control 헤더 설정
    let cacheControl: string;
    if (settings.isDev) {
      // 개발 모드: 캐시 없음
      cacheControl = "no-cache, no-store, must-revalidate";
    } else if (isBundleFile) {
      // 프로덕션 번들: 1년 캐시 (파일명에 해시 포함 가정)
      cacheControl = "public, max-age=31536000, immutable";
    } else {
      // 프로덕션 일반 정적 파일: 1일 캐시
      cacheControl = "public, max-age=86400";
    }

    return {
      handled: true,
      response: new Response(file, {
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": cacheControl,
        },
      }),
    };
  } catch {
    return { handled: true, response: createStaticErrorResponse(500) };
  }
}

// ========== Request Handler ==========

async function handleRequest(req: Request, router: Router, registry: ServerRegistry): Promise<Response> {
  const result = await handleRequestInternal(req, router, registry);

  if (!result.ok) {
    return errorToResponse(result.error, registry.settings.isDev);
  }

  return result.value;
}

// ---------- API Route Handler ----------

/**
 * API 라우트 처리
 */
async function handleApiRoute(
  req: Request,
  route: { id: string; pattern: string },
  params: Record<string, string>,
  registry: ServerRegistry
): Promise<Result<Response>> {
  const handler = registry.apiHandlers.get(route.id);

  if (!handler) {
    return err(createHandlerNotFoundResponse(route.id, route.pattern));
  }

  try {
    const response = await handler(req, params);
    return ok(response);
  } catch (errValue) {
    const error = errValue instanceof Error ? errValue : new Error(String(errValue));
    return err(createSSRErrorResponse(route.id, route.pattern, error));
  }
}

// ---------- Page Data Loader ----------

interface PageLoadResult {
  loaderData: unknown;
  cookies?: CookieManager;
}

/**
 * 페이지 컴포넌트 및 loader 데이터 로딩
 */
async function loadPageData(
  req: Request,
  route: { id: string; pattern: string },
  params: Record<string, string>,
  registry: ServerRegistry
): Promise<Result<PageLoadResult>> {
  let loaderData: unknown;

  // 1. PageHandler 방식 (신규 - filling 포함)
  const pageHandler = registry.pageHandlers.get(route.id);
  if (pageHandler) {
    let cookies: CookieManager | undefined;
    try {
      const registration = await pageHandler();
      const component = registration.component as RouteComponent;
      registry.registerRouteComponent(route.id, component);

      // Filling의 loader 실행
      if (registration.filling?.hasLoader()) {
        const ctx = new ManduContext(req, params);
        loaderData = await registration.filling.executeLoader(ctx);
        if (ctx.cookies.hasPendingCookies()) {
          cookies = ctx.cookies;
        }
      }
    } catch (error) {
      const pageError = createPageLoadErrorResponse(
        route.id,
        route.pattern,
        error instanceof Error ? error : new Error(String(error))
      );
      console.error(`[Mandu] ${pageError.errorType}:`, pageError.message);
      return err(pageError);
    }

    return ok({ loaderData, cookies });
  }

  // 2. PageLoader 방식 (레거시 호환)
  const loader = registry.pageLoaders.get(route.id);
  if (loader) {
    try {
      const module = await loader();
      const exported: unknown = module.default;
      const exportedObj = exported as Record<string, unknown> | null;
      const component = typeof exported === "function"
        ? (exported as RouteComponent)
        : (exportedObj?.component ?? exported);
      registry.registerRouteComponent(route.id, component as RouteComponent);

      // filling이 있으면 loader 실행
      let cookies: CookieManager | undefined;
      const filling = typeof exported === "object" && exported !== null ? (exportedObj as Record<string, unknown>)?.filling as ManduFilling | null : null;
      if (filling?.hasLoader?.()) {
        const ctx = new ManduContext(req, params);
        loaderData = await filling.executeLoader(ctx);
        if (ctx.cookies.hasPendingCookies()) {
          cookies = ctx.cookies;
        }
      }

      return ok({ loaderData, cookies });
    } catch (error) {
      const pageError = createPageLoadErrorResponse(
        route.id,
        route.pattern,
        error instanceof Error ? error : new Error(String(error))
      );
      console.error(`[Mandu] ${pageError.errorType}:`, pageError.message);
      return err(pageError);
    }
  }

  return ok({ loaderData });
}

// ---------- SSR Renderer ----------

/**
 * SSR 렌더링 (Streaming/Non-streaming)
 */
async function renderPageSSR(
  route: { id: string; pattern: string; layoutChain?: string[]; streaming?: boolean; hydration?: HydrationConfig },
  params: Record<string, string>,
  loaderData: unknown,
  url: string,
  registry: ServerRegistry,
  cookies?: CookieManager
): Promise<Result<Response>> {
  const settings = registry.settings;
  const defaultAppCreator = createDefaultAppFactory(registry);
  const appCreator = registry.createAppFn || defaultAppCreator;

  try {
    let app = appCreator({
      routeId: route.id,
      url,
      params,
      loaderData,
    });

    // Island 래핑: 레이아웃 적용 전에 페이지 콘텐츠만 island div로 감쌈
    // 이렇게 하면 레이아웃은 island 바깥에 위치하여 하이드레이션 시 레이아웃이 유지됨
    const needsIslandWrap =
      route.hydration &&
      route.hydration.strategy !== "none" &&
      settings.bundleManifest;

    if (needsIslandWrap) {
      const bundle = settings.bundleManifest?.bundles[route.id];
      const bundleSrc = bundle?.js ? `${bundle.js}?t=${Date.now()}` : "";
      const priority = route.hydration!.priority || "visible";
      app = React.createElement("div", {
        "data-mandu-island": route.id,
        "data-mandu-src": bundleSrc,
        "data-mandu-priority": priority,
        style: { display: "contents" },
      }, app);
    }

    // 레이아웃 체인 적용 (island 래핑 후 → 레이아웃은 island 바깥)
    if (route.layoutChain && route.layoutChain.length > 0) {
      app = await wrapWithLayouts(app, route.layoutChain, registry, params);
    }

    const serverData = loaderData
      ? { [route.id]: { serverData: loaderData } }
      : undefined;

    // Streaming SSR 모드 결정
    const useStreaming = route.streaming !== undefined
      ? route.streaming
      : settings.streaming;

    if (useStreaming) {
      const streamingResponse = await renderStreamingResponse(app, {
        title: `${route.id} - Mandu`,
        isDev: settings.isDev,
        hmrPort: settings.hmrPort,
        routeId: route.id,
        routePattern: route.pattern,
        hydration: route.hydration,
        bundleManifest: settings.bundleManifest,
        criticalData: loaderData as Record<string, unknown> | undefined,
        enableClientRouter: true,
        cssPath: settings.cssPath,
        onShellReady: () => {
          if (settings.isDev) {
            console.log(`[Mandu Streaming] Shell ready: ${route.id}`);
          }
        },
        onMetrics: (metrics) => {
          if (settings.isDev) {
            console.log(`[Mandu Streaming] Metrics for ${route.id}:`, {
              shellReadyTime: `${metrics.shellReadyTime}ms`,
              allReadyTime: `${metrics.allReadyTime}ms`,
              hasError: metrics.hasError,
            });
          }
        },
      });
      return ok(cookies ? cookies.applyToResponse(streamingResponse) : streamingResponse);
    }

    // 기존 renderToString 방식
    // Note: hydration 래핑은 위에서 React 엘리먼트 레벨로 이미 처리됨
    // renderToHTML에서 중복 래핑하지 않도록 hydration을 전달하되 strategy를 "none"으로 설정
    // 단, hydration 스크립트(importmap, runtime 등)는 여전히 필요하므로 bundleManifest는 유지
    const ssrResponse = renderSSR(app, {
      title: `${route.id} - Mandu`,
      isDev: settings.isDev,
      hmrPort: settings.hmrPort,
      routeId: route.id,
      hydration: route.hydration,
      bundleManifest: settings.bundleManifest,
      serverData,
      enableClientRouter: true,
      routePattern: route.pattern,
      cssPath: settings.cssPath,
      islandPreWrapped: !!needsIslandWrap,
    });
    return ok(cookies ? cookies.applyToResponse(ssrResponse) : ssrResponse);
  } catch (error) {
    const ssrError = createSSRErrorResponse(
      route.id,
      route.pattern,
      error instanceof Error ? error : new Error(String(error))
    );
    console.error(`[Mandu] ${ssrError.errorType}:`, ssrError.message);
    return err(ssrError);
  }
}

// ---------- Page Route Handler ----------

/**
 * 페이지 라우트 처리
 */
async function handlePageRoute(
  req: Request,
  url: URL,
  route: { id: string; pattern: string; layoutChain?: string[]; streaming?: boolean; hydration?: HydrationConfig },
  params: Record<string, string>,
  registry: ServerRegistry
): Promise<Result<Response>> {
  // 1. 데이터 로딩
  const loadResult = await loadPageData(req, route, params, registry);
  if (!loadResult.ok) {
    return loadResult;
  }

  const { loaderData, cookies } = loadResult.value;

  // 2. Client-side Routing: 데이터만 반환 (JSON)
  if (url.searchParams.has("_data")) {
    const jsonResponse = Response.json({
      routeId: route.id,
      pattern: route.pattern,
      params,
      loaderData: loaderData ?? null,
      timestamp: Date.now(),
    });
    return ok(cookies ? cookies.applyToResponse(jsonResponse) : jsonResponse);
  }

  // 3. SSR 렌더링
  return renderPageSSR(route, params, loaderData, req.url, registry, cookies);
}

// ---------- Main Request Dispatcher ----------

/**
 * 메인 요청 디스패처
 */
async function handleRequestInternal(
  req: Request,
  router: Router,
  registry: ServerRegistry
): Promise<Result<Response>> {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const settings = registry.settings;

  // 0. CORS Preflight 요청 처리
  if (settings.cors && isPreflightRequest(req)) {
    const corsOptions: CorsOptions = typeof settings.cors === 'object' ? settings.cors : {};
    return ok(handlePreflightRequest(req, corsOptions));
  }

  // 1. 정적 파일 서빙 시도 (최우선)
  const staticFileResult = await serveStaticFile(pathname, settings);
  if (staticFileResult.handled) {
    const staticResponse = staticFileResult.response!;
    if (settings.cors && isCorsRequest(req)) {
      const corsOptions: CorsOptions = typeof settings.cors === 'object' ? settings.cors : {};
      return ok(applyCorsToResponse(staticResponse, req, corsOptions));
    }
    return ok(staticResponse);
  }

  // 2. Kitchen dev dashboard (dev mode only)
  if (settings.isDev && pathname.startsWith(KITCHEN_PREFIX) && registry.kitchen) {
    const kitchenResponse = await registry.kitchen.handle(req, pathname);
    if (kitchenResponse) return ok(kitchenResponse);
  }

  // 3. 라우트 매칭
  const match = router.match(pathname);
  if (!match) {
    return err(createNotFoundResponse(pathname));
  }

  const { route, params } = match;

  // 3. 라우트 종류별 처리
  if (route.kind === "api") {
    const rateLimitOptions = settings.rateLimit;
    if (rateLimitOptions && registry.rateLimiter) {
      const decision = registry.rateLimiter.consume(req, route.id, rateLimitOptions);
      if (!decision.allowed) {
        return ok(createRateLimitResponse(decision, rateLimitOptions));
      }

      const apiResult = await handleApiRoute(req, route, params, registry);
      if (!apiResult.ok) return apiResult;
      return ok(appendRateLimitHeaders(apiResult.value, decision, rateLimitOptions));
    }

    return handleApiRoute(req, route, params, registry);
  }

  if (route.kind === "page") {
    return handlePageRoute(req, url, route, params, registry);
  }

  // 4. 알 수 없는 라우트 종류 — exhaustiveness check
  const _exhaustive: never = route;
  return err({
    errorType: "FRAMEWORK_BUG",
    code: "MANDU_F003",
    httpStatus: 500,
    message: `Unknown route kind: ${(_exhaustive as RouteSpec).kind}`,
    summary: "알 수 없는 라우트 종류 - 프레임워크 버그",
    fix: {
      file: ".mandu/routes.manifest.json",
      suggestion: "라우트의 kind는 'api' 또는 'page'여야 합니다",
    },
    route: { id: (_exhaustive as RouteSpec).id, pattern: (_exhaustive as RouteSpec).pattern },
    timestamp: new Date().toISOString(),
  });
}

// ========== Port Selection ==========

const MAX_PORT_ATTEMPTS = 10;

function isPortInUseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? "";
  return code === "EADDRINUSE" || message.includes("EADDRINUSE") || message.includes("address already in use");
}

function startBunServerWithFallback(options: {
  port: number;
  hostname?: string;
  fetch: (req: Request) => Promise<Response>;
}): { server: Server<undefined>; port: number; attempts: number } {
  const { port: startPort, hostname, fetch } = options;
  let lastError: unknown = null;

  // Port 0: let Bun/OS pick an available ephemeral port.
  if (startPort === 0) {
    const server = Bun.serve({
      port: 0,
      hostname,
      fetch,
      idleTimeout: 255,
    });
    return { server, port: server.port ?? 0, attempts: 0 };
  }

  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const candidate = startPort + attempt;
    if (candidate < 1 || candidate > 65535) {
      continue;
    }
    try {
      const server = Bun.serve({
        port: candidate,
        hostname,
        fetch,
        idleTimeout: 255,
      });
      return { server, port: server.port ?? candidate, attempts: attempt };
    } catch (error) {
      if (!isPortInUseError(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError ?? new Error(`No available port found starting at ${startPort}`);
}

// ========== Server Startup ==========

export function startServer(manifest: RoutesManifest, options: ServerOptions = {}): ManduServer {
  const {
    port = 3000,
    hostname = "localhost",
    rootDir = process.cwd(),
    isDev = false,
    hmrPort,
    bundleManifest,
    publicDir = "public",
    cors = false,
    streaming = false,
    rateLimit = false,
    cssPath: cssPathOption,
    registry = defaultRegistry,
    guardConfig = null,
  } = options;

  // cssPath 처리:
  // - string: 해당 경로로 <link> 주입
  // - false: CSS 링크 주입 비활성화
  // - undefined: false로 처리 (기본적으로 링크 미삽입 - 404 방지)
  //
  // dev/build에서 Tailwind 감지 시 명시적으로 cssPath 전달 필요:
  // - dev.ts: cssPath: hasTailwind ? cssWatcher?.serverPath : false
  // - 프로덕션: 빌드 후 .mandu/client/globals.css 존재 시 경로 전달
  const cssPath: string | false = cssPathOption ?? false;

  // CORS 옵션 파싱
  const corsOptions: CorsOptions | false = cors === true ? {} : cors;
  const rateLimitOptions = normalizeRateLimitOptions(rateLimit);

  if (!isDev && cors === true) {
    console.warn("⚠️  [Security Warning] CORS is set to allow all origins.");
    console.warn("   This is not recommended for production environments.");
    console.warn("   Consider specifying allowed origins explicitly:");
    console.warn("   cors: { origin: ['https://yourdomain.com'] }");
  }

  // Registry settings 저장 (초기값)
  registry.settings = {
    isDev,
    hmrPort,
    bundleManifest,
    rootDir,
    publicDir,
    cors: corsOptions,
    streaming,
    rateLimit: rateLimitOptions,
    cssPath,
  };

  registry.rateLimiter = rateLimitOptions ? new MemoryRateLimiter() : null;

  // Kitchen dev dashboard (dev mode only)
  if (isDev) {
    const kitchen = new KitchenHandler({ rootDir, manifest, guardConfig });
    kitchen.start();
    registry.kitchen = kitchen;
  }

  const router = new Router(manifest.routes);

  // Fetch handler with CORS support (registry를 클로저로 캡처)
  const fetchHandler = async (req: Request): Promise<Response> => {
    const response = await handleRequest(req, router, registry);

    // API 라우트 응답에 CORS 헤더 적용
    if (corsOptions && isCorsRequest(req)) {
      return applyCorsToResponse(response, req, corsOptions);
    }

    return response;
  };

  const { server, port: actualPort, attempts } = startBunServerWithFallback({
    port,
    hostname,
    fetch: fetchHandler,
  });

  if (attempts > 0) {
    console.warn(`⚠️  Port ${port} is in use. Using ${actualPort} instead.`);
  }

  if (hmrPort !== undefined && hmrPort === port && actualPort !== port) {
    registry.settings = { ...registry.settings, hmrPort: actualPort };
  }

  if (isDev) {
    console.log(`🥟 Mandu Dev Server running at http://${hostname}:${actualPort}`);
    if (registry.settings.hmrPort) {
      console.log(`🔥 HMR enabled on port ${registry.settings.hmrPort + PORTS.HMR_OFFSET}`);
    }
    console.log(`📂 Static files: /${publicDir}/, /.mandu/client/`);
    if (corsOptions) {
      console.log(`🌐 CORS enabled`);
    }
    if (streaming) {
      console.log(`🌊 Streaming SSR enabled`);
    }
    if (registry.kitchen) {
      console.log(`🍳 Kitchen dashboard at http://${hostname}:${actualPort}/__kitchen`);
    }
  } else {
    console.log(`🥟 Mandu server running at http://${hostname}:${actualPort}`);
    if (streaming) {
      console.log(`🌊 Streaming SSR enabled`);
    }
  }

  return {
    server,
    router,
    registry,
    stop: () => {
      registry.kitchen?.stop();
      server.stop();
    },
  };
}

// Clear registries (useful for testing) - deprecated, use clearDefaultRegistry()
export function clearRegistry(): void {
  clearDefaultRegistry();
}

// Export registry maps for backward compatibility (defaultRegistry 사용)
export const apiHandlers = defaultRegistry.apiHandlers;
export const pageLoaders = defaultRegistry.pageLoaders;
export const pageHandlers = defaultRegistry.pageHandlers;
export const routeComponents = defaultRegistry.routeComponents;

// ========== Rate Limiting Public API ==========

/**
 * Rate limiter 인스턴스 생성
 * API 핸들러에서 직접 사용 가능
 *
 * @example
 * ```typescript
 * import { createRateLimiter } from '@mandujs/core/runtime/server';
 *
 * const limiter = createRateLimiter({ max: 5, windowMs: 60000 });
 *
 * export async function POST(req: Request) {
 *   const decision = limiter.check(req, 'my-api-route');
 *   if (!decision.allowed) {
 *     return limiter.createResponse(decision);
 *   }
 *   // ... 정상 로직
 * }
 * ```
 */
export function createRateLimiter(options?: RateLimitOptions) {
  const normalized = normalizeRateLimitOptions(options || true);
  if (!normalized) {
    throw new Error('Rate limiter options cannot be false');
  }

  const limiter = new MemoryRateLimiter();

  return {
    /**
     * Rate limit 체크
     * @param req Request 객체 (IP 추출용)
     * @param routeId 라우트 식별자 (동일 IP라도 라우트별로 독립적인 limit)
     */
    check(req: Request, routeId: string): RateLimitDecision {
      return limiter.consume(req, routeId, normalized);
    },

    /**
     * Rate limit 초과 시 429 응답 생성
     */
    createResponse(decision: RateLimitDecision): Response {
      return createRateLimitResponse(decision, normalized);
    },

    /**
     * 정상 응답에 Rate limit 헤더 추가
     */
    addHeaders(response: Response, decision: RateLimitDecision): Response {
      return appendRateLimitHeaders(response, decision, normalized);
    },
  };
}
