import type { Server } from "bun";
import type { RoutesManifest } from "../spec/schema";
import type { BundleManifest } from "../bundler/types";
import { Router } from "./router";
import { renderSSR } from "./ssr";
import React from "react";
import {
  formatErrorResponse,
  createNotFoundResponse,
  createHandlerNotFoundResponse,
  createPageLoadErrorResponse,
  createSSRErrorResponse,
} from "../error";

export interface ServerOptions {
  port?: number;
  hostname?: string;
  /** 개발 모드 여부 */
  isDev?: boolean;
  /** HMR 포트 (개발 모드에서 사용) */
  hmrPort?: number;
  /** 번들 매니페스트 (Island hydration용) */
  bundleManifest?: BundleManifest;
}

export interface ManduServer {
  server: Server;
  router: Router;
  stop: () => void;
}

export type ApiHandler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;
export type PageLoader = () => Promise<{ default: React.ComponentType<{ params: Record<string, string> }> }>;

export interface AppContext {
  routeId: string;
  url: string;
  params: Record<string, string>;
}

type RouteComponent = (props: { params: Record<string, string> }) => React.ReactElement;
type CreateAppFn = (context: AppContext) => React.ReactElement;

// Registry
const apiHandlers: Map<string, ApiHandler> = new Map();
const pageLoaders: Map<string, PageLoader> = new Map();
const routeComponents: Map<string, RouteComponent> = new Map();
let createAppFn: CreateAppFn | null = null;

// Dev mode settings (module-level for handleRequest access)
let devModeSettings: { isDev: boolean; hmrPort?: number; bundleManifest?: BundleManifest } = { isDev: false };

export function registerApiHandler(routeId: string, handler: ApiHandler): void {
  apiHandlers.set(routeId, handler);
}

export function registerPageLoader(routeId: string, loader: PageLoader): void {
  pageLoaders.set(routeId, loader);
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

  return React.createElement(Component, { params: context.params });
}

async function handleRequest(req: Request, router: Router): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

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

    const appCreator = createAppFn || defaultCreateApp;
    try {
      const app = appCreator({
        routeId: route.id,
        url: req.url,
        params,
      });

      return renderSSR(app, {
        title: `${route.id} - Mandu`,
        isDev: devModeSettings.isDev,
        hmrPort: devModeSettings.hmrPort,
        routeId: route.id,
        hydration: route.hydration,
        bundleManifest: devModeSettings.bundleManifest,
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

export function startServer(manifest: RoutesManifest, options: ServerOptions = {}): ManduServer {
  const { port = 3000, hostname = "localhost", isDev = false, hmrPort, bundleManifest } = options;

  // Dev mode settings 저장
  devModeSettings = { isDev, hmrPort, bundleManifest };

  const router = new Router(manifest.routes);

  const server = Bun.serve({
    port,
    hostname,
    fetch: (req) => handleRequest(req, router),
  });

  if (isDev) {
    console.log(`🥟 Mandu Dev Server running at http://${hostname}:${port}`);
    if (hmrPort) {
      console.log(`🔥 HMR enabled on port ${hmrPort + 1}`);
    }
  } else {
    console.log(`🥟 Mandu server running at http://${hostname}:${port}`);
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
  routeComponents.clear();
  createAppFn = null;
}

export { apiHandlers, pageLoaders, routeComponents };
