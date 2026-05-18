/**
 * Mandu Island - Client Slot API 🏝️
 * Hydration을 위한 클라이언트 사이드 컴포넌트 정의
 */

import type { ReactNode } from "react";
import { serializeProps } from "./serialize";
import { getServerData as getGlobalServerData } from "./window-state";

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
 * 컴파일된 Island 컴포넌트 타입.
 *
 * An island is a **page-level client bundle**, not an inline JSX element.
 * The runtime representation is a React component **whose body unconditionally
 * throws**, decorated with the `definition` + `__mandu_island` marker so the
 * build pipeline can still recognise it.
 *
 * Why callable? A plain `{ definition, __mandu_island }` object rendered as
 * `<MyIsland />` produced React's opaque *"Element type is invalid... got:
 * object"* error. Making it a function lets React invoke it like any other
 * component, which triggers our clear diagnostic below — users immediately
 * learn to switch to `partial()` for embedded client regions.
 */
export type CompiledIsland<TServerData, TSetupResult> = (() => never) & {
  /** Island 정의 */
  definition: IslandDefinition<TServerData, TSetupResult>;
  /** Island 메타데이터 (빌드 시 주입) */
  __mandu_island: true;
  /** Island ID (빌드 시 주입) */
  __mandu_island_id?: string;
};

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

  // Function body: reached only when a server page (or any caller) tries to
  // render the island as an inline React element — `<MyIsland />`. Islands
  // are not inline elements; they are page-level client bundles. Throw a
  // clear message pointing at `partial()` (the right API for embedded
  // client regions) instead of React's generic "Element type is invalid".
  const IslandElement = (() => {
    throw new Error(
      "[Mandu Island] Islands are page-level client bundles — they cannot " +
      "be rendered as inline JSX elements. For an embedded client region " +
      "inside a server page, use `partial()` instead (it returns a " +
      "renderable component). See " +
      "https://mandujs.com/docs/architect/client-rendering",
    );
  }) as CompiledIsland<TServerData, TSetupResult>;
  IslandElement.definition = definition;
  IslandElement.__mandu_island = true;
  return IslandElement;
}

/**
 * Island에서 사용할 수 있는 헬퍼 훅들
 */

/**
 * SSR 데이터에 안전하게 접근하는 훅
 * 서버 데이터가 없는 경우 fallback 반환
 */
export function useServerData<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  const data = getGlobalServerData<T>(key);
  return data === undefined ? fallback : data;
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
 * Island 간 통신을 위한 이벤트 훅 반환 타입
 */
export interface IslandEventHandle<T> {
  /** 이벤트 발송 함수 */
  emit: (data: T) => void;
  /** 이벤트 리스너 해제 함수 (cleanup) */
  cleanup: () => void;
}

/**
 * Island 간 통신을 위한 이벤트 훅
 *
 * @example
 * ```typescript
 * // Island A
 * const { emit, cleanup } = useIslandEvent<{ count: number }>(
 *   'counter-update',
 *   (data) => console.log('Received:', data.count)
 * );
 *
 * // 이벤트 발송
 * emit({ count: 42 });
 *
 * // 컴포넌트 언마운트 시 cleanup
 * useEffect(() => cleanup, []);
 * ```
 *
 * @deprecated 새로운 API는 { emit, cleanup } 객체를 반환합니다.
 *   하위 호환성을 위해 emit 함수에 cleanup 속성도 추가됩니다.
 */
export function useIslandEvent<T = unknown>(
  eventName: string,
  handler: (data: T) => void
): IslandEventHandle<T>["emit"] & IslandEventHandle<T> {
  if (typeof window === "undefined") {
    const noop = (() => {}) as unknown as IslandEventHandle<T>["emit"] & IslandEventHandle<T>;
    noop.emit = noop;
    noop.cleanup = () => {};
    return noop;
  }

  // 이벤트 리스너 등록
  const customEventName = `mandu:island:${eventName}`;

  const listener = (event: CustomEvent<T>) => {
    handler(event.detail);
  };

  window.addEventListener(customEventName, listener as EventListener);

  // cleanup 함수
  const cleanup = () => {
    window.removeEventListener(customEventName, listener as EventListener);
  };

  // 이벤트 발송 함수
  const emit = (data: T) => {
    window.dispatchEvent(new CustomEvent(customEventName, { detail: data }));
  };

  // 하위 호환성: emit 함수에 cleanup 속성 추가
  const result = emit as IslandEventHandle<T>["emit"] & IslandEventHandle<T>;
  result.emit = emit;
  result.cleanup = cleanup;

  return result;
}

/**
 * 기존 React 컴포넌트를 Island로 래핑
 *
 * @example
 * ```typescript
 * // 기존 React 컴포넌트
 * import DatePicker from 'react-datepicker';
 *
 * // Island로 래핑 (serverData가 그대로 props로 전달됨)
 * export default Mandu.wrapComponent(DatePicker);
 *
 * // 또는 props 변환이 필요한 경우
 * export default Mandu.wrapComponent(DatePicker, {
 *   transformProps: (serverData) => ({
 *     selected: new Date(serverData.selectedDate),
 *     onChange: (date) => console.log(date),
 *   })
 * });
 * ```
 */
export interface WrapComponentOptions<TServerData, TProps> {
  /** 서버 데이터를 컴포넌트 props로 변환 */
  transformProps?: (serverData: TServerData) => TProps;
  /** 에러 시 표시할 UI */
  errorBoundary?: (error: Error, reset: () => void) => ReactNode;
  /** 로딩 중 표시할 UI */
  loading?: () => ReactNode;
}

export function wrapComponent<TProps extends Record<string, unknown>>(
  Component: React.ComponentType<TProps>,
  options?: WrapComponentOptions<TProps, TProps>
): CompiledIsland<TProps, TProps>;

export function wrapComponent<TServerData, TProps>(
  Component: React.ComponentType<TProps>,
  options: WrapComponentOptions<TServerData, TProps> & { transformProps: (serverData: TServerData) => TProps }
): CompiledIsland<TServerData, TProps>;

export function wrapComponent<TServerData, TProps>(
  Component: React.ComponentType<TProps>,
  options?: WrapComponentOptions<TServerData, TProps>
): CompiledIsland<TServerData, TProps> {
  const { transformProps, errorBoundary, loading } = options || {};

  return island({
    setup: (serverData: TServerData) => {
      return transformProps ? transformProps(serverData) : (serverData as unknown as TProps);
    },
    render: (props: TProps) => {
      // React.createElement를 사용하여 Component 렌더링
      const React = require("react");
      return React.createElement(Component, props);
    },
    errorBoundary,
    loading,
  });
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

// ========== Client Partials/Slots API ==========

/**
 * Partial Island 설정
 * 페이지 내 특정 부분만 하이드레이션할 때 사용
 */
export interface PartialConfig {
  /** Partial 고유 ID */
  id: string;
  /** 하이드레이션 우선순위 */
  priority?: "immediate" | "visible" | "idle" | "interaction";
  /** 부모 Island ID (중첩 시) */
  parentId?: string;
}

/**
 * Partial Island 정의 타입
 */
export interface PartialDefinition<TProps> {
  /** Partial 고유 ID. 기본값은 component displayName/name 입니다. */
  id?: string;
  /** Partial 컴포넌트 */
  component: React.ComponentType<TProps>;
  /** 초기 props (SSR에서 전달) */
  initialProps?: TProps;
  /** 하이드레이션 우선순위 */
  priority?: "immediate" | "visible" | "idle" | "interaction";
  /** 명시적 번들 URL. 기본값은 `/.mandu/client/{id}.partial.js` 입니다. */
  src?: string;
  /** 에러 시 표시할 UI */
  errorBoundary?: (error: Error, reset: () => void) => ReactNode;
  /** 로딩 중 표시할 UI */
  loading?: () => ReactNode;
}

/**
 * 컴파일된 Partial
 */
export interface CompiledPartial<TProps> {
  /** Partial 정의 */
  definition: PartialDefinition<TProps>;
  /** Mandu Partial 마커 */
  __mandu_partial: true;
  /** Partial ID */
  __mandu_partial_id?: string;
}

function normalizePartialId(id: string): string {
  return id
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "") || "partial";
}

function priorityToHydrate(priority: NonNullable<PartialDefinition<unknown>["priority"]>): string {
  return priority === "immediate" ? "load" : priority;
}

/**
 * Partial Island 생성
 * 페이지 내 특정 부분만 하이드레이션
 *
 * @example
 * ```typescript
 * // 검색 바만 별도 Island로 분리
 * const SearchBarPartial = partial({
 *   component: SearchBar,
 *   priority: 'interaction', // 사용자 상호작용 시 하이드레이션
 * });
 *
 * // 사용
 * function Header() {
 *   return (
 *     <header>
 *       <Logo />
 *       <SearchBarPartial.Render query="" />
 *     </header>
 *   );
 * }
 * ```
 */
export function partial<TProps extends Record<string, unknown>>(
  definition: PartialDefinition<TProps>
): CompiledPartial<TProps> & {
  Render: React.ComponentType<TProps>;
} {
  if (!definition.component) {
    throw new Error("[Mandu Partial] component is required");
  }

  const partialId = normalizePartialId(
    definition.id ||
    definition.component.displayName ||
    definition.component.name ||
    "partial",
  );
  const normalizedDefinition: PartialDefinition<TProps> = {
    ...definition,
    id: partialId,
  };

  const compiled: CompiledPartial<TProps> = {
    definition: normalizedDefinition,
    __mandu_partial: true,
    __mandu_partial_id: partialId,
  };

  // Render 컴포넌트 생성
  const React = require("react");

  const RenderComponent: React.FC<TProps> = (props) => {
    const renderProps = Object.keys(props).length > 0
      ? props
      : (normalizedDefinition.initialProps ?? props);
    const priority = normalizedDefinition.priority ?? "visible";
    const bundleSrc = normalizedDefinition.src ?? `/.mandu/client/${partialId}.partial.js`;

    return React.createElement(
      "div",
      {
        "data-mandu-island": partialId,
        "data-mandu-partial": partialId,
        "data-mandu-src": bundleSrc,
        "data-mandu-priority": priority,
        "data-hydrate": priorityToHydrate(priority),
        "data-props": serializeProps(renderProps),
        style: { display: "contents" },
      },
      React.createElement(normalizedDefinition.component, renderProps),
    );
  };

  return Object.assign(compiled, { Render: RenderComponent });
}

/**
 * Slot 정의 - 서버에서 렌더링되고 클라이언트에서 하이드레이션되는 영역
 */
export interface SlotDefinition<TData, TProps> {
  /** 슬롯 ID */
  id: string;
  /** 데이터 로더 (서버에서 실행) */
  loader?: () => Promise<TData>;
  /** 데이터를 props로 변환 */
  transform?: (data: TData) => TProps;
  /** 렌더링 컴포넌트 */
  component: React.ComponentType<TProps>;
  /** 하이드레이션 우선순위 */
  priority?: "immediate" | "visible" | "idle" | "interaction";
  /** 로딩 UI */
  loading?: () => ReactNode;
  /** 에러 UI */
  errorBoundary?: (error: Error, reset: () => void) => ReactNode;
}

/**
 * 컴파일된 Slot
 */
export interface CompiledSlot<TData, TProps> {
  definition: SlotDefinition<TData, TProps>;
  __mandu_slot: true;
  __mandu_slot_id: string;
}

/**
 * Client Slot 생성
 * 서버 데이터를 받아 클라이언트에서 하이드레이션되는 컴포넌트
 *
 * @example
 * ```typescript
 * // 댓글 영역을 별도 슬롯으로 분리
 * const CommentsSlot = slot({
 *   id: 'comments',
 *   loader: async () => fetchComments(postId),
 *   transform: (data) => ({ comments: data.items }),
 *   component: CommentList,
 *   priority: 'visible',
 *   loading: () => <CommentsSkeleton />,
 * });
 * ```
 */
export function slot<TData, TProps extends Record<string, unknown>>(
  definition: SlotDefinition<TData, TProps>
): CompiledSlot<TData, TProps> {
  if (!definition.id) {
    throw new Error("[Mandu Slot] id is required");
  }
  if (!definition.component) {
    throw new Error("[Mandu Slot] component is required");
  }

  return {
    definition,
    __mandu_slot: true,
    __mandu_slot_id: definition.id,
  };
}

/**
 * 여러 Partial을 그룹으로 관리
 */
export interface PartialGroup {
  /** 그룹에 Partial 추가 */
  add: <TProps>(id: string, partial: CompiledPartial<TProps>) => void;
  /** Partial 조회 */
  get: <TProps>(id: string) => CompiledPartial<TProps> | undefined;
  /** 모든 Partial ID 목록 */
  ids: () => string[];
  /** 특정 Partial 하이드레이션 트리거 */
  hydrate: (id: string) => Promise<void>;
  /** 모든 Partial 하이드레이션 */
  hydrateAll: () => Promise<void>;
}

/**
 * Partial 그룹 생성
 *
 * @example
 * ```typescript
 * const dashboardPartials = createPartialGroup();
 *
 * dashboardPartials.add('chart', ChartPartial);
 * dashboardPartials.add('table', TablePartial);
 *
 * // 특정 부분만 하이드레이션
 * await dashboardPartials.hydrate('chart');
 * ```
 */
export function createPartialGroup(): PartialGroup {
  // React `ComponentType<P>` is contravariant on `P`, so a heterogeneous
  // component map genuinely needs `any` here — any narrower bag type would
  // reject concrete `CompiledPartial<{userId: string}>` entries at `.set()`.
  // oxlint-disable-next-line no-explicit-any -- heterogeneous React component storage
  const partials = new Map<string, CompiledPartial<any>>();

  return {
    add: (id, partial) => {
      partial.__mandu_partial_id = id;
      partials.set(id, partial);
    },
    get: (id) => partials.get(id),
    ids: () => Array.from(partials.keys()),
    hydrate: async (id) => {
      if (typeof window === "undefined") return;

      const element = document.querySelector(`[data-mandu-partial="${id}"]`);
      if (element) {
        element.dispatchEvent(
          new CustomEvent("mandu:hydrate-partial", { bubbles: true, detail: { id } })
        );
      }
    },
    hydrateAll: async () => {
      if (typeof window === "undefined") return;

      const elements = document.querySelectorAll("[data-mandu-partial]");
      for (const el of elements) {
        const id = el.getAttribute("data-mandu-partial");
        if (id) {
          el.dispatchEvent(
            new CustomEvent("mandu:hydrate-partial", { bubbles: true, detail: { id } })
          );
        }
      }
    },
  };
}
