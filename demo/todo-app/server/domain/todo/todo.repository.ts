import type { Todo, UpdateTodoInput } from "./todo.types";

const todos: Todo[] = [
  { id: "1", title: "Mandu 프레임워크 배우기", completed: false, createdAt: new Date().toISOString() },
  { id: "2", title: "Island 컴포넌트 만들기", completed: false, createdAt: new Date().toISOString() },
  { id: "3", title: "API 라우트 테스트", completed: true, createdAt: new Date().toISOString() },
];

let nextId = 4;

export const todoRepository = {
  findAll(): Todo[] {
    return [...todos];
  },

  findById(id: string): Todo | undefined {
    return todos.find((t) => t.id === id);
  },

  create(title: string): Todo {
    const todo: Todo = {
      id: String(nextId++),
      title,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    todos.push(todo);
    return todo;
  },

  update(id: string, data: UpdateTodoInput): Todo | undefined {
    const todo = todos.find((t) => t.id === id);
    if (!todo) return undefined;
    if (data.title !== undefined) todo.title = data.title;
    if (data.completed !== undefined) todo.completed = data.completed;
    return todo;
  },

  delete(id: string): boolean {
    const index = todos.findIndex((t) => t.id === id);
    if (index === -1) return false;
    todos.splice(index, 1);
    return true;
  },

  clearCompleted(): number {
    const before = todos.length;
    const remaining = todos.filter((t) => !t.completed);
    todos.length = 0;
    todos.push(...remaining);
    return before - todos.length;
  },
};
