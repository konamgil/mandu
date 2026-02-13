export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface ChatMessagePayload {
  text: string;
}

export interface ChatMessageResponse {
  message: ChatMessage;
}

export interface ChatHistoryResponse {
  messages: ChatMessage[];
}

export interface ChatStreamEvent {
  type: "snapshot" | "message" | "heartbeat";
  data: ChatMessage[] | ChatMessage | { ts: string };
}

export function isChatMessagePayload(value: unknown): value is ChatMessagePayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChatMessagePayload>;
  return typeof candidate.text === "string" && candidate.text.trim().length > 0;
}
