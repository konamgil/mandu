import { getAIAdapter } from "@/server/application/ai-adapter";
import { appendMessage, getMessages } from "@/server/application/chat-store";
import {
  isChatMessagePayload,
  type ChatHistoryResponse,
  type ChatMessageResponse,
} from "@/shared/contracts/chat";
import { createRateLimiter } from "@mandujs/core/runtime/server";

// Rate limiter: 1분당 10개 메시지로 제한
const limiter = createRateLimiter({ max: 10, windowMs: 60000 });

export function GET(request: Request): Response {
  // GET 요청은 제한을 느슨하게 (1분당 30회)
  const getDecision = createRateLimiter({ max: 30, windowMs: 60000 }).check(request, "chat-messages-get");
  if (!getDecision.allowed) {
    return limiter.createResponse(getDecision);
  }

  const body: ChatHistoryResponse = { messages: getMessages() };
  const response = Response.json(body);
  return limiter.addHeaders(response, getDecision);
}

export async function POST(request: Request): Promise<Response> {
  // Rate limiting 체크
  const decision = limiter.check(request, "chat-messages-post");
  if (!decision.allowed) {
    return limiter.createResponse(decision);
  }

  let payload: unknown;

  try {
    payload = (await request.json()) as unknown;
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!isChatMessagePayload(payload)) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const user = appendMessage("user", payload.text.trim());
  const adapter = getAIAdapter();

  try {
    const completion = await adapter.complete({
      userText: user.text,
      history: getMessages(),
    });

    if (completion && completion.trim().length > 0) {
      appendMessage("assistant", completion);
    }
  } catch {
    // Keep user message committed even when assistant completion fails.
  }

  const body: ChatMessageResponse = { message: user };
  const response = Response.json(body, { status: 201 });
  return limiter.addHeaders(response, decision);
}
