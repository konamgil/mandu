/**
 * Mandu Hydration Runtime 🌊
 * v0.8.0: Dynamic Import 기반 아키텍처
 *
 * 이 파일은 타입 정의와 유틸리티 함수를 제공합니다.
 * 실제 Hydration Runtime은 bundler/build.ts의 generateRuntimeSource()에서 생성됩니다.
 */

import type { Root } from "react-dom/client";

/**
 * Window 전역 타입 확장
 */
declare global {
  interface Window {
    /** Hydrated React roots (unmount용) */
    __MANDU_ROOTS__: Map<string, Root>;
    /** 서버 데이터 */
    __MANDU_DATA__?: Record<string, { serverData: unknown; timestamp: number }>;
    /** 직렬화된 서버 데이터 (raw JSON) */
    __MANDU_DATA_RAW__?: string;
  }
}

/**
 * Hydration 상태 추적
 */
export interface HydrationState {
  total: number;
  hydrated: number;
  failed: number;
  pending: Set<string>;
}

/**
 * Hydration 우선순위
 */
export type HydrationPriority = "immediate" | "visible" | "idle" | "interaction";

/**
 * 서버 데이터 가져오기
 */
export function getServerData<T = unknown>(islandId: string): T | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const manduData = window.__MANDU_DATA__;
  if (!manduData) {
    return undefined;
  }

  return manduData[islandId]?.serverData as T;
}

/**
 * Hydration 상태 조회 (DOM 기반)
 */
export function getHydrationState(): Readonly<HydrationState> {
  if (typeof document === "undefined") {
    return { total: 0, hydrated: 0, failed: 0, pending: new Set() };
  }

  const islands = document.querySelectorAll<HTMLElement>("[data-mandu-island]");
  const hydrated = document.querySelectorAll<HTMLElement>("[data-mandu-hydrated]");
  const failed = document.querySelectorAll<HTMLElement>("[data-mandu-error]");

  const pending = new Set<string>();
  islands.forEach((el) => {
    const id = el.getAttribute("data-mandu-island");
    if (id && !el.hasAttribute("data-mandu-hydrated") && !el.hasAttribute("data-mandu-error")) {
      pending.add(id);
    }
  });

  return {
    total: islands.length,
    hydrated: hydrated.length,
    failed: failed.length,
    pending,
  };
}

/**
 * 특정 Island unmount
 */
export function unmountIsland(id: string): boolean {
  if (typeof window === "undefined" || !window.__MANDU_ROOTS__) {
    return false;
  }

  const root = window.__MANDU_ROOTS__.get(id);
  if (!root) {
    return false;
  }

  root.unmount();
  window.__MANDU_ROOTS__.delete(id);
  return true;
}

/**
 * 모든 Island unmount
 */
export function unmountAllIslands(): void {
  if (typeof window === "undefined" || !window.__MANDU_ROOTS__) {
    return;
  }

  for (const [id, root] of window.__MANDU_ROOTS__) {
    root.unmount();
    window.__MANDU_ROOTS__.delete(id);
  }
}
