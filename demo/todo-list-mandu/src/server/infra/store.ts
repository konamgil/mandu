/**
 * In-Memory 저장소
 *
 * 개발 및 데모용 인메모리 데이터 저장소
 */

import type { Todo } from "../domain/todo";
import type { Category } from "../domain/category";
import { createCategory } from "../domain/category";

interface Store {
  todos: Map<string, Todo>;
  categories: Map<string, Category>;
}

// 싱글톤 스토어 인스턴스
const store: Store = {
  todos: new Map(),
  categories: new Map(),
};

// 초기 카테고리 데이터
function initializeDefaultCategories() {
  if (store.categories.size === 0) {
    const defaults = [
      { name: "Work", color: "#3B82F6" },
      { name: "Personal", color: "#10B981" },
      { name: "Shopping", color: "#F59E0B" },
    ];

    for (const cat of defaults) {
      const category = createCategory(cat);
      store.categories.set(category.id, category);
    }
  }
}

initializeDefaultCategories();

// Todo Store
export const todoStore = {
  getAll(): Todo[] {
    return Array.from(store.todos.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  },

  getById(id: string): Todo | undefined {
    return store.todos.get(id);
  },

  create(todo: Todo): Todo {
    store.todos.set(todo.id, todo);
    return todo;
  },

  update(id: string, todo: Todo): Todo | undefined {
    if (!store.todos.has(id)) return undefined;
    store.todos.set(id, todo);
    return todo;
  },

  delete(id: string): boolean {
    return store.todos.delete(id);
  },

  deleteMany(ids: string[]): number {
    let count = 0;
    for (const id of ids) {
      if (store.todos.delete(id)) count++;
    }
    return count;
  },

  updateMany(ids: string[], update: Partial<Todo>): number {
    let count = 0;
    for (const id of ids) {
      const todo = store.todos.get(id);
      if (todo) {
        store.todos.set(id, { ...todo, ...update, updatedAt: new Date() });
        count++;
      }
    }
    return count;
  },
};

// Category Store
export const categoryStore = {
  getAll(): Category[] {
    return Array.from(store.categories.values()).sort(
      (a, b) => a.name.localeCompare(b.name)
    );
  },

  getById(id: string): Category | undefined {
    return store.categories.get(id);
  },

  create(category: Category): Category {
    store.categories.set(category.id, category);
    return category;
  },

  delete(id: string): boolean {
    return store.categories.delete(id);
  },
};
