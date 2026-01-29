// 🥟 Mandu Filling - todos-api
// Pattern: /api/todos

import { Mandu } from "@mandujs/core";

interface Todo {
  id: number;
  title: string;
  completed: boolean;
}

const todos: Todo[] = [
  { id: 1, title: "Mandu 프레임워크 배우기", completed: true },
  { id: 2, title: "Activity Monitor 테스트", completed: false },
  { id: 3, title: "Slot 직접 편집 워크플로우 확인", completed: false },
];

let nextId = 4;

export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({ todos, total: todos.length });
  })

  .post(async (ctx) => {
    const body = await ctx.body();
    const todo: Todo = {
      id: nextId++,
      title: body.title || "Untitled",
      completed: false,
    };
    todos.push(todo);
    return ctx.created({ todo });
  });
