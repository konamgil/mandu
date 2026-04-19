/**
 * `mandu ai chat` — interactive streaming chat playground.
 *
 * Phase 14.2 — Agent F. Responsibilities:
 *
 *   - Read lines from stdin (readline) and stream adapter output to stdout.
 *   - Maintain an in-memory {@link ChatHistory} bounded at 100 turns.
 *   - Dispatch slash commands (/reset, /save, /load, /preset, /provider,
 *     /model, /help, /quit).
 *   - Install SIGINT once per stream so Ctrl+C aborts cleanly without
 *     killing the whole REPL.
 *   - Render `--help` without any network traffic so the flag is safe
 *     even without API keys.
 *
 * Exit codes:
 *   0 — graceful quit or non-TTY dry-run succeeded
 *   1 — terminal error surfaced to stderr
 *   2 — bad usage (unknown flag combo)
 */

import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import type { CommandContext } from "../registry";
import type { PromptProvider } from "@mandujs/ate/prompts";
import {
  ChatHistory,
  HistoryValidationError,
  PathEscapeError,
  createSnapshot,
  loadHistory,
  resolveAiChatPath,
  saveHistory,
} from "../../util/ai-history";
import {
  InvalidProviderError,
  MissingApiKeyError,
  PROVIDER_DEFAULT_MODEL,
  PROVIDER_ENV_VARS,
  StreamTimeoutError,
  resolveProvider,
  sanitizeUtf8Input,
  streamChat,
} from "../../util/ai-client";
import { CLI_ERROR_CODES, printCLIError } from "../../errors";

export const EXIT_OK = 0;
export const EXIT_ERR = 1;
export const EXIT_USAGE = 2;

export const PRESET_DIR_RELATIVE = "docs/prompts";

const CHAT_HELP = [
  "",
  "  mandu ai chat — interactive streaming chat",
  "",
  "  Flags:",
  "    --provider=<name>       claude|openai|gemini|local (default: local)",
  "    --model=<id>            Override provider default model",
  "    --system=<path>         Load a file as the system prompt",
  "    --preset=<name>         Load docs/prompts/<name>.md as system",
  "    --timeout=<ms>          Stream wall-clock budget (default: 60000)",
  "    --help                  Show this message (no network traffic)",
  "",
  "  Slash commands:",
  "    /help                   List slash commands",
  "    /reset                  Clear conversation history",
  "    /save <path>            Dump history to JSON",
  "    /load <path>            Restore history from JSON",
  "    /preset <name>          Load docs/prompts/<name>.md as system",
  "    /provider <name>        Switch provider (claude|openai|gemini|local)",
  "    /model <id>             Switch model",
  "    /system <path>          Load a file as the system prompt",
  "    /quit                   Exit",
  "",
  "  Press Ctrl+C mid-stream to abort the current response.",
  "  Press Ctrl+D (EOF) or type /quit to exit.",
  "",
].join("\n");

export interface ChatOptions {
  provider?: string;
  model?: string;
  systemPath?: string;
  preset?: string;
  timeoutMs?: number;
  /** For tests: override stdin/stdout. */
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** For tests: pre-seeded lines fed in-order, bypassing readline. */
  lines?: string[];
  /** For tests: override the working directory used to resolve presets. */
  cwd?: string;
  /** For tests: skip the welcome banner. */
  quiet?: boolean;
  /** Print the help text and return without entering the REPL. */
  help?: boolean;
}

/**
 * Internal chat REPL state. Exported so tests can hand a state object
 * directly to {@link handleSlashCommand}.
 */
export interface ChatState {
  provider: PromptProvider;
  model: string;
  system?: string;
  history: ChatHistory;
  timeoutMs?: number;
  cwd: string;
  output: NodeJS.WritableStream;
}

/**
 * Resolve a preset name into an absolute path + file contents. Returns
 * `{path, text}` or throws with a CLI-friendly message.
 */
export async function loadPreset(
  name: string,
  cwd: string = process.cwd(),
): Promise<{ path: string; text: string }> {
  const safeName = name.trim();
  if (!/^[a-zA-Z0-9_\-]+$/.test(safeName)) {
    throw new Error(`preset name must be alphanumeric (got "${safeName}")`);
  }
  const filePath = path.join(cwd, PRESET_DIR_RELATIVE, `${safeName}.md`);
  if (!existsSync(filePath)) {
    const err = new Error(`preset not found: ${safeName}`);
    (err as { code?: string }).code = "AI_PRESET_NOT_FOUND";
    throw err;
  }
  const text = await fs.readFile(filePath, "utf8");
  return { path: filePath, text };
}

/** Load an arbitrary file as a system prompt. */
export async function loadSystemFile(filePath: string): Promise<string> {
  if (!existsSync(filePath)) {
    const err = new Error(`system file not found: ${filePath}`);
    (err as { code?: string }).code = "AI_SYSTEM_FILE_NOT_FOUND";
    throw err;
  }
  return fs.readFile(filePath, "utf8");
}

function writeLine(output: NodeJS.WritableStream, line: string): void {
  output.write(line.endsWith("\n") ? line : line + "\n");
}

function formatPrompt(state: ChatState): string {
  return `\n[${state.provider}${state.model && state.model !== PROVIDER_DEFAULT_MODEL[state.provider] ? `:${state.model}` : ""}] you> `;
}

/**
 * Known result of handling one slash command. Returned so the REPL can
 * decide whether to continue, exit, or print an error.
 */
export type SlashResult =
  | { kind: "continue" }
  | { kind: "quit" }
  | { kind: "error"; code: keyof typeof CLI_ERROR_CODES; context?: Record<string, string | number> };

/**
 * Handle a single slash command (line starts with `/`). Exported for
 * unit tests — the REPL calls this before feeding lines to the adapter.
 */
export async function handleSlashCommand(
  line: string,
  state: ChatState,
): Promise<SlashResult> {
  const trimmed = line.trim();
  const [command, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(" ").trim();

  switch (command) {
    case "/help": {
      state.output.write(CHAT_HELP);
      return { kind: "continue" };
    }
    case "/quit":
    case "/exit":
    case "/bye": {
      return { kind: "quit" };
    }
    case "/reset": {
      state.history.clear();
      writeLine(state.output, "(history cleared)");
      return { kind: "continue" };
    }
    case "/save": {
      if (!arg) {
        writeLine(state.output, "usage: /save <path>");
        return { kind: "continue" };
      }
      let resolved: string;
      try {
        resolved = resolveAiChatPath(arg, state.cwd);
      } catch (err) {
        if (err instanceof PathEscapeError) {
          return { kind: "error", code: "AI_PATH_ESCAPE", context: { path: err.path } };
        }
        writeLine(state.output, `(/save failed: ${(err as Error).message})`);
        return { kind: "continue" };
      }
      const snapshot = createSnapshot(state.provider, state.history, {
        model: state.model,
        system: state.system,
      });
      try {
        await saveHistory(resolved, snapshot);
        writeLine(state.output, `(saved ${state.history.size} turns → ${resolved})`);
      } catch (err) {
        writeLine(state.output, `(/save failed: ${(err as Error).message})`);
      }
      return { kind: "continue" };
    }
    case "/load": {
      if (!arg) {
        writeLine(state.output, "usage: /load <path>");
        return { kind: "continue" };
      }
      let resolved: string;
      try {
        resolved = resolveAiChatPath(arg, state.cwd);
      } catch (err) {
        if (err instanceof PathEscapeError) {
          return { kind: "error", code: "AI_PATH_ESCAPE", context: { path: err.path } };
        }
        writeLine(state.output, `(/load failed: ${(err as Error).message})`);
        return { kind: "continue" };
      }
      try {
        const snapshot = await loadHistory(resolved);
        state.history.replace(snapshot.messages);
        state.provider = snapshot.provider;
        if (snapshot.model) state.model = snapshot.model;
        if (snapshot.system !== undefined) state.system = snapshot.system;
        writeLine(
          state.output,
          `(loaded ${snapshot.messages.length} turns from ${resolved} — provider=${state.provider})`,
        );
      } catch (err) {
        if (err instanceof HistoryValidationError) {
          return {
            kind: "error",
            code: "AI_HISTORY_MALFORMED",
            context: { path: err.path ?? resolved },
          };
        }
        writeLine(state.output, `(/load failed: ${(err as Error).message})`);
      }
      return { kind: "continue" };
    }
    case "/preset": {
      if (!arg) {
        writeLine(state.output, "usage: /preset <name>");
        return { kind: "continue" };
      }
      try {
        const preset = await loadPreset(arg, state.cwd);
        state.system = preset.text;
        writeLine(state.output, `(preset loaded: ${arg} — ${preset.text.length} chars)`);
      } catch (err) {
        if ((err as { code?: string }).code === "AI_PRESET_NOT_FOUND") {
          return { kind: "error", code: "AI_PRESET_NOT_FOUND", context: { preset: arg } };
        }
        writeLine(state.output, `(/preset failed: ${(err as Error).message})`);
      }
      return { kind: "continue" };
    }
    case "/system": {
      if (!arg) {
        writeLine(state.output, "usage: /system <path>");
        return { kind: "continue" };
      }
      let resolved: string;
      try {
        resolved = resolveAiChatPath(arg, state.cwd);
      } catch (err) {
        if (err instanceof PathEscapeError) {
          return { kind: "error", code: "AI_PATH_ESCAPE", context: { path: err.path } };
        }
        writeLine(state.output, `(/system failed: ${(err as Error).message})`);
        return { kind: "continue" };
      }
      try {
        const text = await loadSystemFile(resolved);
        state.system = text;
        writeLine(state.output, `(system loaded from ${resolved} — ${text.length} chars)`);
      } catch (err) {
        if ((err as { code?: string }).code === "AI_SYSTEM_FILE_NOT_FOUND") {
          return {
            kind: "error",
            code: "AI_SYSTEM_FILE_NOT_FOUND",
            context: { path: resolved },
          };
        }
        writeLine(state.output, `(/system failed: ${(err as Error).message})`);
      }
      return { kind: "continue" };
    }
    case "/provider": {
      if (!arg) {
        writeLine(state.output, `provider=${state.provider}`);
        return { kind: "continue" };
      }
      try {
        const next = resolveProvider(arg);
        state.provider = next;
        state.model = PROVIDER_DEFAULT_MODEL[next];
        writeLine(state.output, `(provider → ${next}, model → ${state.model})`);
      } catch {
        return { kind: "error", code: "AI_UNKNOWN_PROVIDER", context: { provider: arg } };
      }
      return { kind: "continue" };
    }
    case "/model": {
      if (!arg) {
        writeLine(state.output, `model=${state.model}`);
        return { kind: "continue" };
      }
      state.model = arg;
      writeLine(state.output, `(model → ${arg})`);
      return { kind: "continue" };
    }
    default:
      return { kind: "error", code: "AI_UNKNOWN_SLASH", context: { command } };
  }
}

/**
 * Dispatch one user turn: add it to history, stream the response, and
 * append the assistant reply. Returns true on success, false on a
 * recoverable error (the REPL should continue).
 */
async function runTurn(state: ChatState, userInput: string): Promise<boolean> {
  let clean: string;
  try {
    clean = sanitizeUtf8Input(userInput);
  } catch (err) {
    printCLIError(CLI_ERROR_CODES.AI_INVALID_INPUT, { reason: (err as Error).message });
    return false;
  }
  if (clean.length === 0) return true;

  state.history.push({ role: "user", content: clean });

  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once("SIGINT", onSigint);

  const started = Date.now();
  let produced = 0;
  try {
    state.output.write(`[${state.provider}] `);
    for await (const event of streamChat({
      provider: state.provider,
      model: state.model,
      messages: state.history.toPromptMessages(state.system),
      signal: controller.signal,
      timeoutMs: state.timeoutMs,
    })) {
      if (event.type === "chunk" && event.delta) {
        produced += event.delta.length;
        state.output.write(event.delta);
      } else if (event.type === "done") {
        const latency = event.latencyMs ?? Date.now() - started;
        const tokens = event.tokens?.tokensOut ?? event.tokens?.tokensEstimated ?? Math.ceil(produced / 4);
        state.output.write(`\n(${latency}ms · ~${tokens} tok)\n`);
        state.history.push({ role: "assistant", content: event.response ?? "" });
      }
    }
    return true;
  } catch (err) {
    state.output.write("\n");
    if ((err as Error).name === "AbortError") {
      writeLine(state.output, "(aborted)");
      // Remove the trailing user turn — no reply was produced.
      const turns = state.history.getTurns();
      if (turns.length > 0 && turns[turns.length - 1]?.role === "user") {
        state.history.replace(turns.slice(0, -1));
      }
      return true;
    }
    if (err instanceof MissingApiKeyError) {
      printCLIError(CLI_ERROR_CODES.AI_API_KEY_MISSING, {
        envVar: err.envVar,
        provider: err.provider,
      });
      return false;
    }
    if (err instanceof StreamTimeoutError) {
      printCLIError(CLI_ERROR_CODES.AI_TIMEOUT, {
        provider: err.provider,
        seconds: Math.round(err.timeoutMs / 1000),
      });
      return false;
    }
    if (err instanceof InvalidProviderError) {
      printCLIError(CLI_ERROR_CODES.AI_UNKNOWN_PROVIDER, { provider: err.provider });
      return false;
    }
    printCLIError(CLI_ERROR_CODES.AI_STREAM_FAILED, {
      provider: state.provider,
      detail: (err as Error).message,
    });
    return false;
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

/** CLI entry. Returns a numeric exit code (0, 1, 2). */
export async function aiChat(ctx: CommandContext | ChatOptions): Promise<number> {
  // Accept both raw CommandContext (from registry) and pre-parsed
  // ChatOptions (from tests).
  const options = normalizeOptions(ctx);
  const output = options.output ?? process.stdout;
  const cwd = options.cwd ?? process.cwd();

  if (options.help) {
    output.write(CHAT_HELP);
    return EXIT_OK;
  }

  let provider: PromptProvider;
  try {
    provider = resolveProvider(options.provider);
  } catch {
    printCLIError(CLI_ERROR_CODES.AI_UNKNOWN_PROVIDER, { provider: options.provider ?? "" });
    return EXIT_USAGE;
  }

  // Resolve system prompt (preset > systemPath > none).
  let system: string | undefined;
  if (options.preset) {
    try {
      const loaded = await loadPreset(options.preset, cwd);
      system = loaded.text;
    } catch (err) {
      if ((err as { code?: string }).code === "AI_PRESET_NOT_FOUND") {
        printCLIError(CLI_ERROR_CODES.AI_PRESET_NOT_FOUND, { preset: options.preset });
        return EXIT_ERR;
      }
      printCLIError(CLI_ERROR_CODES.AI_STREAM_FAILED, {
        provider,
        detail: (err as Error).message,
      });
      return EXIT_ERR;
    }
  } else if (options.systemPath) {
    try {
      system = await loadSystemFile(options.systemPath);
    } catch (err) {
      if ((err as { code?: string }).code === "AI_SYSTEM_FILE_NOT_FOUND") {
        printCLIError(CLI_ERROR_CODES.AI_SYSTEM_FILE_NOT_FOUND, { path: options.systemPath });
        return EXIT_ERR;
      }
      printCLIError(CLI_ERROR_CODES.AI_STREAM_FAILED, {
        provider,
        detail: (err as Error).message,
      });
      return EXIT_ERR;
    }
  }

  const state: ChatState = {
    provider,
    model: options.model && options.model.length > 0 ? options.model : PROVIDER_DEFAULT_MODEL[provider],
    system,
    history: new ChatHistory(),
    timeoutMs: options.timeoutMs,
    cwd,
    output,
  };

  if (!options.quiet) {
    output.write(
      `mandu ai chat — provider=${state.provider}, model=${state.model}. /help for commands, /quit to exit.\n`,
    );
    if (provider !== "local" && !process.env[PROVIDER_ENV_VARS[provider as Exclude<PromptProvider, "local">]]) {
      output.write(
        `(note: ${PROVIDER_ENV_VARS[provider as Exclude<PromptProvider, "local">]} is not set — requests will fail until it's exported)\n`,
      );
    }
  }

  // Test/script path: feed pre-seeded lines, skip readline.
  if (options.lines && options.lines.length > 0) {
    for (const line of options.lines) {
      output.write(formatPrompt(state));
      output.write(line + "\n");
      const code = await processLine(line, state);
      if (code === EXIT_USAGE) return EXIT_USAGE;
      if (code === EXIT_ERR) return EXIT_ERR;
      if (code === EXIT_OK && isQuitLine(line)) return EXIT_OK;
    }
    return EXIT_OK;
  }

  // Interactive REPL.
  const rl = createInterface({
    input: options.input ?? process.stdin,
    output: output as NodeJS.WritableStream,
    terminal: false, // we print our own prompt; avoid double-echo.
  });

  output.write(formatPrompt(state));
  try {
    for await (const raw of iterateLinesRaw(rl)) {
      const code = await processLine(raw, state);
      if (code === EXIT_OK && isQuitLine(raw)) {
        writeLine(output, "bye.");
        return EXIT_OK;
      }
      output.write(formatPrompt(state));
    }
  } finally {
    rl.close();
  }
  return EXIT_OK;
}

async function* iterateLinesRaw(
  rl: ReadlineInterface,
): AsyncGenerator<string, void, void> {
  for await (const line of rl) {
    yield String(line);
  }
}

function isQuitLine(line: string): boolean {
  const t = line.trim().toLowerCase();
  return t === "/quit" || t === "/exit" || t === "/bye";
}

async function processLine(rawLine: string, state: ChatState): Promise<number> {
  const line = rawLine ?? "";
  if (line.trim().length === 0) return EXIT_OK;
  if (line.trim().startsWith("/")) {
    const result = await handleSlashCommand(line, state);
    if (result.kind === "quit") return EXIT_OK;
    if (result.kind === "error") {
      printCLIError(CLI_ERROR_CODES[result.code], result.context);
      return EXIT_OK; // continue REPL after soft error
    }
    return EXIT_OK;
  }
  const ok = await runTurn(state, line);
  return ok ? EXIT_OK : EXIT_OK; // don't kill the REPL on stream error
}

function normalizeOptions(ctx: CommandContext | ChatOptions): ChatOptions {
  if (!ctx || typeof ctx !== "object") return {};
  // Already parsed (tests)
  if (!("options" in ctx) || !("args" in ctx)) {
    return ctx as ChatOptions;
  }
  const cc = ctx as CommandContext;
  const opts = cc.options ?? {};
  const rawProvider = typeof opts.provider === "string" && opts.provider !== "true" ? opts.provider : undefined;
  const rawModel = typeof opts.model === "string" && opts.model !== "true" ? opts.model : undefined;
  const rawSystem = typeof opts.system === "string" && opts.system !== "true" ? opts.system : undefined;
  const rawPreset = typeof opts.preset === "string" && opts.preset !== "true" ? opts.preset : undefined;
  const rawTimeout = typeof opts.timeout === "string" && opts.timeout !== "true" ? Number(opts.timeout) : undefined;
  const help =
    opts.help === "true" || opts.help === "" || (cc.args ?? []).includes("--help");
  return {
    provider: rawProvider,
    model: rawModel,
    systemPath: rawSystem,
    preset: rawPreset,
    timeoutMs: Number.isFinite(rawTimeout) ? rawTimeout : undefined,
    help,
  };
}
