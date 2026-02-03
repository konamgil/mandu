import type { Server } from "bun";
import type { RoutesManifest } from "../spec/schema";
import type { BundleManifest } from "../bundler/types";
import type { ManduFilling } from "../filling/filling";
import { ManduContext } from "../filling/context";
import { Router } from "./router";
import { renderSSR, renderStreamingResponse } from "./ssr";
import { PageBoundary, DefaultLoading, DefaultError, type ErrorFallbackProps } from "./boundary";
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
   * 커스텀 레지스트리 (핸들러/설정 분리)
   * - 제공하지 않으면 기본 전역 레지스트리 사용
   * - 테스트나 멀티앱 시나리오에서 createServerRegistry()로 생성한 인스턴스 전달
   */
  registry?: ServerRegistry;
}

export interface ManduServer {
  server: Server;
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
  settings: ServerRegistrySettings = {
    isDev: false,
    rootDir: process.cwd(),
    publicDir: "public",
    cors: false,
    streaming: false,
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
   * Layout 컴포넌트 가져오기 (캐시 또는 로드)
   */
  async getLayoutComponent(modulePath: string): Promise<LayoutComponent | null> {
    // 캐시 확인
    const cached = this.layoutComponents.get(modulePath);
    if (cached) {
      return cached;
    }

    // 로더로 로드
    const loader = this.layoutLoaders.get(modulePath);
    if (loader) {
      try {
        const module = await loader();
        const component = module.default;
        this.layoutComponents.set(modulePath, component);
        return component;
      } catch (error) {
        console.error(`[Mandu] Failed to load layout: ${modulePath}`, error);
        return null;
      }
    }

    // 동적 import 시도
    try {
      const fullPath = path.join(this.settings.rootDir, modulePath);
      const module = await import(fullPath);
      const component = module.default;
      this.layoutComponents.set(modulePath, component);
      return component;
    } catch (error) {
      console.error(`[Mandu] Failed to load layout: ${modulePath}`, error);
      return null;
    }
  }

  setCreateApp(fn: CreateAppFn): void {
    this.createAppFn = fn;
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
   * Loading 컴포넌트 가져오기 (캐시 또는 로드)
   */
  async getLoadingComponent(modulePath: string): Promise<LoadingComponent | null> {
    const cached = this.loadingComponents.get(modulePath);
    if (cached) return cached;

    const loader = this.loadingLoaders.get(modulePath);
    if (loader) {
      try {
        const module = await loader();
        const component = module.default;
        this.loadingComponents.set(modulePath, component);
        return component;
      } catch (error) {
        console.error(`[Mandu] Failed to load loading component: ${modulePath}`, error);
        return null;
      }
    }

    try {
      const fullPath = path.join(this.settings.rootDir, modulePath);
      const module = await import(fullPath);
      const component = module.default;
      this.loadingComponents.set(modulePath, component);
      return component;
    } catch {
      return null;
    }
  }

  /**
   * Error 컴포넌트 가져오기 (캐시 또는 로드)
   */
  async getErrorComponent(modulePath: string): Promise<ErrorComponent | null> {
    const cached = this.errorComponents.get(modulePath);
    if (cached) return cached;

    const loader = this.errorLoaders.get(modulePath);
    if (loader) {
      try {
        const module = await loader();
        const component = module.default;
        this.errorComponents.set(modulePath, component);
        return component;
      } catch (error) {
        console.error(`[Mandu] Failed to load error component: ${modulePath}`, error);
        return null;
      }
    }

    try {
      const fullPath = path.join(this.settings.rootDir, modulePath);
      const module = await import(fullPath);
      const component = module.default;
      this.errorComponents.set(modulePath, component);
      return component;
    } catch {
      return null;
    }
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
      wrapped = React.createElement(Layout, { params }, wrapped);
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
async function serveStaticFile(pathname: string, settings: ServerRegistrySettings): Promise<Response | null> {
  let filePath: string | null = null;
  let isBundleFile = false;
  let allowedBaseDir: string;
  let relativePath: string;

  // Path traversal 시도 조기 차단 (정규화 전 raw 체크)
  if (pathname.includes("..")) {
    return null;
  }

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
    return null; // 정적 파일이 아님
  }

  // URL 디코딩 (실패 시 차단)
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch {
    return null;
  }

  // 정규화 + Null byte 방지
  const normalizedPath = path.posix.normalize(decodedPath);
  if (normalizedPath.includes("\0")) {
    console.warn(`[Mandu Security] Null byte attack detected: ${pathname}`);
    return null;
  }

  // 선행 슬래시 제거 → path.join이 base를 무시하지 않도록 보장
  const safeRelativePath = normalizedPath.replace(/^\/+/, "");

  // 상대 경로 탈출 차단
  if (safeRelativePath.startsWith("..")) {
    return null;
  }

  filePath = path.join(allowedBaseDir, safeRelativePath);

  // 최종 경로 검증: 허용된 디렉토리 내에 있는지 확인
  if (!(await isPathSafe(filePath, allowedBaseDir!))) {
    console.warn(`[Mandu Security] Path traversal attempt blocked: ${pathname}`);
    return null;
  }

  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      return null; // 파일 없음 - 라우트 매칭으로 넘김
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

    return new Response(file, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": cacheControl,
      },
    });
  } catch {
    return null; // 파일 읽기 실패 - 라우트 매칭으로 넘김
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
    const corsOptions = settings.cors === true ? {} : settings.cors;
    return ok(handlePreflightRequest(req, corsOptions));
  }

  // 1. 정적 파일 서빙 시도 (최우선)
  const staticResponse = await serveStaticFile(pathname, settings);
  if (staticResponse) {
    // 정적 파일에도 CORS 헤더 적용
    if (settings.cors && isCorsRequest(req)) {
      const corsOptions = settings.cors === true ? {} : settings.cors;
      return ok(applyCorsToResponse(staticResponse, req, corsOptions));
    }
    return ok(staticResponse);
  }

  // 2. 라우트 매칭
  const match = router.match(pathname);

  if (!match) {
    return err(createNotFoundResponse(pathname));
  }

  const { route, params } = match;

  if (route.kind === "api") {
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

  if (route.kind === "page") {
    let loaderData: unknown;
    let component: RouteComponent | undefined;

    // Client-side Routing: 데이터 요청 감지
    const isDataRequest = url.searchParams.has("_data");

    // 1. PageHandler 방식 (신규 - filling 포함)
    const pageHandler = registry.pageHandlers.get(route.id);
    if (pageHandler) {
      try {
        const registration = await pageHandler();
        component = registration.component as RouteComponent;
        registry.registerRouteComponent(route.id, component);

        // Filling의 loader 실행
        if (registration.filling?.hasLoader()) {
          const ctx = new ManduContext(req, params);
          loaderData = await registration.filling.executeLoader(ctx);
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
    }
    // 2. PageLoader 방식 (레거시 호환)
    else {
      const loader = registry.pageLoaders.get(route.id);
      if (loader) {
        try {
          const module = await loader();
          // module.default가 { component, filling } 객체인 경우 component 추출
          const exported = module.default;
          const component = typeof exported === 'function'
            ? exported
            : exported?.component ?? exported;
          registry.registerRouteComponent(route.id, component);

          // filling이 있으면 loader 실행
          const filling = typeof exported === 'object' ? exported?.filling : null;
          if (filling?.hasLoader?.()) {
            const ctx = new ManduContext(req, params);
            loaderData = await filling.executeLoader(ctx);
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
      }
    }

    // Client-side Routing: 데이터만 반환 (JSON)
    if (isDataRequest) {
      return ok(Response.json({
        routeId: route.id,
        pattern: route.pattern,
        params,
        loaderData: loaderData ?? null,
        timestamp: Date.now(),
      }));
    }

    // SSR 렌더링
    const defaultAppCreator = createDefaultAppFactory(registry);
    const appCreator = registry.createAppFn || defaultAppCreator;
    try {
      let app = appCreator({
        routeId: route.id,
        url: req.url,
        params,
        loaderData,
      });

      // 레이아웃 체인 적용 (layoutChain이 있는 경우)
      if (route.layoutChain && route.layoutChain.length > 0) {
        app = await wrapWithLayouts(app, route.layoutChain, registry, params);
      }

      // serverData 구조: { [routeId]: { serverData: loaderData } }
      const serverData = loaderData
        ? { [route.id]: { serverData: loaderData } }
        : undefined;

      // Streaming SSR 모드 결정
      // 우선순위: route.streaming > settings.streaming
      const useStreaming = route.streaming !== undefined
        ? route.streaming
        : settings.streaming;

      if (useStreaming) {
        return ok(await renderStreamingResponse(app, {
          title: `${route.id} - Mandu`,
          isDev: settings.isDev,
          hmrPort: settings.hmrPort,
          routeId: route.id,
          routePattern: route.pattern,
          hydration: route.hydration,
          bundleManifest: settings.bundleManifest,
          criticalData: loaderData as Record<string, unknown> | undefined,
          enableClientRouter: true,
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
        }));
      }

      // 기존 renderToString 방식
      return ok(renderSSR(app, {
        title: `${route.id} - Mandu`,
        isDev: settings.isDev,
        hmrPort: settings.hmrPort,
        routeId: route.id,
        hydration: route.hydration,
        bundleManifest: settings.bundleManifest,
        serverData,
        // Client-side Routing 활성화 정보 전달
        enableClientRouter: true,
        routePattern: route.pattern,
      }));
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

  return err({
    errorType: "FRAMEWORK_BUG",
    code: "MANDU_F003",
    httpStatus: 500,
    message: `Unknown route kind: ${route.kind}`,
    summary: "알 수 없는 라우트 종류 - 프레임워크 버그",
    fix: {
      file: "spec/routes.manifest.json",
      suggestion: "라우트의 kind는 'api' 또는 'page'여야 합니다",
    },
    route: {
      id: route.id,
      pattern: route.pattern,
    },
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
}): { server: Server; port: number; attempts: number } {
  const { port: startPort, hostname, fetch } = options;
  let lastError: unknown = null;

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
    registry = defaultRegistry,
  } = options;

  // CORS 옵션 파싱
  const corsOptions: CorsOptions | false = cors === true ? {} : cors;

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
  };

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
    stop: () => server.stop(),
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
