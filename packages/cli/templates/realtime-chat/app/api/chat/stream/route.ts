import { subscribeWithSnapshot } from "@/server/application/chat-store";
import type { ChatMessage, ChatStreamEvent } from "@/shared/contracts/chat";
import { createSSEConnection } from "@mandujs/core";
import { createRateLimiter } from "@mandujs/core/runtime/server.ts";

// Rate limiter: 1분당 5개 연결로 제한 (SSE는 장시간 유지되므로 보수적으로 설정)
const limiter = createRateLimiter({ max: 5, windowMs: 60000 });

export function GET(request: Request): Response {
  // Rate limiting 체크
  const decision = limiter.check(request, "chat-stream");
  if (!decision.allowed) {
    return limiter.createResponse(decision);
  }

  const sse = createSSEConnection(request.signal);

  const subscription = subscribeWithSnapshot((message: ChatMessage) => {
    const event: ChatStreamEvent = {
      type: "message",
      data: message,
    };
    sse.send(event);
  });

  const snapshot: ChatStreamEvent = {
    type: "snapshot",
    data: subscription.snapshot,
  };
  sse.send(snapshot);

  const interval = setInterval(() => {
    const heartbeat: ChatStreamEvent = {
      type: "heartbeat",
      data: { ts: new Date().toISOString() },
    };
    sse.send(heartbeat);
  }, 15000);

  sse.onClose(() => {
    clearInterval(interval);
    subscription.unsubscribe();
  });

  return sse.response;
}
