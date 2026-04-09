import { todoService } from "../../server/domain/todo/todo.service";

export default function TodosPage() {
  const todos = todoService.list("all");

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Todos</h1>
      <div
        data-island="todo-list"
        data-props={JSON.stringify({ initialTodos: todos })}
      >
        <ul className="space-y-2">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className="flex items-center gap-3 bg-white rounded-lg border p-3"
            >
              <span className={todo.completed ? "line-through text-gray-400" : "text-gray-900"}>
                {todo.title}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
