import { getMessages, subscribe } from "@/server/application/chat-store";
import type { ChatMessage, ChatStreamEvent } from "@/shared/contracts/chat";

const encoder = new TextEncoder();

function formatEvent(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function GET(): Response {
  let interval: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const snapshot: ChatStreamEvent = {
        type: "snapshot",
        data: getMessages(),
      };
      controller.enqueue(formatEvent(snapshot));

      unsubscribe = subscribe((message: ChatMessage) => {
        const event: ChatStreamEvent = {
          type: "message",
          data: message,
        };
        controller.enqueue(formatEvent(event));
      });

      interval = setInterval(() => {
        const heartbeat: ChatStreamEvent = {
          type: "heartbeat",
          data: { ts: new Date().toISOString() },
        };
        controller.enqueue(formatEvent(heartbeat));
      }, 15000);
    },
    cancel() {
      if (interval) clearInterval(interval);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
