import type { ChatMessage } from "@/shared/contracts/chat";

type ChatListener = (message: ChatMessage) => void;

const listeners = new Set<ChatListener>();
const messages: ChatMessage[] = [];

function createMessage(role: ChatMessage["role"], text: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    createdAt: new Date().toISOString(),
  };
}

export function getMessages(): ChatMessage[] {
  return [...messages];
}

export function appendMessage(role: ChatMessage["role"], text: string): ChatMessage {
  const message = createMessage(role, text);
  messages.push(message);

  for (const listener of listeners) {
    listener(message);
  }

  return message;
}

export function subscribe(listener: ChatListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
