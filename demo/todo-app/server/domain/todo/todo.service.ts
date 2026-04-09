import { todoRepository } from "./todo.repository";
import type { Todo, TodoFilter, CreateTodoInput, UpdateTodoInput } from "./todo.types";

export const todoService = {
  list(filter: TodoFilter = "all"): Todo[] {
    const todos = todoRepository.findAll();
    switch (filter) {
      case "active":
        return todos.filter((t) => !t.completed);
      case "completed":
        return todos.filter((t) => t.completed);
      default:
        return todos;
    }
  },

  getById(id: string): Todo | undefined {
    return todoRepository.findById(id);
  },

  create(input: CreateTodoInput): Todo {
    return todoRepository.create(input.title.trim());
  },

  update(id: string, input: UpdateTodoInput): Todo | undefined {
    return todoRepository.update(id, input);
  },

  delete(id: string): boolean {
    return todoRepository.delete(id);
  },

  clearCompleted(): number {
    return todoRepository.clearCompleted();
  },

  stats() {
    const all = todoRepository.findAll();
    return {
      total: all.length,
      active: all.filter((t) => !t.completed).length,
      completed: all.filter((t) => t.completed).length,
    };
  },
};
