import type { Server } from "bun";
import type { RoutesManifest } from "../spec/schema";
import type { BundleManifest } from "../bundler/types";
import type { ManduFilling } from "../filling/filling";
import { ManduContext } from "../filling/context";
import { Router } from "./router";
import { renderSSR, renderStreamingResponse } from "./ssr";
import React from "react";
import path from "path";
import {
  formatErrorResponse,
  createNotFoundResponse,
  createHandlerNotFoundResponse,
  createPageLoadErrorResponse,
  createSSRErrorResponse,
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
}

export interface ManduServer {
  server: Server;
  router: Router;
  stop: () => void;
}

export type ApiHandler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;
export type PageLoader = () => Promise<{ default: React.ComponentType<{ params: Record<string, string> }> }>;

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

// Registry
const apiHandlers: Map<string, ApiHandler> = new Map();
const pageLoaders: Map<string, PageLoader> = new Map();
const pageHandlers: Map<string, PageHandler> = new Map();
const routeComponents: Map<string, RouteComponent> = new Map();
let createAppFn: CreateAppFn | null = null;

// Server settings (module-level for handleRequest access)
let serverSettings: {
  isDev: boolean;
  hmrPort?: number;
  bundleManifest?: BundleManifest;
  rootDir: string;
  publicDir: string;
  cors?: CorsOptions | false;
  streaming: boolean;
} = {
  isDev: false,
  rootDir: process.cwd(),
  publicDir: "public",
  cors: false,
  streaming: false,
};

export function registerApiHandler(routeId: string, handler: ApiHandler): void {
  apiHandlers.set(routeId, handler);
}

export function registerPageLoader(routeId: string, loader: PageLoader): void {
  pageLoaders.set(routeId, loader);
}

/**
 * Page Handler 등록 (컴포넌트 + filling)
 * filling이 있으면 loader를 실행하여 serverData 전달
 */
export function registerPageHandler(routeId: string, handler: PageHandler): void {
  pageHandlers.set(routeId, handler);
}

export function registerRouteComponent(routeId: string, component: RouteComponent): void {
  routeComponents.set(routeId, component);
}

export function setCreateApp(fn: CreateAppFn): void {
  createAppFn = fn;
}

// Default createApp implementation
function defaultCreateApp(context: AppContext): React.ReactElement {
  const Component = routeComponents.get(context.routeId);

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
}

// ========== Static File Serving ==========

/**
 * 정적 파일 서빙
 * - /.mandu/client/* : 클라이언트 번들 (Island hydration)
 * - /public/* : 정적 에셋 (이미지, CSS 등)
 * - /favicon.ico : 파비콘
 */
async function serveStaticFile(pathname: string): Promise<Response | null> {
  let filePath: string | null = null;
  let isBundleFile = false;

  // 1. 클라이언트 번들 파일 (/.mandu/client/*)
  if (pathname.startsWith("/.mandu/client/")) {
    filePath = path.join(serverSettings.rootDir, pathname);
    isBundleFile = true;
  }
  // 2. Public 폴더 파일 (/public/* 또는 직접 접근)
  else if (pathname.startsWith("/public/")) {
    filePath = path.join(serverSettings.rootDir, pathname);
  }
  // 3. Public 폴더의 루트 파일 (favicon.ico, robots.txt 등)
  else if (
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.json"
  ) {
    filePath = path.join(serverSettings.rootDir, serverSettings.publicDir, pathname);
  }

  if (!filePath) {
    return null; // 정적 파일이 아님
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
    if (serverSettings.isDev) {
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

async function handleRequest(req: Request, router: Router): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // 0. CORS Preflight 요청 처리
  if (serverSettings.cors && isPreflightRequest(req)) {
    const corsOptions = serverSettings.cors === true ? {} : serverSettings.cors;
    return handlePreflightRequest(req, corsOptions);
  }

  // 1. 정적 파일 서빙 시도 (최우선)
  const staticResponse = await serveStaticFile(pathname);
  if (staticResponse) {
    // 정적 파일에도 CORS 헤더 적용
    if (serverSettings.cors && isCorsRequest(req)) {
      const corsOptions = serverSettings.cors === true ? {} : serverSettings.cors;
      return applyCorsToResponse(staticResponse, req, corsOptions);
    }
    return staticResponse;
  }

  // 2. 라우트 매칭
  const match = router.match(pathname);

  if (!match) {
    const error = createNotFoundResponse(pathname);
    const response = formatErrorResponse(error, {
      isDev: process.env.NODE_ENV !== "production",
    });
    return Response.json(response, { status: 404 });
  }

  const { route, params } = match;

  if (route.kind === "api") {
    const handler = apiHandlers.get(route.id);
    if (!handler) {
      const error = createHandlerNotFoundResponse(route.id, route.pattern);
      const response = formatErrorResponse(error, {
        isDev: process.env.NODE_ENV !== "production",
      });
      return Response.json(response, { status: 500 });
    }
    return handler(req, params);
  }

  if (route.kind === "page") {
    let loaderData: unknown;
    let component: RouteComponent | undefined;

    // Client-side Routing: 데이터 요청 감지
    const isDataRequest = url.searchParams.has("_data");

    // 1. PageHandler 방식 (신규 - filling 포함)
    const pageHandler = pageHandlers.get(route.id);
    if (pageHandler) {
      try {
        const registration = await pageHandler();
        component = registration.component as RouteComponent;
        registerRouteComponent(route.id, component);

        // Filling의 loader 실행
        if (registration.filling?.hasLoader()) {
          const ctx = new ManduContext(req, params);
          loaderData = await registration.filling.executeLoader(ctx);
        }
      } catch (err) {
        const pageError = createPageLoadErrorResponse(
          route.id,
          route.pattern,
          err instanceof Error ? err : new Error(String(err))
        );
        console.error(`[Mandu] ${pageError.errorType}:`, pageError.message);
        const response = formatErrorResponse(pageError, {
          isDev: process.env.NODE_ENV !== "production",
        });
        return Response.json(response, { status: 500 });
      }
    }
    // 2. PageLoader 방식 (레거시 호환)
    else {
      const loader = pageLoaders.get(route.id);
      if (loader) {
        try {
          const module = await loader();
          registerRouteComponent(route.id, module.default);
        } catch (err) {
          const pageError = createPageLoadErrorResponse(
            route.id,
            route.pattern,
            err instanceof Error ? err : new Error(String(err))
          );
          console.error(`[Mandu] ${pageError.errorType}:`, pageError.message);
          const response = formatErrorResponse(pageError, {
            isDev: process.env.NODE_ENV !== "production",
          });
          return Response.json(response, { status: 500 });
        }
      }
    }

    // Client-side Routing: 데이터만 반환 (JSON)
    if (isDataRequest) {
      return Response.json({
        routeId: route.id,
        pattern: route.pattern,
        params,
        loaderData: loaderData ?? null,
        timestamp: Date.now(),
      });
    }

    // SSR 렌더링
    const appCreator = createAppFn || defaultCreateApp;
    try {
      const app = appCreator({
        routeId: route.id,
        url: req.url,
        params,
        loaderData,
      });

      // serverData 구조: { [routeId]: { serverData: loaderData } }
      const serverData = loaderData
        ? { [route.id]: { serverData: loaderData } }
        : undefined;

      // Streaming SSR 모드 결정
      // 우선순위: route.streaming > serverSettings.streaming
      const useStreaming = route.streaming !== undefined
        ? route.streaming
        : serverSettings.streaming;

      if (useStreaming) {
        return await renderStreamingResponse(app, {
          title: `${route.id} - Mandu`,
          isDev: serverSettings.isDev,
          hmrPort: serverSettings.hmrPort,
          routeId: route.id,
          routePattern: route.pattern,
          hydration: route.hydration,
          bundleManifest: serverSettings.bundleManifest,
          criticalData: loaderData as Record<string, unknown> | undefined,
          enableClientRouter: true,
          onShellReady: () => {
            if (serverSettings.isDev) {
              console.log(`[Mandu Streaming] Shell ready: ${route.id}`);
            }
          },
          onMetrics: (metrics) => {
            if (serverSettings.isDev) {
              console.log(`[Mandu Streaming] Metrics for ${route.id}:`, {
                shellReadyTime: `${metrics.shellReadyTime}ms`,
                allReadyTime: `${metrics.allReadyTime}ms`,
                hasError: metrics.hasError,
              });
            }
          },
        });
      }

      // 기존 renderToString 방식
      return renderSSR(app, {
        title: `${route.id} - Mandu`,
        isDev: serverSettings.isDev,
        hmrPort: serverSettings.hmrPort,
        routeId: route.id,
        hydration: route.hydration,
        bundleManifest: serverSettings.bundleManifest,
        serverData,
        // Client-side Routing 활성화 정보 전달
        enableClientRouter: true,
        routePattern: route.pattern,
      });
    } catch (err) {
      const ssrError = createSSRErrorResponse(
        route.id,
        route.pattern,
        err instanceof Error ? err : new Error(String(err))
      );
      console.error(`[Mandu] ${ssrError.errorType}:`, ssrError.message);
      const response = formatErrorResponse(ssrError, {
        isDev: process.env.NODE_ENV !== "production",
      });
      return Response.json(response, { status: 500 });
    }
  }

  return Response.json({
    errorType: "FRAMEWORK_BUG",
    code: "MANDU_F003",
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
  }, { status: 500 });
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
  } = options;

  // CORS 옵션 파싱
  const corsOptions: CorsOptions | false = cors === true ? {} : cors;

  // Server settings 저장
  serverSettings = {
    isDev,
    hmrPort,
    bundleManifest,
    rootDir,
    publicDir,
    cors: corsOptions,
    streaming,
  };

  const router = new Router(manifest.routes);

  // Fetch handler with CORS support
  const fetchHandler = async (req: Request): Promise<Response> => {
    const response = await handleRequest(req, router);

    // API 라우트 응답에 CORS 헤더 적용
    if (corsOptions && isCorsRequest(req)) {
      return applyCorsToResponse(response, req, corsOptions);
    }

    return response;
  };

  const server = Bun.serve({
    port,
    hostname,
    fetch: fetchHandler,
  });

  if (isDev) {
    console.log(`🥟 Mandu Dev Server running at http://${hostname}:${port}`);
    if (hmrPort) {
      console.log(`🔥 HMR enabled on port ${hmrPort + 1}`);
    }
    console.log(`📂 Static files: /${publicDir}/, /.mandu/client/`);
    if (corsOptions) {
      console.log(`🌐 CORS enabled`);
    }
    if (streaming) {
      console.log(`🌊 Streaming SSR enabled`);
    }
  } else {
    console.log(`🥟 Mandu server running at http://${hostname}:${port}`);
    if (streaming) {
      console.log(`🌊 Streaming SSR enabled`);
    }
  }

  return {
    server,
    router,
    stop: () => server.stop(),
  };
}

// Clear registries (useful for testing)
export function clearRegistry(): void {
  apiHandlers.clear();
  pageLoaders.clear();
  pageHandlers.clear();
  routeComponents.clear();
  createAppFn = null;
}

export { apiHandlers, pageLoaders, pageHandlers, routeComponents };
