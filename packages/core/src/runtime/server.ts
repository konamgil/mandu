import type { Server } from "bun";
import type { RoutesManifest } from "../spec/schema";
import { Router } from "./router";
import { renderSSR } from "./ssr";
import React from "react";

export interface ServerOptions {
  port?: number;
  hostname?: string;
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
    return new Response("Not Found", { status: 404 });
  }

  const { route, params } = match;

  if (route.kind === "api") {
    const handler = apiHandlers.get(route.id);
    if (!handler) {
      return Response.json({ error: "Handler not found" }, { status: 500 });
    }
    return handler(req, params);
  }

  if (route.kind === "page") {
    const loader = pageLoaders.get(route.id);
    if (loader) {
      try {
        const module = await loader();
        registerRouteComponent(route.id, module.default);
      } catch (error) {
        console.error(`Failed to load page module for ${route.id}:`, error);
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    const appCreator = createAppFn || defaultCreateApp;
    const app = appCreator({
      routeId: route.id,
      url: req.url,
      params,
    });

    return renderSSR(app, { title: `${route.id} - Mandu` });
  }

  return new Response("Unknown route kind", { status: 500 });
}

export function startServer(manifest: RoutesManifest, options: ServerOptions = {}): ManduServer {
  const { port = 3000, hostname = "localhost" } = options;

  const router = new Router(manifest.routes);

  const server = Bun.serve({
    port,
    hostname,
    fetch: (req) => handleRequest(req, router),
  });

  console.log(`🥟 Mandu server running at http://${hostname}:${port}`);

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
