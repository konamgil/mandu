import { Mandu } from "@mandujs/core";
import { useState, useCallback } from "react";
import type { Todo, TodoFilter } from "../../../server/domain/todo/todo.types";

interface TodoListData {
  initialTodos: Todo[];
}

interface TodoListSetup {
  todos: Todo[];
  filter: TodoFilter;
  filteredTodos: Todo[];
  newTitle: string;
  setNewTitle: (v: string) => void;
  setFilter: (f: TodoFilter) => void;
  addTodo: () => Promise<void>;
  toggleTodo: (id: string) => Promise<void>;
  deleteTodo: (id: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
  stats: { total: number; active: number; completed: number };
}

export default Mandu.island<TodoListData, TodoListSetup>({
  setup: (serverData) => {
    const [todos, setTodos] = useState<Todo[]>(serverData.initialTodos);
    const [newTitle, setNewTitle] = useState("");
    const [filter, setFilter] = useState<TodoFilter>("all");

    const filteredTodos = todos.filter((t) => {
      if (filter === "active") return !t.completed;
      if (filter === "completed") return t.completed;
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
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      const { todo } = await res.json();
      setTodos((prev) => [...prev, todo]);
      setNewTitle("");
    }, [newTitle]);

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

    return { todos, filter, filteredTodos, newTitle, setNewTitle, setFilter, addTodo, toggleTodo, deleteTodo, clearCompleted, stats };
  },

  render: ({ filteredTodos, filter, newTitle, setNewTitle, setFilter, addTodo, toggleTodo, deleteTodo, clearCompleted, stats }) => (
    <div>
      <form
        onSubmit={(e) => { e.preventDefault(); addTodo(); }}
        className="flex gap-2 mb-4"
      >
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="What needs to be done?"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
        <button
          type="submit"
          className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800"
        >
          Add
        </button>
      </form>

      <div className="flex gap-1 mb-4">
        {(["all", "active", "completed"] as TodoFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === f
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f === "all" ? `All (${stats.total})` : f === "active" ? `Active (${stats.active})` : `Done (${stats.completed})`}
          </button>
        ))}
      </div>

      {filteredTodos.length === 0 ? (
        <p className="text-gray-400 text-center py-8">
          {filter === "all" ? "No todos yet. Add one above!" : `No ${filter} todos.`}
        </p>
      ) : (
        <ul className="space-y-2">
          {filteredTodos.map((todo) => (
            <li
              key={todo.id}
              className="flex items-center gap-3 bg-white rounded-lg border p-3 group"
            >
              <button
                onClick={() => toggleTodo(todo.id)}
                className={`w-5 h-5 rounded border flex items-center justify-center text-xs shrink-0 ${
                  todo.completed
                    ? "bg-green-500 border-green-500 text-white"
                    : "border-gray-300 hover:border-gray-400"
                }`}
              >
                {todo.completed && "\u2713"}
              </button>
              <span className={`flex-1 text-sm ${todo.completed ? "line-through text-gray-400" : "text-gray-900"}`}>
                {todo.title}
              </span>
              <button
                onClick={() => deleteTodo(todo.id)}
                className="text-gray-300 hover:text-red-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity"
              >
                \u00d7
              </button>
            </li>
          ))}
        </ul>
      )}

      {stats.completed > 0 && (
        <button
          onClick={clearCompleted}
          className="mt-4 text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          Clear {stats.completed} completed
        </button>
      )}
    </div>
  ),
});
