/**
 * Tests for `packages/core/src/brain/adapters/openai-oauth.ts`.
 *
 * The adapter is fully isolatable via its options surface:
 *   - `credentialStore` — in-memory fixture (no keychain calls).
 *   - `httpClient`      — stubbed fetch (no network).
 *   - `endpoints`       — fake OAuth endpoints.
 *   - `skipConsent`     — bypass the interactive consent prompt.
 *   - `projectRoot`     — per-test tmpdir so redaction audit log is
 *                         sandboxed.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  OpenAIOAuthAdapter,
  OPENAI_DEFAULT_MODEL,
} from "../openai-oauth";
import {
  makeMemoryStore,
  makeStubHttpClient,
  FAKE_ENDPOINTS,
  jsonResponse,
} from "./_helpers";
import type { StoredToken } from "../../credentials";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-openai-adapter-"));
});

function seedToken(): StoredToken {
  return {
    access_token: "seed-access",
    refresh_token: "seed-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    default_model: OPENAI_DEFAULT_MODEL,
    provider: "openai",
  };
}

describe("OpenAIOAuthAdapter — shape + defaults", () => {
  it("reports default model gpt-4o-mini and adapter name openai-oauth", async () => {
    const store = makeMemoryStore({ openai: seedToken() });
    const adapter = new OpenAIOAuthAdapter({
      credentialStore: store,
      projectRoot: tmp,
      endpoints: FAKE_ENDPOINTS,
      httpClient: makeStubHttpClient(() => new Response("ok")),
      skipConsent: true,
    });
    expect(adapter.name).toBe("openai-oauth");
    expect(adapter.model).toBe(OPENAI_DEFAULT_MODEL);
    const status = await adapter.checkStatus();
    expect(status.available).toBe(true);
    expect(status.model).toBe(OPENAI_DEFAULT_MODEL);
  });
});

describe("OpenAIOAuthAdapter — redaction invariant", () => {
  it("never transmits detected secrets in the chat body and writes an audit entry", async () => {
    const store = makeMemoryStore({ openai: seedToken() });
    let captured = "";
    const http = makeStubHttpClient((_url, init) => {
      captured = (init?.body as string) ?? "";
      return jsonResponse({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      });
    });

    const adapter = new OpenAIOAuthAdapter({
      credentialStore: store,
      projectRoot: tmp,
      endpoints: FAKE_ENDPOINTS,
      httpClient: http,
      skipConsent: true,
    });

    const secret = "sk-proj-SECRET1234567890ABCDEFGH";
    const res = await adapter.complete([
      { role: "user", content: `Analyze this: key=${secret}` },
    ]);

    expect(res.content).toBe("ok");
    expect(captured).not.toContain(secret);
    expect(captured).toContain("[[REDACTED:");

    const auditPath = path.join(tmp, ".mandu", "brain-redactions.jsonl");
    const auditContents = await fs.readFile(auditPath, "utf8");
    expect(auditContents).toContain("openai");
    expect(auditContents).not.toContain(secret);
  });
});

describe("OpenAIOAuthAdapter — 401 fallback chain", () => {
  it("attempts silent refresh once, then returns empty and scrubs the token on persistent 401", async () => {
    const store = makeMemoryStore({ openai: seedToken() });
    let calls = 0;
    const http = makeStubHttpClient((url) => {
      calls += 1;
      if (url === FAKE_ENDPOINTS.tokenUrl) {
        // Refresh endpoint — hand back a new access_token.
        return jsonResponse({
          access_token: "refreshed-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
        });
      }
      // Chat endpoint — always 401.
      return new Response("unauthorized", { status: 401 });
    });

    const adapter = new OpenAIOAuthAdapter({
      credentialStore: store,
      projectRoot: tmp,
      endpoints: FAKE_ENDPOINTS,
      httpClient: http,
      skipConsent: true,
    });

    const res = await adapter.complete([{ role: "user", content: "ping" }]);
    expect(res.content).toBe("");
    // Expect 3 calls: chat(401) → refresh(200) → chat(401) → scrub.
    expect(calls).toBe(3);
    expect(await store.load("openai")).toBeNull();
  });
});

describe("OpenAIOAuthAdapter — no-token → empty completion (not strict)", () => {
  it("returns empty completion when no token is stored and strict=false", async () => {
    const store = makeMemoryStore();
    const adapter = new OpenAIOAuthAdapter({
      credentialStore: store,
      projectRoot: tmp,
      endpoints: FAKE_ENDPOINTS,
      httpClient: makeStubHttpClient(() =>
        jsonResponse({
          choices: [{ message: { content: "should-not-run" } }],
        }),
      ),
      skipConsent: true,
    });
    const res = await adapter.complete([{ role: "user", content: "hi" }]);
    expect(res.content).toBe("");
    expect(res.usage?.totalTokens).toBe(0);
    const status = await adapter.checkStatus();
    expect(status.available).toBe(false);
  });
});

describe("OpenAIOAuthAdapter — consent decline short-circuits transmission", () => {
  it("returns empty completion and never dispatches the chat call when consent is declined", async () => {
    const store = makeMemoryStore({ openai: seedToken() });
    let dispatched = false;
    const http = makeStubHttpClient(() => {
      dispatched = true;
      return jsonResponse({ choices: [{ message: { content: "x" } }] });
    });
    const adapter = new OpenAIOAuthAdapter({
      credentialStore: store,
      projectRoot: tmp,
      endpoints: FAKE_ENDPOINTS,
      httpClient: http,
      consentDeps: {
        ask: async () => "n",
        write: () => {},
        env: {} as NodeJS.ProcessEnv,
      },
    });
    const res = await adapter.complete([{ role: "user", content: "hi" }]);
    expect(res.content).toBe("");
    expect(dispatched).toBe(false);
  });
});

describe("OpenAIOAuthAdapter — model override flows through to the wire body", () => {
  it("uses the configured model in the request payload", async () => {
    const store = makeMemoryStore({ openai: seedToken() });
    let capturedBody = "";
    const http = makeStubHttpClient((_url, init) => {
      capturedBody = (init?.body as string) ?? "";
      return jsonResponse({
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    });
    const adapter = new OpenAIOAuthAdapter({
      credentialStore: store,
      projectRoot: tmp,
      endpoints: FAKE_ENDPOINTS,
      httpClient: http,
      skipConsent: true,
      model: "gpt-4o",
    });
    await adapter.complete([{ role: "user", content: "hello" }]);
    expect(capturedBody).toContain('"model":"gpt-4o"');
  });
});
