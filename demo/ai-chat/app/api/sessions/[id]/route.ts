import { Mandu } from "@mandujs/core";
import { chatService } from "../../../../src/server/chat-service";

export default Mandu.filling()
  .get((ctx) => {
    const session = chatService.getSession(ctx.params.id);
    if (!session) return ctx.notFound("Session not found");
    return ctx.ok({
      id: session.id,
      title: session.title,
      messages: session.messages,
      systemPrompt: session.systemPrompt,
    });
  });
