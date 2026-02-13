import { describe, it, expect, mock } from "bun:test";
import { createSSEConnection } from "./sse";
import { ManduContext } from "./context";

async function readChunk(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing response body");

  const { value, done } = await reader.read();
  if (done || !value) return "";
  return new TextDecoder().decode(value);
}

describe("SSEConnection", () => {
  it("streams real-time chunks and finishes with done=true after close", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const ctx = new ManduContext(req);
        return ctx.sse(async (sse) => {
          sse.event("tick", { step: 1 }, { id: "1" });
          await new Promise((resolve) => setTimeout(resolve, 20));
          sse.event("tick", { step: 2 }, { id: "2" });
          await sse.close();
        });
      },
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/stream`);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing response body");

      const firstRead = await reader.read();
      expect(firstRead.done).toBe(false);
      const firstChunk = new TextDecoder().decode(firstRead.value);
      expect(firstChunk).toContain("event: tick");
      expect(firstChunk).toContain('data: {"step":1}');

      const secondRead = await reader.read();
      expect(secondRead.done).toBe(false);
      const secondChunk = new TextDecoder().decode(secondRead.value);
      expect(secondChunk).toContain('data: {"step":2}');

      const finalRead = await reader.read();
      expect(finalRead.done).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  it("closes stream when context-level SSE setup throws (error path)", async () => {
    const ctx = new ManduContext(new Request("http://localhost/realtime-error"));

    const response = ctx.sse(async () => {
      throw new Error("setup failed");
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response body");

    // setup error is swallowed intentionally, but stream must close cleanly.
    await Promise.resolve();
    const read = await reader.read();
    expect(read.done).toBe(true);
  });
  it("sends SSE event payload with metadata", async () => {
    const sse = createSSEConnection();

    sse.send({ ok: true }, { event: "ready", id: "1", retry: 3000 });
    const chunk = await readChunk(sse.response);

    expect(chunk).toContain("event: ready");
    expect(chunk).toContain("id: 1");
    expect(chunk).toContain("retry: 3000");
    expect(chunk).toContain('data: {"ok":true}');
  });

  it("sanitizes event/id fields to prevent SSE injection", async () => {
    const sse = createSSEConnection();

    sse.send("payload", {
      event: "update\nretry:0",
      id: "abc\r\ndata: injected",
    });

    const chunk = await readChunk(sse.response);
    expect(chunk).toContain("event: update retry:0");
    expect(chunk).toContain("id: abc data: injected");
    expect(chunk).not.toContain("\nevent: update\nretry:0\n");
  });

  it("normalizes payload lines across CR/LF variants", async () => {
    const sse = createSSEConnection();

    sse.send("a\rb\nc\r\nd");
    const chunk = await readChunk(sse.response);

    expect(chunk).toContain("data: a");
    expect(chunk).toContain("data: b");
    expect(chunk).toContain("data: c");
    expect(chunk).toContain("data: d");
  });

  it("registers heartbeat and cleanup on close", async () => {
    const sse = createSSEConnection();
    const cleanup = mock(() => {});

    const stop = sse.heartbeat(1000, "ping");
    sse.onClose(cleanup);

    await sse.close();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(typeof stop).toBe("function");
  });

  it("continues closing when cleanup handlers throw", async () => {
    const sse = createSSEConnection();
    const badCleanup = mock(() => {
      throw new Error("cleanup failed");
    });
    const goodCleanup = mock(() => {});

    sse.onClose(badCleanup);
    sse.onClose(goodCleanup);

    await expect(sse.close()).resolves.toBeUndefined();
    expect(badCleanup).toHaveBeenCalledTimes(1);
    expect(goodCleanup).toHaveBeenCalledTimes(1);
  });

  it("does not throw when registering onClose after already closed", async () => {
    const sse = createSSEConnection();
    await sse.close();

    const badCleanup = () => Promise.reject(new Error("late cleanup failed"));
    expect(() => sse.onClose(badCleanup)).not.toThrow();
  });

  it("closes automatically when request signal aborts", async () => {
    const controller = new AbortController();
    const sse = createSSEConnection(controller.signal);
    const cleanup = mock(() => {});

    sse.onClose(cleanup);
    controller.abort();

    await Promise.resolve();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("supports context-level SSE response helper", async () => {
    const ctx = new ManduContext(new Request("http://localhost/realtime"));

    const response = ctx.sse((sse) => {
      sse.event("message", "hello");
    });

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const chunk = await readChunk(response);
    expect(chunk).toContain("event: message");
    expect(chunk).toContain("data: hello");
  });
});
