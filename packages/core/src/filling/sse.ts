export interface SSEOptions {
  /** Additional headers merged into default SSE headers */
  headers?: HeadersInit;
  /** HTTP status code (default: 200) */
  status?: number;
}

export interface SSESendOptions {
  event?: string;
  id?: string;
  retry?: number;
}

export type SSECleanup = () => void | Promise<void>;

const DEFAULT_SSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export class SSEConnection {
  readonly response: Response;

  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private encoder = new TextEncoder();
  private pending: string[] = [];
  private closed = false;
  private cleanupHandlers: SSECleanup[] = [];

  constructor(signal?: AbortSignal, options: SSEOptions = {}) {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
        for (const chunk of this.pending) {
          controller.enqueue(this.encoder.encode(chunk));
        }
        this.pending = [];
      },
      cancel: () => {
        this.close();
      },
    });

    const headers = new Headers(DEFAULT_SSE_HEADERS);
    if (options.headers) {
      const extra = new Headers(options.headers);
      extra.forEach((value, key) => headers.set(key, value));
    }

    this.response = new Response(stream, {
      status: options.status ?? 200,
      headers,
    });

    signal?.addEventListener("abort", () => this.close(), { once: true });
  }

  send(data: unknown, options: SSESendOptions = {}): void {
    if (this.closed) return;

    const lines: string[] = [];

    if (options.event) lines.push(`event: ${options.event}`);
    if (options.id) lines.push(`id: ${options.id}`);
    if (typeof options.retry === "number") lines.push(`retry: ${Math.max(0, Math.floor(options.retry))}`);

    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const payloadLines = payload.split(/\r?\n/);
    for (const line of payloadLines) {
      lines.push(`data: ${line}`);
    }

    this.enqueue(`${lines.join("\n")}\n\n`);
  }

  event(name: string, data: unknown, options: Omit<SSESendOptions, "event"> = {}): void {
    this.send(data, { ...options, event: name });
  }

  comment(text: string): void {
    if (this.closed) return;
    const normalized = text.replace(/\r?\n/g, "\n");
    const lines = normalized.split("\n").map((line) => `: ${line}`);
    this.enqueue(`${lines.join("\n")}\n\n`);
  }

  heartbeat(intervalMs = 15000, comment = "heartbeat"): () => void {
    const timer = setInterval(() => {
      if (this.closed) return;
      this.comment(comment);
    }, Math.max(1000, intervalMs));

    const stop = () => clearInterval(timer);
    this.onClose(stop);
    return stop;
  }

  onClose(handler: SSECleanup): void {
    if (this.closed) {
      void handler();
      return;
    }
    this.cleanupHandlers.push(handler);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      this.controller?.close();
    } catch {
      // no-op
    }

    const handlers = [...this.cleanupHandlers];
    this.cleanupHandlers = [];
    for (const handler of handlers) {
      await handler();
    }
  }

  private enqueue(chunk: string): void {
    if (this.controller) {
      this.controller.enqueue(this.encoder.encode(chunk));
      return;
    }
    this.pending.push(chunk);
  }
}

/**
 * Create a production-safe Server-Sent Events connection helper.
 */
export function createSSEConnection(signal?: AbortSignal, options: SSEOptions = {}): SSEConnection {
  return new SSEConnection(signal, options);
}
