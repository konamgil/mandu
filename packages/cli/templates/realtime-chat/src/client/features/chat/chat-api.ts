import type {
  ChatHistoryResponse,
  ChatMessage,
  ChatMessagePayload,
  ChatMessageResponse,
  ChatStreamEvent,
} from "@/shared/contracts/chat";

const API_BASE = "/api/chat";

export type ChatStreamConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "closed";

interface ChatStreamOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
  eventSourceFactory?: (url: string) => EventSource;
  onConnectionStateChange?: (state: ChatStreamConnectionState) => void;
}

type ReconnectOptions = Required<Omit<ChatStreamOptions, "eventSourceFactory" | "onConnectionStateChange">>;

const DEFAULT_STREAM_OPTIONS: ReconnectOptions = {
  maxRetries: 8,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  jitterRatio: 0.25,
  random: Math.random,
};

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

export function mergeChatMessages(base: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const merged = new Map<string, ChatMessage>();

  for (const message of base) {
    merged.set(message.id, message);
  }

  for (const message of incoming) {
    merged.set(message.id, message);
  }

  return [...merged.values()].sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt);
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });
}

function toReconnectDelayMs(attempt: number, options: ReconnectOptions): number {
  const exponentialDelay = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
  const jitterRange = exponentialDelay * options.jitterRatio;
  const jitter = (options.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.min(options.maxDelayMs, Math.round(exponentialDelay + jitter)));
}

export function openChatStream(
  onEvent: (event: ChatStreamEvent) => void,
  streamOptions: ChatStreamOptions = {},
): () => void {
  const options: ReconnectOptions = {
    maxRetries: streamOptions.maxRetries ?? DEFAULT_STREAM_OPTIONS.maxRetries,
    baseDelayMs: streamOptions.baseDelayMs ?? DEFAULT_STREAM_OPTIONS.baseDelayMs,
    maxDelayMs: streamOptions.maxDelayMs ?? DEFAULT_STREAM_OPTIONS.maxDelayMs,
    jitterRatio: streamOptions.jitterRatio ?? DEFAULT_STREAM_OPTIONS.jitterRatio,
    random: streamOptions.random ?? DEFAULT_STREAM_OPTIONS.random,
  };
  const createSource = streamOptions.eventSourceFactory ?? ((url: string) => new EventSource(url));

  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let isDisposed = false;
  let lastEventId: string | null = null;

  const setConnectionState = (state: ChatStreamConnectionState) => {
    streamOptions.onConnectionStateChange?.(state);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const closeSource = () => {
    if (!source) {
      return;
    }

    source.onopen = null;
    source.onmessage = null;
    source.onerror = null;
    source.close();
    source = null;
  };

  const scheduleReconnect = () => {
    if (isDisposed || reconnectTimer) {
      return;
    }

    if (reconnectAttempts >= options.maxRetries) {
      closeSource();
      setConnectionState("failed");
      return;
    }

    setConnectionState("reconnecting");
    const delayMs = toReconnectDelayMs(reconnectAttempts, options);
    reconnectAttempts += 1;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  };

  const toStreamUrl = () => {
    if (!lastEventId) return `${API_BASE}/stream`;
    return `${API_BASE}/stream?lastEventId=${encodeURIComponent(lastEventId)}`;
  };

  const connect = () => {
    if (isDisposed) {
      return;
    }

    setConnectionState("connecting");
    closeSource();
    const currentSource = createSource(toStreamUrl());
    source = currentSource;

    currentSource.onopen = () => {
      if (source !== currentSource || isDisposed) {
        return;
      }

      reconnectAttempts = 0;
      setConnectionState("connected");
    };

    currentSource.onmessage = (event) => {
      if (source !== currentSource || isDisposed) {
        return;
      }

      const maybeLastEventId = (event as MessageEvent).lastEventId;
      if (typeof maybeLastEventId === "string" && maybeLastEventId.trim().length > 0) {
        lastEventId = maybeLastEventId.trim();
      }

      try {
        const parsed = JSON.parse(event.data) as ChatStreamEvent;
        onEvent(parsed);
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    currentSource.onerror = () => {
      if (source !== currentSource || isDisposed) {
        return;
      }

      closeSource();
      scheduleReconnect();
    };
  };

  connect();

  return () => {
    isDisposed = true;
    clearReconnectTimer();
    closeSource();
    setConnectionState("closed");
  };
}
