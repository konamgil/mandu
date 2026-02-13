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
  it("sends SSE event payload with metadata", async () => {
    const sse = createSSEConnection();

    sse.send({ ok: true }, { event: "ready", id: "1", retry: 3000 });
    const chunk = await readChunk(sse.response);

    expect(chunk).toContain("event: ready");
    expect(chunk).toContain("id: 1");
    expect(chunk).toContain("retry: 3000");
    expect(chunk).toContain('data: {"ok":true}');
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
