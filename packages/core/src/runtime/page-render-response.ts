import type React from "react";
import type { BundleManifest } from "../bundler/types";
import type { HydrationConfig } from "../spec/schema";
import type { CookieManager } from "../filling/context";
import { renderSSR, renderStreamingResponse, resolveAsyncElement } from "./ssr";

export interface PageRenderResponseOptions {
  app: React.ReactElement;
  useStreaming: boolean;
  title: string;
  headTags: string;
  isDev: boolean;
  hmrPort?: number;
  routeId: string;
  routePattern: string;
  layoutChain?: string[];
  hydration?: HydrationConfig;
  bundleManifest?: BundleManifest;
  loaderData: unknown;
  cssPath?: string | false;
  transitions?: boolean;
  prefetch?: boolean;
  spa?: boolean;
  devtools?: boolean;
  islandPreWrapped?: boolean;
  cookies?: CookieManager;
}

export async function renderPageResponse(
  options: PageRenderResponseOptions
): Promise<Response> {
  let app = options.app;

  if (!options.useStreaming) {
    app = (await resolveAsyncElement(app)) as React.ReactElement;
  }

  const response = options.useStreaming
    ? await renderStreamingPageResponse(app, options)
    : renderNonStreamingPageResponse(app, options);

  return options.cookies ? options.cookies.applyToResponse(response) : response;
}

async function renderStreamingPageResponse(
  app: React.ReactElement,
  options: PageRenderResponseOptions
): Promise<Response> {
  return renderStreamingResponse(app, {
    title: options.title,
    headTags: options.headTags,
    isDev: options.isDev,
    hmrPort: options.hmrPort,
    routeId: options.routeId,
    routePattern: options.routePattern,
    layoutChain: options.layoutChain,
    hydration: options.hydration,
    bundleManifest: options.bundleManifest,
    criticalData: options.loaderData as Record<string, unknown> | undefined,
    enableClientRouter: true,
    cssPath: options.cssPath,
    transitions: options.transitions,
    prefetch: options.prefetch,
    spa: options.spa,
    devtools: options.devtools,
    onShellReady: () => {
      if (options.isDev) {
        console.log(`[Mandu Streaming] Shell ready: ${options.routeId}`);
      }
    },
    onMetrics: (metrics) => {
      if (options.isDev) {
        console.log(`[Mandu Streaming] Metrics for ${options.routeId}:`, {
          shellReadyTime: `${metrics.shellReadyTime}ms`,
          allReadyTime: `${metrics.allReadyTime}ms`,
          hasError: metrics.hasError,
        });
      }
    },
  });
}

function renderNonStreamingPageResponse(
  app: React.ReactElement,
  options: PageRenderResponseOptions
): Response {
  const serverData = options.loaderData
    ? { [options.routeId]: { serverData: options.loaderData } }
    : undefined;

  return renderSSR(app, {
    title: options.title,
    headTags: options.headTags,
    isDev: options.isDev,
    hmrPort: options.hmrPort,
    routeId: options.routeId,
    hydration: options.hydration,
    bundleManifest: options.bundleManifest,
    serverData,
    enableClientRouter: true,
    routePattern: options.routePattern,
    cssPath: options.cssPath,
    islandPreWrapped: !!options.islandPreWrapped,
    transitions: options.transitions,
    prefetch: options.prefetch,
    spa: options.spa,
    devtools: options.devtools,
    layoutChain: options.layoutChain,
  });
}
