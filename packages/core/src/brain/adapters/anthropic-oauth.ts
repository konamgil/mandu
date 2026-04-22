/**
 * Brain — Anthropic OAuth adapter (Issue #235).
 *
 * Mirrors the OpenAI adapter but targets Anthropic's Messages API
 * (`POST /v1/messages`). Mandu does not own Anthropic API keys — the
 * user's OAuth credentials live in the OS keychain and are forwarded
 * on each request.
 *
 * Why the default model is `claude-haiku-4-5-20251001`: brain-doctor
 * triage prompts are short and latency-sensitive. Haiku is the cheapest
 * model in the family that still produces syntactically valid code
 * suggestions in our exploratory tests. Users who prefer Sonnet /
 * Opus override via `ManduConfig.brain.anthropic.model`.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { BaseLLMAdapter } from "./base";
import type {
  AdapterConfig,
  AdapterStatus,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
} from "../types";
import {
  CredentialStore,
  getCredentialStore,
  type StoredToken,
} from "../credentials";
import {
  ensureConsent,
  type ConsentPromptDeps,
} from "../consent";
import { redactSecrets } from "../redactor";
import {
  refreshAccessToken,
  runAuthorizationCodeFlow,
  type HttpClient,
  type OAuthEndpoints,
} from "./oauth-flow";

/* -------------------------------------------------------------------- */
/* Defaults                                                             */
/* -------------------------------------------------------------------- */

export const ANTHROPIC_OAUTH_ENDPOINTS: OAuthEndpoints = {
  authorizationUrl: "https://console.anthropic.com/oauth/authorize",
  tokenUrl: "https://console.anthropic.com/oauth/token",
};

/** Public client id registered by Mandu — PKCE secures the exchange. */
export const ANTHROPIC_OAUTH_CLIENT_ID = "mandu-brain-cli";
export const ANTHROPIC_OAUTH_SCOPE = "messages:write";
export const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
/** Must be bumped whenever Anthropic ships a breaking Messages API version. */
export const ANTHROPIC_API_VERSION = "2023-06-01";

/**
 * Default model — Haiku 4.5. Fast, cheap, and good enough for the
 * triage prompts brain-doctor issues.
 */
export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export const DEFAULT_ANTHROPIC_CONFIG: AdapterConfig = {
  baseUrl: ANTHROPIC_API_BASE,
  model: ANTHROPIC_DEFAULT_MODEL,
  timeout: 60_000,
};

/* -------------------------------------------------------------------- */
/* Options                                                              */
/* -------------------------------------------------------------------- */

export interface AnthropicOAuthAdapterOptions extends Partial<AdapterConfig> {
  httpClient?: HttpClient;
  endpoints?: OAuthEndpoints;
  clientId?: string;
  scope?: string;
  credentialStore?: CredentialStore;
  projectRoot?: string;
  skipConsent?: boolean;
  consentDeps?: ConsentPromptDeps;
  /** Anthropic API version header — override only for enterprise proxies. */
  apiVersion?: string;
  strict?: boolean;
}

/* -------------------------------------------------------------------- */
/* Adapter                                                              */
/* -------------------------------------------------------------------- */

export class AnthropicOAuthAdapter extends BaseLLMAdapter {
  readonly name = "anthropic-oauth";
  private httpClient: HttpClient;
  private endpoints: OAuthEndpoints;
  private clientId: string;
  private scope: string;
  private credentialStore: CredentialStore;
  private projectRoot: string;
  private skipConsent: boolean;
  private consentDeps?: ConsentPromptDeps;
  private apiVersion: string;
  private strict: boolean;
  private refreshInFlight: Promise<StoredToken | null> | null = null;

  constructor(options: AnthropicOAuthAdapterOptions = {}) {
    super({
      ...DEFAULT_ANTHROPIC_CONFIG,
      ...options,
    });
    this.httpClient =
      options.httpClient ?? globalThis.fetch.bind(globalThis);
    this.endpoints = options.endpoints ?? ANTHROPIC_OAUTH_ENDPOINTS;
    this.clientId = options.clientId ?? ANTHROPIC_OAUTH_CLIENT_ID;
    this.scope = options.scope ?? ANTHROPIC_OAUTH_SCOPE;
    this.credentialStore = options.credentialStore ?? getCredentialStore();
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.skipConsent = options.skipConsent ?? false;
    this.consentDeps = options.consentDeps;
    this.apiVersion = options.apiVersion ?? ANTHROPIC_API_VERSION;
    this.strict = options.strict ?? false;
  }

  async checkStatus(): Promise<AdapterStatus> {
    const token = await this.credentialStore.load("anthropic");
    if (!token) {
      return {
        available: false,
        model: null,
        error:
          "No Anthropic OAuth token stored. Run `mandu brain login --provider=anthropic` first.",
      };
    }
    return {
      available: true,
      model: this.config.model,
    };
  }

  async login(
    opts: {
      onAuthUrl?: (url: string) => void;
      openBrowser?: (url: string) => Promise<void> | void;
      timeoutMs?: number;
    } = {},
  ): Promise<StoredToken> {
    const tokenResponse = await runAuthorizationCodeFlow({
      endpoints: this.endpoints,
      client: { clientId: this.clientId, scope: this.scope },
      httpClient: this.httpClient,
      onAuthUrl: opts.onAuthUrl,
      openBrowser: opts.openBrowser,
      timeoutMs: opts.timeoutMs,
    });

    const stored: StoredToken = {
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      expires_at:
        typeof tokenResponse.expires_in === "number"
          ? Math.floor(Date.now() / 1000) + tokenResponse.expires_in
          : undefined,
      scope: tokenResponse.scope ?? this.scope,
      default_model: this.config.model,
      provider: "anthropic",
      last_used_at: new Date().toISOString(),
    };
    await this.credentialStore.save("anthropic", stored);
    return stored;
  }

  async logout(): Promise<void> {
    await this.credentialStore.delete("anthropic");
  }

  async complete(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    const token = await this.credentialStore.load("anthropic");
    if (!token) {
      if (this.strict) {
        throw new Error(
          "AnthropicOAuthAdapter.complete() called without a stored token",
        );
      }
      return emptyCompletion();
    }

    if (!this.skipConsent) {
      const ok = await ensureConsent(
        {
          projectRoot: this.projectRoot,
          provider: "anthropic",
          model: this.config.model,
          payloadDescription: describeChatPayload(messages),
        },
        this.consentDeps,
      );
      if (!ok) return emptyCompletion();
    }

    const redactedMessages: ChatMessage[] = [];
    const audit: string[] = [];
    for (const m of messages) {
      const { redacted, hits } = redactSecrets(m.content);
      redactedMessages.push({ role: m.role, content: redacted });
      for (const hit of hits) {
        audit.push(
          JSON.stringify({
            ts: new Date().toISOString(),
            provider: "anthropic",
            model: this.config.model,
            role: m.role,
            kind: hit.kind,
            sample: hit.sample,
          }),
        );
      }
    }
    if (audit.length > 0) {
      await appendRedactionLog(this.projectRoot, audit);
    }

    let attemptToken = token.access_token;
    let result = await this.callMessagesApi(
      attemptToken,
      redactedMessages,
      options,
    );
    if (result.status === 401 && token.refresh_token) {
      const refreshed = await this.trySilentRefresh(token);
      if (refreshed) {
        attemptToken = refreshed.access_token;
        result = await this.callMessagesApi(
          attemptToken,
          redactedMessages,
          options,
        );
      }
    }
    if (result.status === 401) {
      await this.credentialStore.delete("anthropic");
      return emptyCompletion();
    }
    if (!result.ok) {
      throw new Error(
        `Anthropic request failed (${result.status}): ${result.bodySnippet}`,
      );
    }
    await this.credentialStore.touch("anthropic");
    return result.completion;
  }

  private async trySilentRefresh(
    existing: StoredToken,
  ): Promise<StoredToken | null> {
    if (!existing.refresh_token) return null;
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const refreshed = await refreshAccessToken({
          endpoints: this.endpoints,
          clientId: this.clientId,
          refreshToken: existing.refresh_token!,
          httpClient: this.httpClient,
          scope: existing.scope ?? this.scope,
        });
        const stored: StoredToken = {
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token ?? existing.refresh_token,
          expires_at:
            typeof refreshed.expires_in === "number"
              ? Math.floor(Date.now() / 1000) + refreshed.expires_in
              : undefined,
          scope: refreshed.scope ?? existing.scope,
          default_model: existing.default_model,
          provider: "anthropic",
          last_used_at: new Date().toISOString(),
        };
        await this.credentialStore.save("anthropic", stored);
        return stored;
      } catch {
        return null;
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  /**
   * Transform our shared ChatMessage shape into Anthropic's Messages
   * API request body.  Anthropic separates the system message from
   * the conversation turns; we concatenate any leading system
   * messages into one `system` string.
   */
  private async callMessagesApi(
    accessToken: string,
    messages: ChatMessage[],
    options: CompletionOptions,
  ): Promise<
    | { ok: true; status: number; completion: CompletionResult }
    | { ok: false; status: number; bodySnippet: string; completion: CompletionResult }
  > {
    const systemParts: string[] = [];
    const conversation: Array<{
      role: "user" | "assistant";
      content: string;
    }> = [];
    for (const m of messages) {
      if (m.role === "system") {
        systemParts.push(m.content);
      } else if (m.role === "user" || m.role === "assistant") {
        conversation.push({ role: m.role, content: m.content });
      }
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: conversation,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.2,
    };
    if (systemParts.length > 0) body.system = systemParts.join("\n\n");
    if (options.stop && options.stop.length > 0) {
      body.stop_sequences = options.stop;
    }

    const res = await this.httpClient(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
        "anthropic-version": this.apiVersion,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        bodySnippet: txt.slice(0, 256),
        completion: emptyCompletion(),
      };
    }

    const json = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text =
      json.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("") ?? "";
    const input = json.usage?.input_tokens ?? 0;
    const output = json.usage?.output_tokens ?? 0;
    return {
      ok: true,
      status: res.status,
      completion: {
        content: text,
        usage: {
          promptTokens: input,
          completionTokens: output,
          totalTokens: input + output,
        },
      },
    };
  }
}

/* -------------------------------------------------------------------- */
/* Helpers                                                              */
/* -------------------------------------------------------------------- */

function emptyCompletion(): CompletionResult {
  return {
    content: "",
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

function describeChatPayload(messages: ChatMessage[]): string {
  const totalChars = messages.reduce((a, m) => a + m.content.length, 0);
  const roleCounts = new Map<string, number>();
  for (const m of messages) {
    roleCounts.set(m.role, (roleCounts.get(m.role) ?? 0) + 1);
  }
  const roleSummary = [...roleCounts.entries()]
    .map(([r, n]) => `${n} ${r}`)
    .join(", ");
  return `${messages.length} messages (${roleSummary}), ~${totalChars} chars`;
}

async function appendRedactionLog(
  projectRoot: string,
  entries: string[],
): Promise<void> {
  try {
    const dir = path.join(projectRoot, ".mandu");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "brain-redactions.jsonl");
    await fs.appendFile(file, `${entries.join("\n")}\n`, { mode: 0o600 });
  } catch {
    /* best-effort */
  }
}

export function createAnthropicOAuthAdapter(
  options: AnthropicOAuthAdapterOptions = {},
): AnthropicOAuthAdapter {
  return new AnthropicOAuthAdapter(options);
}
