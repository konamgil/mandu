/**
 * Brain — OpenAI OAuth adapter (Issue #235).
 *
 * Connects to the OpenAI Chat Completions API using a token obtained
 * via OAuth authorization code + PKCE. Mandu never owns an OpenAI API
 * key — the user's OAuth credentials are loaded from the OS keychain
 * (`packages/core/src/brain/credentials.ts`) and forwarded on each
 * request.
 *
 * Failure modes handled here:
 *   - Missing token            → adapter reports `available: false`, the
 *                                resolver falls to the next tier.
 *   - 401 on complete()        → one silent refresh attempt. On repeat
 *                                failure the token is deleted and the
 *                                adapter returns an empty completion,
 *                                letting Brain fall back to template.
 *   - Network / 5xx            → surfaced as an Error (isolated by Brain
 *                                via `isolatedBrainExecution`).
 *
 * Redaction is applied to every prompt BEFORE it hits `fetch`. Redacted
 * hits are appended to `<projectRoot>/.mandu/brain-redactions.jsonl`
 * for user audit. A consent prompt runs on the first cloud call per
 * (provider, project).
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

/**
 * OpenAI OAuth endpoints. These mirror the ChatGPT developer OAuth
 * surface documented at platform.openai.com/oauth. Tests + CI override
 * via `options.endpoints` so this module never dials the real host in
 * unit tests.
 */
export const OPENAI_OAUTH_ENDPOINTS: OAuthEndpoints = {
  authorizationUrl: "https://platform.openai.com/oauth/authorize",
  tokenUrl: "https://platform.openai.com/oauth/token",
};

/**
 * OpenAI OAuth public client id. Registered by Mandu; no secret is
 * required (PKCE covers the exchange). The client id is not sensitive;
 * it is already embedded in every authorization URL the user clicks.
 */
export const OPENAI_OAUTH_CLIENT_ID = "mandu-brain-cli";
export const OPENAI_OAUTH_SCOPE = "openai.chat";

/**
 * Default model — gpt-4o-mini balances cost and quality for brain
 * doctor triage. Override via `ManduConfig.brain.openai.model`.
 */
export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
export const OPENAI_API_BASE = "https://api.openai.com/v1";

export const DEFAULT_OPENAI_CONFIG: AdapterConfig = {
  baseUrl: OPENAI_API_BASE,
  model: OPENAI_DEFAULT_MODEL,
  timeout: 60_000,
};

/* -------------------------------------------------------------------- */
/* Options                                                              */
/* -------------------------------------------------------------------- */

export interface OpenAIOAuthAdapterOptions extends Partial<AdapterConfig> {
  /** Injection point — tests supply an in-memory fetch stub. */
  httpClient?: HttpClient;
  /** Injection point — tests swap in a canned endpoint pair. */
  endpoints?: OAuthEndpoints;
  /** OAuth client id override (for enterprise OpenAI proxies). */
  clientId?: string;
  /** OAuth scope override. */
  scope?: string;
  /** Credential store — default singleton; tests inject an in-memory one. */
  credentialStore?: CredentialStore;
  /** Project root — consent prompts are scoped per-project. */
  projectRoot?: string;
  /** Force-disable the consent prompt (telemetryOptOut path). */
  skipConsent?: boolean;
  /** Consent-prompt deps (stdout, readline) — test injection. */
  consentDeps?: ConsentPromptDeps;
  /**
   * When true, attempted adapter use without a token throws instead of
   * silently returning `available: false`. Used by the CLI `brain login`
   * command to loudly fail if the flow never wrote a token.
   */
  strict?: boolean;
}

/* -------------------------------------------------------------------- */
/* Adapter                                                              */
/* -------------------------------------------------------------------- */

export class OpenAIOAuthAdapter extends BaseLLMAdapter {
  readonly name = "openai-oauth";
  private httpClient: HttpClient;
  private endpoints: OAuthEndpoints;
  private clientId: string;
  private scope: string;
  private credentialStore: CredentialStore;
  private projectRoot: string;
  private skipConsent: boolean;
  private consentDeps?: ConsentPromptDeps;
  private strict: boolean;
  private refreshInFlight: Promise<StoredToken | null> | null = null;

  constructor(options: OpenAIOAuthAdapterOptions = {}) {
    super({
      ...DEFAULT_OPENAI_CONFIG,
      ...options,
    });
    this.httpClient =
      options.httpClient ?? globalThis.fetch.bind(globalThis);
    this.endpoints = options.endpoints ?? OPENAI_OAUTH_ENDPOINTS;
    this.clientId = options.clientId ?? OPENAI_OAUTH_CLIENT_ID;
    this.scope = options.scope ?? OPENAI_OAUTH_SCOPE;
    this.credentialStore = options.credentialStore ?? getCredentialStore();
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.skipConsent = options.skipConsent ?? false;
    this.consentDeps = options.consentDeps;
    this.strict = options.strict ?? false;
  }

  /* ----------------------- Status / login ---------------------------- */

  async checkStatus(): Promise<AdapterStatus> {
    const token = await this.credentialStore.load("openai");
    if (!token) {
      return {
        available: false,
        model: null,
        error:
          "No OpenAI OAuth token stored. Run `mandu brain login --provider=openai` first.",
      };
    }
    return {
      available: true,
      model: this.config.model,
    };
  }

  /**
   * Run the authorization-code + PKCE flow and persist the token.
   * Returns the stored token shape on success.
   */
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
      provider: "openai",
      last_used_at: new Date().toISOString(),
    };
    await this.credentialStore.save("openai", stored);
    return stored;
  }

  /** Delete the stored token. Idempotent. */
  async logout(): Promise<void> {
    await this.credentialStore.delete("openai");
  }

  /* ------------------------ Completion ------------------------------- */

  async complete(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    const token = await this.loadTokenOrReject();
    if (!token) {
      if (this.strict) {
        throw new Error(
          "OpenAIOAuthAdapter.complete() called without a stored token",
        );
      }
      return emptyCompletion();
    }

    // Consent prompt — skipped when telemetryOptOut is active (the
    // resolver never constructs us in that case) OR when the caller
    // has already vetted consent out of band.
    if (!this.skipConsent) {
      const ok = await ensureConsent(
        {
          projectRoot: this.projectRoot,
          provider: "openai",
          model: this.config.model,
          payloadDescription: describeChatPayload(messages),
        },
        this.consentDeps,
      );
      if (!ok) {
        // User declined — Brain must fall back. Return empty so the
        // template path takes over.
        return emptyCompletion();
      }
    }

    // Redact every message before the prompt leaves the machine.
    const redactedMessages: ChatMessage[] = [];
    const audit: string[] = [];
    for (const m of messages) {
      const { redacted, hits } = redactSecrets(m.content);
      redactedMessages.push({ role: m.role, content: redacted });
      for (const hit of hits) {
        audit.push(
          JSON.stringify({
            ts: new Date().toISOString(),
            provider: "openai",
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

    // First attempt — fresh token.
    let attemptToken = token.access_token;
    let result = await this.callChatApi(
      attemptToken,
      redactedMessages,
      options,
    );
    if (result.status === 401 && token.refresh_token) {
      const refreshed = await this.trySilentRefresh(token);
      if (refreshed) {
        attemptToken = refreshed.access_token;
        result = await this.callChatApi(
          attemptToken,
          redactedMessages,
          options,
        );
      }
    }
    if (result.status === 401) {
      // Persistent auth failure — scrub the token so subsequent runs
      // skip straight to the next resolver tier.
      await this.credentialStore.delete("openai");
      return emptyCompletion();
    }
    if (!result.ok) {
      throw new Error(
        `OpenAI request failed (${result.status}): ${result.bodySnippet}`,
      );
    }
    await this.credentialStore.touch("openai");
    return result.completion;
  }

  private async loadTokenOrReject(): Promise<StoredToken | null> {
    const token = await this.credentialStore.load("openai");
    return token ?? null;
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
          provider: "openai",
          last_used_at: new Date().toISOString(),
        };
        await this.credentialStore.save("openai", stored);
        return stored;
      } catch {
        return null;
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  private async callChatApi(
    accessToken: string,
    messages: ChatMessage[],
    options: CompletionOptions,
  ): Promise<
    | { ok: true; status: number; completion: CompletionResult }
    | { ok: false; status: number; bodySnippet: string; completion: CompletionResult }
  > {
    const body = {
      model: this.config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 2048,
      stop: options.stop,
    };

    const res = await this.httpClient(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
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
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    return {
      ok: true,
      status: res.status,
      completion: {
        content,
        usage: {
          promptTokens: json.usage?.prompt_tokens ?? 0,
          completionTokens: json.usage?.completion_tokens ?? 0,
          totalTokens: json.usage?.total_tokens ?? 0,
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

/**
 * One-line human summary of the chat payload for the consent prompt.
 *
 * Not exported — Anthropic has its own copy to avoid a cross-module
 * name collision in the adapters barrel. Keep implementations in sync
 * if the format changes.
 */
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

/**
 * Append redaction audit entries as JSON-lines to
 * `<projectRoot>/.mandu/brain-redactions.jsonl`. Best-effort — an IO
 * error here must not block the actual adapter request.
 */
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

export function createOpenAIOAuthAdapter(
  options: OpenAIOAuthAdapterOptions = {},
): OpenAIOAuthAdapter {
  return new OpenAIOAuthAdapter(options);
}
