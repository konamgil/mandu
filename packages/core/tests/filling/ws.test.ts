/**
 * WebSocket Handler Tests
 */
import { describe, it, expect } from "bun:test";
import { wrapBunWebSocket, type WSUpgradeData } from "../../src/filling/ws";
import { ManduFilling } from "../../src/filling/filling";

describe("wrapBunWebSocket", () => {
  function createMockBunWs() {
    const sent: unknown[] = [];
    const subscribed: string[] = [];
    const unsubscribed: string[] = [];
    const published: { topic: string; data: unknown }[] = [];
    let closed = false;

    const ws = {
      data: { routeId: "chat", params: {}, id: "ws-123" } as WSUpgradeData,
      send: (data: unknown) => sent.push(data),
      subscribe: (topic: string) => subscribed.push(topic),
      unsubscribe: (topic: string) => unsubscribed.push(topic),
      publish: (topic: string, data: unknown) => published.push({ topic, data }),
      close: () => { closed = true; },
    };

    return { ws, sent, subscribed, unsubscribed, published, isClosed: () => closed };
  }

  it("exposes id from WSUpgradeData", () => {
    const { ws } = createMockBunWs();
    const wrapped = wrapBunWebSocket(ws);
    expect(wrapped.id).toBe("ws-123");
  });

  it("delegates send to underlying ws", () => {
    const { ws, sent } = createMockBunWs();
    const wrapped = wrapBunWebSocket(ws);
    wrapped.send("hello");
    expect(sent).toEqual(["hello"]);
  });

  it("delegates subscribe/unsubscribe", () => {
    const { ws, subscribed, unsubscribed } = createMockBunWs();
    const wrapped = wrapBunWebSocket(ws);
    wrapped.subscribe("chat");
    wrapped.unsubscribe("chat");
    expect(subscribed).toEqual(["chat"]);
    expect(unsubscribed).toEqual(["chat"]);
  });

  it("delegates publish", () => {
    const { ws, published } = createMockBunWs();
    const wrapped = wrapBunWebSocket(ws);
    wrapped.publish("room", "msg");
    expect(published).toEqual([{ topic: "room", data: "msg" }]);
  });

  it("sendJSON serializes to JSON string", () => {
    const { ws, sent } = createMockBunWs();
    const wrapped = wrapBunWebSocket(ws);
    wrapped.sendJSON({ type: "greeting", text: "hi" });
    expect(sent[0]).toBe('{"type":"greeting","text":"hi"}');
  });

  it("close delegates to underlying ws", () => {
    const { ws, isClosed } = createMockBunWs();
    const wrapped = wrapBunWebSocket(ws);
    wrapped.close();
    expect(isClosed()).toBe(true);
  });
});

describe("ManduFilling.ws()", () => {
  it("registers WS handlers", () => {
    const filling = new ManduFilling()
      .ws({
        open: () => {},
        message: () => {},
      });

    expect(filling.hasWS()).toBe(true);
    expect(filling.getWSHandlers()?.open).toBeDefined();
    expect(filling.getWSHandlers()?.message).toBeDefined();
  });

  it("hasWS returns false when no handlers", () => {
    const filling = new ManduFilling();
    expect(filling.hasWS()).toBe(false);
  });
});
