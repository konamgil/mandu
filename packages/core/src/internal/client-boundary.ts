import React from "react";
import { AsyncLocalStorage } from "node:async_hooks";

import type { BundleManifest } from "../bundler/types";
import { serializeProps } from "../client/serialize";
import { escapeJsonForInlineScript } from "../runtime/escape";

export interface ManduClientBoundaryProps {
  routeId: string;
  boundaryId: string;
  module: string;
  exportName: string;
  props?: Record<string, unknown>;
  hydrate?: string;
  src?: string;
}

interface BoundaryRenderContext {
  routeId?: string;
  bundleManifest?: BundleManifest;
  instanceCounts: Map<string, number>;
}

export interface ManduClientBoundaryRenderScope {
  <T>(render: () => T): T;
  wrapElement(element: React.ReactElement): React.ReactElement;
}

const boundaryContextStack: BoundaryRenderContext[] = [];
const boundaryAsyncStorage = new AsyncLocalStorage<BoundaryRenderContext>();
const BoundaryReactContext = React.createContext<BoundaryRenderContext | undefined>(undefined);

export function createManduClientBoundaryRenderScope(
  routeId: string | undefined,
  bundleManifest: BundleManifest | undefined,
): ManduClientBoundaryRenderScope {
  const context: BoundaryRenderContext = { routeId, bundleManifest, instanceCounts: new Map() };
  const scope = (<T>(render: () => T): T => runWithBoundaryContext(context, render)) as ManduClientBoundaryRenderScope;
  scope.wrapElement = (element: React.ReactElement): React.ReactElement =>
    React.createElement(BoundaryReactContext.Provider, { value: context }, element);
  return scope;
}

export function renderWithManduClientBoundaryManifest<T>(
  routeId: string | undefined,
  bundleManifest: BundleManifest | undefined,
  render: () => T,
): T {
  return createManduClientBoundaryRenderScope(routeId, bundleManifest)(render);
}

function runWithBoundaryContext<T>(
  context: BoundaryRenderContext,
  render: () => T,
): T {
  boundaryContextStack.push(context);
  try {
    return boundaryAsyncStorage.run(context, render);
  } catch (error) {
    throw error;
  } finally {
    boundaryContextStack.pop();
  }
}

export function __ManduClientBoundary({
  routeId,
  boundaryId,
  module,
  exportName,
  props = {},
  hydrate = "visible",
  src,
}: ManduClientBoundaryProps): React.ReactElement {
  const fallbackContext = getCurrentBoundaryContext();
  return React.createElement(
    BoundaryReactContext.Consumer,
    {
      children: (reactContext: BoundaryRenderContext | undefined) =>
        renderClientBoundaryElement({
          routeId,
          boundaryId,
          module,
          exportName,
          props,
          hydrate,
          src,
        }, reactContext ?? fallbackContext),
    },
  );
}

function renderClientBoundaryElement(
  {
    routeId,
    boundaryId,
    module,
    exportName,
    props = {},
    hydrate = "visible",
    src,
  }: ManduClientBoundaryProps,
  context: BoundaryRenderContext | undefined,
): React.ReactElement {
  assertSerializableBoundaryProps({ routeId, boundaryId, module, exportName, props });
  const serializedProps = serializeProps(props);
  const priority = hydrate === "load" ? "immediate" : hydrate;
  const resolvedSrc = src ?? resolveBoundarySrc(context, routeId, boundaryId);
  const instanceId = nextBoundaryInstanceId(context, boundaryId);

  return React.createElement(
    React.Fragment,
    null,
    React.createElement("div", {
      "data-mandu-island": instanceId,
      "data-mandu-boundary-id": boundaryId,
      "data-mandu-route-id": routeId,
      "data-mandu-src": resolvedSrc,
      "data-mandu-priority": priority,
      "data-hydrate": hydrate,
      "data-mandu-client-module": module,
      "data-mandu-client-export": exportName,
      style: { display: "contents" },
    }),
    React.createElement("script", {
      type: "application/json",
      "data-mandu-props": instanceId,
      dangerouslySetInnerHTML: {
        __html: escapeJsonForInlineScript(serializedProps),
      },
    }),
  );
}

function assertSerializableBoundaryProps({
  routeId,
  boundaryId,
  module,
  exportName,
  props,
}: Required<Pick<ManduClientBoundaryProps, "routeId" | "boundaryId" | "module" | "exportName" | "props">>): void {
  const reason = findNonSerializableBoundaryValue(props, "$", new WeakSet<object>());
  if (!reason) return;

  throw new Error(
    `[MANDU_BOUNDARY_UNSERIALIZABLE_PROP] Client boundary props are not serializable for route "${routeId}", boundary "${boundaryId}" (${module}#${exportName}): ${reason}. ` +
    "Pass plain serializable data, or construct functions, React elements, symbols, promises, and class instances inside the client component.",
  );
}

function findNonSerializableBoundaryValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): string | null {
  if (value === null || value === undefined) return null;

  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean" || valueType === "bigint") {
    return null;
  }

  if (valueType === "function") {
    return `${path} is a function`;
  }

  if (valueType === "symbol") {
    return `${path} is a symbol`;
  }

  if (valueType !== "object") {
    return `${path} has unsupported type "${valueType}"`;
  }

  if (React.isValidElement(value)) {
    return `${path} is a React element`;
  }

  if (value instanceof Date || value instanceof URL || value instanceof RegExp || value instanceof Error) {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  if (value instanceof Promise) {
    return `${path} is a Promise`;
  }

  if (value instanceof Map) {
    let index = 0;
    for (const [key, entryValue] of value.entries()) {
      const keyReason = findNonSerializableBoundaryValue(key, `${path}.<map-key:${index}>`, seen);
      if (keyReason) return keyReason;
      const valueReason = findNonSerializableBoundaryValue(entryValue, `${path}.<map-value:${index}>`, seen);
      if (valueReason) return valueReason;
      index++;
    }
    return null;
  }

  if (value instanceof Set) {
    let index = 0;
    for (const entryValue of value.values()) {
      const reason = findNonSerializableBoundaryValue(entryValue, `${path}.<set:${index}>`, seen);
      if (reason) return reason;
      index++;
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const reason = findNonSerializableBoundaryValue(value[index], `${path}[${index}]`, seen);
      if (reason) return reason;
    }
    return null;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    const name = prototype?.constructor?.name ?? "unknown";
    return `${path} is a ${name} instance`;
  }

  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    const reason = findNonSerializableBoundaryValue(entryValue, `${path}.${key}`, seen);
    if (reason) return reason;
  }

  return null;
}

function nextBoundaryInstanceId(context: BoundaryRenderContext | undefined, boundaryId: string): string {
  if (!context) return boundaryId;

  const count = context.instanceCounts.get(boundaryId) ?? 0;
  context.instanceCounts.set(boundaryId, count + 1);
  return count === 0 ? boundaryId : `${boundaryId}--${count}`;
}

function resolveBoundarySrc(
  context: BoundaryRenderContext | undefined,
  routeId: string,
  boundaryId: string,
): string | undefined {
  const manifest = context?.bundleManifest;
  if (!manifest) return undefined;

  const boundary = manifest.boundaries?.[boundaryId];
  if (boundary?.js) return cacheBust(boundary.js);

  const effectiveRouteId = routeId || context?.routeId;
  const routeBundle = effectiveRouteId ? manifest.bundles[effectiveRouteId] : undefined;
  return routeBundle?.js ? cacheBust(routeBundle.js) : undefined;
}

function cacheBust(src: string): string {
  return `${src}${src.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

function getCurrentBoundaryContext(): BoundaryRenderContext | undefined {
  return boundaryAsyncStorage.getStore() ?? boundaryContextStack[boundaryContextStack.length - 1];
}
