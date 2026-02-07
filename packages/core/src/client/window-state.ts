/**
 * 타입 안전 전역 상태 접근자
 * window 객체 직접 접근 대신 이 모듈의 함수 사용
 */
import type { Root } from "react-dom/client";
import type { RouterState } from "./router";

// ============================================
// 환경 체크
// ============================================

export function isBrowser(): boolean {
  return typeof window !== "undefined";
}

// ============================================
// Router State
// ============================================

export function getRouterState(): RouterState | undefined {
  if (!isBrowser()) return undefined;
  return window.__MANDU_ROUTER_STATE__;
}

export function setRouterState(state: RouterState): void {
  if (!isBrowser()) return;
  window.__MANDU_ROUTER_STATE__ = state;
}

export function getRouterListeners(): Set<(state: RouterState) => void> {
  if (!isBrowser()) return new Set();

  if (!window.__MANDU_ROUTER_LISTENERS__) {
    window.__MANDU_ROUTER_LISTENERS__ = new Set();
  }
  return window.__MANDU_ROUTER_LISTENERS__;
}

// ============================================
// Route & Data
// ============================================

export function getManduRoute():
  | { id: string; pattern: string; params: Record<string, string> }
  | undefined {
  if (!isBrowser()) return undefined;
  return window.__MANDU_ROUTE__;
}

export function getManduData():
  | Record<string, { serverData: unknown; timestamp?: number }>
  | undefined {
  if (!isBrowser()) return undefined;
  return window.__MANDU_DATA__;
}

export function getManduDataRaw(): string | undefined {
  if (!isBrowser()) return undefined;
  return window.__MANDU_DATA_RAW__;
}

/**
 * 특정 라우트의 서버 데이터 조회 (타입 안전)
 */
export function getServerData<T>(routeId: string): T | undefined {
  const data = getManduData();
  return data?.[routeId]?.serverData as T | undefined;
}

/**
 * 서버 데이터 설정
 */
export function setServerData(routeId: string, data: unknown): void {
  if (!isBrowser()) return;

  if (!window.__MANDU_DATA__) {
    window.__MANDU_DATA__ = {};
  }
  window.__MANDU_DATA__[routeId] = { serverData: data };
}

// ============================================
// Hydration Roots
// ============================================

export function getHydratedRoots(): Map<string, Root> {
  if (!isBrowser()) return new Map();

  if (!window.__MANDU_ROOTS__) {
    window.__MANDU_ROOTS__ = new Map();
  }
  return window.__MANDU_ROOTS__;
}

export function setHydratedRoot(id: string, root: Root): void {
  getHydratedRoots().set(id, root);
}

export function removeHydratedRoot(id: string): boolean {
  return getHydratedRoots().delete(id);
}
