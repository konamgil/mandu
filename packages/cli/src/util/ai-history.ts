/**
 * In-memory chat history with JSON save/load (bounded scrollback).
 *
 * Phase 14.2 — Agent F. Owned by `packages/cli/src/commands/ai/chat.ts`.
 *
 * Schema v1 (forward-compatible via `version`):
 *
 * ```json
 * {
 *   "version": 1,
 *   "provider": "claude|openai|gemini|local",
 *   "model": "optional-model-id",
 *   "system": "optional system prompt text",
 *   "savedAt": "ISO-8601 timestamp",
 *   "messages": [
 *     { "role": "user"|"assistant", "content": "..." }
 *   ]
 * }
 * ```
 *
 * We reject malformed files with {@link HistoryValidationError} so the CLI
 * can surface `CLI_E302` cleanly. System messages are NOT stored in
 * `messages[]` — they live on `system` so preset swaps don't pollute the
 * turn history.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { PromptMessage, PromptProvider } from "@mandujs/ate/prompts";

/**
 * Default directory used by `mandu ai chat` for `/save` and `/load`.
 * Resolved relative to the REPL's working directory so history is
 * scoped to each project. Created on first save.
 */
export const AI_CHAT_DIR_RELATIVE = ".mandu/ai-chat";

/**
 * Raised when a user-supplied slash-command path would escape the
 * AI chat working directory — absolute paths, `..` traversals, or
 * paths that resolve outside the default scope. The CLI surfaces
 * this as `CLI_E310 AI_PATH_ESCAPE`.
 */
export class PathEscapeError extends Error {
  readonly path: string;
  constructor(offending: string) {
    super(`Path escapes the AI chat working directory: ${offending}`);
    this.name = "PathEscapeError";
    this.path = offending;
  }
}

/**
 * Resolve a slash-command path inside the AI chat scope, rejecting
 * absolute paths and `..`-based traversals before we touch the
 * filesystem.
 *
 * Rules:
 *  - Absolute paths (Windows `C:\...`, POSIX `/...`) are rejected.
 *  - `..` traversals (any segment that is exactly `..`) are rejected.
 *  - Bare filenames (`session.json`) resolve under
 *    `${cwd}/.mandu/ai-chat/session.json`.
 *  - Relative paths with subdirs (`./runs/session.json`,
 *    `runs/session.json`) resolve under
 *    `${cwd}/.mandu/ai-chat/<path>`.
 *  - The resolved absolute path must still live under the
 *    `${cwd}/.mandu/ai-chat` directory — a belt-and-braces check
 *    against platform-specific edge cases (symlinks, drive letters).
 */
export function resolveAiChatPath(
  userInput: string,
  cwd: string = process.cwd(),
): string {
  if (typeof userInput !== "string" || userInput.trim().length === 0) {
    throw new PathEscapeError(String(userInput ?? ""));
  }

  const raw = userInput.trim();

  // Reject absolute paths eagerly — Windows drive-rooted, POSIX `/`, UNC forms.
  if (path.isAbsolute(raw)) {
    throw new PathEscapeError(raw);
  }
  // Additional defense on Windows where `path.isAbsolute` accepts only
  // drive-rooted forms, but a leading slash or backslash is still a
  // drive-relative absolute reference we must reject.
  if (raw.startsWith("/") || raw.startsWith("\\")) {
    throw new PathEscapeError(raw);
  }

  // Reject explicit parent traversal in any segment — after normalizing
  // backslashes to forward slashes so the check works on both platforms.
  const normalized = raw.replace(/\\/g, "/");
  for (const seg of normalized.split("/")) {
    if (seg === "..") {
      throw new PathEscapeError(raw);
    }
  }

  const baseDir = path.resolve(cwd, AI_CHAT_DIR_RELATIVE);
  const resolved = path.resolve(baseDir, raw);

  // Final containment check — the resolved path must live under baseDir.
  // Compare with trailing separator to avoid `.mandu/ai-chat-evil` false-positives.
  const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : baseDir + path.sep;
  if (resolved !== baseDir && !resolved.startsWith(baseWithSep)) {
    throw new PathEscapeError(raw);
  }

  return resolved;
}

/** Maximum turns kept in memory to bound scrollback and prompt size. */
export const HISTORY_MAX_TURNS = 100;

export const HISTORY_SCHEMA_VERSION = 1 as const;

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface HistorySnapshot {
  version: typeof HISTORY_SCHEMA_VERSION;
  provider: PromptProvider;
  model?: string;
  system?: string;
  savedAt: string;
  messages: HistoryTurn[];
}

export class HistoryValidationError extends Error {
  readonly path?: string;
  constructor(message: string, filePath?: string) {
    super(message);
    this.name = "HistoryValidationError";
    this.path = filePath;
  }
}

/** In-memory rolling chat history. */
export class ChatHistory {
  private turns: HistoryTurn[] = [];
  private maxTurns: number;

  constructor(options: { maxTurns?: number } = {}) {
    this.maxTurns = options.maxTurns ?? HISTORY_MAX_TURNS;
    if (!Number.isInteger(this.maxTurns) || this.maxTurns <= 0) {
      throw new Error(`maxTurns must be a positive integer (got ${this.maxTurns})`);
    }
  }

  /** Append a turn, trimming the oldest when the cap is exceeded. */
  push(turn: HistoryTurn): void {
    if (turn.role !== "user" && turn.role !== "assistant") {
      throw new Error(`ChatHistory.push: invalid role "${turn.role}"`);
    }
    if (typeof turn.content !== "string") {
      throw new Error("ChatHistory.push: content must be a string");
    }
    this.turns.push({ role: turn.role, content: turn.content });
    while (this.turns.length > this.maxTurns) {
      this.turns.shift();
    }
  }

  /** Return a shallow copy of turns (callers can't mutate internal state). */
  getTurns(): HistoryTurn[] {
    return this.turns.slice();
  }

  /** Convert turns into PromptMessage[] for adapter.stream. */
  toPromptMessages(systemPrompt?: string): PromptMessage[] {
    const msgs: PromptMessage[] = [];
    if (systemPrompt && systemPrompt.trim().length > 0) {
      msgs.push({ role: "system", content: systemPrompt });
    }
    for (const t of this.turns) {
      msgs.push({ role: t.role, content: t.content });
    }
    return msgs;
  }

  /** Drop all turns. */
  clear(): void {
    this.turns.length = 0;
  }

  /** Current turn count. */
  get size(): number {
    return this.turns.length;
  }

  /** Replace turns wholesale (used by /load). */
  replace(turns: HistoryTurn[]): void {
    this.turns = turns.slice(-this.maxTurns).map((t) => ({ role: t.role, content: t.content }));
  }
}

/**
 * Shape-validate a parsed JSON object as a {@link HistorySnapshot}. Throws
 * {@link HistoryValidationError} on any structural mismatch.
 *
 * Exported so the CLI `/load` command can reuse this for user-facing
 * error messages without pulling in the full chat loop.
 */
export function validateHistorySnapshot(
  raw: unknown,
  filePath?: string,
): HistorySnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HistoryValidationError("history root is not an object", filePath);
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== HISTORY_SCHEMA_VERSION) {
    throw new HistoryValidationError(
      `unsupported version ${String(obj.version)} (expected ${HISTORY_SCHEMA_VERSION})`,
      filePath,
    );
  }
  const provider = obj.provider;
  if (
    provider !== "claude" &&
    provider !== "openai" &&
    provider !== "gemini" &&
    provider !== "local"
  ) {
    throw new HistoryValidationError(
      `invalid provider "${String(provider)}"`,
      filePath,
    );
  }
  if (!Array.isArray(obj.messages)) {
    throw new HistoryValidationError("messages is not an array", filePath);
  }
  const turns: HistoryTurn[] = [];
  for (let i = 0; i < obj.messages.length; i += 1) {
    const m = obj.messages[i];
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      throw new HistoryValidationError(`messages[${i}] is not an object`, filePath);
    }
    const mo = m as Record<string, unknown>;
    if (mo.role !== "user" && mo.role !== "assistant") {
      throw new HistoryValidationError(
        `messages[${i}].role must be "user" or "assistant" (got "${String(mo.role)}")`,
        filePath,
      );
    }
    if (typeof mo.content !== "string") {
      throw new HistoryValidationError(
        `messages[${i}].content must be a string`,
        filePath,
      );
    }
    turns.push({ role: mo.role, content: mo.content });
  }
  const system = typeof obj.system === "string" ? obj.system : undefined;
  const model = typeof obj.model === "string" ? obj.model : undefined;
  const savedAt = typeof obj.savedAt === "string" ? obj.savedAt : new Date(0).toISOString();

  return {
    version: HISTORY_SCHEMA_VERSION,
    provider,
    model,
    system,
    savedAt,
    messages: turns,
  };
}

/**
 * Save a snapshot to disk as pretty-printed JSON. `filePath` is trusted to
 * be a fully resolved absolute path — containment is enforced by callers
 * via {@link resolveAiChatPath} before this is invoked.
 */
export async function saveHistory(
  filePath: string,
  snapshot: HistorySnapshot,
): Promise<void> {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const serialized = JSON.stringify(snapshot, null, 2) + "\n";
  await fs.writeFile(resolved, serialized, "utf8");
}

/**
 * Load + validate a snapshot. Throws {@link HistoryValidationError} on
 * failure. `filePath` is trusted to be a fully resolved absolute path —
 * containment is enforced by callers via {@link resolveAiChatPath}.
 */
export async function loadHistory(filePath: string): Promise<HistorySnapshot> {
  const resolved = path.resolve(filePath);
  let raw: string;
  try {
    raw = await fs.readFile(resolved, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new HistoryValidationError(`file not found: ${resolved}`, resolved);
    }
    throw new HistoryValidationError(
      `cannot read file (${code ?? "IO"}): ${resolved}`,
      resolved,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new HistoryValidationError(
      `invalid JSON: ${(err as Error).message}`,
      resolved,
    );
  }
  return validateHistorySnapshot(parsed, resolved);
}

/** Build a snapshot ready for `saveHistory`. */
export function createSnapshot(
  provider: PromptProvider,
  history: ChatHistory,
  extras: { model?: string; system?: string } = {},
): HistorySnapshot {
  return {
    version: HISTORY_SCHEMA_VERSION,
    provider,
    model: extras.model,
    system: extras.system,
    savedAt: new Date().toISOString(),
    messages: history.getTurns(),
  };
}
