import type { ChatMessage } from "@/shared/contracts/chat";

type ChatListener = (message: ChatMessage) => void;

const listeners = new Set<ChatListener>();
const messages: ChatMessage[] = [];
const MAX_HISTORY_MESSAGES = 200;

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

  if (messages.length > MAX_HISTORY_MESSAGES) {
    messages.splice(0, messages.length - MAX_HISTORY_MESSAGES);
  }

  for (const listener of listeners) {
    listener(message);
  }

  return message;
}

export function subscribe(listener: ChatListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}


export function __resetChatStoreForTests(): void {
  messages.length = 0;
  listeners.clear();
}

export { MAX_HISTORY_MESSAGES };
