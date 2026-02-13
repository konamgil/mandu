import type {
  ChatHistoryResponse,
  ChatMessagePayload,
  ChatMessageResponse,
  ChatStreamEvent,
} from "@/shared/contracts/chat";

const API_BASE = "/api/chat";

export async function sendChatMessage(payload: ChatMessagePayload): Promise<ChatMessageResponse> {
  const response = await fetch(`${API_BASE}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to send message: ${response.status}`);
  }

  return response.json() as Promise<ChatMessageResponse>;
}

export async function fetchChatHistory(): Promise<ChatHistoryResponse> {
  const response = await fetch(`${API_BASE}/messages`);
  if (!response.ok) {
    throw new Error(`Failed to load history: ${response.status}`);
  }

  return response.json() as Promise<ChatHistoryResponse>;
}

export function openChatStream(onEvent: (event: ChatStreamEvent) => void): () => void {
  const source = new EventSource(`${API_BASE}/stream`);

  source.onmessage = (event) => {
    const parsed = JSON.parse(event.data) as ChatStreamEvent;
    onEvent(parsed);
  };

  source.onerror = () => {
    source.close();
  };

  return () => source.close();
}
