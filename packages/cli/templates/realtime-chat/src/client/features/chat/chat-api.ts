import type {
  ChatHistoryResponse,
  ChatMessagePayload,
  ChatMessageResponse,
  ChatStreamEvent,
} from "@/shared/contracts/chat";

const API_BASE = "/api/chat";

interface ChatStreamOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
  eventSourceFactory?: (url: string) => EventSource;
}

const DEFAULT_STREAM_OPTIONS: Required<Omit<ChatStreamOptions, "eventSourceFactory">> = {
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

function toReconnectDelayMs(attempt: number, options: Required<Omit<ChatStreamOptions, "eventSourceFactory">>): number {
  const exponentialDelay = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
  const jitterRange = exponentialDelay * options.jitterRatio;
  const jitter = (options.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(exponentialDelay + jitter));
}

export function openChatStream(
  onEvent: (event: ChatStreamEvent) => void,
  streamOptions: ChatStreamOptions = {},
): () => void {
  const options = { ...DEFAULT_STREAM_OPTIONS, ...streamOptions };
  const createSource = streamOptions.eventSourceFactory ?? ((url: string) => new EventSource(url));

  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let isDisposed = false;

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
      return;
    }

    const delayMs = toReconnectDelayMs(reconnectAttempts, options);
    reconnectAttempts += 1;

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  };

  const connect = () => {
    if (isDisposed) {
      return;
    }

    closeSource();
    const currentSource = createSource(`${API_BASE}/stream`);
    source = currentSource;

    currentSource.onopen = () => {
      if (source !== currentSource || isDisposed) {
        return;
      }

      reconnectAttempts = 0;
    };

    currentSource.onmessage = (event) => {
      if (source !== currentSource || isDisposed) {
        return;
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
  };
}
