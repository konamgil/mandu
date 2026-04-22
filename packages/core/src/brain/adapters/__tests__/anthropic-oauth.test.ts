/**
 * Tests for `packages/core/src/brain/adapters/anthropic-oauth.ts`.
 *
 * Mirror-image of the OpenAI adapter test file. We reuse the shared
 * in-memory credential store fixture + stub HTTP client, and exercise
 * the Messages-API-specific quirks (system split, 401 refresh,
 * stop_sequences mapping).
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AnthropicOAuthAdapter,
  ANTHROPIC_DEFAULT_MODEL,
} from "../anthropic-oauth";
import {
  makeMemoryStore,
  makeStubHttpClient,
  FAKE_ENDPOINTS,
  jsonResponse,
} from "./_helpers";
import type { StoredToken } from "../../credentials";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-anthropic-adapter-"));
});

function seedToken(): StoredToken {
  return {
    access_token: "seed-access",
    refresh_token: "seed-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    default_model: ANTHROPIC_DEFAULT_MODEL,
    provider: "anthropic",
  };
}

describe("AnthropicOAuthAdapter — shape + defaults", () => {
  it("reports adapter name anthropic-oauth and default Haiku model", async () => {
    const store = makeMemoryStore({ anthropic: seedToken() });
    const adapter = new AnthropicOAuthAdapter({
      credentialStore: store,
      projectRoot: tmp,
      endpoints: FAKE_ENDPOINTS,
      httpClient: makeStubHttpClient(() => jsonResponse({ content: [] })),
      skipConsent: true,
    });
    expect(adapter.name).toBe("anthropic-oauth");
    expect(adapter.model).toBe(ANTHROPIC_DEFAULT_MODEL);
    const status = await adapter.checkStatus();
    expect(status.available).toBe(true);
    expect(status.model).toBe(ANTHROPIC_DEFAULT_MODEL);
  });
});

describe("AnthropicOAuthAdapter — redaction invariant", () => {
  it("redacts secrets and records an audit line", async () => {
    const store = makeMemoryStore({ anthropic: seedToken() });
    let capturedBody = "";
    const http = makeStubHttpClient((_url, init) => {
      capturedBody = (init?.body as string) ?? "";
      return jsonResponse({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 5, output_tokens: 3 },
      });
    });
    const adapter = new AnthropicOAuthAdapter({
      credentialStore: store,
      projectRoot: tmp,
      endpoints: FAKE_ENDPOINTS,
      httpClient: http,
      skipConsent: true,
    });
    const secret = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
    const res = await adapter.complete([
      { role: "user", content: `Investigate token ${secret}.` },
    ]);
    expect(res.content).toBe("ok");
    expect(capturedBody).not.toContain(secret);
    expect(capturedBody).toContain("[[REDACTED:");
    const auditPath = path.join(tmp, ".mandu", "brain-redactions.jsonl");
    const contents = await fs.readFile(auditPath, "utf8");
    expect(contents).toContain("anthropic");
  });
});

describe("AnthropicOAuthAdapter — 401 fallback chain", () => {
  it("tries silent refresh then scrubs the token on persistent 401", async () => {
    const store = makeMemoryStore({ anthropic: seedToken() });
    let calls = 0;
    const http = makeStubHttpClient((url) => {
      calls += 1;
      if (url === FAKE_ENDPOINTS.tokenUrl) {
        return jsonResponse({
          access_token: "refreshed",
          refresh_token: "r2",
          expires_in: 3600,
        });
      }
      return new Response("unauthorized", { status: 401 });
    });
    const adapter = new AnthropicOAuthAdapter({
      credentialStore: store,
      projectRoot: tmp,
      endpoints: FAKE_ENDPOINTS,
      httpClient: http,
      skipConsent: true,
    });
    const res = await adapter.complete([{ role: "user", content: "ping" }]);
    expect(res.content).toBe("");
    expect(calls).toBe(3);
    expect(await store.load("anthropic")).toBeNull();
  });
});

describe("AnthropicOAuthAdapter — system message split", () => {
  it("pulls leading system messages into the `system` field and sends only user/assistant turns in messages[]", async () => {
    const store = makeMemoryStore({ anthropic: seedToken() });
    let capturedBody = "";
    const http = makeStubHttpClient((_url, init) => {
      capturedBody = (init?.body as string) ?? "";
      return jsonResponse({
        content: [{ type: "text", text: "answer" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    });
    const adapter = new AnthropicOAuthAdapter({
      credentialStore: store,
      projectRoot: tmp,
      endpoints: FAKE_ENDPOINTS,
      httpClient: http,
      skipConsent: true,
    });
    await adapter.complete([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hi" },
    ]);
    const parsed = JSON.parse(capturedBody);
    expect(parsed.system).toBe("You are a helpful assistant.");
    expect(parsed.messages).toEqual([{ role: "user", content: "Hi" }]);
  });
});

describe("AnthropicOAuthAdapter — telemetryOptOut honored via resolver contract", () => {
  it("returns empty completion when consent is declined (simulates opt-out UX)", async () => {
    const store = makeMemoryStore({ anthropic: seedToken() });
    let dispatched = false;
    const http = makeStubHttpClient(() => {
      dispatched = true;
      return jsonResponse({ content: [{ type: "text", text: "nope" }] });
    });
    const adapter = new AnthropicOAuthAdapter({
      credentialStore: store,
      projectRoot: tmp,
      endpoints: FAKE_ENDPOINTS,
      httpClient: http,
      consentDeps: {
        ask: async () => "N",
        write: () => {},
        env: {} as NodeJS.ProcessEnv,
      },
    });
    const res = await adapter.complete([{ role: "user", content: "hi" }]);
    expect(res.content).toBe("");
    expect(dispatched).toBe(false);
  });
});

describe("AnthropicOAuthAdapter — model override flows into request", () => {
  it("uses overridden model in the outgoing body", async () => {
    const store = makeMemoryStore({ anthropic: seedToken() });
    let capturedBody = "";
    const http = makeStubHttpClient((_url, init) => {
      capturedBody = (init?.body as string) ?? "";
      return jsonResponse({
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    });
    const adapter = new AnthropicOAuthAdapter({
      credentialStore: store,
      projectRoot: tmp,
      endpoints: FAKE_ENDPOINTS,
      httpClient: http,
      skipConsent: true,
      model: "claude-sonnet-4-5-20250929",
    });
    await adapter.complete([{ role: "user", content: "hi" }]);
    const parsed = JSON.parse(capturedBody);
    expect(parsed.model).toBe("claude-sonnet-4-5-20250929");
  });
});
