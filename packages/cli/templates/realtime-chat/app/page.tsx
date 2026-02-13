import { RealtimeChatStarter } from "@/client/features/chat/realtime-chat-starter.client";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">🥟 Mandu Realtime Chat Starter</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Official starter template with typed client hook, message API, and SSE stream.
        </p>
      </header>

      <RealtimeChatStarter />
    </main>
  );
}
