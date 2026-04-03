# Mandu Hydration System 상세 기획서

> **목표**: Spec-driven, Agent-native, Guard-protected Islands Architecture
> **버전**: MVP-0.4 ~ MVP-1.0
> **작성일**: 2025-01-28

> 구현 현황 노트 (2026-01-30): Spec 스키마 확장, 클라이언트 번들러/런타임, SSR 통합, CLI build, MCP Hydration 도구가 코드에 반영됨.  
> 미구현/실험적 항목(예: client reviver/partials, 고급 Guard/분석)은 `docs/status.md` 기준으로 본다.

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

1. **FS Routes = 라우트 소스**: Hydration 전략도 라우트 파일에서 선언
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
│   └── slots/
│       ├── todos.slot.ts         # 서버 로직 (API, loader)
│
├── apps/
│   ├── server/
│   │   ├── main.ts
│   │   └── generated/
│   │       └── routes/
│   │           └── todos.route.ts
│   └── web/
│       ├── entry.tsx
│       ├── components/
│       │   └── todos.client.tsx  # 클라이언트 로직 (React hooks)
│       └── generated/
│           └── routes/
│               └── todos.route.tsx
│
├── .mandu/                        # [NEW] 빌드 결과물
│   ├── client/
│   │   ├── _runtime.js           # Hydration runtime
│   │   ├── _router.js            # Client-side Router runtime
│   │   ├── _react.js             # React shim
│   │   ├── _react-dom.js         # ReactDOM shim
│   │   ├── _react-dom-client.js  # ReactDOM Client shim
│   │   ├── _jsx-runtime.js       # JSX runtime shim
│   │   ├── _jsx-dev-runtime.js   # JSX dev runtime shim
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

  // generated module paths
  module: string;
  componentModule?: string;

  // slot modules
  slotModule?: string;
  clientModule?: string;
  contractModule?: string;

  // hydration + loader
  hydration?: HydrationConfig;
  loader?: LoaderConfig;

  // Streaming SSR (route override)
  streaming?: boolean;
}

interface HydrationConfig {
  strategy: "none" | "island" | "full" | "progressive";
  priority?: "immediate" | "visible" | "idle" | "interaction";
  preload?: boolean;
}

interface LoaderConfig {
  timeout?: number;
  fallback?: Record<string, unknown>;
}
```

> 실제 스키마 제약:
> - `kind: "page"`이면 `componentModule`은 필수
> - `clientModule`이 있으면 `hydration.strategy`는 `"none"`일 수 없음

### 3.2 Spec 예시

```json
{
  "version": 2,
  "routes": [
    {
      "id": "home",
      "pattern": "/",
      "kind": "page",
      "module": "apps/server/generated/routes/home.route.ts",
      "componentModule": "apps/web/generated/routes/home.route.tsx",
      "hydration": {
        "strategy": "none"
      }
    },
    {
      "id": "todos",
      "pattern": "/todos",
      "kind": "page",
      "module": "apps/server/generated/routes/todos.route.ts",
      "componentModule": "apps/web/generated/routes/todos.route.tsx",
      "slotModule": "spec/slots/todos.slot.ts",
      "clientModule": "apps/web/components/todos.client.tsx",
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
      "module": "apps/server/generated/routes/dashboard.route.ts",
      "componentModule": "apps/web/generated/routes/dashboard.route.tsx",
      "slotModule": "spec/slots/dashboard.slot.ts",
      "clientModule": "apps/web/components/dashboard.client.tsx",
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
      "module": "apps/server/generated/routes/todos-api.route.ts",
      "slotModule": "spec/slots/todos.slot.ts",
      "contractModule": "spec/contracts/todos.contract.ts"
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
import type { ManduContext } from "@mandujs/core";

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
  .loader(async (ctx: ManduContext): Promise<TodosLoaderData> => {
    // 병렬로 데이터 로딩
    const apiUrl = process.env.API_URL ?? "http://localhost:3000";
    const session = ctx.cookies.get("session");
    const cookieHeader = session ? `session=${encodeURIComponent(session)}` : undefined;
    const [todosRes, userRes] = await Promise.all([
      fetch(`${apiUrl}/todos`),
      session
        ? fetch(`${apiUrl}/me`, {
            headers: { Cookie: cookieHeader }
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
// apps/web/components/todos.client.tsx
import { ManduClient } from "@mandujs/core/client";
import { useState, useEffect, useCallback, useMemo } from "react";
// 필요 시 서버 slot 타입을 가져올 수 있음 (프로젝트 구조에 맞게 경로 조정)
import type { TodosLoaderData, Todo } from "../../../spec/slots/todos.slot";

/**
 * Client Island 정의
 *
 * setup: 서버 데이터를 받아 클라이언트 상태 초기화
 * render: React 컴포넌트 렌더링
 */
export default ManduClient.island<TodosLoaderData>({
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
// packages/core/src/client/island.ts (발췌)

import type { ReactNode } from "react";

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
   * - setup 반환값을 props로 받음
   */
  render: (props: TSetupResult) => ReactNode;

  /**
   * Optional: 에러 UI
   */
  errorBoundary?: (error: Error, reset: () => void) => ReactNode;

  /**
   * Optional: 로딩 UI
   */
  loading?: () => ReactNode;
}

export interface CompiledIsland<TServerData, TSetupResult> {
  definition: IslandDefinition<TServerData, TSetupResult>;
  __mandu_island: true;
  __mandu_island_id?: string;
}

export function island<TServerData, TSetupResult = TServerData>(
  definition: IslandDefinition<TServerData, TSetupResult>
): CompiledIsland<TServerData, TSetupResult> {
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
```

> 현재 런타임(v0.8.0)은 `setup`/`render`만 사용하며, `errorBoundary`/`loading`은 정의만 존재하는 예약 필드입니다.

---

## 5. 번들러 시스템

### 5.1 Bun.build 기반 번들러

```typescript
// packages/core/src/bundler/build.ts (v0.8.0 핵심)

import type { RoutesManifest, RouteSpec } from "../spec/schema";
import { needsHydration, getRouteHydration } from "../spec/schema";
import type { BundleResult, BundleOutput, BundlerOptions } from "./types";
import path from "path";
import fs from "fs/promises";

/**
 * Runtime 번들 소스 생성 (v0.8.0)
 * - data-mandu-src 기반 dynamic import
 * - 글로벌 registry 없음
 */
function generateRuntimeSource(): string {
  return `
import React from 'react';
import { hydrateRoot } from 'react-dom/client';

const hydratedRoots = new Map();
const getServerData = (id) => (window.__MANDU_DATA__ || {})[id]?.serverData || {};

function scheduleHydration(element, src, priority) {
  switch (priority) {
    case 'immediate':
      loadAndHydrate(element, src);
      break;
    case 'visible':
      if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) {
            observer.disconnect();
            loadAndHydrate(element, src);
          }
        }, { rootMargin: '50px' });
        observer.observe(element);
      } else {
        loadAndHydrate(element, src);
      }
      break;
    case 'idle':
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => loadAndHydrate(element, src));
      } else {
        setTimeout(() => loadAndHydrate(element, src), 200);
      }
      break;
    case 'interaction': {
      const hydrate = () => {
        element.removeEventListener('mouseenter', hydrate);
        element.removeEventListener('focusin', hydrate);
        element.removeEventListener('touchstart', hydrate);
        loadAndHydrate(element, src);
      };
      element.addEventListener('mouseenter', hydrate, { once: true, passive: true });
      element.addEventListener('focusin', hydrate, { once: true });
      element.addEventListener('touchstart', hydrate, { once: true, passive: true });
      break;
    }
  }
}

async function loadAndHydrate(element, src) {
  const id = element.getAttribute('data-mandu-island');
  const module = await import(src);
  const island = module.default;
  if (!island || !island.__mandu_island) throw new Error('[Mandu] Invalid island: ' + id);

  const { definition } = island;
  const data = getServerData(id);
  function IslandComponent() {
    const setupResult = definition.setup(data);
    return definition.render(setupResult);
  }

  const root = hydrateRoot(element, React.createElement(IslandComponent));
  hydratedRoots.set(id, root);
  element.setAttribute('data-mandu-hydrated', 'true');
}

function hydrateIslands() {
  const islands = document.querySelectorAll('[data-mandu-island]');
  for (const el of islands) {
    const id = el.getAttribute('data-mandu-island');
    const src = el.getAttribute('data-mandu-src');
    const priority = el.getAttribute('data-mandu-priority') || 'visible';
    if (!id || !src) continue;
    scheduleHydration(el, src, priority);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydrateIslands);
} else {
  hydrateIslands();
}
`;
}

function generateIslandEntry(routeId: string, clientModulePath: string): string {
  const normalizedPath = clientModulePath.replace(/\\/g, "/");
  return `
/**
 * Mandu Island: ${routeId} (Generated)
 * Pure export - no side effects
 */
import island from "${normalizedPath}";
export default island;
`;
}

async function buildRuntime(outDir: string, options: BundlerOptions) {
  const runtimePath = path.join(outDir, "_runtime.src.js");
  const outputName = "_runtime.js";
  await Bun.write(runtimePath, generateRuntimeSource());
  const result = await Bun.build({
    entrypoints: [runtimePath],
    outdir: outDir,
    naming: outputName,
    target: "browser",
    external: ["react", "react-dom", "react-dom/client"],
    minify: options.minify ?? process.env.NODE_ENV === "production",
    sourcemap: options.sourcemap ? "external" : "none",
  });
  await fs.unlink(runtimePath).catch(() => {});
  return {
    success: result.success,
    outputPath: result.success ? `/.mandu/client/${outputName}` : "",
    errors: result.success ? [] : result.logs.map((l) => l.message),
  };
}

async function buildIsland(
  route: RouteSpec,
  rootDir: string,
  outDir: string,
  options: BundlerOptions
): Promise<BundleOutput> {
  const entryPath = path.join(outDir, `_entry_${route.id}.js`);
  await Bun.write(entryPath, generateIslandEntry(route.id, path.join(rootDir, route.clientModule!)));

  const result = await Bun.build({
    entrypoints: [entryPath],
    outdir: outDir,
    naming: `${route.id}.island.js`,
    target: "browser",
    splitting: false,
    external: ["react", "react-dom", "react-dom/client", ...(options.external || [])],
    minify: options.minify ?? process.env.NODE_ENV === "production",
    sourcemap: options.sourcemap ? "external" : "none",
  });
  await fs.unlink(entryPath).catch(() => {});
  if (!result.success) throw new Error(result.logs.map((l) => l.message).join("\n"));
  const outputFile = Bun.file(path.join(outDir, `${route.id}.island.js`));
  const content = await outputFile.text();
  const gzipped = Bun.gzipSync(Buffer.from(content));
  return {
    routeId: route.id,
    entrypoint: route.clientModule!,
    outputPath: `/.mandu/client/${route.id}.island.js`,
    size: outputFile.size,
    gzipSize: gzipped.length,
  };
}

export async function buildClientBundles(
  manifest: RoutesManifest,
  rootDir: string,
  options: BundlerOptions = {}
): Promise<BundleResult> {
  const startTime = performance.now();
  const errors: string[] = [];
  const env = process.env.NODE_ENV === "production" ? "production" : "development";
  const hydratedRoutes = manifest.routes.filter((r) => r.kind === "page" && r.clientModule && needsHydration(r));
  const outDir = options.outDir || path.join(rootDir, ".mandu/client");
  await fs.mkdir(outDir, { recursive: true });

  const runtimeResult = await buildRuntime(outDir, options);
  const routerResult = await buildRouterRuntime(outDir, options);
  const vendorResult = await buildVendorShims(outDir, options);

  const outputs: BundleOutput[] = [];
  for (const route of hydratedRoutes) {
    outputs.push(await buildIsland(route, rootDir, outDir, options));
  }

  const bundleManifest = createBundleManifest(
    outputs,
    hydratedRoutes,
    runtimeResult.outputPath,
    vendorResult,
    routerResult.outputPath,
    env
  );

  await fs.writeFile(path.join(rootDir, ".mandu/manifest.json"), JSON.stringify(bundleManifest, null, 2));
  const stats = calculateStats(outputs, startTime);
  return { success: errors.length === 0, outputs, errors, manifest: bundleManifest, stats };
}
```

### 5.2 개발 모드 (Watch + HMR)

```typescript
// packages/core/src/bundler/dev.ts

import type { RoutesManifest } from "../spec/schema";
import { buildClientBundles } from "./build";
import path from "path";
import fs from "fs";

export interface DevBundlerOptions {
  rootDir: string;
  manifest: RoutesManifest;
  onRebuild?: (result: RebuildResult) => void;
  onError?: (error: Error, routeId?: string) => void;
}

export async function startDevBundler(options: DevBundlerOptions) {
  const { rootDir, manifest, onRebuild, onError } = options;

  // 초기 빌드
  const initialBuild = await buildClientBundles(manifest, rootDir, {
    minify: false,
    sourcemap: true,
  });

  // clientModule → routeId 매핑 & 감시 디렉토리 수집
  const clientModuleToRoute = new Map<string, string>();
  const watchDirs = new Set<string>();
  for (const route of manifest.routes) {
    if (!route.clientModule) continue;
    const absPath = path.resolve(rootDir, route.clientModule);
    clientModuleToRoute.set(absPath.replace(/\\/g, "/"), route.id);
    watchDirs.add(path.dirname(absPath));
  }

  // spec/slots 감시
  const slotsDir = path.join(rootDir, "spec", "slots");
  try { await fs.promises.access(slotsDir); watchDirs.add(slotsDir); } catch {}

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const handleFileChange = async (changedFile: string) => {
    const normalizedPath = changedFile.replace(/\\/g, "/");
    let routeId = clientModuleToRoute.get(normalizedPath);
    if (!routeId && changedFile.endsWith(".client.ts")) {
      const basename = path.basename(changedFile, ".client.ts");
      const route = manifest.routes.find((r) => r.id === basename);
      if (route) routeId = route.id;
    }
    if (!routeId) return;

    const start = performance.now();
    try {
      const result = await buildClientBundles(manifest, rootDir, {
        minify: false,
        sourcemap: true,
      });
      const buildTime = performance.now() - start;
      onRebuild?.({ routeId, success: result.success, buildTime, error: result.errors.join(", ") });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      onError?.(err, routeId);
    }
  };

  const watchers: fs.FSWatcher[] = [];
  for (const dir of watchDirs) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, async (_event, filename) => {
        if (!filename) return;
        if (!filename.endsWith(".ts") && !filename.endsWith(".tsx")) return;
        const fullPath = path.join(dir, filename);
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => handleFileChange(fullPath), 100);
      });
      watchers.push(watcher);
    } catch {}
  }

  return {
    initialBuild,
    close: () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      watchers.forEach((w) => w.close());
    },
  };
}

export function createHMRServer(port: number) {
  const clients = new Set<any>();
  const hmrPort = port + 1;

  const server = Bun.serve({
    port: hmrPort,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response(
        JSON.stringify({ status: "ok", clients: clients.size, port: hmrPort }),
        { headers: { "Content-Type": "application/json" } }
      );
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(JSON.stringify({ type: "connected", data: { timestamp: Date.now() } }));
      },
      close(ws) { clients.delete(ws); },
      message(ws, message) {
        try {
          const data = JSON.parse(String(message));
          if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", data: { timestamp: Date.now() } }));
          }
        } catch {}
      },
    },
  });

  return {
    broadcast(message: { type: string; data: any }) {
      const json = JSON.stringify(message);
      for (const client of clients) client.send(json);
    },
    close() { server.stop(); },
  };
}
```

---

## 6. SSR 시스템 확장

### 6.1 SSR 렌더러 확장

```typescript
// packages/core/src/runtime/ssr.ts (핵심)

import { renderToString } from "react-dom/server";
import { serializeProps } from "../client/serialize";
import type { HydrationConfig, HydrationPriority } from "../spec/schema";
import type { BundleManifest } from "../bundler/types";
import type { ReactElement } from "react";

export interface SSROptions {
  title?: string;
  lang?: string;
  serverData?: Record<string, unknown>;
  hydration?: HydrationConfig;
  bundleManifest?: BundleManifest;
  routeId?: string;
  routePattern?: string;
  isDev?: boolean;
  hmrPort?: number;
  enableClientRouter?: boolean;
}

function serializeServerData(data: Record<string, unknown>): string {
  const json = serializeProps(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/'/g, "\\u0027");

  return `<script id="__MANDU_DATA__" type="application/json">${json}</script>
<script>window.__MANDU_DATA_RAW__ = document.getElementById('__MANDU_DATA__').textContent;</script>`;
}

function generateHydrationScripts(routeId: string, manifest: BundleManifest): string {
  const scripts: string[] = [];
  if (manifest.importMap && Object.keys(manifest.importMap.imports).length > 0) {
    scripts.push(`<script type="importmap">${JSON.stringify(manifest.importMap, null, 2)}</script>`);
  }
  const bundle = manifest.bundles[routeId];
  if (bundle) {
    scripts.push(`<link rel="modulepreload" href="${bundle.js}">`);
  }
  if (manifest.shared.runtime) {
    scripts.push(`<script type="module" src="${manifest.shared.runtime}"></script>`);
  }
  return scripts.join("\n");
}

export function wrapWithIsland(
  content: string,
  routeId: string,
  priority: HydrationPriority = "visible",
  bundleSrc?: string
): string {
  const srcAttr = bundleSrc ? ` data-mandu-src="${bundleSrc}"` : "";
  return `<div data-mandu-island="${routeId}"${srcAttr} data-mandu-priority="${priority}">${content}</div>`;
}

export function renderToHTML(element: ReactElement, options: SSROptions = {}): string {
  const { title = "Mandu App", lang = "ko", serverData, hydration, bundleManifest, routeId } = options;

  let content = renderToString(element);
  const needsHydration = hydration && hydration.strategy !== "none" && routeId && bundleManifest;

  if (needsHydration) {
    const bundle = bundleManifest!.bundles[routeId!];
    content = wrapWithIsland(content, routeId!, hydration!.priority, bundle?.js);
  }

  const dataScript = serverData && routeId
    ? serializeServerData({ [routeId]: { serverData, timestamp: Date.now() } })
    : "";

  const hydrationScripts = needsHydration
    ? generateHydrationScripts(routeId!, bundleManifest!)
    : "";

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body>
  <div id="root">${content}</div>
  ${dataScript}
  ${hydrationScripts}
</body>
</html>`;
}
```

---

## 7. Guard 규칙 확장

### 7.1 클라이언트 코드 Guard 규칙

```typescript
// packages/core/src/guard/rules.ts (발췌)

export const GUARD_RULES = {
  GENERATED_MANUAL_EDIT: { id: "GENERATED_MANUAL_EDIT", severity: "error" },
  INVALID_GENERATED_IMPORT: { id: "INVALID_GENERATED_IMPORT", severity: "error" },
  FORBIDDEN_IMPORT_IN_GENERATED: { id: "FORBIDDEN_IMPORT_IN_GENERATED", severity: "error" },
  SLOT_NOT_FOUND: { id: "SLOT_NOT_FOUND", severity: "error" },

  // Hydration 관련 무결성
  ISLAND_FIRST_INTEGRITY: {
    id: "ISLAND_FIRST_INTEGRITY",
    description: "clientModule이 있는 page route의 componentModule이 island을 import하지 않습니다",
    severity: "error",
  },
  CLIENT_MODULE_NOT_FOUND: {
    id: "CLIENT_MODULE_NOT_FOUND",
    description: "spec에 명시된 clientModule 파일을 찾을 수 없습니다",
    severity: "error",
  },
};

// packages/core/src/guard/check.ts (발췌)
export async function checkIslandFirstIntegrity(manifest, rootDir) {
  const violations = [];

  for (const route of manifest.routes) {
    if (route.kind !== "page" || !route.clientModule) continue;

    const clientPath = path.join(rootDir, route.clientModule);
    if (!(await fileExists(clientPath))) {
      violations.push({
        ruleId: "CLIENT_MODULE_NOT_FOUND",
        file: route.clientModule,
        message: `clientModule 파일을 찾을 수 없습니다 (routeId: ${route.id})`,
        suggestion: "clientModule 경로를 확인하거나 파일을 생성하세요",
      });
      continue;
    }

    if (route.componentModule) {
      const componentPath = path.join(rootDir, route.componentModule);
      const content = await readFileContent(componentPath);
      if (content && !content.includes("islandModule") && !content.includes("Island-First")) {
        violations.push({
          ruleId: "ISLAND_FIRST_INTEGRITY",
          file: route.componentModule,
          message: `componentModule이 island을 import하지 않습니다 (routeId: ${route.id})`,
          suggestion: "mandu generate를 실행하여 Island-First 템플릿으로 재생성하세요",
        });
      }
    }
  }

  return violations;
}
```

---

## 8. MCP 도구 확장

### 8.1 현재 구현된 MCP Hydration 도구 (2026-01-30)

- `mandu_build`: 클라이언트 번들 빌드
- `mandu_build_status`: 번들 상태/매니페스트 조회
- `mandu_list_islands`: Hydration 대상 라우트 목록
- `mandu_set_hydration`: 라우트 Hydration 설정
- `mandu_add_client_slot`: 클라이언트 슬롯 추가

> 구현 위치: `packages/mcp/src/tools/hydration.ts`

### 8.2 구현 코드 (발췌)

```typescript
// packages/mcp/src/tools/hydration.ts (발췌)

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  loadManifest,
  buildClientBundles,
  formatSize,
  needsHydration,
  getRouteHydration,
} from "@mandujs/core";
import { getProjectPaths, readJsonFile, writeJsonFile } from "../utils/project.js";
import path from "path";

export const hydrationToolDefinitions: Tool[] = [
  {
    name: "mandu_build",
    description: "Build client bundles for hydration. Compiles client slots (.client.ts) into browser-ready JavaScript bundles.",
    inputSchema: {
      type: "object",
      properties: {
        minify: { type: "boolean", description: "Minify the output bundles (default: true in production)" },
        sourcemap: { type: "boolean", description: "Generate source maps for debugging" },
      },
      required: [],
    },
  },
  {
    name: "mandu_build_status",
    description: "Get the current build status, bundle manifest, and statistics for client bundles.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "mandu_list_islands",
    description: "List all routes that have client-side hydration (islands). Shows hydration strategy and priority for each.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "mandu_set_hydration",
    description: "Set hydration configuration for a specific route. Updates the route's hydration strategy and priority.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: { type: "string", description: "The route ID to configure" },
        strategy: { type: "string", enum: ["none", "island", "full", "progressive"] },
        priority: { type: "string", enum: ["immediate", "visible", "idle", "interaction"] },
        preload: { type: "boolean" },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu_add_client_slot",
    description: "Add a client slot file for a route to enable hydration. Creates the .client.ts file and updates the manifest.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: { type: "string", description: "The route ID to add client slot for" },
        strategy: { type: "string", enum: ["island", "full", "progressive"] },
        priority: { type: "string", enum: ["immediate", "visible", "idle", "interaction"] },
      },
      required: ["routeId"],
    },
  },
];

export function hydrationTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);

  return {
    mandu_build: async (args: Record<string, unknown>) => {
      const { minify, sourcemap } = args as { minify?: boolean; sourcemap?: boolean };
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) return { error: manifestResult.errors };

      const result = await buildClientBundles(manifestResult.data, projectRoot, { minify, sourcemap });
      return {
        success: result.success,
        bundleCount: result.stats.bundleCount,
        totalSize: formatSize(result.stats.totalSize),
        totalGzipSize: formatSize(result.stats.totalGzipSize),
        buildTime: `${result.stats.buildTime.toFixed(0)}ms`,
        bundles: result.outputs.map((o) => ({
          routeId: o.routeId,
          path: o.outputPath,
          size: formatSize(o.size),
          gzipSize: formatSize(o.gzipSize),
        })),
        errors: result.errors,
      };
    },

    mandu_build_status: async () => {
      const manifest = await readJsonFile(path.join(projectRoot, ".mandu/manifest.json"));
      if (!manifest) {
        return { hasBundles: false, message: "No bundle manifest found. Run mandu_build first." };
      }
      const bundleCount = Object.keys(manifest.bundles).length;
      return {
        hasBundles: true,
        version: manifest.version,
        buildTime: manifest.buildTime,
        environment: manifest.env,
        bundleCount,
        shared: { runtime: manifest.shared.runtime, vendor: manifest.shared.vendor },
        bundles: Object.entries(manifest.bundles).map(([routeId, bundle]) => ({
          routeId,
          js: bundle.js,
          css: bundle.css || null,
          priority: bundle.priority,
          dependencies: bundle.dependencies,
        })),
      };
    },

    mandu_list_islands: async () => {
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) return { error: manifestResult.errors };
      const islands = manifestResult.data.routes
        .filter((route) => route.kind === "page")
        .map((route) => {
          const hydration = getRouteHydration(route);
          const isIsland = needsHydration(route);
          return {
            routeId: route.id,
            pattern: route.pattern,
            hasClientModule: !!route.clientModule,
            clientModule: route.clientModule || null,
            isIsland,
            hydration: {
              strategy: hydration.strategy,
              priority: hydration.priority,
              preload: hydration.preload,
            },
          };
        });
      const islandCount = islands.filter((i) => i.isIsland).length;
      const staticCount = islands.filter((i) => !i.isIsland).length;
      return {
        totalPages: islands.length,
        islandCount,
        staticCount,
        islands: islands.filter((i) => i.isIsland),
        staticPages: islands.filter((i) => !i.isIsland),
      };
    },

    mandu_set_hydration: async (args: Record<string, unknown>) => {
      const { routeId, strategy, priority, preload } = args as {
        routeId: string;
        strategy?: "none" | "island" | "full" | "progressive";
        priority?: "immediate" | "visible" | "idle" | "interaction";
        preload?: boolean;
      };
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) return { error: manifestResult.errors };
      const manifest = manifestResult.data;
      const route = manifest.routes.find((r) => r.id === routeId);
      if (!route) return { error: `Route not found: ${routeId}` };
      if (route.kind !== "page") return { error: `Route ${routeId} is not a page route` };

      route.hydration = {
        strategy: strategy || route.hydration?.strategy || "island",
        priority: priority || route.hydration?.priority || "visible",
        preload: preload !== undefined ? preload : route.hydration?.preload || false,
      };
      await writeJsonFile(paths.manifestPath, manifest);
      return { success: true, routeId, hydration: route.hydration };
    },

    mandu_add_client_slot: async (args: Record<string, unknown>) => {
      const { routeId, strategy = "island", priority = "visible" } = args as {
        routeId: string;
        strategy?: "island" | "full" | "progressive";
        priority?: "immediate" | "visible" | "idle" | "interaction";
      };
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) return { error: manifestResult.errors };
      const manifest = manifestResult.data;
      const routeIndex = manifest.routes.findIndex((r) => r.id === routeId);
      if (routeIndex === -1) return { error: `Route not found: ${routeId}` };
      const route = manifest.routes[routeIndex];
      if (route.kind !== "page") return { error: `Route ${routeId} is not a page route` };

      if (route.clientModule) {
        return { error: `Route ${routeId} already has a client module: ${route.clientModule}` };
      }

      const clientModulePath = `apps/web/components/${routeId}.client.tsx`;
      const clientFilePath = path.join(projectRoot, clientModulePath);
      const clientFile = Bun.file(clientFilePath);
      if (await clientFile.exists()) {
        return { error: `Client slot file already exists: ${clientModulePath}` };
      }

      const template = generateClientSlotTemplate(routeId, route.slotModule);
      await Bun.write(clientFilePath, template);

      manifest.routes[routeIndex] = {
        ...route,
        clientModule: clientModulePath,
        hydration: {
          strategy,
          priority,
          preload: false,
        },
      };
      await writeJsonFile(paths.manifestPath, manifest);

      return {
        success: true,
        routeId,
        clientModule: clientModulePath,
        hydration: { strategy, priority, preload: false },
        message: `Created client slot: ${clientModulePath}`,
      };
    },
  };
}
```

---

## 9. CLI 명령어 확장

### 9.1 새로운 CLI 명령어

```typescript
// packages/cli/src/commands/build.ts

import { loadManifest, buildClientBundles, printBundleStats } from "@mandujs/core";
import path from "path";
import fs from "fs/promises";

export interface BuildOptions {
  minify?: boolean;
  sourcemap?: boolean;
  watch?: boolean;
  outDir?: string;
}

export async function build(options: BuildOptions = {}): Promise<boolean> {
  const cwd = process.cwd();
  const specPath = path.join(cwd, "spec", "routes.manifest.json");

  console.log("📦 Mandu Build - Client Bundle Builder\n");

  const specResult = await loadManifest(specPath);
  if (!specResult.success) {
    console.error("❌ Spec 로드 실패:");
    for (const error of specResult.errors) {
      console.error(`   ${error}`);
    }
    return false;
  }

  const manifest = specResult.data!;
  const hydratedRoutes = manifest.routes.filter(
    (route) =>
      route.kind === "page" &&
      route.clientModule &&
      (!route.hydration || route.hydration.strategy !== "none")
  );

  if (hydratedRoutes.length === 0) {
    console.log("\n📭 Hydration이 필요한 라우트가 없습니다.");
    console.log("   (clientModule이 없거나 hydration.strategy: none)");
    return true;
  }

  const result = await buildClientBundles(manifest, cwd, {
    minify: options.minify,
    sourcemap: options.sourcemap,
    outDir: options.outDir,
  });

  printBundleStats(result);

  if (!result.success) {
    console.error("\n❌ 빌드 실패");
    return false;
  }

  if (options.watch) {
    await watchAndRebuild(manifest, cwd, options);
  }

  return true;
}

async function watchAndRebuild(
  manifest: Awaited<ReturnType<typeof loadManifest>>["manifest"],
  rootDir: string,
  options: BuildOptions
): Promise<void> {
  const slotsDir = path.join(rootDir, "spec", "slots");

  try {
    await fs.access(slotsDir);
  } catch {
    console.warn(`⚠️  슬롯 디렉토리가 없습니다: ${slotsDir}`);
    return;
  }

  const { watch } = await import("fs");
  watch(slotsDir, { recursive: true }, async (event, filename) => {
    if (!filename || !filename.endsWith(".client.ts")) return;
    const routeId = filename.replace(".client.ts", "").replace(/\\/g, "/").split("/").pop();
    if (!routeId) return;
    const route = manifest!.routes.find((r) => r.id === routeId);
    if (!route || !route.clientModule) return;

    const result = await buildClientBundles(manifest!, rootDir, {
      minify: options.minify,
      sourcemap: options.sourcemap,
      outDir: options.outDir,
    });

    if (!result.success) {
      console.error(`❌ 재빌드 실패: ${routeId}`);
    }
  });
}
```

> 참고: `build`의 watch 모드는 현재 `.client.ts` 변경만 감지합니다. `.client.tsx` 파일은 감지되지 않으므로 추후 개선 필요합니다.

### 9.2 dev 명령어 확장

```typescript
// packages/cli/src/commands/dev.ts (발췌)

import {
  loadManifest,
  startServer,
  registerApiHandler,
  registerPageLoader,
  registerPageHandler,
  startDevBundler,
  createHMRServer,
  needsHydration,
  loadEnv,
} from "@mandujs/core";
import { resolveFromCwd } from "../util/fs";
import path from "path";

export async function dev(options: DevOptions = {}): Promise<void> {
  const specPath = resolveFromCwd(".mandu/routes.manifest.json");
  const rootDir = resolveFromCwd(".");

  const envResult = await loadEnv({ rootDir, env: "development" });
  if (envResult.loaded.length > 0) {
    console.log(`🔐 환경 변수 로드: ${envResult.loaded.join(", ")}`);
  }

  const manifestResult = await loadManifest(specPath);
  if (!manifestResult.success || !manifestResult.data) {
    console.error("❌ Spec 로드 실패:");
    manifestResult.errors?.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  const manifest = manifestResult.data;

  // 핸들러 등록
  for (const route of manifest.routes) {
    if (route.kind === "api") {
      const modulePath = path.resolve(rootDir, route.module);
      const module = await import(modulePath);
      registerApiHandler(route.id, module.default || module.handler);
    } else if (route.kind === "page" && route.componentModule) {
      const componentPath = path.resolve(rootDir, route.componentModule);
      if (route.slotModule) {
        registerPageHandler(route.id, async () => {
          const module = await import(componentPath);
          return module.default;
        });
      } else registerPageLoader(route.id, () => import(componentPath));
    }
  }

  // HMR/Dev Bundler
  const hasIslands = manifest.routes.some((r) => r.kind === "page" && r.clientModule && needsHydration(r));
  const port = options.port || Number(process.env.PORT) || 3000;
  const hmrServer = hasIslands && !options.noHmr ? createHMRServer(port) : null;
  const devBundler = hasIslands && !options.noHmr
    ? await startDevBundler({
        rootDir,
        manifest,
        onRebuild: (result) => {
          hmrServer?.broadcast({ type: "island-update", data: { routeId: result.routeId, timestamp: Date.now() } });
        },
        onError: (error, routeId) => {
          hmrServer?.broadcast({ type: "error", data: { routeId, message: error.message } });
        },
      })
    : null;

  const server = startServer(manifest, {
    port,
    rootDir,
    isDev: true,
    hmrPort: hmrServer ? port : undefined,
    bundleManifest: devBundler?.initialBuild.manifest,
  });

  const cleanup = () => {
    server.stop();
    devBundler?.close();
    hmrServer?.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
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
| Client Slot | .client.tsx 파일 지원 | P0 |
| ManduClient.island() | 클라이언트 API | P0 |
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
      "clientModule": "apps/web/components/todos.client.tsx",
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

1. **FS Routes = 라우트 소스**: Hydration 전략도 라우트 파일에서 선언
2. **Slot = Island**: 자연스러운 개념 확장
3. **Agent-Native**: MCP로 모든 것을 조작 가능
4. **Guard 확장**: 클라이언트 코드도 보호
5. **성능 최적화**: Priority-based partial hydration
6. **개발자 경험**: HMR, 에러 오버레이, 타입 안전성

이 설계는 Mandu를 "AI 에이전트와 인간이 함께 개발하는 최고의 프레임워크"로 만드는 핵심 기능이다.
