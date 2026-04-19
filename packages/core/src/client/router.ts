/**
 * Mandu Client-side Router 🧭
 * SPA 스타일 네비게이션을 위한 클라이언트 라우터
 */

import type { ReactNode } from "react";
import { startTransition } from "react";
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
  state: "idle" | "loading" | "submitting";
  location?: string;
  formAction?: string;
}

export interface RouterState {
  currentRoute: RouteInfo | null;
  loaderData: unknown;
  actionData: unknown;
  navigation: NavigationState;
}

export interface ActionResult {
  ok: boolean;
  actionData?: unknown;
  loaderData?: unknown;
}

export interface NavigateOptions {
  /** history.replaceState 사용 여부 */
  replace?: boolean;
  /** 스크롤 위치 복원 여부 */
  scroll?: boolean;
  /** revalidation 스킵 (기존 loaderData 유지) */
  skipRevalidation?: boolean;
}

/**
 * shouldRevalidate 콜백 타입
 * false 반환 시 loader 재실행을 건너뜀
 */
export type ShouldRevalidateFunction = (args: {
  currentUrl: URL;
  nextUrl: URL;
  formAction?: string;
  defaultShouldRevalidate: boolean;
}) => boolean;

/** 글로벌 shouldRevalidate 핸들러 */
let globalShouldRevalidate: ShouldRevalidateFunction | null = null;

/**
 * shouldRevalidate 핸들러 등록
 *
 * @example
 * ```typescript
 * setShouldRevalidate(({ currentUrl, nextUrl }) => {
 *   // 같은 탭 내 이동이면 loader 재실행 안 함
 *   return currentUrl.pathname !== nextUrl.pathname;
 * });
 * ```
 */
export function setShouldRevalidate(fn: ShouldRevalidateFunction | null): void {
  globalShouldRevalidate = fn;
}

type RouterListener = (state: RouterState) => void;

function getGlobalRouterState(): RouterState {
  if (typeof window === "undefined") {
    return { currentRoute: null, loaderData: undefined, actionData: undefined, navigation: { state: "idle" } };
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
      actionData: undefined,
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
      actionData: undefined,
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

/** 현재 진행 중인 네비게이션의 AbortController (race condition 방지) */
let activeNavigationController: AbortController | null = null;

/**
 * 페이지 네비게이션
 */
export async function navigate(
  to: string,
  options: NavigateOptions = {}
): Promise<void> {
  const { replace = false, scroll = true, skipRevalidation = false } = options;

  // 이전 네비게이션이 진행 중이면 취소
  if (activeNavigationController) {
    activeNavigationController.abort();
    activeNavigationController = null;
  }

  const controller = new AbortController();
  activeNavigationController = controller;

  try {
    const url = new URL(to, window.location.origin);

    // 외부 URL은 일반 네비게이션
    if (url.origin !== window.location.origin) {
      window.location.href = to;
      return;
    }

    // shouldRevalidate 체크 — false면 fetch 없이 URL만 변경
    if (!skipRevalidation && globalShouldRevalidate) {
      const currentUrl = new URL(window.location.href);
      const shouldFetch = globalShouldRevalidate({
        currentUrl,
        nextUrl: url,
        defaultShouldRevalidate: true,
      });
      if (!shouldFetch) {
        const currentState = getRouterStateInternal();
        const nextRoute = currentState.currentRoute
          ? {
              ...currentState.currentRoute,
              params: extractParamsFromPath(currentState.currentRoute.pattern, url.pathname),
            }
          : null;
        const historyState = nextRoute
          ? { routeId: nextRoute.id, params: nextRoute.params }
          : null;
        if (replace) {
          history.replaceState(historyState, "", to);
        } else {
          history.pushState(historyState, "", to);
        }
        setRouterStateInternal({
          ...currentState,
          currentRoute: nextRoute,
          actionData: undefined,
          navigation: { state: "idle" },
        });
        notifyListeners();
        if (scroll) window.scrollTo(0, 0);
        return;
      }
    }

    // 로딩 상태 시작
    setRouterStateInternal({
      ...getRouterStateInternal(),
      navigation: { state: "loading", location: to },
    });
    notifyListeners();

    // 데이터 fetch (signal 연결로 취소 가능)
    const dataUrl = `${url.pathname}${url.search ? url.search + "&" : "?"}_data=1`;
    const response = await fetch(dataUrl, { signal: controller.signal });

    // 이 요청이 이미 abort된 경우 (새 네비게이션이 시작됨) 무시
    if (controller.signal.aborted) return;

    if (!response.ok) {
      // 에러 시 full navigation fallback
      window.location.href = to;
      return;
    }

    const data = await response.json();

    // json 파싱 사이에 새 네비게이션이 시작됐을 수 있음
    if (controller.signal.aborted) return;

    // 상태 + History + 스크롤을 한 번에 적용하는 함수
    const applyUpdate = () => {
      const historyState = { routeId: data.routeId, params: data.params };
      if (replace) {
        history.replaceState(historyState, "", to);
      } else {
        history.pushState(historyState, "", to);
      }

      setRouterStateInternal({
        currentRoute: {
          id: data.routeId,
          pattern: data.pattern,
          params: data.params,
        },
        loaderData: data.loaderData,
        actionData: undefined,
        navigation: { state: "idle" },
      });
      setServerData(data.routeId, data.loaderData);
      notifyListeners();
      if (scroll) window.scrollTo(0, 0);
    };

    // View Transitions API — 브라우저 지원 시 URL + DOM 전환을 동기화
    if (!replace && "startViewTransition" in document) {
      (document as any).startViewTransition(applyUpdate);
    } else {
      applyUpdate();
    }
  } catch (error) {
    // abort된 네비게이션은 조용히 무시 (새 네비게이션이 대체함)
    if (controller.signal.aborted) return;

    console.error("[Mandu Router] Navigation failed:", error);
    // 에러 시 full navigation fallback
    window.location.href = to;
  } finally {
    // 이 controller가 아직 active면 정리
    if (activeNavigationController === controller) {
      activeNavigationController = null;
    }
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
    // SPA 네비게이션 이력이 아닌 페이지 — 현재 라우터 상태 유지
    // (getManduRoute()는 SSR 초기값이라 SPA 네비게이션 후에는 stale)
    const current = getGlobalRouterState();
    setGlobalRouterState({
      ...current,
      actionData: undefined,
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
    const parsed = new URL(url, window.location.origin);
    const dataUrl = `${parsed.pathname}${parsed.search ? parsed.search + "&" : "?"}_data=1`;
    await fetch(dataUrl, { priority: "low" } as RequestInit);
    prefetchedUrls.set(url, true);
  } catch {
    // Prefetch 실패는 무시
  }
}

// ========== Action Submission ==========

/**
 * 서버 action 제출 (mutation)
 * 응답에 _revalidated가 있으면 loaderData를 자동 갱신
 */
/** 진행 중인 action의 AbortController */
let activeActionController: AbortController | null = null;

export async function submitAction(
  url: string,
  data: FormData | Record<string, unknown>,
  actionName: string,
  method: string = "POST"
): Promise<ActionResult> {
  // 진행 중인 navigate 취소 (action이 우선)
  if (activeNavigationController) {
    activeNavigationController.abort();
    activeNavigationController = null;
  }
  // 진행 중인 이전 action 취소
  if (activeActionController) {
    activeActionController.abort();
  }
  const controller = new AbortController();
  activeActionController = controller;

  // submitting 상태 시작
  setRouterStateInternal({
    ...getRouterStateInternal(),
    navigation: { state: "submitting", formAction: url },
  });
  notifyListeners();

  try {
    const isFormData = data instanceof FormData;
    const body = isFormData ? data : JSON.stringify({ _action: actionName, ...data });
    const headers: Record<string, string> = {
      "X-Requested-With": "ManduAction",
      "Accept": "application/json",
    };
    if (!isFormData) {
      headers["Content-Type"] = "application/json";
    } else if (!data.has("_action")) {
      data.set("_action", actionName);
    }

    const response = await fetch(url, {
      method: method.toUpperCase(),
      body,
      headers,
      signal: controller.signal,
    });

    if (controller.signal.aborted) return { ok: false };

    // JSON 파싱 (실패 시 빈 객체 — 타입 안전)
    let result: Record<string, unknown> = {};
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const parsed = await response.json();
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          result = parsed as Record<string, unknown>;
        }
      } catch {
        // malformed JSON — result stays {}
      }
    }

    if (controller.signal.aborted) return { ok: false };

    // Revalidation: 서버가 loader를 재실행해서 fresh data를 보내줬으면 갱신
    const nextActionData = result._revalidated ? result.actionData : result;

    if (result._revalidated && result.loaderData !== undefined) {
      setRouterStateInternal({
        ...getRouterStateInternal(),
        loaderData: result.loaderData,
        actionData: nextActionData,
        navigation: { state: "idle" },
      });

      const currentRoute = getRouterStateInternal().currentRoute;
      if (currentRoute) {
        setServerData(currentRoute.id, result.loaderData);
      }
    } else {
      setRouterStateInternal({
        ...getRouterStateInternal(),
        actionData: nextActionData,
        navigation: { state: "idle" },
      });
    }

      notifyListeners();
      return {
        ok: response.ok,
        actionData: nextActionData,
        loaderData: result._revalidated ? result.loaderData as unknown : undefined,
      };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false };

    setRouterStateInternal({
      ...getRouterStateInternal(),
      navigation: { state: "idle" },
    });
    notifyListeners();
    return { ok: false };
  } finally {
    if (activeActionController === controller) {
      activeActionController = null;
    }
  }
}

/**
 * 현재 action 데이터 가져오기
 */
export function getActionData<T = unknown>(): T | undefined {
  return getRouterStateInternal().actionData as T | undefined;
}

// ========== Initialization ==========

let initialized = false;

/**
 * Phase 7.2 — HDR (Hot Data Revalidation) hook.
 *
 * The dev-time HMR client script (see `bundler/dev.ts`
 * `generateHMRClientScript`) calls this when a `.slot.ts` file
 * changes for the currently-rendered route. We update the router's
 * loader data inside `React.startTransition` so the component tree
 * re-renders with new props while form inputs, scroll position, and
 * focused elements all survive.
 *
 * The global is installed by `initializeRouter()` so dev and prod
 * share the same boot path; in prod builds the HMR script is not
 * emitted and the global is simply never called.
 *
 * Exposed on `window` because the HMR client script (emitted as a
 * raw string) has no module system. Typed via `window-state.ts` if
 * we ever lift the typing, but inline here for now.
 */
function applyHDRUpdate(routeId: string, loaderData: unknown): void {
  const current = getRouterStateInternal();
  const route = current.currentRoute;
  if (!route || route.id !== routeId) {
    // Route mismatch — the user navigated away between the
    // slot-refetch broadcast and the fetch response. Safe to drop.
    return;
  }
  const nextState: RouterState = {
    currentRoute: route,
    loaderData,
    actionData: current.actionData,
    navigation: current.navigation,
  };
  // startTransition wraps the update so React can interrupt it if
  // more urgent updates come in, and (crucially for HDR) does NOT
  // trigger the "input's state is inconsistent" tearing that a plain
  // setState would. React 19 exports startTransition as a top-level
  // API so it's always available when the router is on the page.
  const apply = () => {
    setRouterStateInternal(nextState);
    setServerData(routeId, loaderData);
    notifyListeners();
  };
  try {
    startTransition(apply);
  } catch {
    // Defensive: if for any reason startTransition throws (e.g. a
    // non-React 19 build ends up with the router on the page), fall
    // back to a direct apply. Prop changes still propagate; only
    // the tearing protection is lost.
    apply();
  }
}

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

  // Phase 7.2 — expose HDR revalidate hook. Only in dev does the HMR
  // client script call this; prod builds omit the script.
  (window as unknown as {
    __MANDU_ROUTER_REVALIDATE__?: (routeId: string, loaderData: unknown) => void;
  }).__MANDU_ROUTER_REVALIDATE__ = applyHDRUpdate;

  console.log("[Mandu Router] Initialized");
}

/**
 * 라우터 정리
 */
export function cleanupRouter(): void {
  if (typeof window === "undefined" || !initialized) return;

  // 진행 중인 네비게이션/액션 취소
  if (activeNavigationController) {
    activeNavigationController.abort();
    activeNavigationController = null;
  }
  if (activeActionController) {
    activeActionController.abort();
    activeActionController = null;
  }

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
