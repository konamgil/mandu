# Mandu Hydration System 상세 기획서

> **목표**: Spec-driven, Agent-native, Guard-protected Islands Architecture
> **버전**: MVP-0.4 ~ MVP-1.0
> **작성일**: 2025-01-28

---

## 1. 문제 정의

### 1.1 현재 상황

```
[서버]
TodoList 컴포넌트 렌더링
  → useState 초기값: loading = true
  → renderToString() → HTML: "로딩 중..."

[브라우저로 전송]
<div>로딩 중...</div>   ✅ 전송됨
<script>...</script>    ❌ 없음!

[결과]
화면에 "로딩 중..."만 표시
useEffect 실행 안됨 → API 호출 안됨 → 영원히 로딩
```

### 1.2 해결해야 할 핵심 문제

| 문제 | 설명 | 우선순위 |
|------|------|----------|
| JS 번들 없음 | 클라이언트에 JavaScript가 전송되지 않음 | P0 |
| Hydration 없음 | React가 브라우저에서 활성화되지 않음 | P0 |
| 상태 동기화 없음 | 서버 데이터가 클라이언트로 전달되지 않음 | P0 |
| HMR 없음 | 개발 시 변경사항 즉시 반영 안됨 | P1 |
| 번들 최적화 없음 | Code splitting, tree shaking 없음 | P1 |

### 1.3 설계 원칙

1. **Spec = SSOT 유지**: Hydration 전략도 JSON에서 선언
2. **Slot = Island**: 기존 개념의 자연스러운 확장
3. **Guard 확장**: 클라이언트 코드도 보호
4. **Agent-Native**: MCP로 모든 것을 조작 가능
5. **점진적 도입**: 기존 프로젝트 호환성 유지

---

## 2. 아키텍처 개요

### 2.1 전체 흐름

```
┌─────────────────────────────────────────────────────────────────────┐
│                           BUILD TIME                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  routes.manifest.json                                                │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │                    mandu generate                         │       │
│  └──────────────────────────────────────────────────────────┘       │
│         │                                                            │
│         ├─────────────────────┬─────────────────────┐               │
│         ▼                     ▼                     ▼               │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │ Server      │    │ Client          │    │ Bundle          │     │
│  │ Generated   │    │ Generated       │    │ Manifest        │     │
│  │             │    │                 │    │                 │     │
│  │ routes/     │    │ .mandu/client/  │    │ .mandu/         │     │
│  │ *.route.ts  │    │ *.island.js     │    │ manifest.json   │     │
│  └─────────────┘    └─────────────────┘    └─────────────────┘     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                           RUNTIME (Server)                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Request: GET /todos                                                 │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │ 1. Route Matching                                         │       │
│  │    manifest.routes.find(r => match(r.pattern, url))       │       │
│  └──────────────────────────────────────────────────────────┘       │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │ 2. Data Loading (SSR)                                     │       │
│  │    const data = await slot.loader(ctx)                    │       │
│  │    // { todos: [...], user: {...} }                       │       │
│  └──────────────────────────────────────────────────────────┘       │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │ 3. Server-Side Rendering                                  │       │
│  │    const html = renderToString(<Page data={data} />)      │       │
│  └──────────────────────────────────────────────────────────┘       │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │ 4. HTML Assembly                                          │       │
│  │    - Inject __MANDU_DATA__ script                         │       │
│  │    - Add island markers (data-mandu-island)               │       │
│  │    - Include bundle script tags                           │       │
│  └──────────────────────────────────────────────────────────┘       │
│         │                                                            │
│         ▼                                                            │
│  Response: Full HTML Document                                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                           RUNTIME (Browser)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. HTML Parse & Initial Paint                                       │
│     └─→ 사용자가 즉시 콘텐츠를 볼 수 있음 (SSR 결과)                   │
│                                                                      │
│  2. Runtime Script Load                                              │
│     └─→ /.mandu/client/_runtime.js                                  │
│                                                                      │
│  3. Island Discovery                                                 │
│     └─→ document.querySelectorAll('[data-mandu-island]')            │
│                                                                      │
│  4. Priority-Based Hydration Scheduling                              │
│     ├─→ immediate: 즉시 hydrate                                      │
│     ├─→ visible: IntersectionObserver                                │
│     ├─→ idle: requestIdleCallback                                    │
│     └─→ interaction: mouseenter/focusin/touchstart                   │
│                                                                      │
│  5. Island Hydration                                                 │
│     ├─→ Dynamic import: island bundle                                │
│     ├─→ Extract server data from __MANDU_DATA__                      │
│     └─→ hydrateRoot(element, <Island {...serverData} />)            │
│                                                                      │
│  6. Interactive! 🎉                                                   │
│     └─→ React hooks 동작, 이벤트 핸들러 활성화                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 파일 구조 변경

```
my-app/
├── spec/
│   ├── routes.manifest.json      # 라우트 + hydration 설정
│   ├── spec.lock.json
│   └── slots/
│       ├── todos.slot.ts         # 서버 로직 (API, loader)
│       └── todos.client.ts       # 클라이언트 로직 (React hooks) [NEW]
│
├── apps/
│   ├── server/
│   │   ├── main.ts
│   │   └── generated/
│   │       └── routes/
│   │           └── todos.route.ts
│   └── web/
│       ├── entry.tsx
│       └── generated/
│           └── routes/
│               └── todos.route.tsx
│
├── .mandu/                        # [NEW] 빌드 결과물
│   ├── client/
│   │   ├── _runtime.js           # Hydration runtime
│   │   ├── _shared.js            # 공통 의존성 (React 등)
│   │   ├── todos.island.js       # todos 페이지 island 번들
│   │   └── users.island.js       # users 페이지 island 번들
│   └── manifest.json             # 번들 매핑 정보
│
└── package.json
```

---

## 3. Spec 스키마 확장

### 3.1 routes.manifest.json 확장

```typescript
// packages/core/src/spec/schema.ts

interface RouteSpec {
  id: string;
  pattern: string;
  kind: "page" | "api";
  methods?: HttpMethod[];

  // 서버 슬롯 (기존)
  slotModule?: string;

  // 클라이언트 슬롯 [NEW]
  clientModule?: string;

  // Hydration 설정 [NEW]
  hydration?: HydrationConfig;

  // SSR 데이터 로딩 설정 [NEW]
  loader?: LoaderConfig;
}

interface HydrationConfig {
  /**
   * Hydration 전략
   * - none: 순수 Static HTML (JS 없음)
   * - island: Slot 영역만 hydrate (기본값)
   * - full: 전체 페이지 hydrate
   * - progressive: 점진적 hydrate (복잡한 페이지용)
   */
  strategy: "none" | "island" | "full" | "progressive";

  /**
   * Hydration 우선순위
   * - immediate: 페이지 로드 즉시
   * - visible: 뷰포트에 보일 때 (기본값)
   * - idle: 브라우저 idle 시
   * - interaction: 사용자 상호작용 시
   */
  priority?: "immediate" | "visible" | "idle" | "interaction";

  /**
   * 번들 preload 여부
   * true면 <link rel="modulepreload"> 추가
   */
  preload?: boolean;

  /**
   * 클라이언트 의존성 (외부 라이브러리)
   * 자동 감지되지만 명시적 선언 가능
   */
  dependencies?: string[];
}

interface LoaderConfig {
  /**
   * SSR 시 데이터 로딩 타임아웃 (ms)
   */
  timeout?: number;

  /**
   * 로딩 실패 시 fallback 데이터
   */
  fallback?: Record<string, unknown>;

  /**
   * 캐시 설정
   */
  cache?: {
    ttl: number;        // 초 단위
    staleWhileRevalidate?: boolean;
  };
}
```

### 3.2 Spec 예시

```json
{
  "version": 2,
  "routes": [
    {
      "id": "home",
      "pattern": "/",
      "kind": "page",
      "hydration": {
        "strategy": "none"
      }
    },
    {
      "id": "todos",
      "pattern": "/todos",
      "kind": "page",
      "slotModule": "spec/slots/todos.slot.ts",
      "clientModule": "spec/slots/todos.client.ts",
      "hydration": {
        "strategy": "island",
        "priority": "visible",
        "preload": true
      },
      "loader": {
        "timeout": 3000,
        "fallback": { "todos": [] }
      }
    },
    {
      "id": "dashboard",
      "pattern": "/dashboard",
      "kind": "page",
      "slotModule": "spec/slots/dashboard.slot.ts",
      "clientModule": "spec/slots/dashboard.client.ts",
      "hydration": {
        "strategy": "progressive",
        "priority": "immediate"
      }
    },
    {
      "id": "todos-api",
      "pattern": "/api/todos",
      "kind": "api",
      "methods": ["GET", "POST", "PUT", "DELETE"],
      "slotModule": "spec/slots/todos.slot.ts"
    }
  ]
}
```

---

## 4. Slot 시스템 확장

### 4.1 Server Slot (기존 확장)

```typescript
// spec/slots/todos.slot.ts
import { Mandu } from "@mandujs/core";
import type { Context } from "@mandujs/core";

// 타입 정의 (클라이언트와 공유)
export interface Todo {
  id: number;
  text: string;
  completed: boolean;
  createdAt: string;
}

export interface TodosLoaderData {
  todos: Todo[];
  totalCount: number;
  user: { name: string } | null;
}

export default Mandu.filling<TodosLoaderData>()
  /**
   * SSR Loader - 페이지 렌더링 전 데이터 로딩
   * 이 데이터는 서버에서 렌더링되고, 클라이언트로 전달됨
   */
  .loader(async (ctx: Context): Promise<TodosLoaderData> => {
    // 병렬로 데이터 로딩
    const [todosRes, userRes] = await Promise.all([
      fetch(`${ctx.env.API_URL}/todos`),
      ctx.cookies.get("session")
        ? fetch(`${ctx.env.API_URL}/me`, {
            headers: { Cookie: ctx.cookies.toString() }
          })
        : Promise.resolve(null)
    ]);

    const todos = await todosRes.json();
    const user = userRes ? await userRes.json() : null;

    return {
      todos: todos.data,
      totalCount: todos.total,
      user
    };
  })

  /**
   * API Handlers
   */
  .get(async (ctx) => {
    const todos = await db.todos.findMany();
    return ctx.json({ data: todos, total: todos.length });
  })

  .post(async (ctx) => {
    const body = await ctx.body<{ text: string }>();
    const todo = await db.todos.create({
      data: { text: body.text, completed: false }
    });
    return ctx.created(todo);
  })

  .put(async (ctx) => {
    const { id } = ctx.params;
    const body = await ctx.body<Partial<Todo>>();
    const todo = await db.todos.update({
      where: { id: Number(id) },
      data: body
    });
    return ctx.json(todo);
  })

  .delete(async (ctx) => {
    const { id } = ctx.params;
    await db.todos.delete({ where: { id: Number(id) } });
    return ctx.noContent();
  });
```

### 4.2 Client Slot (신규)

```typescript
// spec/slots/todos.client.ts
import { Mandu } from "@mandujs/core/client";
import { useState, useEffect, useCallback, useMemo } from "react";
import type { TodosLoaderData, Todo } from "./todos.slot";

/**
 * Client Island 정의
 *
 * setup: 서버 데이터를 받아 클라이언트 상태 초기화
 * render: React 컴포넌트 렌더링
 */
export default Mandu.island<TodosLoaderData>({
  /**
   * Setup Phase
   * - 서버에서 전달된 데이터로 상태 초기화
   * - React hooks 사용
   * - 반환값이 render에 전달됨
   */
  setup: (serverData) => {
    // 서버 데이터로 초기 상태 설정
    const [todos, setTodos] = useState<Todo[]>(serverData.todos);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

    // 필터링된 할일 목록
    const filteredTodos = useMemo(() => {
      switch (filter) {
        case "active":
          return todos.filter(t => !t.completed);
        case "completed":
          return todos.filter(t => t.completed);
        default:
          return todos;
      }
    }, [todos, filter]);

    // 할일 추가
    const addTodo = useCallback(async (text: string) => {
      if (!text.trim()) return;

      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/todos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });

        if (!res.ok) throw new Error("Failed to add todo");

        const newTodo = await res.json();
        setTodos(prev => [...prev, newTodo]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }, []);

    // 할일 토글
    const toggleTodo = useCallback(async (id: number) => {
      const todo = todos.find(t => t.id === id);
      if (!todo) return;

      try {
        const res = await fetch(`/api/todos/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: !todo.completed })
        });

        if (!res.ok) throw new Error("Failed to update todo");

        const updated = await res.json();
        setTodos(prev => prev.map(t => t.id === id ? updated : t));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }, [todos]);

    // 할일 삭제
    const deleteTodo = useCallback(async (id: number) => {
      try {
        const res = await fetch(`/api/todos/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to delete todo");
        setTodos(prev => prev.filter(t => t.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    }, []);

    // 실시간 업데이트 (WebSocket)
    useEffect(() => {
      const ws = new WebSocket(`ws://${window.location.host}/ws/todos`);

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        switch (message.type) {
          case "todo:created":
            setTodos(prev => [...prev, message.data]);
            break;
          case "todo:updated":
            setTodos(prev => prev.map(t =>
              t.id === message.data.id ? message.data : t
            ));
            break;
          case "todo:deleted":
            setTodos(prev => prev.filter(t => t.id !== message.data.id));
            break;
        }
      };

      return () => ws.close();
    }, []);

    // render 함수에 전달할 상태/함수들
    return {
      todos: filteredTodos,
      totalCount: todos.length,
      loading,
      error,
      filter,
      setFilter,
      addTodo,
      toggleTodo,
      deleteTodo,
      user: serverData.user
    };
  },

  /**
   * Render Phase
   * - setup에서 반환된 값을 props로 받음
   * - 순수 렌더링 로직만 포함
   */
  render: ({
    todos,
    totalCount,
    loading,
    error,
    filter,
    setFilter,
    addTodo,
    toggleTodo,
    deleteTodo,
    user
  }) => (
    <div className="todo-app">
      {/* 헤더 */}
      <header className="todo-header">
        <h1>📝 할일 목록</h1>
        {user && <span>안녕하세요, {user.name}님!</span>}
      </header>

      {/* 에러 표시 */}
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {/* 입력 폼 */}
      <TodoInput onAdd={addTodo} disabled={loading} />

      {/* 필터 */}
      <TodoFilter
        current={filter}
        onChange={setFilter}
        counts={{
          all: totalCount,
          active: todos.filter(t => !t.completed).length,
          completed: todos.filter(t => t.completed).length
        }}
      />

      {/* 할일 목록 */}
      <TodoList
        todos={todos}
        onToggle={toggleTodo}
        onDelete={deleteTodo}
        loading={loading}
      />

      {/* 요약 */}
      <footer className="todo-footer">
        총 {totalCount}개 중 {todos.filter(t => !t.completed).length}개 남음
      </footer>
    </div>
  )
});

// 하위 컴포넌트들
function TodoInput({ onAdd, disabled }: { onAdd: (text: string) => void; disabled: boolean }) {
  const [text, setText] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(text);
    setText("");
  };

  return (
    <form onSubmit={handleSubmit} className="todo-input">
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="할일을 입력하세요..."
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !text.trim()}>
        {disabled ? "추가 중..." : "추가"}
      </button>
    </form>
  );
}

function TodoFilter({ current, onChange, counts }: {
  current: string;
  onChange: (filter: "all" | "active" | "completed") => void;
  counts: { all: number; active: number; completed: number };
}) {
  return (
    <div className="todo-filter" role="tablist">
      {(["all", "active", "completed"] as const).map(f => (
        <button
          key={f}
          role="tab"
          aria-selected={current === f}
          onClick={() => onChange(f)}
          className={current === f ? "active" : ""}
        >
          {f === "all" ? "전체" : f === "active" ? "진행중" : "완료"} ({counts[f]})
        </button>
      ))}
    </div>
  );
}

function TodoList({ todos, onToggle, onDelete, loading }: {
  todos: Todo[];
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  loading: boolean;
}) {
  if (todos.length === 0) {
    return <p className="empty-message">할일이 없습니다 🎉</p>;
  }

  return (
    <ul className="todo-list">
      {todos.map(todo => (
        <li key={todo.id} className={todo.completed ? "completed" : ""}>
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() => onToggle(todo.id)}
            disabled={loading}
          />
          <span className="todo-text">{todo.text}</span>
          <button
            onClick={() => onDelete(todo.id)}
            disabled={loading}
            aria-label="삭제"
          >
            🗑️
          </button>
        </li>
      ))}
    </ul>
  );
}
```

### 4.3 Slot API 정의

```typescript
// packages/core/src/client/island.ts

import { hydrateRoot } from "react-dom/client";
import type { ReactNode } from "react";

interface IslandDefinition<TServerData, TSetupResult> {
  /**
   * Setup 함수
   * - 서버 데이터를 받아 클라이언트 상태 초기화
   * - React hooks 사용 가능
   * - 반환값이 render에 전달됨
   */
  setup: (serverData: TServerData) => TSetupResult;

  /**
   * Render 함수
   * - setup 반환값을 props로 받음
   * - JSX 반환
   */
  render: (props: TSetupResult) => ReactNode;

  /**
   * Hydration 전 실행 (선택)
   * - DOM 조작, 이벤트 리스너 등
   */
  beforeHydrate?: (element: HTMLElement, serverData: TServerData) => void;

  /**
   * Hydration 후 실행 (선택)
   * - Analytics, 성능 측정 등
   */
  afterHydrate?: (element: HTMLElement) => void;

  /**
   * 에러 발생 시 fallback (선택)
   */
  errorBoundary?: (error: Error) => ReactNode;
}

/**
 * Island 컴포넌트 생성
 */
export function island<TServerData = any, TSetupResult = any>(
  definition: IslandDefinition<TServerData, TSetupResult>
) {
  // Island 컴포넌트
  function IslandComponent({ serverData }: { serverData: TServerData }) {
    const setupResult = definition.setup(serverData);
    return <>{definition.render(setupResult)}</>;
  }

  // Hydration 함수 (runtime에서 호출)
  function hydrate(element: HTMLElement, serverData: TServerData) {
    if (definition.beforeHydrate) {
      definition.beforeHydrate(element, serverData);
    }

    try {
      const root = hydrateRoot(
        element,
        definition.errorBoundary ? (
          <ErrorBoundary fallback={definition.errorBoundary}>
            <IslandComponent serverData={serverData} />
          </ErrorBoundary>
        ) : (
          <IslandComponent serverData={serverData} />
        )
      );

      if (definition.afterHydrate) {
        definition.afterHydrate(element);
      }

      return root;
    } catch (error) {
      console.error("[Mandu] Hydration failed:", error);
      if (definition.errorBoundary) {
        element.innerHTML = "";
        const root = hydrateRoot(
          element,
          <>{definition.errorBoundary(error as Error)}</>
        );
        return root;
      }
      throw error;
    }
  }

  return {
    Component: IslandComponent,
    hydrate,
    __mandu_island: true
  };
}
```

---

## 5. 번들러 시스템

### 5.1 Bun.build 기반 번들러

```typescript
// packages/core/src/bundler/build.ts

import type { RoutesManifest, RouteSpec } from "../spec/schema";
import type { BuildOutput } from "bun";
import path from "path";
import fs from "fs/promises";

export interface BundleResult {
  success: boolean;
  outputs: BundleOutput[];
  errors: string[];
  manifest: BundleManifest;
  stats: BundleStats;
}

export interface BundleOutput {
  routeId: string;
  entrypoint: string;
  outputPath: string;
  size: number;
  gzipSize: number;
}

export interface BundleManifest {
  version: number;
  buildTime: string;
  bundles: Record<string, {
    js: string;
    css?: string;
    dependencies: string[];
  }>;
  shared: {
    runtime: string;
    vendor: string;
  };
}

export interface BundleStats {
  totalSize: number;
  totalGzipSize: number;
  largestBundle: { routeId: string; size: number };
  buildTime: number;
}

/**
 * 클라이언트 번들 빌드
 */
export async function buildClientBundles(
  manifest: RoutesManifest,
  rootDir: string,
  options: {
    minify?: boolean;
    sourcemap?: boolean;
    watch?: boolean;
  } = {}
): Promise<BundleResult> {
  const startTime = performance.now();
  const outputs: BundleOutput[] = [];
  const errors: string[] = [];

  // 1. Hydration이 필요한 라우트 필터링
  const hydratedRoutes = manifest.routes.filter(route =>
    route.kind === "page" &&
    route.clientModule &&
    route.hydration?.strategy !== "none"
  );

  if (hydratedRoutes.length === 0) {
    return {
      success: true,
      outputs: [],
      errors: [],
      manifest: createEmptyManifest(),
      stats: { totalSize: 0, totalGzipSize: 0, largestBundle: { routeId: "", size: 0 }, buildTime: 0 }
    };
  }

  // 2. 출력 디렉토리 생성
  const outDir = path.join(rootDir, ".mandu/client");
  await fs.mkdir(outDir, { recursive: true });

  // 3. Runtime 번들 빌드
  const runtimeResult = await buildRuntime(outDir, options);
  if (!runtimeResult.success) {
    errors.push(...runtimeResult.errors);
  }

  // 4. 공유 의존성 번들 빌드 (React 등)
  const vendorResult = await buildVendor(outDir, options);
  if (!vendorResult.success) {
    errors.push(...vendorResult.errors);
  }

  // 5. 각 Island 번들 빌드
  for (const route of hydratedRoutes) {
    try {
      const result = await buildIsland(route, rootDir, outDir, options);
      outputs.push(result);
    } catch (error) {
      errors.push(`Failed to build island for ${route.id}: ${error}`);
    }
  }

  // 6. 번들 매니페스트 생성
  const bundleManifest = createBundleManifest(outputs, runtimeResult, vendorResult);
  await fs.writeFile(
    path.join(rootDir, ".mandu/manifest.json"),
    JSON.stringify(bundleManifest, null, 2)
  );

  // 7. 통계 계산
  const stats = calculateStats(outputs, startTime);

  return {
    success: errors.length === 0,
    outputs,
    errors,
    manifest: bundleManifest,
    stats
  };
}

/**
 * 단일 Island 번들 빌드
 */
async function buildIsland(
  route: RouteSpec,
  rootDir: string,
  outDir: string,
  options: { minify?: boolean; sourcemap?: boolean }
): Promise<BundleOutput> {
  const entrypoint = path.join(rootDir, route.clientModule!);
  const outputName = `${route.id}.island.js`;

  // Island wrapper 생성
  const wrapperContent = `
    import island from "${entrypoint}";
    import { registerIsland } from "./_runtime.js";

    registerIsland("${route.id}", () => island);

    export default island;
  `;

  const wrapperPath = path.join(outDir, `_entry_${route.id}.ts`);
  await Bun.write(wrapperPath, wrapperContent);

  // Bun.build 실행
  const result = await Bun.build({
    entrypoints: [wrapperPath],
    outdir: outDir,
    naming: outputName,
    minify: options.minify ?? process.env.NODE_ENV === "production",
    sourcemap: options.sourcemap ? "external" : "none",
    target: "browser",
    splitting: false, // Island 단위로 이미 분리됨
    external: ["react", "react-dom"], // vendor에서 제공
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development")
    }
  });

  // wrapper 파일 정리
  await fs.unlink(wrapperPath);

  if (!result.success) {
    throw new Error(result.logs.map(l => l.message).join("\n"));
  }

  const outputPath = path.join(outDir, outputName);
  const outputFile = Bun.file(outputPath);
  const content = await outputFile.text();
  const gzipped = Bun.gzipSync(Buffer.from(content));

  return {
    routeId: route.id,
    entrypoint: route.clientModule!,
    outputPath: `/.mandu/client/${outputName}`,
    size: outputFile.size,
    gzipSize: gzipped.length
  };
}

/**
 * Runtime 번들 빌드
 */
async function buildRuntime(
  outDir: string,
  options: { minify?: boolean; sourcemap?: boolean }
): Promise<{ success: boolean; errors: string[] }> {
  const runtimeSource = `
    // Mandu Hydration Runtime

    const islandRegistry = new Map();
    const islandData = window.__MANDU_DATA__ || {};

    export function registerIsland(id, loader) {
      islandRegistry.set(id, loader);
    }

    export async function hydrateIslands() {
      const islands = document.querySelectorAll('[data-mandu-island]');

      for (const el of islands) {
        const id = el.getAttribute('data-mandu-island');
        const priority = el.getAttribute('data-mandu-priority') || 'visible';
        const data = islandData[id];

        scheduleHydration(el, id, data, priority);
      }
    }

    function scheduleHydration(el, id, data, priority) {
      switch (priority) {
        case 'immediate':
          hydrateIsland(el, id, data);
          break;

        case 'visible':
          if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
              if (entries[0].isIntersecting) {
                observer.disconnect();
                hydrateIsland(el, id, data);
              }
            }, { rootMargin: '50px' });
            observer.observe(el);
          } else {
            hydrateIsland(el, id, data);
          }
          break;

        case 'idle':
          if ('requestIdleCallback' in window) {
            requestIdleCallback(() => hydrateIsland(el, id, data));
          } else {
            setTimeout(() => hydrateIsland(el, id, data), 200);
          }
          break;

        case 'interaction':
          const hydrate = () => {
            el.removeEventListener('mouseenter', hydrate);
            el.removeEventListener('focusin', hydrate);
            el.removeEventListener('touchstart', hydrate);
            hydrateIsland(el, id, data);
          };
          el.addEventListener('mouseenter', hydrate, { once: true, passive: true });
          el.addEventListener('focusin', hydrate, { once: true });
          el.addEventListener('touchstart', hydrate, { once: true, passive: true });
          break;
      }
    }

    async function hydrateIsland(el, id, data) {
      const loader = islandRegistry.get(id);
      if (!loader) {
        console.warn('[Mandu] Island not found:', id);
        return;
      }

      try {
        const island = await loader();
        await island.hydrate(el, data?.serverData || {});
        el.setAttribute('data-mandu-hydrated', 'true');

        // 성능 마커
        if (performance.mark) {
          performance.mark('mandu-hydrated-' + id);
        }
      } catch (error) {
        console.error('[Mandu] Hydration failed for', id, error);
        el.setAttribute('data-mandu-hydrated', 'error');
      }
    }

    // 자동 시작
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hydrateIslands);
    } else {
      hydrateIslands();
    }
  `;

  const runtimePath = path.join(outDir, "_runtime.ts");
  await Bun.write(runtimePath, runtimeSource);

  const result = await Bun.build({
    entrypoints: [runtimePath],
    outdir: outDir,
    naming: "_runtime.js",
    minify: options.minify ?? process.env.NODE_ENV === "production",
    sourcemap: options.sourcemap ? "external" : "none",
    target: "browser"
  });

  await fs.unlink(runtimePath);

  return {
    success: result.success,
    errors: result.success ? [] : result.logs.map(l => l.message)
  };
}

/**
 * Vendor (React) 번들 빌드
 */
async function buildVendor(
  outDir: string,
  options: { minify?: boolean; sourcemap?: boolean }
): Promise<{ success: boolean; errors: string[] }> {
  const vendorSource = `
    export * from "react";
    export * as ReactDOM from "react-dom";
    export * as ReactDOMClient from "react-dom/client";
  `;

  const vendorPath = path.join(outDir, "_vendor.ts");
  await Bun.write(vendorPath, vendorSource);

  const result = await Bun.build({
    entrypoints: [vendorPath],
    outdir: outDir,
    naming: "_vendor.js",
    minify: options.minify ?? process.env.NODE_ENV === "production",
    sourcemap: options.sourcemap ? "external" : "none",
    target: "browser"
  });

  await fs.unlink(vendorPath);

  return {
    success: result.success,
    errors: result.success ? [] : result.logs.map(l => l.message)
  };
}
```

### 5.2 개발 모드 (Watch + HMR)

```typescript
// packages/core/src/bundler/dev.ts

import type { RoutesManifest } from "../spec/schema";
import { buildClientBundles } from "./build";
import path from "path";
import fs from "fs";

interface DevServerOptions {
  rootDir: string;
  manifest: RoutesManifest;
  port: number;
  onRebuild?: (routeId: string) => void;
}

/**
 * 개발 모드 번들 감시
 */
export async function startDevBundler(options: DevServerOptions) {
  const { rootDir, manifest, onRebuild } = options;
  const slotsDir = path.join(rootDir, "spec/slots");

  // 초기 빌드
  console.log("🔨 Building client bundles...");
  const initialResult = await buildClientBundles(manifest, rootDir, {
    minify: false,
    sourcemap: true
  });

  if (!initialResult.success) {
    console.error("❌ Initial build failed:", initialResult.errors);
  } else {
    console.log(`✅ Built ${initialResult.outputs.length} islands`);
  }

  // 파일 감시
  const watcher = fs.watch(slotsDir, { recursive: true }, async (event, filename) => {
    if (!filename || !filename.endsWith(".client.ts")) return;

    const routeId = filename.replace(".client.ts", "");
    console.log(`🔄 Rebuilding island: ${routeId}`);

    try {
      // 해당 island만 재빌드
      const route = manifest.routes.find(r => r.id === routeId);
      if (route && route.clientModule) {
        await buildIsland(route, rootDir, path.join(rootDir, ".mandu/client"), {
          minify: false,
          sourcemap: true
        });
        console.log(`✅ Rebuilt: ${routeId}`);
        onRebuild?.(routeId);
      }
    } catch (error) {
      console.error(`❌ Rebuild failed for ${routeId}:`, error);
    }
  });

  return {
    close: () => watcher.close()
  };
}

/**
 * HMR WebSocket 서버
 */
export function createHMRServer(port: number) {
  const clients = new Set<WebSocket>();

  const server = Bun.serve({
    port: port + 1, // HMR은 메인 서버 + 1 포트
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("HMR Server", { status: 200 });
    },
    websocket: {
      open(ws) {
        clients.add(ws);
      },
      close(ws) {
        clients.delete(ws);
      },
      message(ws, message) {
        // 클라이언트 메시지 처리
      }
    }
  });

  return {
    broadcast(message: { type: string; data: any }) {
      const json = JSON.stringify(message);
      for (const client of clients) {
        client.send(json);
      }
    },
    close() {
      server.stop();
    }
  };
}
```

---

## 6. SSR 시스템 확장

### 6.1 SSR 렌더러 확장

```typescript
// packages/core/src/runtime/ssr.ts (확장)

import { renderToString } from "react-dom/server";
import type { RoutesManifest, RouteSpec } from "../spec/schema";
import type { BundleManifest } from "../bundler/build";
import type { Context } from "./context";

export interface SSRResult {
  html: string;
  data: Record<string, any>;
  head: string[];
  scripts: string[];
}

export interface SSROptions {
  route: RouteSpec;
  manifest: RoutesManifest;
  bundleManifest: BundleManifest;
  context: Context;
  component: React.ComponentType<any>;
}

/**
 * 확장된 SSR 렌더링
 */
export async function renderPage(options: SSROptions): Promise<SSRResult> {
  const { route, manifest, bundleManifest, context, component: Component } = options;

  // 1. Loader 데이터 로딩
  let loaderData = {};
  if (route.slotModule) {
    const slot = await import(route.slotModule);
    if (slot.default?.loader) {
      try {
        loaderData = await slot.default.loader(context);
      } catch (error) {
        console.error(`[Mandu] Loader failed for ${route.id}:`, error);
        loaderData = route.loader?.fallback || {};
      }
    }
  }

  // 2. 컴포넌트 렌더링
  const componentHtml = renderToString(<Component data={loaderData} />);

  // 3. Island 마커로 감싸기
  const islandHtml = wrapWithIslandMarker(componentHtml, route);

  // 4. 데이터 스크립트 생성
  const dataScript = generateDataScript(route.id, loaderData);

  // 5. 번들 스크립트 태그 생성
  const scripts = generateScriptTags(route, bundleManifest);

  // 6. Head 태그 생성 (preload 등)
  const head = generateHeadTags(route, bundleManifest);

  return {
    html: islandHtml,
    data: { [route.id]: loaderData },
    head,
    scripts: [dataScript, ...scripts]
  };
}

/**
 * Island 마커로 감싸기
 */
function wrapWithIslandMarker(html: string, route: RouteSpec): string {
  if (route.hydration?.strategy === "none") {
    return html;
  }

  const priority = route.hydration?.priority || "visible";

  return `<div data-mandu-island="${route.id}" data-mandu-priority="${priority}">${html}</div>`;
}

/**
 * 데이터 스크립트 생성
 */
function generateDataScript(routeId: string, data: any): string {
  const serialized = JSON.stringify(data)
    .replace(/</g, "\\u003c")  // XSS 방지
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return `<script>window.__MANDU_DATA__=window.__MANDU_DATA__||{};window.__MANDU_DATA__["${routeId}"]={serverData:${serialized}}</script>`;
}

/**
 * 스크립트 태그 생성
 */
function generateScriptTags(route: RouteSpec, bundleManifest: BundleManifest): string[] {
  if (route.hydration?.strategy === "none") {
    return [];
  }

  const scripts: string[] = [];

  // Vendor (React)
  scripts.push(`<script type="module" src="${bundleManifest.shared.vendor}"></script>`);

  // Runtime
  scripts.push(`<script type="module" src="${bundleManifest.shared.runtime}"></script>`);

  // Island 번들
  const bundle = bundleManifest.bundles[route.id];
  if (bundle) {
    scripts.push(`<script type="module" src="${bundle.js}"></script>`);
    if (bundle.css) {
      scripts.push(`<link rel="stylesheet" href="${bundle.css}">`);
    }
  }

  return scripts;
}

/**
 * Head 태그 생성 (preload)
 */
function generateHeadTags(route: RouteSpec, bundleManifest: BundleManifest): string[] {
  const head: string[] = [];

  if (route.hydration?.preload) {
    // Vendor preload
    head.push(`<link rel="modulepreload" href="${bundleManifest.shared.vendor}">`);

    // Runtime preload
    head.push(`<link rel="modulepreload" href="${bundleManifest.shared.runtime}">`);

    // Island preload
    const bundle = bundleManifest.bundles[route.id];
    if (bundle) {
      head.push(`<link rel="modulepreload" href="${bundle.js}">`);
    }
  }

  return head;
}

/**
 * 전체 HTML 문서 생성
 */
export function generateHTMLDocument(
  ssrResult: SSRResult,
  options: {
    title?: string;
    lang?: string;
    charset?: string;
  } = {}
): string {
  const { title = "Mandu App", lang = "ko", charset = "utf-8" } = options;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="${charset}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${ssrResult.head.join("\n  ")}
</head>
<body>
  <div id="root">${ssrResult.html}</div>
  ${ssrResult.scripts.join("\n  ")}
</body>
</html>`;
}
```

---

## 7. Guard 규칙 확장

### 7.1 클라이언트 코드 Guard 규칙

```typescript
// packages/core/src/guard/rules.ts (확장)

export const GUARD_RULES = {
  // 기존 규칙들...

  // ========== 클라이언트 전용 규칙 ==========

  /**
   * 클라이언트 슬롯에서 서버 전용 모듈 import 금지
   */
  CLIENT_SERVER_IMPORT: {
    id: "CLIENT_SERVER_IMPORT",
    description: "클라이언트 슬롯에서 서버 전용 모듈 import 금지",
    severity: "error",
    appliesTo: "client",
    forbiddenPatterns: [
      /import\s+.*from\s+['"]fs['"]/,
      /import\s+.*from\s+['"]path['"]/,
      /import\s+.*from\s+['"]child_process['"]/,
      /import\s+.*from\s+['"]crypto['"]/,
      /import\s+.*from\s+['"]node:/,
      /require\s*\(\s*['"]fs['"]\s*\)/,
    ],
    suggestion: "클라이언트 코드에서는 브라우저 API만 사용하세요",
    autoFixable: false
  },

  /**
   * 클라이언트에서 직접 DB 접근 금지
   */
  CLIENT_DIRECT_DB: {
    id: "CLIENT_DIRECT_DB",
    description: "클라이언트에서 직접 데이터베이스 접근 금지",
    severity: "error",
    appliesTo: "client",
    forbiddenPatterns: [
      /import\s+.*from\s+['"].*prisma/,
      /import\s+.*from\s+['"].*drizzle/,
      /import\s+.*from\s+['"].*mongoose/,
      /import\s+.*from\s+['"].*typeorm/,
      /import\s+.*from\s+['"].*sequelize/,
    ],
    suggestion: "API를 통해 데이터를 가져오세요: fetch('/api/...')",
    autoFixable: false
  },

  /**
   * 클라이언트에서 민감한 환경변수 사용 금지
   */
  CLIENT_ENV_EXPOSURE: {
    id: "CLIENT_ENV_EXPOSURE",
    description: "클라이언트에서 민감한 환경변수 노출 금지",
    severity: "error",
    appliesTo: "client",
    forbiddenPatterns: [
      /process\.env\.(DATABASE|DB_)/i,
      /process\.env\.(SECRET|PRIVATE)/i,
      /process\.env\.(API_KEY|APIKEY)/i,
      /process\.env\.(PASSWORD|PASSWD)/i,
      /process\.env\.(TOKEN(?!_PUBLIC))/i,
    ],
    suggestion: "민감한 정보는 서버에서만 사용하고, 필요시 API로 전달하세요",
    autoFixable: false
  },

  /**
   * Island 간 전역 상태 공유 금지
   */
  ISLAND_GLOBAL_STATE: {
    id: "ISLAND_GLOBAL_STATE",
    description: "Island 간 전역 상태 직접 공유 금지",
    severity: "warning",
    appliesTo: "client",
    forbiddenPatterns: [
      /window\.__ISLAND_STATE__/,
      /globalThis\.__MANDU_SHARED__/,
      /window\.GLOBAL_STATE/,
    ],
    suggestion: "Island 간 통신은 이벤트 또는 API를 통해 하세요",
    autoFixable: false
  },

  /**
   * 클라이언트 슬롯에서 Mandu.island() 패턴 필수
   */
  CLIENT_ISLAND_PATTERN: {
    id: "CLIENT_ISLAND_PATTERN",
    description: "클라이언트 슬롯은 Mandu.island() 패턴을 사용해야 함",
    severity: "error",
    appliesTo: "client",
    requiredPattern: /Mandu\s*\.\s*island\s*\(/,
    suggestion: "export default Mandu.island({ setup: ..., render: ... }) 형태로 작성하세요",
    autoFixable: false
  },

  /**
   * setup 함수에서 조건부 훅 호출 금지
   */
  CONDITIONAL_HOOKS: {
    id: "CONDITIONAL_HOOKS",
    description: "setup 함수에서 조건부 훅 호출 금지",
    severity: "error",
    appliesTo: "client",
    forbiddenPatterns: [
      /if\s*\([^)]*\)\s*\{[^}]*use[A-Z]/,  // if (...) { useState/useEffect }
      /\?\s*use[A-Z]/,  // condition ? useState() : ...
    ],
    suggestion: "React 훅은 항상 최상위 레벨에서 호출되어야 합니다",
    autoFixable: false
  },

  /**
   * 클라이언트 번들 크기 제한
   */
  CLIENT_BUNDLE_SIZE: {
    id: "CLIENT_BUNDLE_SIZE",
    description: "클라이언트 번들 크기 초과",
    severity: "warning",
    appliesTo: "bundle",
    maxSize: 100 * 1024, // 100KB per island (gzip 전)
    suggestion: "코드를 분리하거나 dynamic import를 사용하세요",
    autoFixable: false
  },

  /**
   * 클라이언트에서 동기 XHR 금지
   */
  SYNC_XHR: {
    id: "SYNC_XHR",
    description: "동기 XMLHttpRequest 사용 금지",
    severity: "error",
    appliesTo: "client",
    forbiddenPatterns: [
      /\.open\s*\([^,]+,\s*[^,]+,\s*false\s*\)/,
    ],
    suggestion: "비동기 fetch() 또는 async/await를 사용하세요",
    autoFixable: false
  }
};

/**
 * 클라이언트 슬롯 검증
 */
export async function validateClientSlot(
  content: string,
  routeId: string
): Promise<GuardCheckResult> {
  const violations: GuardViolation[] = [];
  const lines = content.split("\n");

  // 적용 가능한 규칙 필터링
  const clientRules = Object.values(GUARD_RULES).filter(
    rule => rule.appliesTo === "client"
  );

  for (const rule of clientRules) {
    // 금지 패턴 검사
    if (rule.forbiddenPatterns) {
      for (let i = 0; i < lines.length; i++) {
        for (const pattern of rule.forbiddenPatterns) {
          if (pattern.test(lines[i])) {
            violations.push({
              ruleId: rule.id,
              file: `spec/slots/${routeId}.client.ts`,
              line: i + 1,
              message: rule.description,
              suggestion: rule.suggestion,
              severity: rule.severity
            });
          }
        }
      }
    }

    // 필수 패턴 검사
    if (rule.requiredPattern && !rule.requiredPattern.test(content)) {
      violations.push({
        ruleId: rule.id,
        file: `spec/slots/${routeId}.client.ts`,
        message: rule.description,
        suggestion: rule.suggestion,
        severity: rule.severity
      });
    }
  }

  return {
    passed: violations.filter(v => v.severity === "error").length === 0,
    violations
  };
}
```

---

## 8. MCP 도구 확장

### 8.1 클라이언트 관련 MCP 도구

```typescript
// packages/mcp/src/tools/client.ts

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  loadManifest,
  validateClientSlot,
  buildClientBundles
} from "@mandujs/core";
import { getProjectPaths, isInsideProject } from "../utils/project.js";
import path from "path";
import fs from "fs/promises";

export const clientToolDefinitions: Tool[] = [
  {
    name: "mandu_write_client_slot",
    description: "Write or update a client-side slot file for island hydration",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID whose client slot to write"
        },
        content: {
          type: "string",
          description: "The TypeScript content for the client slot"
        },
        autoCorrect: {
          type: "boolean",
          description: "Automatically fix correctable issues (default: false)"
        },
        validateOnly: {
          type: "boolean",
          description: "Only validate without writing (default: false)"
        }
      },
      required: ["routeId", "content"]
    }
  },

  {
    name: "mandu_set_hydration",
    description: "Configure hydration strategy for a route",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to configure"
        },
        strategy: {
          type: "string",
          enum: ["none", "island", "full", "progressive"],
          description: "Hydration strategy"
        },
        priority: {
          type: "string",
          enum: ["immediate", "visible", "idle", "interaction"],
          description: "When to hydrate (default: visible)"
        },
        preload: {
          type: "boolean",
          description: "Whether to preload the bundle (default: false)"
        }
      },
      required: ["routeId", "strategy"]
    }
  },

  {
    name: "mandu_build_client",
    description: "Build client bundles for all islands",
    inputSchema: {
      type: "object",
      properties: {
        minify: {
          type: "boolean",
          description: "Minify the output (default: based on NODE_ENV)"
        },
        sourcemap: {
          type: "boolean",
          description: "Generate sourcemaps (default: true in development)"
        },
        routeId: {
          type: "string",
          description: "Build only a specific route's bundle (optional)"
        }
      }
    }
  },

  {
    name: "mandu_analyze_bundle",
    description: "Analyze client bundle size and dependencies",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to analyze (optional, analyzes all if omitted)"
        },
        detailed: {
          type: "boolean",
          description: "Show detailed dependency analysis (default: false)"
        }
      }
    }
  },

  {
    name: "mandu_validate_client_slot",
    description: "Validate client slot content against Guard rules",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to validate"
        },
        content: {
          type: "string",
          description: "The content to validate (optional, reads from file if omitted)"
        }
      },
      required: ["routeId"]
    }
  }
];

export function clientTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);

  return {
    mandu_write_client_slot: async (args: Record<string, unknown>) => {
      const { routeId, content, autoCorrect = false, validateOnly = false } = args as {
        routeId: string;
        content: string;
        autoCorrect?: boolean;
        validateOnly?: boolean;
      };

      // 1. manifest 로드
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) {
        return { error: manifestResult.errors };
      }

      // 2. 라우트 찾기
      const route = manifestResult.data.routes.find(r => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      // 3. clientModule 경로 결정
      const clientModule = route.clientModule || `spec/slots/${routeId}.client.ts`;
      const clientPath = path.join(projectRoot, clientModule);

      // 보안 검사
      if (!isInsideProject(clientPath, projectRoot)) {
        return { error: "Client slot path is outside project directory" };
      }

      // 4. 검증
      const validation = await validateClientSlot(content, routeId);

      if (validateOnly) {
        return {
          validateOnly: true,
          valid: validation.passed,
          violations: validation.violations,
          tip: validation.passed
            ? "Content is valid and ready to write"
            : "Fix the violations before writing"
        };
      }

      // 5. 에러가 있으면 쓰기 거부 (autoCorrect가 false인 경우)
      if (!validation.passed && !autoCorrect) {
        const errors = validation.violations.filter(v => v.severity === "error");
        return {
          success: false,
          valid: false,
          errors,
          tip: "Use autoCorrect: true or fix the errors manually"
        };
      }

      // 6. 파일 쓰기
      try {
        const slotDir = path.dirname(clientPath);
        await fs.mkdir(slotDir, { recursive: true });

        const file = Bun.file(clientPath);
        const existed = await file.exists();

        await Bun.write(clientPath, content);

        // 7. manifest 업데이트 (clientModule이 없었다면)
        if (!route.clientModule) {
          route.clientModule = clientModule;
          // hydration 기본값 설정
          if (!route.hydration) {
            route.hydration = { strategy: "island", priority: "visible" };
          }
          await Bun.write(
            paths.manifestPath,
            JSON.stringify(manifestResult.data, null, 2)
          );
        }

        return {
          success: true,
          clientModule,
          action: existed ? "updated" : "created",
          validation: {
            passed: validation.passed,
            warnings: validation.violations.filter(v => v.severity === "warning")
          },
          tip: "Run mandu_build_client to rebuild the bundle"
        };
      } catch (error) {
        return {
          error: `Failed to write client slot: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    },

    mandu_set_hydration: async (args: Record<string, unknown>) => {
      const { routeId, strategy, priority, preload } = args as {
        routeId: string;
        strategy: "none" | "island" | "full" | "progressive";
        priority?: "immediate" | "visible" | "idle" | "interaction";
        preload?: boolean;
      };

      // manifest 로드
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) {
        return { error: manifestResult.errors };
      }

      // 라우트 찾기
      const route = manifestResult.data.routes.find(r => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      // hydration 설정 업데이트
      route.hydration = {
        strategy,
        priority: priority || "visible",
        preload: preload || false
      };

      // manifest 저장
      await Bun.write(
        paths.manifestPath,
        JSON.stringify(manifestResult.data, null, 2)
      );

      return {
        success: true,
        routeId,
        hydration: route.hydration,
        tip: strategy === "none"
          ? "This route will be static HTML only"
          : `This route will use ${strategy} hydration with ${route.hydration.priority} priority`
      };
    },

    mandu_build_client: async (args: Record<string, unknown>) => {
      const { minify, sourcemap, routeId } = args as {
        minify?: boolean;
        sourcemap?: boolean;
        routeId?: string;
      };

      // manifest 로드
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) {
        return { error: manifestResult.errors };
      }

      // 빌드 실행
      const result = await buildClientBundles(manifestResult.data, projectRoot, {
        minify,
        sourcemap
      });

      if (!result.success) {
        return {
          success: false,
          errors: result.errors
        };
      }

      return {
        success: true,
        bundles: result.outputs.map(o => ({
          routeId: o.routeId,
          path: o.outputPath,
          size: `${(o.size / 1024).toFixed(2)} KB`,
          gzipSize: `${(o.gzipSize / 1024).toFixed(2)} KB`
        })),
        stats: {
          totalSize: `${(result.stats.totalSize / 1024).toFixed(2)} KB`,
          buildTime: `${result.stats.buildTime.toFixed(0)} ms`
        }
      };
    },

    mandu_analyze_bundle: async (args: Record<string, unknown>) => {
      const { routeId, detailed } = args as {
        routeId?: string;
        detailed?: boolean;
      };

      const bundleManifestPath = path.join(projectRoot, ".mandu/manifest.json");
      const file = Bun.file(bundleManifestPath);

      if (!(await file.exists())) {
        return {
          error: "No bundle manifest found. Run mandu_build_client first."
        };
      }

      const bundleManifest = await file.json();

      if (routeId) {
        const bundle = bundleManifest.bundles[routeId];
        if (!bundle) {
          return { error: `Bundle not found for route: ${routeId}` };
        }

        const bundleFile = Bun.file(path.join(projectRoot, bundle.js));
        const content = await bundleFile.text();
        const gzipped = Bun.gzipSync(Buffer.from(content));

        return {
          routeId,
          bundle: bundle.js,
          size: `${(bundleFile.size / 1024).toFixed(2)} KB`,
          gzipSize: `${(gzipped.length / 1024).toFixed(2)} KB`,
          dependencies: bundle.dependencies,
          recommendation: bundleFile.size > 100 * 1024
            ? "Consider code splitting or lazy loading"
            : "Bundle size is acceptable"
        };
      }

      // 전체 분석
      const analysis = Object.entries(bundleManifest.bundles).map(([id, bundle]: [string, any]) => ({
        routeId: id,
        bundle: bundle.js,
        dependencies: bundle.dependencies?.length || 0
      }));

      return {
        totalBundles: analysis.length,
        bundles: analysis,
        shared: bundleManifest.shared,
        buildTime: bundleManifest.buildTime
      };
    },

    mandu_validate_client_slot: async (args: Record<string, unknown>) => {
      const { routeId, content } = args as {
        routeId: string;
        content?: string;
      };

      let slotContent = content;

      // content가 없으면 파일에서 읽기
      if (!slotContent) {
        const clientPath = path.join(projectRoot, `spec/slots/${routeId}.client.ts`);
        const file = Bun.file(clientPath);

        if (!(await file.exists())) {
          return { error: `Client slot not found: ${routeId}` };
        }

        slotContent = await file.text();
      }

      const validation = await validateClientSlot(slotContent, routeId);

      return {
        valid: validation.passed,
        violations: validation.violations,
        summary: validation.passed
          ? "No issues found"
          : `${validation.violations.filter(v => v.severity === "error").length} errors, ${validation.violations.filter(v => v.severity === "warning").length} warnings`
      };
    }
  };
}
```

---

## 9. CLI 명령어 확장

### 9.1 새로운 CLI 명령어

```typescript
// packages/cli/src/commands/build.ts

import { buildClientBundles, loadManifest } from "@mandujs/core";
import path from "path";

interface BuildOptions {
  minify?: boolean;
  sourcemap?: boolean;
  watch?: boolean;
}

export async function buildCommand(options: BuildOptions = {}) {
  const rootDir = process.cwd();
  const manifestPath = path.join(rootDir, "spec/routes.manifest.json");

  console.log("🔨 Building client bundles...\n");

  // Manifest 로드
  const manifestResult = await loadManifest(manifestPath);
  if (!manifestResult.success || !manifestResult.data) {
    console.error("❌ Failed to load manifest:", manifestResult.errors);
    process.exit(1);
  }

  // 빌드 실행
  const startTime = performance.now();
  const result = await buildClientBundles(manifestResult.data, rootDir, {
    minify: options.minify ?? process.env.NODE_ENV === "production",
    sourcemap: options.sourcemap ?? process.env.NODE_ENV !== "production"
  });
  const duration = performance.now() - startTime;

  if (!result.success) {
    console.error("❌ Build failed:");
    result.errors.forEach(err => console.error(`   ${err}`));
    process.exit(1);
  }

  // 결과 출력
  console.log(`✅ Built ${result.outputs.length} islands in ${duration.toFixed(0)}ms\n`);

  console.log("📦 Bundles:");
  console.log("┌─────────────────┬────────────┬────────────┐");
  console.log("│ Route           │ Size       │ Gzip       │");
  console.log("├─────────────────┼────────────┼────────────┤");

  for (const output of result.outputs) {
    const size = (output.size / 1024).toFixed(2).padStart(7);
    const gzip = (output.gzipSize / 1024).toFixed(2).padStart(7);
    const id = output.routeId.padEnd(15);
    console.log(`│ ${id} │ ${size} KB │ ${gzip} KB │`);
  }

  console.log("└─────────────────┴────────────┴────────────┘");
  console.log(`\n총 크기: ${(result.stats.totalSize / 1024).toFixed(2)} KB`);

  // Watch 모드
  if (options.watch) {
    console.log("\n👀 Watching for changes...");
    // ... watch 로직
  }
}
```

### 9.2 dev 명령어 확장

```typescript
// packages/cli/src/commands/dev.ts (확장)

import { buildClientBundles, startDevBundler, createHMRServer } from "@mandujs/core";

export async function devCommand(options: DevOptions) {
  // ... 기존 코드 ...

  // 클라이언트 번들러 시작
  const hmrServer = createHMRServer(options.port);
  const devBundler = await startDevBundler({
    rootDir,
    manifest: manifestResult.data,
    port: options.port,
    onRebuild: (routeId) => {
      // HMR 신호 전송
      hmrServer.broadcast({
        type: "island-update",
        data: { routeId }
      });
    }
  });

  // 서버 시작
  // ...

  // 종료 시 정리
  process.on("SIGINT", () => {
    devBundler.close();
    hmrServer.close();
    process.exit(0);
  });
}
```

---

## 10. 구현 로드맵

### Phase 1: Foundation (MVP-0.4) - 2주

| 작업 | 설명 | 우선순위 |
|------|------|----------|
| Bun.build 번들러 | 기본 클라이언트 번들 생성 | P0 |
| Hydration Runtime | hydrateIslands() 구현 | P0 |
| SSR 데이터 주입 | __MANDU_DATA__ 생성 | P0 |
| Island 마커 | data-mandu-island 속성 | P0 |
| Spec 확장 | hydration 필드 추가 | P0 |
| mandu build | CLI 명령어 추가 | P1 |

### Phase 2: Islands (MVP-0.5) - 2주

| 작업 | 설명 | 우선순위 |
|------|------|----------|
| Client Slot | .client.ts 파일 지원 | P0 |
| Mandu.island() | 클라이언트 API | P0 |
| Priority Scheduling | visible/idle/interaction | P0 |
| Guard 확장 | 클라이언트 규칙 | P1 |
| MCP 도구 | 클라이언트 도구 추가 | P1 |

### Phase 3: DX (MVP-0.6) - 2주

| 작업 | 설명 | 우선순위 |
|------|------|----------|
| HMR | 파일 변경 시 자동 리로드 | P0 |
| 번들 분석 | 크기 분석 도구 | P1 |
| 에러 오버레이 | 개발 시 에러 표시 | P1 |
| TypeScript 지원 | 타입 추론 개선 | P1 |

### Phase 4: Advanced (MVP-1.0) - 4주

| 작업 | 설명 | 우선순위 |
|------|------|----------|
| Streaming SSR | renderToPipeableStream | P1 |
| Suspense | 데이터 로딩 Suspense | P1 |
| Progressive Hydration | 복잡한 페이지 최적화 | P2 |
| RSC (선택) | React Server Components | P2 |

---

## 11. 성능 목표

| 메트릭 | 목표 | 측정 방법 |
|--------|------|----------|
| FCP | < 1s | Lighthouse |
| LCP | < 2s | Lighthouse |
| TTI | < 3s | Lighthouse |
| TBT | < 200ms | Lighthouse |
| Island 번들 크기 | < 50KB (gzip) | mandu analyze |
| Hydration 시간 | < 100ms/island | Performance API |
| 빌드 시간 | < 3s | CLI 출력 |

---

## 12. 마이그레이션 가이드

### 기존 프로젝트 업그레이드

```bash
# 1. 패키지 업데이트
bun update @mandujs/core @mandujs/cli

# 2. spec.lock 재생성
bun run spec

# 3. 코드 재생성
bun run generate

# 4. 클라이언트 번들 빌드
bun run build

# 5. 개발 서버 시작
bun run dev
```

### Spec 마이그레이션

```json
// Before (v1)
{
  "version": 1,
  "routes": [
    { "id": "todos", "pattern": "/todos", "kind": "page" }
  ]
}

// After (v2)
{
  "version": 2,
  "routes": [
    {
      "id": "todos",
      "pattern": "/todos",
      "kind": "page",
      "slotModule": "spec/slots/todos.slot.ts",
      "clientModule": "spec/slots/todos.client.ts",
      "hydration": {
        "strategy": "island",
        "priority": "visible"
      }
    }
  ]
}
```

---

## 13. 결론

Mandu Hydration System은 다음을 달성한다:

1. **Spec = SSOT 유지**: Hydration 전략도 JSON에서 선언
2. **Slot = Island**: 자연스러운 개념 확장
3. **Agent-Native**: MCP로 모든 것을 조작 가능
4. **Guard 확장**: 클라이언트 코드도 보호
5. **성능 최적화**: Priority-based partial hydration
6. **개발자 경험**: HMR, 에러 오버레이, 타입 안전성

이 설계는 Mandu를 "AI 에이전트와 인간이 함께 개발하는 최고의 프레임워크"로 만드는 핵심 기능이다.
