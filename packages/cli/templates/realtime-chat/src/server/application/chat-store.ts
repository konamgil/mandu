import type { ChatMessage } from "@/shared/contracts/chat";

type ChatListener = (message: ChatMessage) => void;

type SubscriptionSnapshot = {
  snapshot: ChatMessage[];
  unsubscribe: () => void;
};

const listeners = new Set<ChatListener>();
const messages: ChatMessage[] = [];
const MAX_HISTORY_MESSAGES = 200;
let storeVersion = 0;
let testHookBeforeSubscribeCommit: (() => void) | undefined;

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

  storeVersion += 1;

  for (const listener of listeners) {
    try {
      listener(message);
    } catch {
      // Ignore listener errors so one broken subscriber does not stop fan-out.
    }
  }

  return message;
}

export function subscribe(listener: ChatListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeWithSnapshot(listener: ChatListener): SubscriptionSnapshot {
  // Optimistic lock-free retry: snapshot과 subscribe 사이에 write가 끼면 재시도
  // => snapshot-subscription 경계에서 메시지 유실 방지
  for (;;) {
    const beforeVersion = storeVersion;
    const snapshot = [...messages];

    testHookBeforeSubscribeCommit?.();

    listeners.add(listener);

    if (beforeVersion === storeVersion) {
      return {
        snapshot,
        unsubscribe: () => listeners.delete(listener),
      };
    }

    listeners.delete(listener);
  }
}

export function __resetChatStoreForTests(): void {
  messages.length = 0;
  listeners.clear();
  storeVersion = 0;
  testHookBeforeSubscribeCommit = undefined;
}

export function __setSubscribeCommitHookForTests(hook?: () => void): void {
  testHookBeforeSubscribeCommit = hook;
}

export { MAX_HISTORY_MESSAGES };
