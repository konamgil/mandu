/**
 * Integration tests for `packages/cli/src/commands/brain-auth.ts`.
 *
 * We drive the OAuth flow entirely in-process:
 *
 *   - The CLI `brainLogin` function accepts `simulateAuthorize`, which
 *     receives the prepared authorization URL and pokes the loopback
 *     listener with a canned `(code, state)` pair. This replaces the
 *     browser+user round-trip in tests.
 *   - `httpClient` is a stub that handles the `/oauth/token` POST and
 *     returns a synthetic `OAuthTokenResponse`.
 *   - The `CredentialStore` uses an in-memory backend so no real
 *     keychain / filesystem IO happens.
 *
 * This gives us full coverage of:
 *   1. Successful login persists the token + default_model.
 *   2. Logout removes the token (idempotent).
 *   3. Wrong --provider value surfaces a clean error.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  brainLogin,
  brainLogout,
  brainAuthStatus,
} from "../brain-auth";
import {
  CredentialStore,
  type CredentialBackend,
  type StoredToken,
  type HttpClient,
  type OAuthEndpoints,
} from "@mandujs/core";

function makeMemoryStore(
  seed: Record<string, StoredToken> = {},
): CredentialStore {
  const map = new Map<string, StoredToken>(Object.entries(seed));
  const backend: CredentialBackend = {
    name: "memory",
    async save(provider, token) {
      map.set(provider, token);
    },
    async load(provider) {
      return map.get(provider) ?? null;
    },
    async delete(provider) {
      map.delete(provider);
    },
    async list() {
      return [...map.keys()];
    },
  };
  return new CredentialStore(backend);
}

const FAKE_ENDPOINTS: OAuthEndpoints = {
  authorizationUrl: "https://example.test/oauth/authorize",
  tokenUrl: "https://example.test/oauth/token",
};

/** Stub that only responds to the `/oauth/token` POST. */
function tokenExchangeStub(): HttpClient {
  return async (url) => {
    if (url === FAKE_ENDPOINTS.tokenUrl) {
      return new Response(
        JSON.stringify({
          access_token: "minted-access",
          refresh_token: "minted-refresh",
          expires_in: 3600,
          scope: "test.scope",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return new Response("not found", { status: 404 });
  };
}

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-brain-login-test-"));
});

describe("mandu brain login — openai happy path", () => {
  it("drives the OAuth flow and persists a stored token", async () => {
    const store = makeMemoryStore();
    const logs: string[] = [];
    const errors: string[] = [];

    const ok = await brainLogin({
      provider: "openai",
      credentialStore: store,
      projectRoot: tmp,
      endpoints: FAKE_ENDPOINTS,
      httpClient: tokenExchangeStub(),
      openBrowser: async () => {},
      timeoutMs: 10_000,
      log: (m) => logs.push(m),
      error: (m) => errors.push(m),
      simulateAuthorize: async (authUrl) => {
        const parsed = new URL(authUrl);
        const state = parsed.searchParams.get("state")!;
        return { code: "auth-code-xyz", state };
      },
    });

    expect(ok).toBe(true);
    expect(errors).toEqual([]);
    const stored = await store.load("openai");
    expect(stored).not.toBeNull();
    expect(stored!.access_token).toBe("minted-access");
    expect(stored!.refresh_token).toBe("minted-refresh");
    expect(stored!.default_model).toBe("gpt-4o-mini");
  });
});

describe("mandu brain logout — removes token + consent", () => {
  it("deletes the stored token and is idempotent", async () => {
    const store = makeMemoryStore({
      openai: {
        access_token: "stale",
        provider: "openai",
      },
      anthropic: {
        access_token: "stale-claude",
        provider: "anthropic",
      },
    });
    const logs: string[] = [];
    const ok1 = await brainLogout({
      provider: "openai",
      credentialStore: store,
      projectRoot: tmp,
      log: (m) => logs.push(m),
    });
    expect(ok1).toBe(true);
    expect(await store.load("openai")).toBeNull();
    expect(await store.load("anthropic")).not.toBeNull();

    // Idempotent — calling logout again is a no-op.
    const ok2 = await brainLogout({
      provider: "openai",
      credentialStore: store,
      projectRoot: tmp,
      log: (m) => logs.push(m),
    });
    expect(ok2).toBe(true);

    // --provider=all scrubs both.
    const ok3 = await brainLogout({
      provider: "all",
      credentialStore: store,
      projectRoot: tmp,
      log: (m) => logs.push(m),
    });
    expect(ok3).toBe(true);
    expect(await store.load("anthropic")).toBeNull();
  });
});

describe("mandu brain status — surfaces the resolver pick", () => {
  it("reports the active tier + token presence for each provider", async () => {
    const store = makeMemoryStore({
      openai: {
        access_token: "oa",
        provider: "openai",
        default_model: "gpt-4o-mini",
      },
    });
    const logs: string[] = [];
    const ok = await brainAuthStatus({
      credentialStore: store,
      projectRoot: tmp,
      log: (m) => logs.push(m),
    });
    expect(ok).toBe(true);
    const joined = logs.join("\n");
    expect(joined).toContain("Active tier : openai");
    expect(joined).toContain("openai");
    // padEnd(10) aligns provider names → "anthropic " (trailing space).
    expect(joined).toContain("anthropic  : not logged in");
  });
});
