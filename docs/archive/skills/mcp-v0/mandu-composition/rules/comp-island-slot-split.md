---
title: Separate Server Logic (Slot) from Client (Island)
impact: MEDIUM
impactDescription: Clear server-client boundary
tags: composition, island, slot, separation
---

## Separate Server Logic (Slot) from Client (Island)

**Impact: MEDIUM (Clear server-client boundary)**

서버 로직(slot)과 클라이언트 로직(Island)을 명확히 분리하세요. slot은 데이터 페칭과 비즈니스 로직, Island는 인터랙션을 담당합니다.

**Incorrect (혼합된 관심사):**

```tsx
// ❌ 클라이언트 컴포넌트에서 데이터 페칭
"use client";

export function TodosIsland() {
  const [todos, setTodos] = useState([]);

  useEffect(() => {
    // 클라이언트에서 데이터 페칭 → 워터폴 발생
    fetch("/api/todos")
      .then(res => res.json())
      .then(setTodos);
  }, []);

  return <TodoList todos={todos} />;
}
```

**Correct (slot-client 분리):**

```typescript
// spec/slots/todos.slot.ts - 서버 로직
import { Mandu } from "@mandujs/core";
import { db } from "@/lib/db";

export default Mandu.filling()
  .guard((ctx) => {
    // 인증 체크 (서버에서)
    if (!ctx.get("user")) {
      return ctx.unauthorized("Login required");
    }
  })
  .get(async (ctx) => {
    // 데이터 페칭 (서버에서)
    const todos = await db.todo.findMany({
      where: { userId: ctx.get("user").id },
      orderBy: { createdAt: "desc" },
    });

    return ctx.ok({ todos });
  })
  .post(async (ctx) => {
    // 생성 로직 (서버에서)
    const body = await ctx.body<{ text: string }>();
    const todo = await db.todo.create({
      data: { text: body.text, userId: ctx.get("user").id },
    });

    return ctx.created({ todo });
  });
```

```tsx
// app/todos/client.tsx - 클라이언트 인터랙션
"use client";

import { useState, useCallback } from "react";

interface TodosIslandProps {
  initialTodos: Todo[];  // 서버에서 받은 초기 데이터
}

export function TodosIsland({ initialTodos }: TodosIslandProps) {
  const [todos, setTodos] = useState(initialTodos);
  const [input, setInput] = useState("");

  const addTodo = useCallback(async () => {
    // 낙관적 업데이트
    const optimisticTodo = { id: Date.now(), text: input, done: false };
    setTodos(prev => [optimisticTodo, ...prev]);
    setInput("");

    // 서버에 요청
    const res = await fetch("/api/todos", {
      method: "POST",
      body: JSON.stringify({ text: input }),
    });
    const { todo } = await res.json();

    // 실제 데이터로 교체
    setTodos(prev => prev.map(t =>
      t.id === optimisticTodo.id ? todo : t
    ));
  }, [input]);

  return (
    <div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="New todo..."
      />
      <button onClick={addTodo}>Add</button>
      <ul>
        {todos.map(todo => (
          <TodoItem key={todo.id} todo={todo} />
        ))}
      </ul>
    </div>
  );
}
```

```tsx
// app/todos/page.tsx - 페이지 (서버 컴포넌트)
import { TodosIsland } from "./client";
import { loadTodos } from "./slot";

export default async function TodosPage() {
  // 서버에서 데이터 로드 (워터폴 없음)
  const { todos } = await loadTodos();

  return (
    <div>
      <h1>My Todos</h1>
      {/* 초기 데이터를 Island에 전달 */}
      <TodosIsland initialTodos={todos} />
    </div>
  );
}
```

## 분리 원칙

| 관심사 | 위치 | 예시 |
|--------|------|------|
| 데이터 페칭 | Slot | DB 쿼리, API 호출 |
| 인증/인가 | Slot Guard | 권한 체크 |
| 비즈니스 로직 | Slot | 유효성 검사, 계산 |
| 인터랙션 | Island | 클릭, 입력, 애니메이션 |
| 클라이언트 상태 | Island | useState, useReducer |
| 낙관적 업데이트 | Island | 즉시 UI 반영 |

## 데이터 흐름

```
┌─────────────────────────────────────────┐
│  Page (Server Component)                │
│  └─ loadTodos() from slot               │
│     └─ DB Query                         │
│                                         │
│  ↓ initialTodos prop                    │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ TodosIsland (Client Component)    │  │
│  │ └─ useState(initialTodos)         │  │
│  │ └─ User interactions              │  │
│  │ └─ Optimistic updates             │  │
│  │ └─ POST to /api/todos             │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```
