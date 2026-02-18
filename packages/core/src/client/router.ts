/**
 * Mandu Client-side Router 🧭
 * SPA 스타일 네비게이션을 위한 클라이언트 라우터
 */

import type { ReactNode } from "react";
import {
  getManduData,
  getManduRoute,
  getRouterListeners,
  getRouterState as getWindowRouterState,
  setRouterState as setWindowRouterState,
  setServerData,
} from "./window-state";
import { LRUCache } from "../utils/lru-cache";
import { LIMITS } from "../constants";

// ========== Types ==========

export interface RouteInfo {
  id: string;
  pattern: string;
  params: Record<string, string>;
}

export interface NavigationState {
  state: "idle" | "loading";
  location?: string;
}

export interface RouterState {
  currentRoute: RouteInfo | null;
  loaderData: unknown;
  navigation: NavigationState;
}

export interface NavigateOptions {
  /** history.replaceState 사용 여부 */
  replace?: boolean;
  /** 스크롤 위치 복원 여부 */
  scroll?: boolean;
}

type RouterListener = (state: RouterState) => void;

function getGlobalRouterState(): RouterState {
  if (typeof window === "undefined") {
    return { currentRoute: null, loaderData: undefined, navigation: { state: "idle" } };
  }
  if (!getWindowRouterState()) {
    // SSR에서 주입된 __MANDU_ROUTE__에서 초기화
    const route = getManduRoute();
    const data = getManduData();

    setWindowRouterState({
      currentRoute: route
        ? {
            id: route.id,
            pattern: route.pattern,
            params: route.params || {},
          }
        : null,
      loaderData: route && data?.[route.id]?.serverData,
      navigation: { state: "idle" },
    });
  }
  return getWindowRouterState()!;
}

function setGlobalRouterState(state: RouterState): void {
  if (typeof window !== "undefined") {
    setWindowRouterState(state);
  }
}

function getGlobalListeners(): Set<RouterListener> {
  return getRouterListeners();
}

// Getter for routerState (전역 상태 참조)
const getRouterStateInternal = () => getGlobalRouterState();
const setRouterStateInternal = (state: RouterState) => setGlobalRouterState(state);
const listeners = { get current() { return getGlobalListeners(); } };

/**
 * 초기화: 서버에서 전달된 라우트 정보로 상태 설정
 */
function initializeFromServer(): void {
  if (typeof window === "undefined") return;

  const route = getManduRoute();
  const data = getManduData();

  if (route) {
    // URL에서 실제 params 추출
    const params = extractParamsFromPath(route.pattern, window.location.pathname);

    setRouterStateInternal({
      currentRoute: {
        id: route.id,
        pattern: route.pattern,
        params,
      },
      loaderData: data?.[route.id]?.serverData,
      navigation: { state: "idle" },
    });
  }
}

// ========== Pattern Matching ==========

interface CompiledPattern {
  regex: RegExp;
  paramNames: string[];
}

const patternCache = new LRUCache<string, CompiledPattern>(LIMITS.ROUTER_PATTERN_CACHE);

/**
 * 패턴을 정규식으로 컴파일
 */
function compilePattern(pattern: string): CompiledPattern {
  const cached = patternCache.get(pattern);
  if (cached) return cached;

  const paramNames: string[] = [];
  const PARAM_PLACEHOLDER = "\x00PARAM\x00";
  const paramMatches: string[] = [];

  const withPlaceholders = pattern.replace(
    /:([a-zA-Z_][a-zA-Z0-9_]*)/g,
    (_, paramName) => {
      paramMatches.push(paramName);
      return PARAM_PLACEHOLDER;
    }
  );

  const escaped = withPlaceholders.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

  let paramIndex = 0;
  const regexStr = escaped.replace(
    new RegExp(PARAM_PLACEHOLDER.replace(/\x00/g, "\\x00"), "g"),
    () => {
      paramNames.push(paramMatches[paramIndex++]);
      return "([^/]+)";
    }
  );

  const compiled = {
    regex: new RegExp(`^${regexStr}$`),
    paramNames,
  };

  patternCache.set(pattern, compiled);
  return compiled;
}

/**
 * 패턴에서 파라미터 추출
 */
function extractParamsFromPath(
  pattern: string,
  pathname: string
): Record<string, string> {
  const compiled = compilePattern(pattern);
  const match = pathname.match(compiled.regex);

  if (!match) return {};

  const params: Record<string, string> = {};
  compiled.paramNames.forEach((name, index) => {
    params[name] = match[index + 1];
  });

  return params;
}

// ========== Navigation ==========

/**
 * 페이지 네비게이션
 */
export async function navigate(
  to: string,
  options: NavigateOptions = {}
): Promise<void> {
  const { replace = false, scroll = true } = options;

  try {
    const url = new URL(to, window.location.origin);

    // 외부 URL은 일반 네비게이션
    if (url.origin !== window.location.origin) {
      window.location.href = to;
      return;
    }

    // 로딩 상태 시작
    setRouterStateInternal({
      ...getRouterStateInternal(),
      navigation: { state: "loading", location: to },
    });
    notifyListeners();

    // 데이터 fetch
    const dataUrl = `${url.pathname}${url.search ? url.search + "&" : "?"}_data=1`;
    const response = await fetch(dataUrl);

    if (!response.ok) {
      // 에러 시 full navigation fallback
      window.location.href = to;
      return;
    }

    const data = await response.json();

    // History 업데이트
    const historyState = { routeId: data.routeId, params: data.params };
    if (replace) {
      history.replaceState(historyState, "", to);
    } else {
      history.pushState(historyState, "", to);
    }

    // 상태 업데이트
    setRouterStateInternal({
      currentRoute: {
        id: data.routeId,
        pattern: data.pattern,
        params: data.params,
      },
      loaderData: data.loaderData,
      navigation: { state: "idle" },
    });

    // __MANDU_DATA__ 업데이트
    setServerData(data.routeId, data.loaderData);

    notifyListeners();

    // 스크롤 복원
    if (scroll) {
      window.scrollTo(0, 0);
    }
  } catch (error) {
    console.error("[Mandu Router] Navigation failed:", error);
    // 에러 시 full navigation fallback
    window.location.href = to;
  }
}

/**
 * 뒤로가기/앞으로가기 처리
 */
function handlePopState(event: PopStateEvent): void {
  const state = event.state;

  if (state?.routeId) {
    // Mandu로 방문한 페이지 - 데이터 다시 fetch
    navigate(window.location.pathname + window.location.search, {
      replace: true,
      scroll: false,
    });
  } else {
    // 직접 URL 입력 등으로 방문한 페이지 - 상태만 업데이트
    const route = getManduRoute();
    setGlobalRouterState({
      currentRoute: route ? {
        id: route.id,
        pattern: route.pattern,
        params: route.params || {},
      } : null,
      loaderData: getGlobalRouterState().loaderData,
      navigation: { state: "idle" },
    });
    notifyListeners();
  }
}

// ========== State Management ==========

/**
 * 리스너에게 상태 변경 알림
 */
function notifyListeners(): void {
  const state = getRouterStateInternal();
  for (const listener of listeners.current) {
    try {
      listener(state);
    } catch (error) {
      console.error("[Mandu Router] Listener error:", error);
    }
  }
}

/**
 * 상태 변경 구독
 */
export function subscribe(listener: RouterListener): () => void {
  listeners.current.add(listener);
  return () => listeners.current.delete(listener);
}

/**
 * 현재 라우터 상태 가져오기
 */
export function getRouterState(): RouterState {
  return getRouterStateInternal();
}

/**
 * 현재 라우트 정보 가져오기
 */
export function getCurrentRoute(): RouteInfo | null {
  return getRouterStateInternal().currentRoute;
}

/**
 * 현재 loader 데이터 가져오기
 */
export function getLoaderData<T = unknown>(): T | undefined {
  return getRouterStateInternal().loaderData as T | undefined;
}

/**
 * 네비게이션 상태 가져오기
 */
export function getNavigationState(): NavigationState {
  return getRouterStateInternal().navigation;
}

// ========== Link Click Handler ==========

/**
 * 링크 클릭 이벤트 핸들러 (이벤트 위임용)
 */
function handleLinkClick(event: MouseEvent): void {
  // 기본 동작 조건 체크
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey
  ) {
    return;
  }

  // 가장 가까운 앵커 태그 찾기
  const anchor = (event.target as HTMLElement).closest("a");
  if (!anchor) return;

  // data-mandu-link 속성이 있는 링크만 처리
  if (!anchor.hasAttribute("data-mandu-link")) return;

  const href = anchor.getAttribute("href");
  if (!href) return;

  // 외부 링크 체크
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;
  } catch {
    return;
  }

  // 기본 동작 방지 및 Client-side 네비게이션
  event.preventDefault();
  navigate(href);
}

// ========== Prefetch ==========

const prefetchedUrls = new LRUCache<string, true>(LIMITS.ROUTER_PREFETCH_CACHE);

/**
 * 페이지 데이터 미리 로드
 */
export async function prefetch(url: string): Promise<void> {
  if (prefetchedUrls.has(url)) return;

  try {
    const dataUrl = `${url}${url.includes("?") ? "&" : "?"}_data=1`;
    await fetch(dataUrl, { priority: "low" } as RequestInit);
    prefetchedUrls.set(url, true);
  } catch {
    // Prefetch 실패는 무시
  }
}

// ========== Initialization ==========

let initialized = false;

/**
 * 라우터 초기화
 */
export function initializeRouter(): void {
  if (typeof window === "undefined" || initialized) return;

  initialized = true;

  // 서버 데이터로 초기화
  initializeFromServer();

  // popstate 이벤트 리스너
  window.addEventListener("popstate", handlePopState);

  // 링크 클릭 이벤트 위임
  document.addEventListener("click", handleLinkClick);

  console.log("[Mandu Router] Initialized");
}

/**
 * 라우터 정리
 */
export function cleanupRouter(): void {
  if (typeof window === "undefined" || !initialized) return;

  window.removeEventListener("popstate", handlePopState);
  document.removeEventListener("click", handleLinkClick);
  listeners.current.clear();
  initialized = false;
}

// 자동 초기화 (DOM 준비 시)
if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeRouter);
  } else {
    initializeRouter();
  }
}
