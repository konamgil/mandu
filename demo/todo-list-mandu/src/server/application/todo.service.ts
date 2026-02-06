/**
 * Todo Application Service
 *
 * Todo 관련 비즈니스 로직을 처리하는 서비스
 */

import { todoStore } from "../infra/store";
import {
  createTodo,
  updateTodo,
  type Todo,
  type CreateTodoInput,
  type UpdateTodoInput,
  type TodoStats,
  type BulkAction,
  type BulkOperationResult,
} from "../domain/todo";

export const todoService = {
  /**
   * 모든 Todo 조회
   */
  getAll(): Todo[] {
    return todoStore.getAll();
  },

  /**
   * ID로 Todo 조회
   */
  getById(id: string): Todo | undefined {
    return todoStore.getById(id);
  },

  /**
   * 새 Todo 생성
   */
  create(input: CreateTodoInput): Todo {
    const todo = createTodo(input);
    return todoStore.create(todo);
  },

  /**
   * Todo 업데이트
   */
  update(id: string, input: UpdateTodoInput): Todo | undefined {
    const existing = todoStore.getById(id);
    if (!existing) return undefined;

    const updated = updateTodo(existing, input);
    return todoStore.update(id, updated);
  },

  /**
   * Todo 삭제
   */
  delete(id: string): boolean {
    return todoStore.delete(id);
  },

  /**
   * 벌크 작업 수행
   */
  bulkOperation(ids: string[], action: BulkAction): BulkOperationResult {
    let affected = 0;

    switch (action) {
      case "complete":
        affected = todoStore.updateMany(ids, { completed: true });
        break;
      case "incomplete":
        affected = todoStore.updateMany(ids, { completed: false });
        break;
      case "delete":
        affected = todoStore.deleteMany(ids);
        break;
    }

    return { affected, action };
  },

  /**
   * Todo 통계 조회
   */
  getStats(): TodoStats {
    const todos = todoStore.getAll();
    const completed = todos.filter((t) => t.completed).length;
    const byCategory: Record<string, number> = {};

    for (const todo of todos) {
      const key = todo.categoryId ?? "uncategorized";
      byCategory[key] = (byCategory[key] ?? 0) + 1;
    }

    return {
      total: todos.length,
      completed,
      pending: todos.length - completed,
      byCategory,
    };
  },
};
