import { Mandu } from "@mandujs/core";
import { chatService } from "../../../src/server/chat-service";

export default Mandu.filling()
  .get((ctx) => {
    const url = new URL(ctx.request.url);
    const q = url.searchParams.get("q")?.trim();
    if (!q || q.length < 2) {
      return ctx.ok({ results: [] });
    }

    const results = chatService.searchMessages(q).map(r => ({
      messageId: r.message.id,
      sessionId: r.sessionId,
      sessionTitle: r.sessionTitle,
      role: r.message.role,
      content: r.message.content,
      timestamp: r.message.timestamp,
    }));

    return ctx.ok({ results });
  });
