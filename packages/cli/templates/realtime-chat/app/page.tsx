/**
 * Realtime Chat Starter Home
 */

import { RealtimeChatStarter } from "@/client/widgets/realtime-chat-starter";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="space-y-2 text-center">
        <h1 className="text-4xl font-bold">🥟 Mandu Realtime Chat Starter</h1>
        <p className="text-muted-foreground">
          Minimal full-stack starter with optimistic UI + typing indicator + API route.
        </p>
      </header>

      <RealtimeChatStarter />
    </main>
  );
}
