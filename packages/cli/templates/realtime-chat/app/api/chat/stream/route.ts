import {
  planResumeFrom,
  subscribeWithSnapshot,
} from "@/server/application/chat-store";
import type { ChatMessage, ChatStreamEvent } from "@/shared/contracts/chat";
import { createSSEConnection } from "@mandujs/core";
import { createRateLimiter } from "@mandujs/core/runtime/server.ts";

// Rate limiter: 1분당 5개 연결로 제한 (SSE는 장시간 유지되므로 보수적으로 설정)
const limiter = createRateLimiter({ max: 5, windowMs: 60000 });

function getLastEventId(request: Request): string | null {
  const fromHeader = request.headers.get("last-event-id");
  if (fromHeader && fromHeader.trim()) return fromHeader.trim();

  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("lastEventId");
  if (fromQuery && fromQuery.trim()) return fromQuery.trim();

  return null;
}

export function GET(request: Request): Response {
  // Rate limiting 체크
  const decision = limiter.check(request, "chat-stream");
  if (!decision.allowed) {
    return limiter.createResponse(decision);
  }

  const sse = createSSEConnection(request.signal);
  const lastEventId = getLastEventId(request);

  const subscribeToLiveMessages = () => {
    const subscription = subscribeWithSnapshot((event) => {
      const streamEvent: ChatStreamEvent = {
        type: "message",
        data: event.message,
      };
      sse.send(streamEvent, { id: event.eventId });
    });

    return subscription;
  };

  const resume = planResumeFrom(lastEventId);

  if (resume.mode === "catch-up") {
    for (const event of resume.events) {
      const streamEvent: ChatStreamEvent = {
        type: "message",
        data: event.message,
      };
      sse.send(streamEvent, { id: event.eventId });
    }

    const liveSubscription = subscribeToLiveMessages();
    const unsubscribe = liveSubscription.commit();
    sse.onClose(() => unsubscribe());
  } else {
    const snapshotSubscription = subscribeToLiveMessages();

    const snapshot: ChatStreamEvent = {
      type: "snapshot",
      data: snapshotSubscription.snapshot,
    };
    sse.send(snapshot);

    const unsubscribe = snapshotSubscription.commit();
    sse.onClose(() => unsubscribe());
  }

  const interval = setInterval(() => {
    const heartbeat: ChatStreamEvent = {
      type: "heartbeat",
      data: { ts: new Date().toISOString() },
    };
    sse.send(heartbeat);
  }, 15000);

  sse.onClose(() => {
    clearInterval(interval);
  });

  return sse.response;
}
