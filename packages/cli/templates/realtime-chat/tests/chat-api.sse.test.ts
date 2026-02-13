import { describe, expect, it } from "bun:test";
import { openChatStream } from "../src/client/features/chat/chat-api";

type MessageEventLike = { data: string };

class FakeEventSource {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEventLike) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  emitOpen() {
    this.onopen?.(new Event("open"));
  }

  emitMessage(data: string) {
    this.onmessage?.({ data });
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
    const events: Array<{ type: string }> = [];
    const sources: FakeEventSource[] = [];

    const stop = openChatStream((event) => {
      events.push(event as { type: string });
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
