import React, { Component, useEffect, useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { deserializeProps } from "./props-serialization";

const DEFAULT_HYDRATION_PRIORITY = "visible";

interface ManduDataRecord {
  serverData: unknown;
  timestamp?: number;
}

interface ManduIslandDefinition {
  setup(serverData: Record<string, unknown>): Record<string, unknown>;
  render(props: Record<string, unknown>): ReactNode;
  errorBoundary?: (error: Error | null, reset: () => void) => ReactNode;
  loading?: () => ReactNode;
}

interface ManduIslandModule {
  default?: unknown;
  [key: string]: unknown;
}

interface ManduIslandExport {
  __mandu_island: true;
  definition: ManduIslandDefinition;
}

interface RuntimeDevtoolsHook {
  emit(event: unknown): void;
}

type ManduDataStore = Record<string, ManduDataRecord>;

const hydratedRoots = window.__MANDU_ROOTS__ ?? (window.__MANDU_ROOTS__ = new Map<string, Root>());
const warnedBoundaryPropFallbacks = new Set<string>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readManduData(): ManduDataStore {
  if (window.__MANDU_DATA__) return window.__MANDU_DATA__ as ManduDataStore;

  const raw = window.__MANDU_DATA_RAW__ || document.getElementById("__MANDU_DATA__")?.textContent;
  if (!raw) {
    window.__MANDU_DATA__ = {};
    return window.__MANDU_DATA__ as ManduDataStore;
  }

  try {
    window.__MANDU_DATA__ = deserializeProps(raw) as ManduDataStore;
  } catch (error) {
    console.warn("[Mandu] Failed to parse server data:", error);
    window.__MANDU_DATA__ = {};
  }

  return window.__MANDU_DATA__ as ManduDataStore;
}

const getServerData = (id: string, element: Element | null): Record<string, unknown> => {
  const data = readManduData();
  if (data[id] && Object.prototype.hasOwnProperty.call(data[id], "serverData")) {
    return asRecord(data[id].serverData);
  }
  const routeId = element?.getAttribute?.("data-mandu-route-id");
  if (
    routeId &&
    data[routeId] &&
    Object.prototype.hasOwnProperty.call(data[routeId], "serverData")
  ) {
    return asRecord(data[routeId].serverData);
  }
  return {};
};

function findPropsScript(id: string): HTMLScriptElement | null {
  const scripts = document.querySelectorAll("script[data-mandu-props]");
  for (const script of scripts) {
    if (script.getAttribute("data-mandu-props") === id) {
      return script as HTMLScriptElement;
    }
  }
  return null;
}

function parsePropsScript(id: string): Record<string, unknown> | null {
  const script = findPropsScript(id);
  if (!script || !script.textContent) return null;
  try {
    return deserializeProps(script.textContent);
  } catch (error) {
    console.warn("[Mandu] Failed to parse data-mandu-props for island " + id + ":", error);
    return null;
  }
}

function readDataProps(element: Element): Record<string, unknown> | null {
  const propsEl = element.hasAttribute("data-props")
    ? element
    : element.querySelector("[data-props]");
  if (!propsEl) return null;
  try {
    return deserializeProps(propsEl.getAttribute("data-props") || "{}");
  } catch (error) {
    console.warn("[Mandu] Failed to parse data-props fallback:", error);
    return null;
  }
}

function getIslandProps(id: string, element: Element): Record<string, unknown> {
  const inlineProps = parsePropsScript(id);
  if (inlineProps) return inlineProps;

  const dataProps = readDataProps(element);
  if (dataProps) return dataProps;

  const boundaryId = element?.getAttribute?.("data-mandu-boundary-id");
  if (boundaryId && !warnedBoundaryPropFallbacks.has(id)) {
    warnedBoundaryPropFallbacks.add(id);
    console.warn(
      "[Mandu] Missing boundary-local props for transformed client boundary " +
      boundaryId +
      "; falling back to route server data.",
    );
  }

  return getServerData(id, element);
}

function resolveIslandExport(module: ManduIslandModule, element: Element): unknown {
  const exportName = element.getAttribute("data-mandu-client-export");
  if (exportName) {
    if (exportName === "default" && module.default) return module.default;
    if (exportName !== "default" && module[exportName]) return module[exportName];
    console.warn('[Mandu] Client boundary export "' + exportName + '" was not found; falling back to default export.');
  }
  return module.default;
}

interface IslandErrorBoundaryProps {
  islandId: string;
  errorBoundary?: (error: Error | null, reset: () => void) => ReactNode;
  children: ReactNode;
}

interface IslandErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class IslandErrorBoundary extends Component<IslandErrorBoundaryProps, IslandErrorBoundaryState> {
  state: IslandErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): IslandErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: unknown): void {
    console.error("[Mandu] Island error:", this.props.islandId, error, errorInfo);
    emitIslandHydrationError(this.props.islandId, error);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.errorBoundary) {
        return this.props.errorBoundary(this.state.error, this.reset);
      }
      return React.createElement("div", {
        className: "mandu-island-error",
        style: {
          padding: "16px",
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: "8px",
          color: "#dc2626",
        },
      }, [
        React.createElement("strong", { key: "title" }, "Hydration error"),
        React.createElement("p", { key: "msg", style: { margin: "8px 0", fontSize: "14px" } },
          this.state.error?.message || "Unknown error",
        ),
        React.createElement("button", {
          key: "btn",
          onClick: this.reset,
          style: {
            padding: "6px 12px",
            background: "#dc2626",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          },
        }, "Retry"),
      ]);
    }
    return this.props.children;
  }
}

function IslandLoadingWrapper({
  children,
  loading,
  isReady,
}: {
  children: ReactNode;
  loading?: () => ReactNode;
  isReady: boolean;
}): ReactNode {
  if (!isReady && loading) {
    return loading();
  }
  return children;
}

function resolveHydrationTarget(element: Element): Element {
  if (!(element instanceof HTMLElement)) {
    return element;
  }

  if (getComputedStyle(element).display !== "contents") {
    return element;
  }

  const queue = Array.from(element.children);
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (candidate instanceof HTMLElement) {
      return candidate;
    }
    if (candidate) {
      queue.push(...candidate.children);
    }
  }

  return element.parentElement || element;
}

function hasHydratableMarkup(element: Element): boolean {
  for (const node of element.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      return true;
    }

    if (node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim() !== "") {
      return true;
    }
  }

  return false;
}

function shouldHydrateCompiledIsland(element: Element): boolean {
  return (
    element.getAttribute("data-mandu-loading") !== "true" &&
    hasHydratableMarkup(element)
  );
}

function createHydrationOptions(element: Element, id: string, mode: string) {
  return {
    onRecoverableError(error: unknown): void {
      element.setAttribute("data-mandu-recoverable-error", "true");
      console.warn("[Mandu] Recoverable hydration error:", id, mode, error);
      element.dispatchEvent(new CustomEvent("mandu:recoverable-hydration-error", {
        bubbles: true,
        detail: {
          id,
          mode,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    },
  };
}

function priorityToHydrateStrategy(priority: string): string {
  return priority === "immediate" ? "load" : priority;
}

function scheduleHydration(element: HTMLElement, src: string, strategy: string): void {
  let nextStrategy = strategy || "load";
  if (nextStrategy === "immediate") nextStrategy = "load";

  if (nextStrategy.startsWith("media(") && nextStrategy.endsWith(")")) {
    const query = nextStrategy.slice("media(".length, -1).trim();
    if (!query || !window.matchMedia) {
      void loadAndHydrate(element, src);
      return;
    }
    const mql = window.matchMedia(query);
    if (mql.matches) {
      void loadAndHydrate(element, src);
      return;
    }
    const onChange = (event: MediaQueryListEvent): void => {
      if (!event.matches) return;
      if (mql.removeEventListener) {
        mql.removeEventListener("change", onChange);
      } else {
        mql.removeListener(onChange);
      }
      void loadAndHydrate(element, src);
    };
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
    } else {
      mql.addListener(onChange);
    }
    return;
  }

  switch (nextStrategy) {
    case "load":
    case "immediate":
      void loadAndHydrate(element, src);
      break;

    case "visible":
      if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver((entries) => {
          if (entries[0]?.isIntersecting) {
            observer.disconnect();
            void loadAndHydrate(element, src);
          }
        }, { rootMargin: "200px" });
        const target = resolveHydrationTarget(element);
        observer.observe(target);
      } else {
        void loadAndHydrate(element, src);
      }
      break;

    case "idle":
      if ("requestIdleCallback" in window) {
        requestIdleCallback(() => void loadAndHydrate(element, src));
      } else {
        setTimeout(() => void loadAndHydrate(element, src), 200);
      }
      break;

    case "interaction": {
      const target = resolveHydrationTarget(element);
      const hydrate = (): void => {
        target.removeEventListener("touchstart", hydrate);
        target.removeEventListener("click", hydrate);
        target.removeEventListener("keydown", hydrate);
        void loadAndHydrate(element, src);
      };
      target.addEventListener("touchstart", hydrate, { once: true, passive: true });
      target.addEventListener("click", hydrate, { once: true });
      target.addEventListener("keydown", hydrate, { once: true });
      break;
    }

    default:
      console.warn('[Mandu] Unknown hydrate strategy "' + nextStrategy + '", falling back to load.');
      void loadAndHydrate(element, src);
  }
}

function isManduIslandExport(value: unknown): value is ManduIslandExport {
  return !!value &&
    (typeof value === "object" || typeof value === "function") &&
    (value as { __mandu_island?: unknown }).__mandu_island === true &&
    "definition" in value;
}

// #324: surface island hydration/render failures to the in-page DevTools so
// its health badge and Issues counter reflect them instead of staying
// "HEALTHY". Render-time errors are swallowed by IslandErrorBoundary and never
// reach the global error listener, so we emit them to the devtools hook here.
function emitIslandHydrationError(islandId: string, error: unknown): void {
  const devtoolsHook = (window as Window & {
    __MANDU_DEVTOOLS_HOOK__?: RuntimeDevtoolsHook;
  }).__MANDU_DEVTOOLS_HOOK__;
  if (!devtoolsHook) return;
  try {
    devtoolsHook.emit({
      type: "error",
      timestamp: Date.now(),
      data: {
        id: "island-" + islandId + "-" + Date.now(),
        type: "runtime",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: Date.now(),
        url: location.href,
        islandId,
      },
    });
  } catch {
    // DevTools must never break hydration.
  }
}

async function loadAndHydrate(element: HTMLElement, src: string): Promise<void> {
  const id = element.getAttribute("data-mandu-island");
  if (!id) {
    return;
  }
  const islandId = id;

  if (
    hydratedRoots.has(islandId) ||
    element.hasAttribute("data-mandu-hydrated") ||
    element.getAttribute("data-mandu-hydrating") === "true"
  ) {
    return;
  }

  element.setAttribute("data-mandu-hydrating", "true");

  try {
    const module = await import(src) as ManduIslandModule;
    const island = resolveIslandExport(module, element);
    const data = getIslandProps(islandId, element);

    if (isManduIslandExport(island)) {
      const { definition } = island;
      const shouldHydrate = shouldHydrateCompiledIsland(element);
      const renderMode = shouldHydrate ? "hydrate" : "mount";

      function IslandComponent({ initialReady }: { initialReady: boolean }): ReactNode {
        const [isReady, setIsReady] = useState(initialReady);

        useEffect(() => {
          setIsReady(true);
        }, []);

        const setupResult = definition.setup(data);
        const content = definition.render(setupResult);
        const wrappedContent = definition.loading
          ? React.createElement(IslandLoadingWrapper, {
              loading: definition.loading,
              isReady,
              children: content,
            })
          : content;

        return React.createElement(IslandErrorBoundary, {
          islandId,
          errorBoundary: definition.errorBoundary,
          children: wrappedContent,
        });
      }

      const root = shouldHydrate
        ? hydrateRoot(
            element,
            React.createElement(IslandComponent, { initialReady: true }),
            createHydrationOptions(element, islandId, renderMode),
          )
        : createRoot(element);

      if (!shouldHydrate) {
        root.render(React.createElement(IslandComponent, { initialReady: false }));
      }

      markHydrated(element, islandId, data, root, renderMode);

      const devtoolsHook = (window as Window & {
        __MANDU_DEVTOOLS_HOOK__?: RuntimeDevtoolsHook;
      }).__MANDU_DEVTOOLS_HOOK__;
      if (devtoolsHook) {
        const hydrateTime = performance.now ? performance.now() : Date.now();
        devtoolsHook.emit({
          type: "island:register",
          timestamp: Date.now(),
          data: {
            id: islandId,
            name: islandId,
            strategy: element.getAttribute("data-mandu-priority") || DEFAULT_HYDRATION_PRIORITY,
            status: "hydrated",
            renderMode,
            hydrateStartTime: hydrateTime - 10,
            hydrateEndTime: hydrateTime,
            propsSize: JSON.stringify(data).length,
          },
        });
      }

      console.log("[Mandu] Hydrated:", islandId, "(" + renderMode + ")");
    } else if (typeof island === "function" || React.isValidElement(island)) {
      console.warn("[Mandu] Plain component hydration:", islandId);
      const shouldHydrate = hasHydratableMarkup(element);
      const renderMode = shouldHydrate ? "hydrate" : "mount";
      const ComponentOrElement = island as React.ComponentType<Record<string, unknown>> | React.ReactElement;

      const root = shouldHydrate
        ? (typeof ComponentOrElement === "function"
            ? hydrateRoot(
                element,
                React.createElement(ComponentOrElement, data),
                createHydrationOptions(element, islandId, renderMode),
              )
            : hydrateRoot(element, ComponentOrElement, createHydrationOptions(element, islandId, renderMode)))
        : createRoot(element);

      if (!shouldHydrate) {
        root.render(
          typeof ComponentOrElement === "function"
            ? React.createElement(ComponentOrElement, data)
            : ComponentOrElement,
        );
      }

      markHydrated(element, islandId, data, root, renderMode);
      console.log("[Mandu] Plain component hydrated:", islandId, "(" + renderMode + ")");
    } else {
      throw new Error("[Mandu] Invalid module: expected Mandu island or React component: " + islandId);
    }
  } catch (error) {
    console.error("[Mandu] Hydration failed for", islandId, error);
    element.setAttribute("data-mandu-error", "true");
    emitIslandHydrationError(islandId, error);

    element.dispatchEvent(new CustomEvent("mandu:hydration-error", {
      bubbles: true,
      detail: { id: islandId, error: error instanceof Error ? error.message : String(error) },
    }));
  } finally {
    element.removeAttribute("data-mandu-hydrating");
  }
}

function markHydrated(
  element: HTMLElement,
  id: string,
  data: Record<string, unknown>,
  root: Root,
  renderMode: string,
): void {
  hydratedRoots.set(id, root);
  element.setAttribute("data-mandu-render-mode", renderMode);
  element.setAttribute("data-mandu-hydrated", "true");

  if (performance.mark) {
    performance.mark("mandu-hydrated-" + id);
  }

  element.dispatchEvent(new CustomEvent("mandu:hydrated", {
    bubbles: true,
    detail: { id, data, mode: renderMode },
  }));
}

function hydrateIslands(): void {
  const islands = document.querySelectorAll("[data-mandu-island]");
  const seenIds = new Set<string>();

  for (const el of islands) {
    if (!(el instanceof HTMLElement)) continue;

    const id = el.getAttribute("data-mandu-island");
    const src = el.getAttribute("data-mandu-src");
    const priority = el.getAttribute("data-mandu-priority") || DEFAULT_HYDRATION_PRIORITY;
    const hydrateStrategy = el.getAttribute("data-hydrate") || priorityToHydrateStrategy(priority);

    if (!id || !src) {
      console.warn("[Mandu] Island missing id or src:", el);
      continue;
    }

    if (seenIds.has(id)) {
      console.warn("[Mandu] Duplicate island id detected:", id, "- skipping");
      continue;
    }
    seenIds.add(id);

    scheduleHydration(el, src, hydrateStrategy);
  }
}

function unmountIsland(id: string): boolean {
  const root = hydratedRoots.get(id);
  if (root) {
    root.unmount();
    hydratedRoots.delete(id);
    return true;
  }
  return false;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", hydrateIslands);
} else {
  hydrateIslands();
}

export { hydrateIslands, hydratedRoots, unmountIsland };
