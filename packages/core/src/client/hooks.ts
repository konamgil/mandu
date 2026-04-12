/**
 * Mandu Router Hooks 🪝
 * React hooks for client-side routing
 */

import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import {
  subscribe,
  getRouterState,
  getCurrentRoute,
  getLoaderData,
  getActionData,
  getNavigationState,
  navigate,
  submitAction,
  type RouteInfo,
  type NavigationState,
  type NavigateOptions,
  type ActionResult,
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

  const regex = useMemo(() => {
    // 파라미터를 플레이스홀더로 치환 → 나머지 특수문자 이스케이프 → 플레이스홀더 복원
    const PLACEHOLDER = "\x00PARAM\x00";
    const withPlaceholders = pattern.replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, PLACEHOLDER);
    const escaped = withPlaceholders.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regexStr = escaped.replace(
      new RegExp(PLACEHOLDER.replace(/\x00/g, "\\x00"), "g"),
      "[^/]+"
    );
    return new RegExp(`^${regexStr}$`);
  }, [pattern]);

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

/**
 * Action 데이터 접근
 * filling.action()의 결과 데이터
 *
 * @example
 * ```tsx
 * const actionData = useActionData<{ created: boolean }>();
 * if (actionData?.created) { ... }
 * ```
 */
export function useActionData<T = unknown>(): T | undefined {
  const state = useRouterState();
  return state.actionData as T | undefined;
}

/**
 * Action 제출 함수
 *
 * @example
 * ```tsx
 * const submit = useSubmit();
 * const handleCreate = () => submit("/api/todos", { title: "New" }, "create");
 * ```
 */
export function useSubmit(): (
  url: string,
  data: FormData | Record<string, unknown>,
  actionName?: string,
  method?: string
) => Promise<ActionResult> {
  return useCallback(
    (url: string, data: FormData | Record<string, unknown>, actionName = "default", method = "POST") => {
      return submitAction(url, data, actionName, method);
    },
    []
  );
}

/**
 * Mandu 통합 상태 훅
 * 라우트, 데이터, 네비게이션, 액션 상태를 하나의 객체로 제공
 *
 * @example
 * ```tsx
 * const {
 *   url, params, routeId,
 *   loaderData, actionData,
 *   navigation,
 *   navigate, submit,
 * } = useMandu();
 * ```
 */
export function useMandu() {
  const state = useRouterState();
  const navigateFn = useNavigate();
  const submitFn = useSubmit();

  // URL은 라우트 변경 시에만 재생성 (매 렌더마다 new URL 방지)
  const url = useMemo(
    () => typeof window !== "undefined" ? new URL(window.location.href) : null,
    [state.currentRoute?.id, state.currentRoute?.params]
  );

  return {
    /** 현재 URL (브라우저) */
    url,
    /** URL 파라미터 */
    params: (state.currentRoute?.params ?? {}) as Record<string, string>,
    /** 현재 라우트 ID */
    routeId: state.currentRoute?.id ?? "",
    /** 라우트 패턴 */
    pattern: state.currentRoute?.pattern ?? "",
    /** Loader 데이터 */
    loaderData: state.loaderData,
    /** 마지막 Action 결과 */
    actionData: state.actionData,
    /** 네비게이션 상태 */
    navigation: state.navigation,
    /** 네비게이션 중 여부 */
    isNavigating: state.navigation.state === "loading",
    /** Action 제출 중 여부 */
    isSubmitting: state.navigation.state === "submitting",
    /** 프로그래매틱 네비게이션 */
    navigate: navigateFn,
    /** Action 제출 */
    submit: submitFn,
  };
}
