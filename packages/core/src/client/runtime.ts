/**
 * Mandu Hydration Runtime 🌊
 * 브라우저에서 Island를 hydrate하는 런타임
 */

import { hydrateRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { CompiledIsland } from "./island";
import type { ReactNode } from "react";
import React from "react";

/**
 * Island 로더 타입
 */
export type IslandLoader = () => Promise<CompiledIsland<any, any>> | CompiledIsland<any, any>;

/**
 * Island 레지스트리
 */
const islandRegistry = new Map<string, IslandLoader>();

/**
 * Hydrated roots 추적
 */
const hydratedRoots = new Map<string, Root>();

/**
 * Hydration 상태 추적
 */
interface HydrationState {
  total: number;
  hydrated: number;
  failed: number;
  pending: Set<string>;
}

const hydrationState: HydrationState = {
  total: 0,
  hydrated: 0,
  failed: 0,
  pending: new Set(),
};

/**
 * Island 등록
 */
export function registerIsland(id: string, loader: IslandLoader): void {
  islandRegistry.set(id, loader);
}

/**
 * 등록된 모든 Island 가져오기
 */
export function getRegisteredIslands(): string[] {
  return Array.from(islandRegistry.keys());
}

/**
 * 서버 데이터 가져오기
 */
export function getServerData<T = unknown>(islandId: string): T | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const manduData = (window as any).__MANDU_DATA__;
  if (!manduData) {
    return undefined;
  }

  return manduData[islandId]?.serverData as T;
}

/**
 * Priority-based hydration 스케줄러
 */
type HydrationPriority = "immediate" | "visible" | "idle" | "interaction";

function scheduleHydration(
  element: HTMLElement,
  id: string,
  priority: HydrationPriority,
  serverData: unknown
): void {
  switch (priority) {
    case "immediate":
      hydrateIsland(element, id, serverData);
      break;

    case "visible":
      if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(
          (entries) => {
            if (entries[0].isIntersecting) {
              observer.disconnect();
              hydrateIsland(element, id, serverData);
            }
          },
          { rootMargin: "50px" }
        );
        observer.observe(element);
      } else {
        // Fallback for older browsers
        hydrateIsland(element, id, serverData);
      }
      break;

    case "idle":
      if ("requestIdleCallback" in window) {
        (window as any).requestIdleCallback(() => {
          hydrateIsland(element, id, serverData);
        });
      } else {
        // Fallback
        setTimeout(() => hydrateIsland(element, id, serverData), 200);
      }
      break;

    case "interaction": {
      const hydrate = () => {
        element.removeEventListener("mouseenter", hydrate);
        element.removeEventListener("focusin", hydrate);
        element.removeEventListener("touchstart", hydrate);
        hydrateIsland(element, id, serverData);
      };
      element.addEventListener("mouseenter", hydrate, { once: true, passive: true });
      element.addEventListener("focusin", hydrate, { once: true });
      element.addEventListener("touchstart", hydrate, { once: true, passive: true });
      break;
    }
  }
}

/**
 * 단일 Island hydrate
 */
async function hydrateIsland(
  element: HTMLElement,
  id: string,
  serverData: unknown
): Promise<void> {
  const loader = islandRegistry.get(id);
  if (!loader) {
    console.warn(`[Mandu] Island not registered: ${id}`);
    hydrationState.failed++;
    hydrationState.pending.delete(id);
    return;
  }

  try {
    // 로더 실행 (dynamic import 또는 직접 참조)
    const island = await Promise.resolve(loader());

    if (!island.__mandu_island) {
      throw new Error(`[Mandu] Invalid island: ${id}`);
    }

    const { definition } = island;

    // Island 컴포넌트 생성
    function IslandComponent(): ReactNode {
      const setupResult = definition.setup(serverData);
      return definition.render(setupResult);
    }

    // ErrorBoundary가 있으면 감싸기
    let content: ReactNode;
    if (definition.errorBoundary) {
      content = React.createElement(
        ManduErrorBoundary,
        {
          fallback: (error: Error, reset: () => void) => definition.errorBoundary!(error, reset),
        },
        React.createElement(IslandComponent)
      );
    } else {
      content = React.createElement(IslandComponent);
    }

    // Hydrate
    const root = hydrateRoot(element, content);
    hydratedRoots.set(id, root);

    // 상태 업데이트
    element.setAttribute("data-mandu-hydrated", "true");
    hydrationState.hydrated++;
    hydrationState.pending.delete(id);

    // 성능 마커
    if (typeof performance !== "undefined" && performance.mark) {
      performance.mark(`mandu-hydrated-${id}`);
    }

    // Hydration 완료 이벤트
    element.dispatchEvent(
      new CustomEvent("mandu:hydrated", {
        bubbles: true,
        detail: { id, serverData },
      })
    );
  } catch (error) {
    console.error(`[Mandu] Hydration failed for island ${id}:`, error);
    hydrationState.failed++;
    hydrationState.pending.delete(id);

    // 에러 상태 표시
    element.setAttribute("data-mandu-error", "true");

    // 에러 이벤트
    element.dispatchEvent(
      new CustomEvent("mandu:hydration-error", {
        bubbles: true,
        detail: { id, error },
      })
    );
  }
}

/**
 * 모든 Island hydrate 시작
 */
export async function hydrateIslands(): Promise<void> {
  if (typeof document === "undefined") {
    return;
  }

  const islands = document.querySelectorAll<HTMLElement>("[data-mandu-island]");
  const manduData = (window as any).__MANDU_DATA__ || {};

  hydrationState.total = islands.length;

  for (const element of islands) {
    const id = element.getAttribute("data-mandu-island");
    if (!id) continue;

    const priority = (element.getAttribute("data-mandu-priority") || "visible") as HydrationPriority;
    const data = manduData[id]?.serverData || {};

    hydrationState.pending.add(id);
    scheduleHydration(element, id, priority, data);
  }
}

/**
 * Hydration 상태 조회
 */
export function getHydrationState(): Readonly<HydrationState> {
  return { ...hydrationState };
}

/**
 * 특정 Island unmount
 */
export function unmountIsland(id: string): boolean {
  const root = hydratedRoots.get(id);
  if (!root) {
    return false;
  }

  root.unmount();
  hydratedRoots.delete(id);
  return true;
}

/**
 * 모든 Island unmount
 */
export function unmountAllIslands(): void {
  for (const [id, root] of hydratedRoots) {
    root.unmount();
    hydratedRoots.delete(id);
  }
}

/**
 * 간단한 ErrorBoundary 컴포넌트
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ManduErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[Mandu] Island error:", error, errorInfo);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }
    return this.props.children;
  }
}

/**
 * 자동 초기화 (스크립트 로드 시)
 */
export function initializeRuntime(): void {
  if (typeof document === "undefined") {
    return;
  }

  // DOM이 준비되면 hydration 시작
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      hydrateIslands();
    });
  } else {
    // 이미 DOM이 준비된 경우
    hydrateIslands();
  }
}

// 자동 초기화 여부 (번들 시 설정)
if (typeof window !== "undefined" && (window as any).__MANDU_AUTO_INIT__ !== false) {
  initializeRuntime();
}
