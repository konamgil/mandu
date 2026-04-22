/**
 * Brain v0.2 - LLM Adapters (resolver + factory).
 *
 * `createBrainAdapter(config)` picks the right adapter based on
 * declarative config + runtime signals. Resolution order when
 * `adapter: "auto"` (or `brain` config omitted entirely):
 *
 *   1. openai-oauth   — token present in the keychain
 *   2. anthropic-oauth — token present in the keychain
 *   3. ollama          — daemon reachable at localhost:11434
 *   4. template        — always works (returns NoopAdapter; Brain
 *                        gracefully falls back to template analysis)
 *
 * `telemetryOptOut: true` disables every cloud tier — the resolver
 * skips straight to ollama/template regardless of stored tokens.
 *
 * Explicit `adapter: "openai"` / `"anthropic"` / `"ollama"` /
 * `"template"` pins the choice; the resolver still degrades to the
 * NoopAdapter when the chosen provider is unreachable, so the caller
 * never explodes on a missing dependency.
 */

export * from "./base";
export * from "./ollama";
export * from "./openai-oauth";
export * from "./anthropic-oauth";
export * from "./oauth-flow";
export * from "./chatgpt-auth";

import { type LLMAdapter, NoopAdapter } from "./base";
import { OllamaAdapter, createOllamaAdapter } from "./ollama";
import {
  OpenAIOAuthAdapter,
  createOpenAIOAuthAdapter,
  type OpenAIOAuthAdapterOptions,
} from "./openai-oauth";
import { ChatGPTAuth } from "./chatgpt-auth";
import {
  AnthropicOAuthAdapter,
  createAnthropicOAuthAdapter,
  type AnthropicOAuthAdapterOptions,
} from "./anthropic-oauth";
import {
  getCredentialStore,
  type CredentialStore,
  type StoredToken,
} from "../credentials";

/**
 * Normalised Brain config shape consumed by the resolver. Mirrors
 * `ManduConfig.brain` but with every field required-or-explicitly
 * defaulted so downstream code does not repeat the same null checks.
 */
export interface BrainAdapterConfig {
  adapter: "auto" | "openai" | "anthropic" | "ollama" | "template";
  openai?: { model?: string };
  anthropic?: { model?: string };
  ollama?: { model?: string; baseUrl?: string };
  /**
   * When true, cloud adapters are disabled entirely. The resolver
   * falls to ollama/template regardless of stored tokens.
   */
  telemetryOptOut?: boolean;
  /**
   * Project root — required for consent scoping + redaction audit log.
   * Defaults to `process.cwd()` when omitted.
   */
  projectRoot?: string;
  /** Credential store override — tests inject an in-memory one. */
  credentialStore?: CredentialStore;
  /** Override OpenAI-specific adapter options (tests only). */
  openaiOptions?: OpenAIOAuthAdapterOptions;
  /** Override Anthropic-specific adapter options (tests only). */
  anthropicOptions?: AnthropicOAuthAdapterOptions;
  /**
   * Override the ollama-reachability probe. When omitted we call
   * `OllamaAdapter.isServerRunning()` which is the production path.
   */
  probeOllama?: (adapter: OllamaAdapter) => Promise<boolean>;
  /**
   * Override the keychain probe used by the auto-resolver. Returns
   * the stored token or null. Tests inject a deterministic stub; the
   * default consults `credentialStore.load(provider)`.
   */
  probeToken?: (provider: "openai" | "anthropic") => Promise<StoredToken | null>;
  /**
   * Override the ChatGPT session-token probe. Default: instantiate
   * `new ChatGPTAuth()` and check its on-disk auth.json. Tests inject
   * a stub returning `false` so the developer's real `~/.codex/auth.json`
   * doesn't leak into unit-test expectations.
   */
  probeChatGPTAuth?: () => { authenticated: boolean; path: string | null };
}

/**
 * Result of the resolver — returned so callers can log which tier
 * won (surfaced in `mandu brain status`).
 */
export interface BrainAdapterResolution {
  adapter: LLMAdapter;
  /** Which tier the resolver picked. */
  resolved: "openai" | "anthropic" | "ollama" | "template";
  /** Which tier the caller asked for (config value). */
  requested: BrainAdapterConfig["adapter"];
  /** Human-readable reason — useful for `mandu brain status`. */
  reason: string;
}

/**
 * Resolve + construct a Brain adapter.
 *
 * Callers typically use the convenience re-export
 * `createBrainAdapter(config)`. The full `resolveBrainAdapter()`
 * surface returns the metadata record so CLI status commands can
 * explain which tier won.
 */
export async function resolveBrainAdapter(
  config: Partial<BrainAdapterConfig> = {},
): Promise<BrainAdapterResolution> {
  const requested = config.adapter ?? "auto";
  const telemetryOptOut = config.telemetryOptOut ?? false;

  const store = config.credentialStore ?? getCredentialStore();
  const projectRoot = config.projectRoot ?? process.cwd();

  const probeToken =
    config.probeToken ?? ((provider) => store.load(provider));

  const probeOllama =
    config.probeOllama ??
    (async (ollama: OllamaAdapter) => ollama.isServerRunning());

  const probeChatGPTAuth =
    config.probeChatGPTAuth ??
    (() => {
      const c = new ChatGPTAuth();
      return { authenticated: c.isAuthenticated(), path: c.locateAuthFile() };
    });

  // Explicit template — skip every other check.
  if (requested === "template") {
    return {
      adapter: new NoopAdapter(),
      resolved: "template",
      requested,
      reason: "Explicit adapter: 'template' in config",
    };
  }

  // Explicit openai — only honored when telemetry is allowed AND a
  // token exists. Falls back to template otherwise so Core does not
  // explode.
  if (requested === "openai") {
    if (telemetryOptOut) {
      return {
        adapter: new NoopAdapter(),
        resolved: "template",
        requested,
        reason:
          "adapter: 'openai' requested but telemetryOptOut=true — forcing template",
      };
    }
    // Primary: ChatGPT session token (written by `@openai/codex login`).
    const cg = probeChatGPTAuth();
    const hasChatGPT = cg.authenticated;
    const token = hasChatGPT ? null : await probeToken("openai");
    if (!hasChatGPT && !token) {
      return {
        adapter: new NoopAdapter(),
        resolved: "template",
        requested,
        reason:
          "adapter: 'openai' requested but no token found — run `mandu brain login --provider=openai`",
      };
    }
    return {
      adapter: createOpenAIOAuthAdapter({
        ...(config.openaiOptions ?? {}),
        model: config.openai?.model ?? config.openaiOptions?.model,
        credentialStore: store,
        projectRoot,
      }),
      resolved: "openai",
      requested,
      reason: hasChatGPT
        ? "Explicit adapter: 'openai' + ChatGPT session token present"
        : "Explicit adapter: 'openai' + keychain token present",
    };
  }

  if (requested === "anthropic") {
    if (telemetryOptOut) {
      return {
        adapter: new NoopAdapter(),
        resolved: "template",
        requested,
        reason:
          "adapter: 'anthropic' requested but telemetryOptOut=true — forcing template",
      };
    }
    const token = await probeToken("anthropic");
    if (!token) {
      return {
        adapter: new NoopAdapter(),
        resolved: "template",
        requested,
        reason:
          "adapter: 'anthropic' requested but no token in keychain — run `mandu brain login --provider=anthropic`",
      };
    }
    return {
      adapter: createAnthropicOAuthAdapter({
        ...(config.anthropicOptions ?? {}),
        model: config.anthropic?.model ?? config.anthropicOptions?.model,
        credentialStore: store,
        projectRoot,
      }),
      resolved: "anthropic",
      requested,
      reason: "Explicit adapter: 'anthropic' + token present",
    };
  }

  if (requested === "ollama") {
    const ollama = createOllamaAdapter({
      model: config.ollama?.model,
      baseUrl: config.ollama?.baseUrl,
    });
    return {
      adapter: ollama,
      resolved: "ollama",
      requested,
      reason: "Explicit adapter: 'ollama'",
    };
  }

  // Auto — try cloud providers first (when allowed), then ollama,
  // then template.
  if (!telemetryOptOut) {
    // Primary: ChatGPT session token (managed by `@openai/codex`).
    const cg2 = probeChatGPTAuth();
    if (cg2.authenticated) {
      return {
        adapter: createOpenAIOAuthAdapter({
          ...(config.openaiOptions ?? {}),
          model: config.openai?.model ?? config.openaiOptions?.model,
          credentialStore: store,
          projectRoot,
        }),
        resolved: "openai",
        requested,
        reason: `auto: ChatGPT session token at ${cg2.path ?? "(unknown)"}`,
      };
    }
    const openaiToken = await probeToken("openai");
    if (openaiToken) {
      return {
        adapter: createOpenAIOAuthAdapter({
          ...(config.openaiOptions ?? {}),
          model: config.openai?.model ?? config.openaiOptions?.model,
          credentialStore: store,
          projectRoot,
        }),
        resolved: "openai",
        requested,
        reason: "auto: OpenAI token found in keychain",
      };
    }
    const anthropicToken = await probeToken("anthropic");
    if (anthropicToken) {
      return {
        adapter: createAnthropicOAuthAdapter({
          ...(config.anthropicOptions ?? {}),
          model: config.anthropic?.model ?? config.anthropicOptions?.model,
          credentialStore: store,
          projectRoot,
        }),
        resolved: "anthropic",
        requested,
        reason: "auto: Anthropic token found in keychain",
      };
    }
  }

  const ollama = createOllamaAdapter({
    model: config.ollama?.model,
    baseUrl: config.ollama?.baseUrl,
  });
  const ollamaAlive = await probeOllama(ollama).catch(() => false);
  if (ollamaAlive) {
    return {
      adapter: ollama,
      resolved: "ollama",
      requested,
      reason: telemetryOptOut
        ? "auto: telemetryOptOut=true, ollama daemon reachable"
        : "auto: no cloud token, ollama daemon reachable",
    };
  }

  return {
    adapter: new NoopAdapter(),
    resolved: "template",
    requested,
    reason: telemetryOptOut
      ? "auto: telemetryOptOut=true and no local LLM — using template"
      : "auto: no cloud token, no ollama daemon — using template",
  };
}

/**
 * Convenience factory — returns just the adapter. Use
 * `resolveBrainAdapter()` when you also need the resolution metadata
 * (e.g. for `mandu brain status`).
 */
export async function createBrainAdapter(
  config: Partial<BrainAdapterConfig> = {},
): Promise<LLMAdapter> {
  const res = await resolveBrainAdapter(config);
  return res.adapter;
}

/**
 * Runtime guard — is the adapter a cloud connector? Used by CLI
 * status to flag "may transmit data" lines.
 */
export function isCloudAdapter(adapter: LLMAdapter): boolean {
  return (
    adapter instanceof OpenAIOAuthAdapter ||
    adapter instanceof AnthropicOAuthAdapter
  );
}
