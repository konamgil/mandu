import type { ChatMessage } from "@/shared/contracts/chat";

type ChatListener = (event: ChatMessageEvent) => void;

export interface ChatMessageEvent {
  eventId: string;
  message: ChatMessage;
}

type SubscriptionSnapshot = {
  snapshot: ChatMessage[];
  commit: () => () => void;
};

export interface ResumePlan {
  mode: "catch-up" | "snapshot";
  events: ChatMessageEvent[];
}

const listeners = new Set<ChatListener>();
const messages: ChatMessage[] = [];
const MAX_HISTORY_MESSAGES = 200;
const MAX_CATCH_UP_EVENTS = 500;
let storeVersion = 0;
let streamEventSeq = 0;
const catchUpEvents: ChatMessageEvent[] = [];
let testHookBeforeSubscribeCommit: (() => void) | undefined;

function createMessage(role: ChatMessage["role"], text: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    createdAt: new Date().toISOString(),
  };
}

function createEventId(nextSeq: number): string {
  return `msg-${nextSeq}`;
}

function parseEventSeq(eventId: string | null | undefined): number | null {
  if (!eventId) return null;
  const match = /^msg-(\d+)$/.exec(eventId);
  if (!match) return null;
  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function pushCatchUpEvent(event: ChatMessageEvent): void {
  catchUpEvents.push(event);
  if (catchUpEvents.length > MAX_CATCH_UP_EVENTS) {
    catchUpEvents.splice(0, catchUpEvents.length - MAX_CATCH_UP_EVENTS);
  }
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
  streamEventSeq += 1;

  const event: ChatMessageEvent = {
    eventId: createEventId(streamEventSeq),
    message,
  };

  pushCatchUpEvent(event);

  for (const listener of listeners) {
    try {
      listener(event);
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
  // commit()은 snapshot 전송 후 호출하여 listener 활성화 (이벤트 순서 보장)
  for (;;) {
    const beforeVersion = storeVersion;
    const snapshot = [...messages];

    testHookBeforeSubscribeCommit?.();

    if (beforeVersion === storeVersion) {
      return {
        snapshot,
        commit: () => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    }
  }
}

export function planResumeFrom(lastEventId: string | null | undefined): ResumePlan {
  const parsedSeq = parseEventSeq(lastEventId);
  if (parsedSeq === null) {
    return { mode: "snapshot", events: [] };
  }

  if (parsedSeq === streamEventSeq) {
    return { mode: "catch-up", events: [] };
  }

  const firstAvailable = catchUpEvents[0];
  if (!firstAvailable) {
    return { mode: "snapshot", events: [] };
  }

  const firstSeq = parseEventSeq(firstAvailable.eventId);
  if (firstSeq === null || parsedSeq < firstSeq - 1 || parsedSeq > streamEventSeq) {
    return { mode: "snapshot", events: [] };
  }

  const events = catchUpEvents.filter((event) => {
    const seq = parseEventSeq(event.eventId);
    return seq !== null && seq > parsedSeq;
  });

  return { mode: "catch-up", events };
}

export function __resetChatStoreForTests(): void {
  messages.length = 0;
  listeners.clear();
  storeVersion = 0;
  streamEventSeq = 0;
  catchUpEvents.length = 0;
  testHookBeforeSubscribeCommit = undefined;
}

export function __setSubscribeCommitHookForTests(hook?: () => void): void {
  testHookBeforeSubscribeCommit = hook;
}

export { MAX_HISTORY_MESSAGES, MAX_CATCH_UP_EVENTS };
