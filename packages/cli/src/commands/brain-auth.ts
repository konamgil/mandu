/**
 * Mandu CLI — Brain OAuth authentication (Issue #235).
 *
 *   mandu brain login  [--provider=openai|anthropic]
 *   mandu brain logout [--provider=openai|anthropic|all]
 *   mandu brain status
 *
 * Lives next to the legacy `brain setup / status` commands in
 * `./brain.ts`. The parent dispatcher routes `login` / `logout` /
 * `status` here; `setup` stays in the old module for backward-compat.
 *
 * Design invariants (user feedback on Issue #235 — Mandu as connector):
 *   - No API keys ever touched by Mandu. The OAuth flow writes tokens
 *     straight into the OS keychain via `CredentialStore`.
 *   - Every prompt/side-effect is injectable so the test suite can
 *     exercise the full flow with an in-memory CredentialStore and
 *     stubbed HttpClient.
 */

import {
  OpenAIOAuthAdapter,
  AnthropicOAuthAdapter,
  resolveBrainAdapter,
  getCredentialStore,
  CredentialStore,
  revokeConsent,
  type StoredToken,
  type HttpClient,
  type OAuthEndpoints,
} from "@mandujs/core";

export type BrainAuthProvider = "openai" | "anthropic";
export type BrainLogoutProvider = BrainAuthProvider | "all";

/**
 * Dependency-injection surface for every brain-auth command. Tests
 * override every field; production leaves them all default.
 */
export interface BrainAuthDeps {
  /** Credential store — tests inject an in-memory one. */
  credentialStore?: CredentialStore;
  /** Print callback (default: `console.log`). */
  log?: (msg: string) => void;
  /** Error print callback (default: `console.error`). */
  error?: (msg: string) => void;
  /** Project root — default `process.cwd()`, used for consent scope. */
  projectRoot?: string;
  /**
   * Override the OAuth HTTP client. Tests inject a stub returning a
   * canned token response.
   */
  httpClient?: HttpClient;
  /**
   * Override OAuth endpoints. Tests point at a local `Bun.serve`
   * stand-in for platform.openai.com / console.anthropic.com.
   */
  endpoints?: OAuthEndpoints;
  /** Override the browser-open helper — tests supply a no-op. */
  openBrowser?: (url: string) => Promise<void> | void;
  /**
   * Injection point used exclusively by the test harness to drive the
   * loopback flow: receives the prepared authorization URL and may
   * return a pre-baked `(code, state)` pair to short-circuit the real
   * browser dance. Production leaves this undefined.
   */
  simulateAuthorize?: (
    authUrl: string,
  ) => Promise<{ code: string; state: string } | void> | void;
  /** Loopback callback timeout (ms). Tests use a short value. */
  timeoutMs?: number;
}

export interface BrainLoginOptions extends BrainAuthDeps {
  provider?: BrainAuthProvider;
}

export interface BrainLogoutOptions extends BrainAuthDeps {
  provider?: BrainLogoutProvider;
}

export interface BrainStatusOptions extends BrainAuthDeps {
  verbose?: boolean;
}

/* -------------------------------------------------------------------- */
/* mandu brain login                                                    */
/* -------------------------------------------------------------------- */

export async function brainLogin(
  options: BrainLoginOptions = {},
): Promise<boolean> {
  const provider = options.provider ?? "openai";
  if (provider !== "openai" && provider !== "anthropic") {
    (options.error ?? console.error)(
      `Unknown --provider value: "${provider}". Use openai or anthropic.`,
    );
    return false;
  }

  const log = options.log ?? ((m: string) => console.log(m));
  const store = options.credentialStore ?? getCredentialStore();
  const projectRoot = options.projectRoot ?? process.cwd();

  log(`Mandu Brain — ${provider} login`);
  log("-".repeat(40));

  // #235 follow-up — OpenAI login delegates to the official
  // `@openai/codex` CLI. OpenAI owns the OAuth app; we just read the
  // auth.json it writes to `~/.codex/auth.json`. This avoids the
  // chicken-and-egg problem of Mandu needing its own OAuth app
  // registration before anyone can sign in.
  if (provider === "openai" && !options.simulateAuthorize) {
    log("");
    log("Delegating to the OpenAI official Codex CLI for OAuth:");
    log("  $ npx @openai/codex login");
    log("");
    log("A browser window will open for ChatGPT sign-in. After you");
    log("approve, the token lands in ~/.codex/auth.json and Mandu");
    log("reads it automatically (auto-refreshed on expiry).");
    log("");

    try {
      const { spawnSync } = await import("node:child_process");
      const result = spawnSync("npx", ["-y", "@openai/codex", "login"], {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      if (result.status !== 0) {
        (options.error ?? console.error)(
          `\`npx @openai/codex login\` exited with code ${result.status ?? "(signal)"}. ` +
            "Install the CLI manually and re-run this command, or use `mandu brain login --provider=anthropic`.",
        );
        return false;
      }
    } catch (err) {
      (options.error ?? console.error)(
        `Failed to spawn \`npx @openai/codex login\`: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }

    // Verify the auth.json actually showed up.
    const { ChatGPTAuth } = await import("@mandujs/core");
    const auth = new ChatGPTAuth();
    const located = auth.locateAuthFile();
    if (!located) {
      (options.error ?? console.error)(
        "OAuth finished but no auth.json found in ~/.codex or ~/.chatgpt-local. Aborting.",
      );
      return false;
    }
    log("");
    log("Login succeeded.");
    log(`  Provider   : openai (ChatGPT session)`);
    log(`  Auth file  : ${located}`);
    log("  Managed by : @openai/codex (Mandu reads, OpenAI refreshes)");
    log("");
    log("Run `mandu brain status` to confirm the resolver picks this tier.");
    return true;
  }

  // Construct the adapter in strict mode so failures are loud during
  // login (we want to know if the flow aborted without a token).
  const adapter =
    provider === "openai"
      ? new OpenAIOAuthAdapter({
          httpClient: options.httpClient,
          endpoints: options.endpoints,
          credentialStore: store,
          projectRoot,
          strict: true,
          skipConsent: true, // consent is a runtime concept, not a login concept
        })
      : new AnthropicOAuthAdapter({
          httpClient: options.httpClient,
          endpoints: options.endpoints,
          credentialStore: store,
          projectRoot,
          strict: true,
          skipConsent: true,
        });

  let token: StoredToken;
  try {
    token = await adapter.login({
      timeoutMs: options.timeoutMs,
      openBrowser: options.openBrowser,
      onAuthUrl: async (url: string) => {
        log("");
        log("Open this URL in your browser to authorize Mandu Brain:");
        log(`  ${url}`);
        log("");
        log("(A local loopback listener is waiting on 127.0.0.1 for the callback.)");
        // Test-only: drive the loopback directly instead of the browser.
        if (options.simulateAuthorize) {
          const result = await options.simulateAuthorize(url);
          if (result && result.code && result.state) {
            const cb = new URL(url);
            const redirect = cb.searchParams.get("redirect_uri")!;
            const stateQs = new URLSearchParams({
              code: result.code,
              state: result.state,
            });
            // Poke the loopback; any error is caught by the flow promise.
            await fetch(`${redirect}?${stateQs.toString()}`).catch(() => {});
          }
        }
      },
    });
  } catch (err) {
    (options.error ?? console.error)(
      `Login failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  log("");
  log(`Login succeeded.`);
  log(`  Provider   : ${provider}`);
  log(`  Model      : ${token.default_model ?? "(default)"}`);
  log(`  Stored via : ${store.backendName}`);
  if (token.expires_at) {
    log(
      `  Expires at : ${new Date(token.expires_at * 1000).toISOString()}`,
    );
  }
  log("");
  log(
    `Run \`mandu brain status\` to confirm the resolver picks this provider.`,
  );
  return true;
}

/* -------------------------------------------------------------------- */
/* mandu brain logout                                                   */
/* -------------------------------------------------------------------- */

export async function brainLogout(
  options: BrainLogoutOptions = {},
): Promise<boolean> {
  const provider = options.provider ?? "all";
  if (
    provider !== "openai" &&
    provider !== "anthropic" &&
    provider !== "all"
  ) {
    (options.error ?? console.error)(
      `Unknown --provider value: "${provider}". Use openai, anthropic, or all.`,
    );
    return false;
  }

  const log = options.log ?? ((m: string) => console.log(m));
  const store = options.credentialStore ?? getCredentialStore();
  const projectRoot = options.projectRoot ?? process.cwd();

  const targets: BrainAuthProvider[] =
    provider === "all" ? ["openai", "anthropic"] : [provider];

  for (const p of targets) {
    await store.delete(p);
    // Revoke project-scoped consent too — keeps `~/.mandu/brain-consent.json` clean.
    await revokeConsent(p, projectRoot);
    log(`Logged out of ${p}. Token + consent removed.`);
  }
  return true;
}

/* -------------------------------------------------------------------- */
/* mandu brain status — resolver + token visibility                     */
/* -------------------------------------------------------------------- */

export async function brainAuthStatus(
  options: BrainStatusOptions = {},
): Promise<boolean> {
  const log = options.log ?? ((m: string) => console.log(m));
  const store = options.credentialStore ?? getCredentialStore();
  const projectRoot = options.projectRoot ?? process.cwd();

  log("Mandu Brain — adapter resolver status");
  log("-".repeat(40));

  const resolution = await resolveBrainAdapter({
    adapter: "auto",
    credentialStore: store,
    projectRoot,
  });

  log(`Active tier : ${resolution.resolved}`);
  log(`Reason      : ${resolution.reason}`);
  log(`Backend     : ${store.backendName}`);
  log("");

  // OpenAI: prefer ChatGPT session token (codex-managed) over keychain.
  const { ChatGPTAuth } = await import("@mandujs/core");
  const chatgpt = new ChatGPTAuth();
  const chatgptFile = chatgpt.locateAuthFile();

  for (const provider of ["openai", "anthropic"] as const) {
    const token = await store.load(provider);
    if (provider === "openai" && !token && chatgptFile) {
      log(
        `  openai     : logged in (ChatGPT session at ${chatgptFile}, managed by @openai/codex)`,
      );
      continue;
    }
    if (!token) {
      log(`  ${provider.padEnd(10)} : not logged in`);
      continue;
    }
    const expires = token.expires_at
      ? new Date(token.expires_at * 1000).toISOString()
      : "(no expiry)";
    const lastUsed = token.last_used_at ?? "(never)";
    log(
      `  ${provider.padEnd(10)} : logged in (model ${token.default_model ?? "default"}, expires ${expires}, last used ${lastUsed})`,
    );
  }

  log("");
  log(`Fallback file: ${CredentialStore.fallbackPath()}`);
  return true;
}
