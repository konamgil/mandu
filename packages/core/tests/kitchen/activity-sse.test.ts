import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ActivitySSEBroadcaster } from "../../src/kitchen/stream/activity-sse";
import fs from "fs";
import path from "path";
import os from "os";

describe("ActivitySSEBroadcaster", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kitchen-sse-"));
    fs.mkdirSync(path.join(tmpDir, ".mandu"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should create SSE response with correct headers", () => {
    const broadcaster = new ActivitySSEBroadcaster(tmpDir);
    broadcaster.start();

    const response = broadcaster.createResponse();

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
    expect(response.headers.get("X-Kitchen-Version")).toBe("1");

    broadcaster.stop();
  });

  it("should track connected clients", () => {
    const broadcaster = new ActivitySSEBroadcaster(tmpDir);
    broadcaster.start();

    expect(broadcaster.clientCount).toBe(0);

    broadcaster.createResponse();
    expect(broadcaster.clientCount).toBe(1);

    broadcaster.createResponse();
    expect(broadcaster.clientCount).toBe(2);

    broadcaster.stop();
    expect(broadcaster.clientCount).toBe(0);
  });

  it("should broadcast messages to clients", async () => {
    const broadcaster = new ActivitySSEBroadcaster(tmpDir);
    broadcaster.start();

    const response = broadcaster.createResponse();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Read the welcome message
    const { value: welcomeChunk } = await reader.read();
    const welcomeText = decoder.decode(welcomeChunk);
    expect(welcomeText).toContain('"type":"connected"');

    // Broadcast a message
    broadcaster.broadcast('{"type":"test","data":"hello"}');

    const { value: dataChunk } = await reader.read();
    const dataText = decoder.decode(dataChunk);
    expect(dataText).toContain('"type":"test"');
    expect(dataText).toContain('"data":"hello"');

    reader.cancel();
    broadcaster.stop();
  });

  it("should not start twice", () => {
    const broadcaster = new ActivitySSEBroadcaster(tmpDir);
    broadcaster.start();
    broadcaster.start(); // Should not throw
    broadcaster.stop();
  });
});
