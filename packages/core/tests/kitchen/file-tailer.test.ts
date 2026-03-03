import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { FileTailer } from "../../src/kitchen/stream/file-tailer";
import fs from "fs";
import path from "path";
import os from "os";

describe("FileTailer", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kitchen-test-"));
    logPath = path.join(tmpDir, "activity.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should emit lines from new content appended to file", async () => {
    // Create file first
    fs.writeFileSync(logPath, "");

    const tailer = new FileTailer(logPath, {
      startAtEnd: true,
      pollIntervalMs: 50,
    });

    const lines: string[] = [];
    tailer.on("line", (line: string) => lines.push(line));
    tailer.start();

    // Wait for watcher to settle
    await Bun.sleep(100);

    // Append lines
    fs.appendFileSync(logPath, '{"type":"test","value":1}\n');
    fs.appendFileSync(logPath, '{"type":"test","value":2}\n');

    // Wait for polling to pick up
    await Bun.sleep(200);

    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0])).toEqual({ type: "test", value: 1 });
    expect(JSON.parse(lines[1])).toEqual({ type: "test", value: 2 });

    tailer.stop();
  });

  it("should handle file truncation (MCP restart)", async () => {
    fs.writeFileSync(logPath, "");

    const tailer = new FileTailer(logPath, {
      startAtEnd: true,
      pollIntervalMs: 50,
    });

    const lines: string[] = [];
    tailer.on("line", (line: string) => lines.push(line));
    tailer.start();

    await Bun.sleep(100);

    // Append initial data (longer, so truncation is detectable)
    fs.appendFileSync(logPath, '{"old":"data","extra":"padding_value"}\n');
    await Bun.sleep(200);
    expect(lines.length).toBe(1);

    // Truncate and write shorter data (simulates MCP restart)
    fs.writeFileSync(logPath, '{"new":"data"}\n');

    await Bun.sleep(200);

    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[1])).toEqual({ new: "data" });

    tailer.stop();
  });

  it("should start from 0 if file doesn't exist", async () => {
    const tailer = new FileTailer(logPath, {
      startAtEnd: true,
      pollIntervalMs: 50,
    });

    const lines: string[] = [];
    tailer.on("line", (line: string) => lines.push(line));
    tailer.start();

    await Bun.sleep(100);

    // Now create the file
    fs.writeFileSync(logPath, '{"created":"after"}\n');

    await Bun.sleep(200);

    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0])).toEqual({ created: "after" });

    tailer.stop();
  });

  it("should skip empty lines", async () => {
    fs.writeFileSync(logPath, "");

    const tailer = new FileTailer(logPath, {
      startAtEnd: true,
      pollIntervalMs: 50,
    });

    const lines: string[] = [];
    tailer.on("line", (line: string) => lines.push(line));
    tailer.start();

    await Bun.sleep(100);

    fs.appendFileSync(logPath, '\n\n{"data":1}\n\n');

    await Bun.sleep(200);

    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0])).toEqual({ data: 1 });

    tailer.stop();
  });

  it("should not start twice", () => {
    fs.writeFileSync(logPath, "");

    const tailer = new FileTailer(logPath, {
      startAtEnd: true,
      pollIntervalMs: 50,
    });

    tailer.start();
    tailer.start(); // Should not throw

    tailer.stop();
  });
});
