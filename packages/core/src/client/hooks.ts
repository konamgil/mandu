/**
 * Mandu Router Hooks 🪝
 * React hooks for client-side routing
 */

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import {
  subscribe,
  getRouterState,
  getCurrentRoute,
  getLoaderData,
  getNavigationState,
  navigate,
  type RouteInfo,
  type NavigationState,
  type NavigateOptions,
} from "./router";

/**
 * 라우터 상태 전체 접근
 *
 * @example
 * ```tsx
 * const { currentRoute, loaderData, navigation } = useRouterState();
 * ```
 */
export function useRouterState() {
  return useSyncExternalStore(
    subscribe,
    getRouterState,
    getRouterState // SSR에서도 동일
  );
}

/**
 * 현재 라우트 정보
 *
 * @example
 * ```tsx
 * const route = useRoute();
 * console.log(route?.id, route?.params);
 * ```
 */
export function useRoute(): RouteInfo | null {
  const state = useRouterState();
  return state.currentRoute;
}

/**
 * URL 파라미터 접근
 *
 * @example
 * ```tsx
 * // URL: /users/123
 * const { id } = useParams<{ id: string }>();
 * console.log(id); // "123"
 * ```
 */
export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  const route = useRoute();
  return (route?.params ?? {}) as T;
}

/**
 * 현재 경로명
 *
 * @example
 * ```tsx
 * const pathname = usePathname();
 * console.log(pathname); // "/users/123"
 * ```
 */
export function usePathname(): string {
  const [pathname, setPathname] = useState(() =>
    typeof window !== "undefined" ? window.location.pathname : "/"
  );

  useEffect(() => {
    const handleChange = () => {
      setPathname(window.location.pathname);
    };

    window.addEventListener("popstate", handleChange);

    // 라우터 상태 변경 구독
    const unsubscribe = subscribe(() => {
      setPathname(window.location.pathname);
    });

    return () => {
      window.removeEventListener("popstate", handleChange);
      unsubscribe();
    };
  }, []);

  return pathname;
}

/**
 * 현재 검색 파라미터 (쿼리 스트링)
 *
 * @example
 * ```tsx
 * // URL: /search?q=hello&page=2
 * const searchParams = useSearchParams();
 * console.log(searchParams.get("q")); // "hello"
 * ```
 */
export function useSearchParams(): URLSearchParams {
  const [searchParams, setSearchParams] = useState(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams()
  );

  useEffect(() => {
    const handleChange = () => {
      setSearchParams(new URLSearchParams(window.location.search));
    };

    window.addEventListener("popstate", handleChange);

    const unsubscribe = subscribe(() => {
      setSearchParams(new URLSearchParams(window.location.search));
    });

    return () => {
      window.removeEventListener("popstate", handleChange);
      unsubscribe();
    };
  }, []);

  return searchParams;
}

/**
 * Loader 데이터 접근
 *
 * @example
 * ```tsx
 * interface UserData { name: string; email: string; }
 * const data = useLoaderData<UserData>();
 * ```
 */
export function useLoaderData<T = unknown>(): T | undefined {
  const state = useRouterState();
  return state.loaderData as T | undefined;
}

/**
 * 네비게이션 상태 (로딩 여부)
 *
 * @example
 * ```tsx
 * const { state, location } = useNavigation();
 *
 * if (state === "loading") {
 *   return <Spinner />;
 * }
 * ```
 */
export function useNavigation(): NavigationState {
  const state = useRouterState();
  return state.navigation;
}

/**
 * 프로그래매틱 네비게이션
 *
 * @example
 * ```tsx
 * const navigate = useNavigate();
 *
 * const handleClick = () => {
 *   navigate("/dashboard");
 * };
 *
 * const handleSubmit = () => {
 *   navigate("/success", { replace: true });
 * };
 * ```
 */
export function useNavigate(): (to: string, options?: NavigateOptions) => Promise<void> {
  return useCallback((to: string, options?: NavigateOptions) => {
    return navigate(to, options);
  }, []);
}

/**
 * 라우터 통합 훅 (편의용)
 *
 * @example
 * ```tsx
 * const {
 *   pathname,
 *   params,
 *   searchParams,
 *   navigate,
 *   isNavigating
 * } = useRouter();
 * ```
 */
export function useRouter() {
  const pathname = usePathname();
  const params = useParams();
  const searchParams = useSearchParams();
  const navigation = useNavigation();
  const navigateFn = useNavigate();

  return {
    /** 현재 경로명 */
    pathname,
    /** URL 파라미터 */
    params,
    /** 검색 파라미터 (쿼리 스트링) */
    searchParams,
    /** 네비게이션 함수 */
    navigate: navigateFn,
    /** 네비게이션 중 여부 */
    isNavigating: navigation.state === "loading",
    /** 네비게이션 상태 상세 */
    navigation,
  };
}

/**
 * 특정 경로와 현재 경로 일치 여부
 *
 * @example
 * ```tsx
 * const isActive = useMatch("/about");
 * const isUsersPage = useMatch("/users/:id");
 * ```
 */
export function useMatch(pattern: string): boolean {
  const pathname = usePathname();

  // 간단한 패턴 매칭 (파라미터 고려)
  const regexStr = pattern
    .replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, "[^/]+")
    .replace(/\//g, "\\/");

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(pathname);
}

/**
 * 뒤로 가기
 */
export function useGoBack(): () => void {
  return useCallback(() => {
    if (typeof window !== "undefined") {
      window.history.back();
    }
  }, []);
}

/**
 * 앞으로 가기
 */
export function useGoForward(): () => void {
  return useCallback(() => {
    if (typeof window !== "undefined") {
      window.history.forward();
    }
  }, []);
}
