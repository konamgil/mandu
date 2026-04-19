/**
 * Local / generic prompt adapter (Ollama, LM Studio, llama.cpp, etc.).
 *
 * Most local runtimes accept OpenAI-compatible chat format, so we pass
 * through untouched. Systems are consolidated into a single leading
 * message for determinism.
 *
 * Streaming behavior:
 *   - When `MANDU_LOCAL_BASE_URL` is set (or `options.baseUrl` is passed),
 *     the adapter hits `<baseUrl>/v1/chat/completions` in streaming mode —
 *     compatible with Ollama (`http://127.0.0.1:11434/v1`) and LM Studio.
 *   - Otherwise we emit a **deterministic dummy response** so `mandu ai`
 *     works offline for CI and dry-runs. The dummy response echoes the
 *     last user message and tags it with a stable preamble.
 */

import type {
  PromptAdapter,
  PromptMessage,
  PromptStreamOptions,
  PromptStreamTerminal,
} from "../types";

/**
 * Deterministic offline responder. Given the same messages, emits the
 * same output — so tests + CI never flake.
 *
 * Exported for tests so the CLI echo harness can validate the exact
 * string shape end-to-end.
 */
export function renderLocalDummy(messages: PromptMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const systems = messages.filter((m) => m.role === "system").map((m) => m.content);
  const systemDigest = systems.length > 0 ? `(system: ${systems[0].slice(0, 60).replace(/\s+/g, " ")}${systems[0].length > 60 ? "..." : ""})` : "(no system prompt)";
  const userText = lastUser?.content ?? "(no user message)";
  return `[local:echo] ${systemDigest}\n\n> ${userText.split("\n").join("\n> ")}\n`;
}

async function* streamDummy(
  options: PromptStreamOptions,
): AsyncIterable<string | PromptStreamTerminal> {
  const body = renderLocalDummy(options.messages);
  // Chunk by word so downstream logic that expects multiple deltas gets them.
  const words = body.match(/\S+\s*|\s+/g) ?? [body];
  for (const word of words) {
    if (options.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    yield word;
  }
  const charCount = body.length;
  // ~4 chars per token heuristic (matches the rest of Mandu's budgeting).
  yield {
    tokensEstimated: Math.max(1, Math.ceil(charCount / 4)),
  } satisfies PromptStreamTerminal;
}

/**
 * Wave R3 M-02 — SSRF guard for `MANDU_LOCAL_BASE_URL` / `OPENAI_BASE_URL`.
 *
 * The local adapter exists so Mandu can point at Ollama / LM Studio running
 * on the same machine. Without this gate a malicious `.env` could redirect
 * the chat loop to the AWS IMDS endpoint (`http://169.254.169.254`) or an
 * internal intranet host, and the returned body would be rendered as model
 * output. We therefore require:
 *   - scheme http / https
 *   - http scheme → hostname in `{localhost, 127.0.0.1, ::1}` unless the
 *     caller explicitly opts in via `MANDU_LOCAL_ALLOW_REMOTE=1`
 *   - block RFC1918 ranges (10/8, 192.168/16, 172.16/12) and link-local
 *     (169.254/16) unless the same opt-in is set
 *
 * Throws a user-facing `Error` so the chat loop surfaces it via the normal
 * adapter-error path (which is already mask-scrubbed).
 */
export function validateLocalBaseUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(
      `MANDU_LOCAL_BASE_URL must be a valid URL (got: ${JSON.stringify(rawUrl)})`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `MANDU_LOCAL_BASE_URL protocol must be http: or https: (got: ${parsed.protocol})`,
    );
  }
  const allowRemote =
    process.env.MANDU_LOCAL_ALLOW_REMOTE === "1" ||
    process.env.MANDU_LOCAL_ALLOW_REMOTE === "true";
  if (allowRemote) return parsed;
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return parsed;
  }
  if (parsed.protocol === "http:") {
    throw new Error(
      `MANDU_LOCAL_BASE_URL over http: must point at localhost / 127.0.0.1 / ::1 ` +
        `(got: ${host}). Set MANDU_LOCAL_ALLOW_REMOTE=1 to opt out of this guard.`,
    );
  }
  // https: — still refuse metadata + private ranges by default.
  if (
    host === "169.254.169.254" ||
    host.startsWith("169.254.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error(
      `MANDU_LOCAL_BASE_URL host ${host} is in a blocked range (metadata / RFC1918). ` +
        `Set MANDU_LOCAL_ALLOW_REMOTE=1 to opt out of this guard.`,
    );
  }
  return parsed;
}

async function* streamOpenAICompat(
  baseUrl: string,
  options: PromptStreamOptions,
): AsyncIterable<string | PromptStreamTerminal> {
  const parsed = validateLocalBaseUrl(baseUrl);
  const url = parsed.toString().replace(/\/$/, "") + "/v1/chat/completions";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: options.model ?? "local-model",
      messages: options.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      max_tokens: options.maxTokens,
    }),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`local runtime ${response.status}: ${response.statusText}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let produced = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            produced += delta.length;
            yield delta;
          }
        } catch {
          /* ignore malformed SSE frame */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield {
    tokensEstimated: Math.max(1, Math.ceil(produced / 4)),
  } satisfies PromptStreamTerminal;
}

export const localAdapter: PromptAdapter = {
  name: "local",
  getDefaultUserCharBudget() {
    // Smaller local models usually target 8k–32k ctx; conservative cap.
    return 20_000;
  },
  render(messages: PromptMessage[]): PromptMessage[] {
    const systems: string[] = [];
    const conv: PromptMessage[] = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        systems.push(msg.content);
      } else {
        conv.push(msg);
      }
    }
    const out: PromptMessage[] = [];
    if (systems.length > 0) {
      out.push({ role: "system", content: systems.join("\n\n") });
    }
    out.push(...conv);
    return out;
  },
  stream(options: PromptStreamOptions): AsyncIterable<string | PromptStreamTerminal> {
    const baseUrl =
      options.baseUrl ?? process.env.MANDU_LOCAL_BASE_URL ?? process.env.OPENAI_BASE_URL;
    if (baseUrl && baseUrl.trim().length > 0) {
      return streamOpenAICompat(baseUrl, options);
    }
    return streamDummy(options);
  },
};
