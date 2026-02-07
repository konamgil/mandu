---
title: Use Mandu.island() with Setup Function
impact: HIGH
impactDescription: Proper Island structure
tags: hydration, island, setup
---

## Use Mandu.island() with Setup Function

For complex Islands, use `Mandu.island()` API to separate state logic from rendering.

**Incorrect (mixed concerns):**

```tsx
"use client";

export default function TodoList({ initialTodos }) {
  // State, handlers, and JSX all mixed together
  const [todos, setTodos] = useState(initialTodos);
  const [input, setInput] = useState("");

  const add = () => {
    setTodos([...todos, { id: Date.now(), text: input }]);
    setInput("");
  };

  return (
    <div>
      <input value={input} onChange={e => setInput(e.target.value)} />
      <button onClick={add}>Add</button>
      {todos.map(t => <li key={t.id}>{t.text}</li>)}
    </div>
  );
}
```

**Correct (Mandu.island pattern):**

```tsx
// spec/slots/todos.client.ts

import { Mandu } from "@mandujs/core/client";
import { useState, useCallback } from "react";

interface TodosData {
  todos: { id: number; text: string; done: boolean }[];
}

export default Mandu.island<TodosData>({
  // Setup: Initialize client state from server data
  setup: (serverData) => {
    const [todos, setTodos] = useState(serverData.todos);
    const [input, setInput] = useState("");

    const addTodo = useCallback(() => {
      if (!input.trim()) return;
      setTodos(prev => [...prev, { id: Date.now(), text: input, done: false }]);
      setInput("");
    }, [input]);

    const toggleTodo = useCallback((id: number) => {
      setTodos(prev => prev.map(t =>
        t.id === id ? { ...t, done: !t.done } : t
      ));
    }, []);

    return { todos, input, setInput, addTodo, toggleTodo };
  },

  // Render: Pure rendering logic
  render: ({ todos, input, setInput, addTodo, toggleTodo }) => (
    <div>
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="New todo..."
      />
      <button onClick={addTodo}>Add</button>
      <ul>
        {todos.map(todo => (
          <li
            key={todo.id}
            onClick={() => toggleTodo(todo.id)}
            style={{ textDecoration: todo.done ? "line-through" : "none" }}
          >
            {todo.done ? "✅" : "⬜"} {todo.text}
          </li>
        ))}
      </ul>
    </div>
  ),

  // Optional: Error boundary
  errorBoundary: (error, reset) => (
    <div>
      <p>Error: {error.message}</p>
      <button onClick={reset}>Retry</button>
    </div>
  ),

  // Optional: Loading state
  loading: () => <p>Loading todos...</p>,
});
```

## Mandu.island() Options

| Option | Required | Description |
|--------|----------|-------------|
| `setup` | Yes | Initialize state from server data |
| `render` | Yes | Pure render function |
| `errorBoundary` | No | Error UI component |
| `loading` | No | Loading UI component |
