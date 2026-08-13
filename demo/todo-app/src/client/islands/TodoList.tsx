import { island } from "@mandujs/core/client";
import { useState, useCallback } from "react";
import type { Todo, TodoFilter, Priority, Category } from "../../shared/types";

interface TodoListData {
  initialTodos: Todo[];
  categories: Category[];
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate + "T23:59:59") < new Date();
}

function formatDueDate(dueDate: string | null): string | null {
  if (!dueDate) return null;
  const d = new Date(dueDate + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff <= 7) return `${diff}d left`;
  return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export default island<TodoListData>({
  setup: (serverData) => {
    const [todos, setTodos] = useState<Todo[]>(serverData.initialTodos);
    const [categories] = useState<Category[]>(serverData.categories);
    const [newTitle, setNewTitle] = useState("");
    const [newPriority, setNewPriority] = useState<Priority>("medium");
    const [newDueDate, setNewDueDate] = useState("");
    const [newCategoryId, setNewCategoryId] = useState("");
    const [filter, setFilter] = useState<TodoFilter>("all");
    const [categoryFilter, setCategoryFilter] = useState<string>("all");

    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    const filteredTodos = todos.filter((t) => {
      if (filter === "active" && t.completed) return false;
      if (filter === "completed" && !t.completed) return false;
      if (categoryFilter !== "all" && t.categoryId !== categoryFilter) return false;
      return true;
    });

    const stats = {
      total: todos.length,
      active: todos.filter((t) => !t.completed).length,
      completed: todos.filter((t) => t.completed).length,
    };

    const addTodo = useCallback(async () => {
      if (!newTitle.trim()) return;
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          priority: newPriority,
          dueDate: newDueDate || undefined,
          categoryId: newCategoryId || undefined,
        }),
      });
      const { todo } = await res.json();
      setTodos((prev) => [...prev, todo]);
      setNewTitle("");
      setNewDueDate("");
      setNewPriority("medium");
      setNewCategoryId("");
    }, [newTitle, newPriority, newDueDate, newCategoryId]);

    const toggleTodo = useCallback(async (id: string) => {
      const target = todos.find((t) => t.id === id);
      if (!target) return;
      const res = await fetch(`/api/todos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !target.completed }),
      });
      const { todo } = await res.json();
      setTodos((prev) => prev.map((t) => (t.id === id ? todo : t)));
    }, [todos]);

    const deleteTodo = useCallback(async (id: string) => {
      await fetch(`/api/todos/${id}`, { method: "DELETE" });
      setTodos((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const clearCompleted = useCallback(async () => {
      await fetch("/api/todos", { method: "DELETE" });
      setTodos((prev) => prev.filter((t) => !t.completed));
    }, []);

    return {
      todos, filter, filteredTodos, newTitle, newPriority, newDueDate, newCategoryId,
      categories, categoryMap, categoryFilter,
      setNewTitle, setNewPriority, setNewDueDate, setNewCategoryId, setFilter, setCategoryFilter,
      addTodo, toggleTodo, deleteTodo, clearCompleted, stats,
    };
  },

  render: (ctx) => {
    const {
      filteredTodos, filter, newTitle, newPriority, newDueDate, newCategoryId,
      categories, categoryMap, categoryFilter,
      setNewTitle, setNewPriority, setNewDueDate, setNewCategoryId, setFilter, setCategoryFilter,
      addTodo, toggleTodo, deleteTodo, clearCompleted, stats,
    } = ctx;

    return (
      <div>
        <h1
          className="text-4xl mb-1"
          style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic' }}
        >
          Todos
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--color-ink-muted)' }}>
          {stats.active} active, {stats.completed} completed
        </p>
        {/* Add form */}
        <form
          onSubmit={(e) => { e.preventDefault(); addTodo(); }}
          className="card p-5 mb-6"
        >
          <div className="flex gap-3 mb-3">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="input-warm flex-1"
            />
            <button type="submit" className="btn-primary">Add</button>
          </div>
          <div className="flex gap-2 flex-wrap">
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as Priority)}
              className="select-warm"
            >
              <option value="high">🔴 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">⚪ Low</option>
            </select>
            <input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              className="select-warm"
            />
            <select
              value={newCategoryId}
              onChange={(e) => setNewCategoryId(e.target.value)}
              className="select-warm"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </form>

        {/* Filters */}
        <div className="flex gap-2 mb-3">
          {(["all", "active", "completed"] as TodoFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-4 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: filter === f ? 'var(--color-ink)' : 'transparent',
                color: filter === f ? 'var(--color-cream)' : 'var(--color-ink-muted)',
                border: `2px solid ${filter === f ? 'var(--color-ink)' : 'var(--color-border)'}`,
              }}
            >
              {f === "all" ? `All (${stats.total})` : f === "active" ? `Active (${stats.active})` : `Done (${stats.completed})`}
            </button>
          ))}
        </div>

        {/* Category filter */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            onClick={() => setCategoryFilter("all")}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              background: categoryFilter === "all" ? 'var(--color-ink-light)' : 'transparent',
              color: categoryFilter === "all" ? 'white' : 'var(--color-ink-muted)',
              border: `1.5px solid ${categoryFilter === "all" ? 'var(--color-ink-light)' : 'var(--color-border)'}`,
            }}
          >
            All categories
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryFilter(c.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all"
              style={{
                background: categoryFilter === c.id ? c.color : 'transparent',
                color: categoryFilter === c.id ? 'white' : 'var(--color-ink-muted)',
                border: `1.5px solid ${categoryFilter === c.id ? c.color : 'var(--color-border)'}`,
              }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: categoryFilter === c.id ? 'white' : c.color }}
              />
              {c.name}
            </button>
          ))}
        </div>

        {/* Todo list */}
        {filteredTodos.length === 0 ? (
          <div className="card p-10 text-center">
            <div className="text-3xl mb-3">{filter === "all" && categoryFilter === "all" ? "🥟" : "🔍"}</div>
            <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
              {filter === "all" && categoryFilter === "all"
                ? "No todos yet. Add one above!"
                : "No matching todos."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTodos.map((todo) => {
              const overdue = !todo.completed && isOverdue(todo.dueDate);
              const dueDateLabel = formatDueDate(todo.dueDate);
              const category = todo.categoryId ? categoryMap.get(todo.categoryId) : null;
              return (
                <div
                  key={todo.id}
                  className="card p-4 flex items-center gap-4 group"
                  style={overdue ? { borderColor: '#F5C4BB', background: '#FEF8F6' } : {}}
                >
                  <button
                    onClick={() => toggleTodo(todo.id)}
                    className="checkbox-warm"
                    style={todo.completed ? { background: 'var(--color-sage)', borderColor: 'var(--color-sage)' } : {}}
                  >
                    {todo.completed && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6L5 8.5L9.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-sm font-medium block"
                      style={{
                        color: todo.completed ? 'var(--color-ink-faint)' : 'var(--color-ink)',
                        textDecoration: todo.completed ? 'line-through' : 'none',
                      }}
                    >
                      {todo.title}
                    </span>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className={`badge badge-${todo.priority}`}>
                        {todo.priority === "high" ? "High" : todo.priority === "medium" ? "Mid" : "Low"}
                      </span>
                      {category && (
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-md text-white"
                          style={{ backgroundColor: category.color }}
                        >
                          {category.name}
                        </span>
                      )}
                      {dueDateLabel && (
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: overdue ? 'var(--color-terracotta)' : 'var(--color-ink-faint)' }}
                        >
                          {dueDateLabel}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteTodo(todo.id)}
                    className="text-sm opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--color-ink-faint)' }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--color-terracotta)'; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--color-ink-faint)'; }}
                  >
                    {"\u00d7"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {stats.completed > 0 && (
          <button
            onClick={clearCompleted}
            className="mt-5 text-xs font-medium transition-colors"
            style={{ color: 'var(--color-ink-faint)' }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--color-terracotta)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--color-ink-faint)'; }}
          >
            Clear {stats.completed} completed
          </button>
        )}
      </div>
    );
  },
});
