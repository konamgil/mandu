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
  const payload = (await request.json()) as unknown;

  if (!isChatMessagePayload(payload)) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const user = appendMessage("user", payload.text.trim());
  const adapter = getAIAdapter();

  const completion = await adapter.complete({
    userText: user.text,
    history: getMessages(),
  });

  if (completion && completion.trim().length > 0) {
    appendMessage("assistant", completion);
  }

  const body: ChatMessageResponse = { message: user };
  return Response.json(body, { status: 201 });
}
