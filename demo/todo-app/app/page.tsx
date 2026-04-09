import { todoService } from "../server/domain/todo/todo.service";

export default function HomePage() {
  const stats = todoService.stats();

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Mandu Todo App</h1>
      <p className="text-gray-600 mb-6">
        Mandu 프레임워크의 CRUD, Island Hydration, API 라우팅을 시연합니다.
      </p>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          <div className="text-sm text-gray-500">Total</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-blue-600">{stats.active}</div>
          <div className="text-sm text-gray-500">Active</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
          <div className="text-sm text-gray-500">Done</div>
        </div>
      </div>

      <a
        href="/todos"
        className="inline-block bg-gray-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800"
      >
        Manage Todos
      </a>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">API Endpoints</h2>
        <ul className="space-y-1 text-sm text-gray-600">
          <li><code className="bg-gray-100 px-1.5 py-0.5 rounded">GET /api/todos?filter=all|active|completed</code></li>
          <li><code className="bg-gray-100 px-1.5 py-0.5 rounded">POST /api/todos</code> — Create</li>
          <li><code className="bg-gray-100 px-1.5 py-0.5 rounded">PUT /api/todos/:id</code> — Update</li>
          <li><code className="bg-gray-100 px-1.5 py-0.5 rounded">DELETE /api/todos/:id</code> — Delete</li>
          <li><code className="bg-gray-100 px-1.5 py-0.5 rounded">DELETE /api/todos</code> — Clear completed</li>
        </ul>
      </section>
    </div>
  );
}
