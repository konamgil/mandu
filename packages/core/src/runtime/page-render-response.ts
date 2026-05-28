import React from "react";
import type { BundleManifest } from "../bundler/types";
import type { HydrationConfig } from "../spec/schema";
import type { CookieManager } from "../filling/context";
import { renderSSR, renderStreamingResponse, resolveAsyncElement } from "./ssr";
import { serializeProps } from "../client/serialize";
import { escapeJsonForInlineScript } from "./escape";

export interface InlineClientHydrationTarget {
  routeId: string;
  src: string;
  priority: NonNullable<HydrationConfig["priority"]>;
  component: unknown;
  /**
   * Compatibility path for pre-F42 route-level client modules where the
   * client component is hidden behind a server wrapper. Disabled by default
   * because it invokes user function components outside React's renderer.
   */
  legacyRuntimeScan?: boolean;
  sourceFile?: string;
}

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
  inlineClientHydration?: InlineClientHydrationTarget;
  cookies?: CookieManager;
}

export async function renderPageResponse(
  options: PageRenderResponseOptions
): Promise<Response> {
  let app = options.app;
  let islandPreWrapped = !!options.islandPreWrapped;

  if (!options.useStreaming) {
    if (options.inlineClientHydration) {
      const resolved = await resolveAndWrapInlineClientHydration(
        app,
        options.inlineClientHydration,
      );
      app = resolved.node as React.ReactElement;
      islandPreWrapped = islandPreWrapped || resolved.didWrap;
    } else {
      app = (await resolveAsyncElement(app)) as React.ReactElement;
    }
  }

  const effectiveOptions = islandPreWrapped === !!options.islandPreWrapped
    ? options
    : { ...options, islandPreWrapped };

  const response = options.useStreaming
    ? await renderStreamingPageResponse(app, effectiveOptions)
    : renderNonStreamingPageResponse(app, effectiveOptions);

  return options.cookies ? options.cookies.applyToResponse(response) : response;
}

async function resolveAndWrapInlineClientHydration(
  node: React.ReactNode,
  target: InlineClientHydrationTarget,
  counter = { value: 0 },
): Promise<{ node: React.ReactNode; didWrap: boolean }> {
  if (node == null || typeof node !== "object") {
    return { node, didWrap: false };
  }

  if (Array.isArray(node)) {
    let didWrap = false;
    const children: React.ReactNode[] = [];
    for (const child of node) {
      const result = await resolveAndWrapInlineClientHydration(child, target, counter);
      didWrap = didWrap || result.didWrap;
      children.push(result.node);
    }
    return { node: children, didWrap };
  }

  if (!React.isValidElement(node)) {
    return { node, didWrap: false };
  }

  const element = node as React.ReactElement<Record<string, unknown>>;
  const type = element.type;

  if (type === target.component) {
    const id = `${target.routeId}--${counter.value++}`;
    const props = element.props ?? {};
    const serializedProps = serializeProps(props);
    return {
      node: React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "div",
          {
            "data-mandu-island": id,
            "data-mandu-src": target.src,
            "data-mandu-priority": target.priority,
            "data-hydrate": priorityToHydrate(target.priority),
            "data-props": serializedProps,
            style: { display: "contents" },
          },
          element,
        ),
        React.createElement("script", {
          type: "application/json",
          "data-mandu-props": id,
          dangerouslySetInnerHTML: {
            __html: escapeJsonForInlineScript(serializedProps),
          },
        }),
      ),
      didWrap: true,
    };
  }

  if (target.legacyRuntimeScan && typeof type === "function" && !isClassComponent(type)) {
    warnLegacyRuntimePartialScan(target);
    const rendered = await renderFunctionComponentForInlineHydration(
      type,
      element.props ?? {},
    );
    if (rendered.ok) {
      return resolveAndWrapInlineClientHydration(rendered.node, target, counter);
    }
  }

  const props = element.props;
  const rawChildren = props?.children as React.ReactNode | undefined;
  if (rawChildren === undefined) {
    return { node: element, didWrap: false };
  }

  const resolvedChildren = await resolveAndWrapInlineClientHydration(rawChildren, target, counter);
  if (!resolvedChildren.didWrap && resolvedChildren.node === rawChildren) {
    return { node: element, didWrap: false };
  }

  const cloned = Array.isArray(resolvedChildren.node)
    ? React.cloneElement(element, undefined, ...resolvedChildren.node)
    : React.cloneElement(element, undefined, resolvedChildren.node);
  return { node: cloned, didWrap: resolvedChildren.didWrap };
}

const warnedLegacyRuntimePartialScanRoutes = new Set<string>();

function warnLegacyRuntimePartialScan(target: InlineClientHydrationTarget): void {
  if (warnedLegacyRuntimePartialScanRoutes.has(target.routeId)) return;
  warnedLegacyRuntimePartialScanRoutes.add(target.routeId);

  const file = target.sourceFile ? ` file="${target.sourceFile}"` : "";
  console.warn(
    `[MANDU_LEGACY_RUNTIME_PARTIAL_SCAN] route="${target.routeId}"${file}: ` +
    "runtime client component discovery is running under the compatibility flag. " +
    "Migrate this route to compiler-owned client boundaries so SSR does not invoke user components during discovery.",
  );
}

function isAsyncFunctionComponent(type: Function): boolean {
  return !type.prototype?.isReactComponent &&
    (type as { constructor?: { name?: string } }).constructor?.name === "AsyncFunction";
}

function isClassComponent(type: Function): boolean {
  return !!type.prototype?.isReactComponent;
}

async function renderFunctionComponentForInlineHydration(
  type: Function,
  props: Record<string, unknown>,
): Promise<{ ok: true; node: React.ReactNode } | { ok: false }> {
  const render = type as (props: Record<string, unknown>) => React.ReactNode | Promise<React.ReactNode>;
  if (isAsyncFunctionComponent(type)) {
    return { ok: true, node: await render(props) };
  }

  if (functionComponentLooksHookDependent(type)) {
    return { ok: false };
  }

  try {
    return { ok: true, node: await render(props) };
  } catch {
    return { ok: false };
  }
}

function functionComponentLooksHookDependent(type: Function): boolean {
  let source = "";
  try {
    source = Function.prototype.toString.call(type);
  } catch {
    return true;
  }

  return /\bReact\.use[A-Za-z0-9_$]*\s*\(/.test(source) ||
    /\buse[A-Z][A-Za-z0-9_$]*\s*\(/.test(source);
}

function priorityToHydrate(priority: InlineClientHydrationTarget["priority"]): string {
  return priority === "immediate" ? "load" : priority;
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
    islandPreWrapped: !!options.islandPreWrapped,
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
  return renderSSR(app, {
    title: options.title,
    headTags: options.headTags,
    isDev: options.isDev,
    hmrPort: options.hmrPort,
    routeId: options.routeId,
    hydration: options.hydration,
    bundleManifest: options.bundleManifest,
    serverData: options.loaderData,
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
