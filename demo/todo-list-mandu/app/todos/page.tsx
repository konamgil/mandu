/**
 * Todos Page
 *
 * Todo 리스트 메인 페이지
 * SSR로 초기 데이터를 fetch하여 Island 컴포넌트에 전달
 */

import { TodoList } from "../../src/client/widgets/todo-list";
import { todoService } from "../../src/server/application/todo.service";
import { categoryService } from "../../src/server/application/category.service";
import type { TodoDTO } from "../../src/shared/contracts/todo";
import type { CategoryDTO } from "../../src/shared/contracts/category";

export default async function TodosPage() {
  // SSR: 서버에서 초기 데이터 로드
  const todos = todoService.getAll();
  const categories = categoryService.getAll();
  const stats = todoService.getStats();

  // DTO로 변환
  const initialTodos: TodoDTO[] = todos.map((t) => ({
    ...t,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));

  const initialCategories: CategoryDTO[] = categories.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4">
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">📝 My Todos</h1>
              <p className="text-muted-foreground mt-1">
                할 일을 관리하세요
              </p>
            </div>
            <a
              href="/"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← 홈으로
            </a>
          </div>
        </header>

        <TodoList
          initialTodos={initialTodos}
          initialCategories={initialCategories}
          initialStats={stats}
        />
      </div>
    </main>
  );
}
