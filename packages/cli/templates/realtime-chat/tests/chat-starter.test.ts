import { beforeEach, describe, expect, it } from "bun:test";
import { GET as getMessages, POST as postMessage } from "../app/api/chat/messages/route";
import { GET as getStream } from "../app/api/chat/stream/route";
import {
  __resetChatStoreForTests,
  appendMessage,
  getMessages as getStoreMessages,
  MAX_HISTORY_MESSAGES,
} from "../src/server/application/chat-store";
import { getAIAdapter, setAIAdapter } from "../src/server/application/ai-adapter";
import { createTestRequest, parseJsonResponse } from "./helpers";

describe("realtime chat starter template", () => {
  const originalAdapter = getAIAdapter();

  beforeEach(() => {
    __resetChatStoreForTests();
    setAIAdapter(originalAdapter);
  });

  it("returns empty history by default", async () => {
    const response = getMessages();
    expect(response.status).toBe(200);

    const json = await parseJsonResponse<{ messages: unknown[] }>(response);
    expect(Array.isArray(json.messages)).toBe(true);
    expect(json.messages.length).toBe(0);
  });

  it("rejects invalid message payload", async () => {
    const request = createTestRequest("http://localhost:3000/api/chat/messages", {
      method: "POST",
      body: { text: "   " },
    });

    const response = await postMessage(request);
    expect(response.status).toBe(400);
  });

  it("rejects malformed json payload", async () => {
    const request = new Request("http://localhost:3000/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-valid-json",
    });

    const response = await postMessage(request);
    expect(response.status).toBe(400);
  });

  it("accepts valid payload and appends assistant reply", async () => {
    const request = createTestRequest("http://localhost:3000/api/chat/messages", {
      method: "POST",
      body: { text: "hello" },
    });

    const response = await postMessage(request);
    expect(response.status).toBe(201);

    const history = getMessages();
    const json = await parseJsonResponse<{ messages: Array<{ role: string }> }>(history);

    expect(json.messages.length).toBe(2);
    expect(json.messages.at(-1)?.role).toBe("assistant");
  });

  it("keeps user message when adapter completion fails", async () => {
    setAIAdapter({
      async complete() {
        throw new Error("adapter-failure");
      },
    });

    const request = createTestRequest("http://localhost:3000/api/chat/messages", {
      method: "POST",
      body: { text: "hello" },
    });

    const response = await postMessage(request);
    expect(response.status).toBe(201);

    const messages = getStoreMessages();
    expect(messages.length).toBe(1);
    expect(messages[0]?.role).toBe("user");
  });

  it("caps in-memory history size", () => {
    for (let i = 0; i < MAX_HISTORY_MESSAGES + 25; i++) {
      appendMessage("user", `msg-${i}`);
    }

    const messages = getStoreMessages();
    expect(messages.length).toBe(MAX_HISTORY_MESSAGES);
    expect(messages[0]?.text).toBe("msg-25");
  });

  it("exposes SSE stream endpoint", () => {
    const request = createTestRequest("http://localhost:3000/api/chat/stream");
    const response = getStream(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  });

  it("SSE stream emits snapshot and live message events", async () => {
    const abortController = new AbortController();
    const request = new Request("http://localhost:3000/api/chat/stream", {
      signal: abortController.signal,
    });

    const response = getStream(request);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();

    const firstChunk = await reader!.read();
    expect(firstChunk.done).toBe(false);
    const firstText = decoder.decode(firstChunk.value);
    expect(firstText).toContain('"type":"snapshot"');

    appendMessage("user", "live-event");

    const secondChunk = await reader!.read();
    expect(secondChunk.done).toBe(false);
    const secondText = decoder.decode(secondChunk.value);
    expect(secondText).toContain('"type":"message"');
    expect(secondText).toContain('"text":"live-event"');

    abortController.abort();
  });
});
