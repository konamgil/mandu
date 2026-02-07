/**
 * TodoList Island Component
 *
 * Island Hydration을 사용하는 Todo 리스트 위젯
 * 서버에서 초기 데이터를 받아 클라이언트에서 hydration
 */

import React, { useState, useCallback, useMemo } from "react";
import { island } from "@mandujs/core";
import { TodoItem } from "../../entities/todo";
import { TodoForm } from "../../features/todo-create";
import { TodoFilter, type FilterType } from "../../features/todo-filter";
import { TodoStats } from "../../features/todo-stats";
import { Card } from "../../shared/ui/card";
import type { TodoDTO, TodoStatsDTO } from "../../../shared/contracts/todo";
import type { CategoryDTO } from "../../../shared/contracts/category";

interface TodoListProps {
  initialTodos: TodoDTO[];
  initialCategories: CategoryDTO[];
  initialStats: TodoStatsDTO;
}

function TodoListComponent({ initialTodos, initialCategories, initialStats }: TodoListProps) {
  const [todos, setTodos] = useState<TodoDTO[]>(initialTodos);
  const [categories] = useState<CategoryDTO[]>(initialCategories);
  const [stats, setStats] = useState<TodoStatsDTO>(initialStats);
  const [filter, setFilter] = useState<FilterType>("all");

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch("/api/todos/stats");
      const data = await res.json();
      setStats(data);
    } catch (err) {
      console.error("Failed to refresh stats:", err);
    }
  }, []);

  const handleCreate = useCallback(async (title: string, categoryId?: string) => {
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, categoryId }),
      });
      const { todo } = await res.json();
      setTodos((prev) => [todo, ...prev]);
      refreshStats();
    } catch (err) {
      console.error("Failed to create todo:", err);
    }
  }, [refreshStats]);

  const handleToggle = useCallback(async (id: string, completed: boolean) => {
    try {
      const res = await fetch(`/api/todos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
      });
      const { todo } = await res.json();
      setTodos((prev) => prev.map((t) => (t.id === id ? todo : t)));
      refreshStats();
    } catch (err) {
      console.error("Failed to toggle todo:", err);
    }
  }, [refreshStats]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await fetch(`/api/todos/${id}`, { method: "DELETE" });
      setTodos((prev) => prev.filter((t) => t.id !== id));
      refreshStats();
    } catch (err) {
      console.error("Failed to delete todo:", err);
    }
  }, [refreshStats]);

  const filteredTodos = useMemo(() => {
    switch (filter) {
      case "active":
        return todos.filter((t) => !t.completed);
      case "completed":
        return todos.filter((t) => t.completed);
      default:
        return todos;
    }
  }, [todos, filter]);

  const counts = useMemo(() => ({
    all: todos.length,
    active: todos.filter((t) => !t.completed).length,
    completed: todos.filter((t) => t.completed).length,
  }), [todos]);

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-4">
          <Card className="p-4">
            <TodoForm categories={categories} onSubmit={handleCreate} />
          </Card>

          <div className="flex justify-between items-center">
            <TodoFilter
              currentFilter={filter}
              onFilterChange={setFilter}
              counts={counts}
            />
          </div>

          <div className="space-y-2">
            {filteredTodos.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground">
                {filter === "all"
                  ? "할 일을 추가해보세요!"
                  : filter === "active"
                    ? "진행 중인 할 일이 없습니다."
                    : "완료된 할 일이 없습니다."}
              </Card>
            ) : (
              filteredTodos.map((todo) => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  categories={categories}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>
        </div>

        <div>
          <TodoStats stats={stats} />
        </div>
      </div>
    </div>
  );
}

export default island("visible", TodoListComponent as unknown as React.ComponentType<Record<string, unknown>>);
