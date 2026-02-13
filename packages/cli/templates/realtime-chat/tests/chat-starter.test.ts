import { describe, expect, it } from "bun:test";
import { GET as getMessages, POST as postMessage } from "../app/api/chat/messages/route";
import { GET as getStream } from "../app/api/chat/stream/route";
import { createTestRequest, parseJsonResponse } from "./helpers";

describe("realtime chat starter template", () => {
  it("returns empty history by default", async () => {
    const response = getMessages();
    expect(response.status).toBe(200);

    const json = await parseJsonResponse<{ messages: unknown[] }>(response);
    expect(Array.isArray(json.messages)).toBe(true);
  });

  it("rejects invalid message payload", async () => {
    const request = createTestRequest("http://localhost:3000/api/chat/messages", {
      method: "POST",
      body: { text: "   " },
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

    expect(json.messages.length).toBeGreaterThanOrEqual(2);
    expect(json.messages.at(-1)?.role).toBe("assistant");
  });

  it("exposes SSE stream endpoint", () => {
    const response = getStream();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  });
});
