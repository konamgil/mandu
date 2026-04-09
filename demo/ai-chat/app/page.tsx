export default function ChatPage() {
  return (
    <div className="flex flex-col h-screen">
      <header className="border-b border-gray-800 px-4 py-3">
        <h1 className="text-lg font-semibold">Mandu AI Chat</h1>
        <p className="text-xs text-gray-500">SSE streaming + Island hydration demo</p>
      </header>
      <div
        data-island="chat-box"
        data-props="{}"
        className="flex-1 flex flex-col"
      >
        {/* SSR fallback */}
        <div className="flex-1 flex items-center justify-center text-gray-600">
          Loading chat...
        </div>
      </div>
    </div>
  );
}
