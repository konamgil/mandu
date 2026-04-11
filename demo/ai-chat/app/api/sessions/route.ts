import { Mandu } from "@mandujs/core";
import { chatService } from "../../../src/server/chat-service";
import sessionsContract from "../../../spec/contracts/api-sessions.contract";
import { sessionsRateLimiter, getClientIp } from "../../../src/server/rate-limiter";

export default Mandu.filling()
  // ------------------------------------------------------------------
  // Rate limiting — 60 req/min for session operations
  // ------------------------------------------------------------------
  .beforeHandle(async (ctx) => {
    const ip = getClientIp(ctx.request);
    const result = sessionsRateLimiter.check(ip);

    if (!result.allowed) {
      return ctx.json(
        {
          error: "Rate limit exceeded. Please try again shortly.",
          retryAfterMs: result.resetMs,
        },
        429,
      );
    }

    ctx.set("rateLimit.remaining", result.remaining);
  })
  // ------------------------------------------------------------------
  // GET /api/sessions — List all sessions
  // ------------------------------------------------------------------
  .get((ctx) => {
    const sessions = chatService.listSessions().map((s) => ({
      id: s.id,
      title: s.title,
      messageCount: s.messages.length,
      systemPrompt: s.systemPrompt,
      updatedAt: s.updatedAt,
    }));
    return ctx.ok({ sessions });
  })
  // ------------------------------------------------------------------
  // POST /api/sessions — Create a new session
  // ------------------------------------------------------------------
  .post(async (ctx) => {
    let input: { body: { title?: string } };
    try {
      input = await ctx.input(sessionsContract, "POST");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request body";
      return ctx.error(message);
    }

    const session = chatService.createSession(input.body.title);
    return ctx.created({
      id: session.id,
      title: session.title,
      messages: session.messages,
      systemPrompt: session.systemPrompt,
    });
  })
  // ------------------------------------------------------------------
  // PUT /api/sessions — Update a session's system prompt
  // ------------------------------------------------------------------
  .put(async (ctx) => {
    let input: { body: { sessionId: string; systemPrompt: string } };
    try {
      input = await ctx.input(sessionsContract, "PUT");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request body";
      return ctx.error(message);
    }

    const { sessionId, systemPrompt } = input.body;
    const ok = chatService.updateSystemPrompt(sessionId, systemPrompt);
    if (!ok) return ctx.notFound("Session not found");
    return ctx.ok({ success: true });
  })
  // ------------------------------------------------------------------
  // DELETE /api/sessions — Remove a session
  // ------------------------------------------------------------------
  .delete(async (ctx) => {
    let input: { body: { sessionId: string } };
    try {
      input = await ctx.input(sessionsContract, "DELETE");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request body";
      return ctx.error(message);
    }

    const { sessionId } = input.body;
    chatService.deleteSession(sessionId);
    return ctx.ok({ success: true });
  });
