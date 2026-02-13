import { Mandu } from "@mandujs/core";
import { z } from "zod";

const ChatBody = z.object({
  message: z.string().min(1).max(500),
});

function buildReply(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("mandu")) {
    return "Mandu helps teams ship quickly with AI while keeping architecture stable.";
  }

  if (normalized.includes("realtime") || normalized.includes("real-time")) {
    return "This starter streams tokens over SSE to simulate realtime chat behavior.";
  }

  return `Starter reply: ${message}`;
}

export default Mandu.filling().post(async (ctx) => {
  const { message } = await ctx.body(ChatBody);
  const chunks = buildReply(message).split(" ");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: `${chunk} ` })}\n\n`));
        await Bun.sleep(30);
      }

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
