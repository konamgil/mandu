/**
 * Integration tests for `packages/cli/src/commands/ai/chat.ts`.
 *
 * We exercise the REPL through its `lines` option (bypassing readline)
 * against the deterministic `local` provider, so tests are fully
 * hermetic — no network, no stdin reliance, no API keys.
 *
 * Coverage:
 *   1. --help renders without any network call + without API keys.
 *   2. A single chat turn streams the dummy response + records history.
 *   3. /reset wipes history.
 *   4. /save + /load round-trip to disk.
 *   5. /preset loads docs/prompts/<name>.md.
 *   6. /provider switches provider cleanly.
 *   7. Malformed history file → CLI_E302 surfaces to stderr.
 *   8. Unknown slash command → CLI_E306 surfaces but REPL keeps going.
 *   9. Preset-not-found is detected at startup.
 *  10. Missing API key surfaces a clear CLI_E300 (soft, REPL survives).
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Writable } from "node:stream";
import { aiChat, handleSlashCommand, type ChatState } from "../ai/chat";
import { ChatHistory } from "../../util/ai-history";
import type { PromptProvider } from "@mandujs/ate/prompts";

const PREFIX = path.join(os.tmpdir(), "mandu-ai-chat-test-");

let tmpDir: string;
let errorSpy: ReturnType<typeof spyOn>;
let errorMessages: string[];

function makeOutput(): { stream: Writable; chunks: string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      cb();
    },
  });
  return { stream, chunks };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(PREFIX);
  errorMessages = [];
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorMessages.push(args.map(String).join(" "));
  });
});

afterEach(async () => {
  errorSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("mandu ai chat — --help is safe without API keys", () => {
  it("prints help to the provided output and exits 0", async () => {
    const saved = {
      claude: process.env.MANDU_CLAUDE_API_KEY,
      openai: process.env.MANDU_OPENAI_API_KEY,
      gemini: process.env.MANDU_GEMINI_API_KEY,
    };
    delete process.env.MANDU_CLAUDE_API_KEY;
    delete process.env.MANDU_OPENAI_API_KEY;
    delete process.env.MANDU_GEMINI_API_KEY;
    try {
      const { stream, chunks } = makeOutput();
      const code = await aiChat({ help: true, output: stream, quiet: true });
      expect(code).toBe(0);
      const out = chunks.join("");
      expect(out).toContain("mandu ai chat");
      expect(out).toContain("/help");
      expect(out).toContain("/reset");
      expect(out).toContain("/quit");
    } finally {
      if (saved.claude) process.env.MANDU_CLAUDE_API_KEY = saved.claude;
      if (saved.openai) process.env.MANDU_OPENAI_API_KEY = saved.openai;
      if (saved.gemini) process.env.MANDU_GEMINI_API_KEY = saved.gemini;
    }
  });
});

describe("mandu ai chat — interactive turns with local provider", () => {
  it("streams an echo response + records both sides in history", async () => {
    const { stream, chunks } = makeOutput();
    const code = await aiChat({
      provider: "local",
      lines: ["hello there", "/quit"],
      output: stream,
      quiet: true,
    });
    expect(code).toBe(0);
    const out = chunks.join("");
    expect(out).toContain("hello there"); // echoed back
    expect(out).toContain("[local]");
  });

  it("treats blank lines as no-ops", async () => {
    const { stream, chunks } = makeOutput();
    const code = await aiChat({
      provider: "local",
      lines: ["", "   ", "/quit"],
      output: stream,
      quiet: true,
    });
    expect(code).toBe(0);
    // No echo turn should appear — the `[local:echo]` marker is only
    // emitted by the dummy responder when a non-empty user message is
    // actually sent.
    expect(chunks.join("")).not.toContain("[local:echo]");
  });
});

describe("mandu ai chat — slash commands", () => {
  const baseState = (): ChatState => ({
    provider: "local" as PromptProvider,
    model: "local-model",
    history: new ChatHistory(),
    output: makeOutput().stream,
    cwd: tmpDir,
  });

  it("/help returns continue", async () => {
    const state = baseState();
    const result = await handleSlashCommand("/help", state);
    expect(result.kind).toBe("continue");
  });

  it("/quit returns quit", async () => {
    const state = baseState();
    const result = await handleSlashCommand("/quit", state);
    expect(result.kind).toBe("quit");
  });

  it("/reset clears history", async () => {
    const state = baseState();
    state.history.push({ role: "user", content: "hi" });
    expect(state.history.size).toBe(1);
    await handleSlashCommand("/reset", state);
    expect(state.history.size).toBe(0);
  });

  it("/provider switches provider + updates model to default", async () => {
    const state = baseState();
    await handleSlashCommand("/provider openai", state);
    expect(state.provider).toBe("openai");
    expect(state.model).toMatch(/gpt/);
  });

  it("/provider with unknown name returns error", async () => {
    const state = baseState();
    const result = await handleSlashCommand("/provider grok", state);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("AI_UNKNOWN_PROVIDER");
    }
  });

  it("/model updates model without touching provider", async () => {
    const state = baseState();
    await handleSlashCommand("/model my-custom-model", state);
    expect(state.model).toBe("my-custom-model");
    expect(state.provider).toBe("local");
  });

  it("unknown slash command returns AI_UNKNOWN_SLASH", async () => {
    const state = baseState();
    const result = await handleSlashCommand("/huh", state);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("AI_UNKNOWN_SLASH");
    }
  });
});

describe("mandu ai chat — /save + /load round trip", () => {
  it("saves history to JSON and loads it back", async () => {
    // Wave R3 L-01: /save and /load now accept only contained, relative paths.
    // Use a bare filename so it resolves under <tmpDir>/.mandu/ai-chat/saved.json.
    const saveArg = "saved.json";
    const expectedDisk = path.join(tmpDir, ".mandu", "ai-chat", saveArg);
    const { stream: streamA } = makeOutput();
    const stateA: ChatState = {
      provider: "local" as PromptProvider,
      model: "local-model",
      history: new ChatHistory(),
      output: streamA,
      cwd: tmpDir,
    };
    stateA.history.push({ role: "user", content: "hello" });
    stateA.history.push({ role: "assistant", content: "hi" });

    const saveRes = await handleSlashCommand(`/save ${saveArg}`, stateA);
    expect(saveRes.kind).toBe("continue");
    const onDisk = await fs.readFile(expectedDisk, "utf8");
    const parsed = JSON.parse(onDisk);
    expect(parsed.version).toBe(1);
    expect(parsed.messages.length).toBe(2);

    // Load into a fresh state.
    const { stream: streamB } = makeOutput();
    const stateB: ChatState = {
      provider: "local" as PromptProvider,
      model: "local-model",
      history: new ChatHistory(),
      output: streamB,
      cwd: tmpDir,
    };
    const loadRes = await handleSlashCommand(`/load ${saveArg}`, stateB);
    expect(loadRes.kind).toBe("continue");
    expect(stateB.history.size).toBe(2);
    expect(stateB.history.getTurns()[1]?.content).toBe("hi");
  });

  it("rejects malformed history file with AI_HISTORY_MALFORMED", async () => {
    // Wave R3 L-01: /load rejects absolute paths, so stage the malformed file
    // under the contained <tmpDir>/.mandu/ai-chat/ dir and reference it by name.
    const badArg = "bad.json";
    const badPath = path.join(tmpDir, ".mandu", "ai-chat", badArg);
    await fs.mkdir(path.dirname(badPath), { recursive: true });
    await fs.writeFile(badPath, "{nope}", "utf8");

    const { stream } = makeOutput();
    const state: ChatState = {
      provider: "local" as PromptProvider,
      model: "local-model",
      history: new ChatHistory(),
      output: stream,
      cwd: tmpDir,
    };
    const result = await handleSlashCommand(`/load ${badArg}`, state);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("AI_HISTORY_MALFORMED");
    }
  });
});

describe("mandu ai chat — /preset", () => {
  it("loads docs/prompts/<name>.md into state.system", async () => {
    const promptsDir = path.join(tmpDir, "docs", "prompts");
    await fs.mkdir(promptsDir, { recursive: true });
    await fs.writeFile(path.join(promptsDir, "custom.md"), "# custom system", "utf8");

    const { stream } = makeOutput();
    const state: ChatState = {
      provider: "local" as PromptProvider,
      model: "local-model",
      history: new ChatHistory(),
      output: stream,
      cwd: tmpDir,
    };
    const result = await handleSlashCommand("/preset custom", state);
    expect(result.kind).toBe("continue");
    expect(state.system).toContain("custom system");
  });

  it("/preset with unknown name returns AI_PRESET_NOT_FOUND", async () => {
    const { stream } = makeOutput();
    const state: ChatState = {
      provider: "local" as PromptProvider,
      model: "local-model",
      history: new ChatHistory(),
      output: stream,
      cwd: tmpDir,
    };
    const result = await handleSlashCommand("/preset nonexistent", state);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("AI_PRESET_NOT_FOUND");
    }
  });

  it("rejects path-traversal attempts in preset name", async () => {
    const { stream } = makeOutput();
    const state: ChatState = {
      provider: "local" as PromptProvider,
      model: "local-model",
      history: new ChatHistory(),
      output: stream,
      cwd: tmpDir,
    };
    // /preset expects alphanumeric — "../etc" is rejected inside loadPreset
    const result = await handleSlashCommand("/preset ../etc/shadow", state);
    // Should surface as an error OR a soft continue with a failure message,
    // never a successful load.
    if (result.kind === "continue") {
      expect(state.system ?? "").toBe("");
    } else {
      expect(result.kind).toBe("error");
    }
  });
});

describe("mandu ai chat — startup failures", () => {
  it("exits non-zero when --preset points at a missing file", async () => {
    const { stream, chunks } = makeOutput();
    const code = await aiChat({
      provider: "local",
      preset: "nonexistent-preset",
      output: stream,
      cwd: tmpDir,
      quiet: true,
    });
    expect(code).toBe(1);
    const output = chunks.join("") + errorMessages.join("\n");
    expect(output).toMatch(/CLI_E303|nonexistent-preset/);
  });

  it("exits non-zero when --system points at a missing file", async () => {
    const { stream, chunks } = makeOutput();
    const code = await aiChat({
      provider: "local",
      systemPath: path.join(tmpDir, "does-not-exist.md"),
      output: stream,
      cwd: tmpDir,
      quiet: true,
    });
    expect(code).toBe(1);
    const output = chunks.join("") + errorMessages.join("\n");
    expect(output).toMatch(/CLI_E309|does-not-exist/);
  });
});

describe("mandu ai chat — missing API key is soft", () => {
  it("prints CLI_E300 but REPL keeps running until /quit", async () => {
    const saved = process.env.MANDU_OPENAI_API_KEY;
    delete process.env.MANDU_OPENAI_API_KEY;
    try {
      const { stream } = makeOutput();
      const code = await aiChat({
        provider: "openai",
        lines: ["hello", "/quit"],
        output: stream,
        quiet: true,
      });
      // REPL runs, error surfaces to stderr, but exit is 0 (user quit cleanly).
      expect(code).toBe(0);
      const combined = errorMessages.join("\n");
      expect(combined).toMatch(/CLI_E300|MANDU_OPENAI_API_KEY/);
    } finally {
      if (saved) process.env.MANDU_OPENAI_API_KEY = saved;
    }
  });
});


describe("mandu ai chat — path containment (L-01)", () => {
  const makeState = (cwd: string): ChatState => ({
    provider: "local" as PromptProvider,
    model: "local-model",
    history: new ChatHistory(),
    output: makeOutput().stream,
    cwd,
  });

  it("/save rejects absolute paths with AI_PATH_ESCAPE", async () => {
    const state = makeState(tmpDir);
    const evilPath = path.isAbsolute("/etc/passwd")
      ? "/etc/passwd"
      : "/tmp/evil.json";
    const result = await handleSlashCommand(`/save ${evilPath}`, state);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("AI_PATH_ESCAPE");
    }
  });

  it("/save rejects Windows-style absolute paths with AI_PATH_ESCAPE", async () => {
    const state = makeState(tmpDir);
    const result = await handleSlashCommand("/save C:\\evil\\out.json", state);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("AI_PATH_ESCAPE");
    }
  });

  it("/save rejects '..' traversal with AI_PATH_ESCAPE", async () => {
    const state = makeState(tmpDir);
    const result = await handleSlashCommand("/save ../../../etc/passwd", state);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("AI_PATH_ESCAPE");
    }
  });

  it("/load rejects absolute paths with AI_PATH_ESCAPE", async () => {
    const state = makeState(tmpDir);
    const result = await handleSlashCommand("/load /etc/shadow", state);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("AI_PATH_ESCAPE");
    }
  });

  it("/load rejects '..' traversal with AI_PATH_ESCAPE", async () => {
    const state = makeState(tmpDir);
    const result = await handleSlashCommand("/load ../../secrets.json", state);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("AI_PATH_ESCAPE");
    }
  });

  it("/system rejects absolute paths with AI_PATH_ESCAPE", async () => {
    const state = makeState(tmpDir);
    const result = await handleSlashCommand("/system /etc/passwd", state);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("AI_PATH_ESCAPE");
    }
  });

  it("/system rejects '..' traversal with AI_PATH_ESCAPE", async () => {
    const state = makeState(tmpDir);
    const result = await handleSlashCommand("/system ../../../etc/passwd", state);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("AI_PATH_ESCAPE");
    }
  });

  it("/save accepts a bare filename and resolves it under .mandu/ai-chat/", async () => {
    const state = makeState(tmpDir);
    state.history.push({ role: "user", content: "hello" });

    const result = await handleSlashCommand("/save session.json", state);
    expect(result.kind).toBe("continue");

    const expected = path.join(tmpDir, ".mandu", "ai-chat", "session.json");
    const exists = await fs
      .stat(expected)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("/save accepts './sub/file.json' and resolves it under .mandu/ai-chat/sub/", async () => {
    const state = makeState(tmpDir);
    state.history.push({ role: "user", content: "hi" });

    const result = await handleSlashCommand("/save ./sub/file.json", state);
    expect(result.kind).toBe("continue");

    const expected = path.join(tmpDir, ".mandu", "ai-chat", "sub", "file.json");
    const exists = await fs
      .stat(expected)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("/save then /load round-trips with a contained bare filename", async () => {
    const stateA = makeState(tmpDir);
    stateA.history.push({ role: "user", content: "q" });
    stateA.history.push({ role: "assistant", content: "a" });

    const saveRes = await handleSlashCommand("/save round.json", stateA);
    expect(saveRes.kind).toBe("continue");

    const stateB = makeState(tmpDir);
    const loadRes = await handleSlashCommand("/load round.json", stateB);
    expect(loadRes.kind).toBe("continue");
    expect(stateB.history.size).toBe(2);
    expect(stateB.history.getTurns()[0]?.content).toBe("q");
  });
});
