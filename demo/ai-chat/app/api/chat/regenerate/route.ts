import { Mandu } from "@mandujs/core";
import { chatService } from "../../../../src/server/chat-service";
import { chatRateLimiter, getClientIp } from "../../../../src/server/rate-limiter";

const STREAM_INITIAL_DELAY_MS = 180;
const STREAM_DELAY_MS = 72;
const STREAM_BREAK_DELAY_MS = 120;

function getChunkDelay(chunk: string, index: number): number {
  if (index === 0) return STREAM_INITIAL_DELAY_MS;
  if (/\n\s*$/.test(chunk) || /[.!?]\s*$/.test(chunk)) return STREAM_BREAK_DELAY_MS;
  return STREAM_DELAY_MS;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export default Mandu.filling()
  .beforeHandle(async (ctx) => {
    const ip = getClientIp(ctx.request);
    const result = chatRateLimiter.check(ip);
    if (!result.allowed) {
      return ctx.json({ error: "Rate limit exceeded.", retryAfterMs: result.resetMs }, 429);
    }
  })
  .post(async (ctx) => {
    let body: { sessionId: string };
    try {
      body = await ctx.request.json();
    } catch {
      return ctx.error("Invalid request body");
    }

    const { sessionId } = body;
    const session = chatService.getSession(sessionId);
    if (!session) return ctx.notFound("Session not found");

    // Delete last assistant message
    chatService.deleteLastAssistantMessage(sessionId);

    const response = chatService.getRandomResponse();

    return ctx.sse(async (sse) => {
      try {
        const chunks = chatService.getResponseChunks(response);
        for (const [index, chunk] of chunks.entries()) {
          if (ctx.request.signal.aborted) return;
          sse.event("token", chunk);
          await wait(getChunkDelay(chunk, index), ctx.request.signal);
        }
        if (ctx.request.signal.aborted) return;
        chatService.addMessage(sessionId, { role: "assistant", content: response });
        sse.event("done", response);
      } catch (error: unknown) {
        if (!ctx.request.signal.aborted) {
          const message = error instanceof Error ? error.message : "스트리밍 중 오류가 발생했습니다.";
          sse.event("error", message);
        }
      } finally {
        await sse.close();
      }
    });
  });
