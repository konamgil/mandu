import { subscribeWithSnapshot } from "@/server/application/chat-store";
import type { ChatMessage, ChatStreamEvent } from "@/shared/contracts/chat";
import { createRateLimiter } from "@mandujs/core/runtime/server";

const encoder = new TextEncoder();

// Rate limiter: 1분당 5개 연결로 제한 (SSE는 장시간 유지되므로 보수적으로 설정)
const limiter = createRateLimiter({ max: 5, windowMs: 60000 });

function formatEvent(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function GET(request: Request): Response {
  // Rate limiting 체크
  const decision = limiter.check(request, "chat-stream");
  if (!decision.allowed) {
    return limiter.createResponse(decision);
  }
  let interval: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const subscription = subscribeWithSnapshot((message: ChatMessage) => {
        const event: ChatStreamEvent = {
          type: "message",
          data: message,
        };
        controller.enqueue(formatEvent(event));
      });

      // snapshot을 먼저 전송
      const snapshot: ChatStreamEvent = {
        type: "snapshot",
        data: subscription.snapshot,
      };
      controller.enqueue(formatEvent(snapshot));

      // 그 다음 listener 활성화 (이벤트 순서 보장)
      unsubscribe = subscription.commit();

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
