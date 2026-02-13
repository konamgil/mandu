import { getAIAdapter } from "@/server/application/ai-adapter";
import { appendMessage, getMessages } from "@/server/application/chat-store";
import {
  isChatMessagePayload,
  type ChatHistoryResponse,
  type ChatMessageResponse,
} from "@/shared/contracts/chat";

export function GET(): Response {
  const body: ChatHistoryResponse = { messages: getMessages() };
  return Response.json(body);
}

export async function POST(request: Request): Promise<Response> {
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
  return Response.json(body, { status: 201 });
}
