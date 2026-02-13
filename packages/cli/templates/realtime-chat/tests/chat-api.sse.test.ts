import { describe, expect, it } from "bun:test";
import { mergeChatMessages, openChatStream } from "@/client/features/chat/chat-api";
import type { ChatStreamEvent } from "@/shared/contracts/chat";

type MessageEventLike = { data: string; lastEventId?: string };

class FakeEventSource {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEventLike) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  emitOpen() {
    this.onopen?.(new Event("open"));
  }

  emitMessage(data: string, lastEventId?: string) {
    this.onmessage?.({ data, lastEventId });
  }

  emitError() {
    this.onerror?.(new Event("error"));
  }

  close() {
    this.closed = true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("openChatStream", () => {
  it("reconnects with capped retries when stream errors", async () => {
    const sources: FakeEventSource[] = [];
    const stop = openChatStream(() => {}, {
      baseDelayMs: 5,
      maxDelayMs: 20,
      jitterRatio: 0,
      maxRetries: 2,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source as unknown as EventSource;
      },
    });

    expect(sources.length).toBe(1);
    expect(sources[0]?.url).toBe("/api/chat/stream");

    sources[0]?.emitError();
    await sleep(8);
    expect(sources.length).toBe(2);

    sources[1]?.emitError();
    await sleep(12);
    expect(sources.length).toBe(3);

    sources[2]?.emitError();
    await sleep(25);
    expect(sources.length).toBe(3);

    stop();
  });

  it("adds lastEventId cursor on reconnect for resumable SSE", async () => {
    const sources: FakeEventSource[] = [];

    const stop = openChatStream(() => {}, {
      baseDelayMs: 5,
      maxDelayMs: 5,
      jitterRatio: 0,
      maxRetries: 1,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source as unknown as EventSource;
      },
    });

    expect(sources[0]?.url).toBe("/api/chat/stream");

    sources[0]?.emitMessage(JSON.stringify({ type: "message" }), "msg-42");
    sources[0]?.emitError();

    await sleep(8);
    expect(sources[1]?.url).toBe("/api/chat/stream?lastEventId=msg-42");

    stop();
  });

  it("notifies connection state changes and terminal failure", async () => {
    const states: Array<"connecting" | "connected" | "reconnecting" | "failed" | "closed"> = [];
    const sources: FakeEventSource[] = [];

    const stop = openChatStream(() => {}, {
      baseDelayMs: 5,
      maxDelayMs: 5,
      jitterRatio: 0,
      maxRetries: 1,
      onConnectionStateChange: (state) => {
        states.push(state);
      },
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source as unknown as EventSource;
      },
    });

    expect(states).toEqual(["connecting"]);

    sources[0]?.emitOpen();
    expect(states).toEqual(["connecting", "connected"]);

    sources[0]?.emitError();
    expect(states).toEqual(["connecting", "connected", "reconnecting"]);

    await sleep(8);
    expect(states).toEqual(["connecting", "connected", "reconnecting", "connecting"]);

    sources[1]?.emitError();
    expect(states).toEqual(["connecting", "connected", "reconnecting", "connecting", "failed"]);

    stop();
    expect(states).toEqual(["connecting", "connected", "reconnecting", "connecting", "failed", "closed"]);
  });

  it("cleans up source and pending reconnect timer on stop", async () => {
    const sources: FakeEventSource[] = [];
    const stop = openChatStream(() => {}, {
      baseDelayMs: 20,
      maxDelayMs: 20,
      jitterRatio: 0,
      maxRetries: 3,
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source as unknown as EventSource;
      },
    });

    expect(sources.length).toBe(1);

    sources[0]?.emitError();
    stop();

    await sleep(30);
    expect(sources.length).toBe(1);
    expect(sources[0]?.closed).toBe(true);
  });

  it("forwards valid payload and ignores malformed payload", () => {
    const events: ChatStreamEvent[] = [];
    const sources: FakeEventSource[] = [];

    const stop = openChatStream((event) => {
      events.push(event);
    }, {
      eventSourceFactory: (url) => {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source as unknown as EventSource;
      },
    });

    sources[0]?.emitMessage("{not-json");
    sources[0]?.emitMessage(JSON.stringify({ type: "message" }));

    expect(events).toEqual([{ type: "message" }]);

    stop();
  });
});

describe("mergeChatMessages", () => {
  it("idempotently merges duplicate messages by id", () => {
    const a = { id: "1", role: "user", text: "hello", createdAt: "2026-02-13T00:00:00.000Z" } as const;
    const b = { id: "2", role: "assistant", text: "world", createdAt: "2026-02-13T00:00:01.000Z" } as const;

    const merged = mergeChatMessages([a, b], [b]);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.id)).toEqual(["1", "2"]);
  });
});
