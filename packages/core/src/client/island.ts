/**
 * Mandu Island - Client Slot API 🏝️
 * Hydration을 위한 클라이언트 사이드 컴포넌트 정의
 */

import type { ReactNode } from "react";

/**
 * Island 정의 타입
 * @template TServerData - SSR에서 전달받는 서버 데이터 타입
 * @template TSetupResult - setup 함수가 반환하는 결과 타입
 */
export interface IslandDefinition<TServerData, TSetupResult> {
  /**
   * Setup Phase
   * - 서버 데이터를 받아 클라이언트 상태 초기화
   * - React hooks 사용 가능
   * - 반환값이 render 함수에 전달됨
   */
  setup: (serverData: TServerData) => TSetupResult;

  /**
   * Render Phase
   * - setup에서 반환된 값을 props로 받음
   * - 순수 렌더링 로직만 포함
   */
  render: (props: TSetupResult) => ReactNode;

  /**
   * Optional: 에러 발생 시 표시할 fallback UI
   */
  errorBoundary?: (error: Error, reset: () => void) => ReactNode;

  /**
   * Optional: 로딩 중 표시할 UI (progressive hydration용)
   */
  loading?: () => ReactNode;
}

/**
 * Island 컴포넌트의 메타데이터
 */
export interface IslandMetadata {
  /** Island 고유 식별자 */
  id: string;
  /** SSR 데이터 키 */
  dataKey: string;
  /** Hydration 우선순위 */
  priority: "immediate" | "visible" | "idle" | "interaction";
}

/**
 * 컴파일된 Island 컴포넌트 타입
 */
export interface CompiledIsland<TServerData, TSetupResult> {
  /** Island 정의 */
  definition: IslandDefinition<TServerData, TSetupResult>;
  /** Island 메타데이터 (빌드 시 주입) */
  __mandu_island: true;
  /** Island ID (빌드 시 주입) */
  __mandu_island_id?: string;
}

/**
 * Island 컴포넌트 생성
 *
 * @example
 * ```typescript
 * // spec/slots/todos.client.ts
 * import { Mandu } from "@mandujs/core/client";
 * import { useState, useCallback } from "react";
 *
 * interface TodosData {
 *   todos: Todo[];
 *   user: User | null;
 * }
 *
 * export default Mandu.island<TodosData>({
 *   setup: (serverData) => {
 *     const [todos, setTodos] = useState(serverData.todos);
 *     const addTodo = useCallback(async (text: string) => {
 *       // ...
 *     }, []);
 *     return { todos, addTodo, user: serverData.user };
 *   },
 *   render: ({ todos, addTodo, user }) => (
 *     <div>
 *       {user && <span>Hello, {user.name}!</span>}
 *       <TodoList todos={todos} onAdd={addTodo} />
 *     </div>
 *   )
 * });
 * ```
 */
export function island<TServerData, TSetupResult = TServerData>(
  definition: IslandDefinition<TServerData, TSetupResult>
): CompiledIsland<TServerData, TSetupResult> {
  // Validate definition
  if (typeof definition.setup !== "function") {
    throw new Error("[Mandu Island] setup must be a function");
  }
  if (typeof definition.render !== "function") {
    throw new Error("[Mandu Island] render must be a function");
  }

  return {
    definition,
    __mandu_island: true,
  };
}

/**
 * Island에서 사용할 수 있는 헬퍼 훅들
 */

/**
 * SSR 데이터에 안전하게 접근하는 훅
 * 서버 데이터가 없는 경우 fallback 반환
 */
export function useServerData<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  const manduData = (window as any).__MANDU_DATA__;
  if (!manduData || !(key in manduData)) {
    return fallback;
  }

  return manduData[key] as T;
}

/**
 * Hydration 상태를 추적하는 훅
 */
export function useHydrated(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return true;
}

/**
 * Island 간 통신을 위한 이벤트 훅
 */
export function useIslandEvent<T = unknown>(
  eventName: string,
  handler: (data: T) => void
): (data: T) => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  // 이벤트 리스너 등록
  const customEventName = `mandu:island:${eventName}`;

  const listener = (event: CustomEvent<T>) => {
    handler(event.detail);
  };

  window.addEventListener(customEventName, listener as EventListener);

  // 이벤트 발송 함수 반환
  return (data: T) => {
    window.dispatchEvent(new CustomEvent(customEventName, { detail: data }));
  };
}

/**
 * API 호출 헬퍼
 */
export interface FetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export async function fetchApi<T>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const { body, headers = {}, ...rest } = options;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    ...rest,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `API Error: ${response.status}`);
  }

  return response.json();
}
