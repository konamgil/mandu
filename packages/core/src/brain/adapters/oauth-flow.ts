/**
 * Brain — OAuth 2.0 (authorization code + PKCE) flow primitives
 * shared by every cloud adapter.
 *
 * Design invariants (Issue #235 — Mandu is a CONNECTOR, not an LLM owner):
 *
 *   - No API keys live in Mandu's process memory beyond the refresh
 *     window. Access tokens are written to the OS keychain immediately.
 *   - The loopback listener is ephemeral (Bun.serve on port 0), answers
 *     exactly ONE request, then closes — even on timeout.
 *   - PKCE with S256 is mandatory (RFC 7636). No code_verifier ever
 *     leaves this process.
 *   - `httpClient` and `endpoints` are injectable so tests can exercise
 *     the full flow without touching the real OpenAI / Anthropic
 *     servers.
 *
 * This module deliberately does NOT know about OpenAI or Anthropic
 * specifics. It exports the four primitives each concrete adapter
 * composes: `generatePkcePair`, `openAuthUrl`, `runLoopbackFlow`,
 * `exchangeCodeForToken` + the `refreshToken` helper.
 */

import { createHash, randomBytes } from "node:crypto";

/* -------------------------------------------------------------------- */
/* Types                                                                */
/* -------------------------------------------------------------------- */

export interface OAuthEndpoints {
  /** Full URL of the authorization endpoint (/authorize). */
  authorizationUrl: string;
  /** Full URL of the token endpoint (/token). */
  tokenUrl: string;
}

export interface OAuthClientConfig {
  /** Public OAuth client id registered with the provider. */
  clientId: string;
  /**
   * Space-separated scope string. Each provider documents its own
   * values — the concrete adapter passes the default.
   */
  scope: string;
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  /** Any provider-specific extensions — passed through verbatim. */
  [key: string]: unknown;
}

/**
 * Minimal fetch-like surface. `globalThis.fetch` satisfies this. Tests
 * inject a stub returning a canned `Response`.
 */
export type HttpClient = (input: string, init?: RequestInit) => Promise<Response>;

export interface LoopbackCallbackConfig {
  /** Auto-close timeout in milliseconds. Default 120 000 (2 min). */
  timeoutMs?: number;
  /** Override the browser-open helper — tests supply a no-op. */
  openBrowser?: (url: string) => Promise<void> | void;
}

export interface LoopbackFlowResult {
  /** The `code` query parameter from the redirect. */
  code: string;
  /** The `state` query parameter for CSRF verification. */
  state: string;
  /** The redirect_uri that matched — includes the ephemeral port. */
  redirectUri: string;
}

/* -------------------------------------------------------------------- */
/* PKCE                                                                 */
/* -------------------------------------------------------------------- */

/**
 * Generate a PKCE verifier/challenge pair (S256).
 *
 * Length: 64 random bytes → 43-char base64url challenge, 86-char
 * base64url verifier. Both well within the RFC 7636 bounds (43–128).
 */
export function generatePkcePair(): PkcePair {
  const raw = randomBytes(64);
  const codeVerifier = base64url(raw);
  const codeChallenge = base64url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  return { codeVerifier, codeChallenge };
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Build the authorization URL with PKCE + CSRF state. Concrete adapters
 * pass the endpoint, client config, redirect URI, and PKCE pair.
 */
export function buildAuthorizationUrl(args: {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  pkce: PkcePair;
  state: string;
  /** Extra provider-specific parameters (e.g. `prompt=login`). */
  extra?: Record<string, string>;
}): string {
  const qs = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: args.scope,
    state: args.state,
    code_challenge: args.pkce.codeChallenge,
    code_challenge_method: "S256",
  });
  if (args.extra) {
    for (const [k, v] of Object.entries(args.extra)) qs.set(k, v);
  }
  return `${args.endpoint}?${qs.toString()}`;
}

/* -------------------------------------------------------------------- */
/* Loopback callback listener                                           */
/* -------------------------------------------------------------------- */

/**
 * Run the loopback OAuth callback listener. Starts a `Bun.serve` on
 * an ephemeral port, returns the redirect_uri for the caller to pass
 * to the authorization URL, and resolves with the received `code` +
 * `state` on the first GET.
 *
 * The caller is expected to navigate the user's browser to the
 * authorization URL AFTER this function has started (the returned
 * promise is hot — we already await the first request).
 *
 * The returned `start()` closure yields a record you can use to:
 *   1. `redirectUri` — feed into `buildAuthorizationUrl`.
 *   2. `result` — await for the parsed `code` + `state`.
 *   3. `stop()` — safe-to-call-twice early-abort hook.
 */
export function prepareLoopbackFlow(
  expectedState: string,
  config: LoopbackCallbackConfig = {},
): {
  redirectUri: string;
  result: Promise<LoopbackFlowResult>;
  stop: () => void;
} {
  const timeoutMs = config.timeoutMs ?? 120_000;

  let resolveResult!: (r: LoopbackFlowResult) => void;
  let rejectResult!: (e: Error) => void;
  const result = new Promise<LoopbackFlowResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  let stopped = false;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      if (stopped) {
        return new Response("closed", { status: 503 });
      }
      const url = new URL(req.url);
      if (url.pathname !== "/callback") {
        return new Response("Mandu OAuth helper — waiting for /callback", {
          status: 404,
        });
      }
      const error = url.searchParams.get("error");
      if (error) {
        rejectResult(
          new Error(
            `OAuth error: ${error} ${url.searchParams.get("error_description") ?? ""}`,
          ),
        );
        queueMicrotask(() => stop());
        return htmlResponse(
          "OAuth authorization failed — you can close this tab.",
          500,
        );
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        rejectResult(new Error("OAuth callback missing code/state"));
        queueMicrotask(() => stop());
        return htmlResponse("Missing code/state — you can close this tab.", 400);
      }
      if (state !== expectedState) {
        rejectResult(new Error("OAuth state mismatch (possible CSRF)"));
        queueMicrotask(() => stop());
        return htmlResponse("State mismatch — aborted.", 400);
      }
      resolveResult({ code, state, redirectUri });
      queueMicrotask(() => stop());
      return htmlResponse(
        "Mandu Brain — login succeeded. You can close this tab.",
        200,
      );
    },
  });

  const port = server.port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const timer = setTimeout(() => {
    if (stopped) return;
    rejectResult(new Error(`OAuth callback timed out after ${timeoutMs}ms`));
    stop();
  }, timeoutMs);
  // Keep the timer from pinning the event loop past the resolved promise.
  timer.unref?.();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    try {
      server.stop(true);
    } catch {
      /* best-effort */
    }
  }

  return { redirectUri, result, stop };
}

function htmlResponse(body: string, status: number): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Mandu Brain</title>` +
      `<body style="font-family:sans-serif;padding:2rem;">${body}</body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/* -------------------------------------------------------------------- */
/* Token exchange + refresh                                             */
/* -------------------------------------------------------------------- */

/**
 * Exchange an authorization code for an access + refresh token.
 *
 * Standard RFC 6749 Section 4.1.3 — `application/x-www-form-urlencoded`
 * body, PKCE code_verifier included.
 */
export async function exchangeCodeForToken(args: {
  endpoints: OAuthEndpoints;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  httpClient?: HttpClient;
}): Promise<OAuthTokenResponse> {
  const http = args.httpClient ?? globalThis.fetch.bind(globalThis);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    code_verifier: args.codeVerifier,
  });

  const res = await http(args.endpoints.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `Token exchange failed (${res.status}): ${errBody.slice(0, 256)}`,
    );
  }

  const json = (await res.json()) as OAuthTokenResponse;
  if (!json.access_token) {
    throw new Error("Token exchange response missing access_token");
  }
  return json;
}

/**
 * Refresh an access token. Returns the new token response OR throws if
 * the refresh was rejected (401) — caller should log out + fall back.
 */
export async function refreshAccessToken(args: {
  endpoints: OAuthEndpoints;
  clientId: string;
  refreshToken: string;
  httpClient?: HttpClient;
  scope?: string;
}): Promise<OAuthTokenResponse> {
  const http = args.httpClient ?? globalThis.fetch.bind(globalThis);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
  });
  if (args.scope) body.set("scope", args.scope);

  const res = await http(args.endpoints.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `Token refresh failed (${res.status}): ${errBody.slice(0, 256)}`,
    );
  }

  const json = (await res.json()) as OAuthTokenResponse;
  if (!json.access_token) {
    throw new Error("Token refresh response missing access_token");
  }
  return json;
}

/* -------------------------------------------------------------------- */
/* Browser open — best-effort, never blocking                           */
/* -------------------------------------------------------------------- */

/**
 * Best-effort open the user's default browser at `url`. Never throws —
 * if we cannot spawn, we print the URL so the user can click it.
 */
export async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    // `cmd /c start "" <url>` is the canonical Windows opener.
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: "ignore",
      stderr: "ignore",
    });
    // Detach — we do not wait for the browser to close.
    proc.unref?.();
  } catch {
    // Silent fallthrough — caller is expected to have printed the URL.
  }
}

/**
 * Build + execute the entire authorization code + PKCE flow. Concrete
 * adapters call this to exchange a fresh `OAuthTokenResponse`.
 */
export async function runAuthorizationCodeFlow(args: {
  endpoints: OAuthEndpoints;
  client: OAuthClientConfig;
  /** Extra auth-URL query params (e.g. `prompt=login`). */
  extraAuthParams?: Record<string, string>;
  httpClient?: HttpClient;
  openBrowser?: (url: string) => Promise<void> | void;
  timeoutMs?: number;
  /** Injection point — tests swap in a deterministic state. */
  state?: string;
  /** Injection point — tests provide a canned pair. */
  pkce?: PkcePair;
  /**
   * Callback invoked with the prepared authorization URL before the
   * browser is opened. CLI wraps this to print the URL as a fallback.
   */
  onAuthUrl?: (url: string) => void;
}): Promise<OAuthTokenResponse> {
  const pkce = args.pkce ?? generatePkcePair();
  const state = args.state ?? base64url(randomBytes(16));

  const { redirectUri, result, stop } = prepareLoopbackFlow(state, {
    timeoutMs: args.timeoutMs,
  });

  const authUrl = buildAuthorizationUrl({
    endpoint: args.endpoints.authorizationUrl,
    clientId: args.client.clientId,
    redirectUri,
    scope: args.client.scope,
    pkce,
    state,
    extra: args.extraAuthParams,
  });

  args.onAuthUrl?.(authUrl);
  try {
    await (args.openBrowser ?? openBrowser)(authUrl);

    const callback = await result;
    const token = await exchangeCodeForToken({
      endpoints: args.endpoints,
      clientId: args.client.clientId,
      code: callback.code,
      redirectUri: callback.redirectUri,
      codeVerifier: pkce.codeVerifier,
      httpClient: args.httpClient,
    });
    return token;
  } finally {
    stop();
  }
}
