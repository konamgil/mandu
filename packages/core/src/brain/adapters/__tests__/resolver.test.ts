/**
 * Tests for `resolveBrainAdapter()` in `adapters/index.ts`.
 *
 * Priority order under `adapter: "auto"`:
 *   1. openai-oauth when token present
 *   2. anthropic-oauth when token present
 *   3. ollama when daemon reachable
 *   4. template otherwise
 *
 * `telemetryOptOut: true` disables every cloud tier.
 */

import { describe, it, expect } from "bun:test";
import { resolveBrainAdapter } from "../index";
import { makeMemoryStore } from "./_helpers";
import type { StoredToken } from "../../credentials";

function openaiToken(): StoredToken {
  return { access_token: "oa", provider: "openai" };
}
function anthropicToken(): StoredToken {
  return { access_token: "an", provider: "anthropic" };
}

describe("resolveBrainAdapter — priority order", () => {
  it("picks openai first when both cloud tokens + ollama are available", async () => {
    const store = makeMemoryStore({
      openai: openaiToken(),
      anthropic: anthropicToken(),
    });
    const res = await resolveBrainAdapter({
      adapter: "auto",
      credentialStore: store,
      probeOllama: async () => true,
      probeChatGPTAuth: () => ({ authenticated: false, path: null }),
    });
    expect(res.resolved).toBe("openai");
    expect(res.adapter.name).toBe("openai-oauth");
  });

  it("falls to anthropic when only anthropic token present", async () => {
    const store = makeMemoryStore({ anthropic: anthropicToken() });
    const res = await resolveBrainAdapter({
      adapter: "auto",
      credentialStore: store,
      probeOllama: async () => true,
      probeChatGPTAuth: () => ({ authenticated: false, path: null }),
    });
    expect(res.resolved).toBe("anthropic");
    expect(res.adapter.name).toBe("anthropic-oauth");
  });

  it("falls to ollama when no cloud tokens but daemon is alive", async () => {
    const store = makeMemoryStore();
    const res = await resolveBrainAdapter({
      adapter: "auto",
      credentialStore: store,
      probeOllama: async () => true,
      probeChatGPTAuth: () => ({ authenticated: false, path: null }),
    });
    expect(res.resolved).toBe("ollama");
    expect(res.adapter.name).toBe("ollama");
  });

  it("falls to template when nothing is reachable", async () => {
    const store = makeMemoryStore();
    const res = await resolveBrainAdapter({
      adapter: "auto",
      credentialStore: store,
      probeOllama: async () => false,
      probeChatGPTAuth: () => ({ authenticated: false, path: null }),
    });
    expect(res.resolved).toBe("template");
    expect(res.adapter.name).toBe("noop");
  });
});

describe("resolveBrainAdapter — telemetryOptOut", () => {
  it("skips cloud tiers even when tokens exist", async () => {
    const store = makeMemoryStore({
      openai: openaiToken(),
      anthropic: anthropicToken(),
    });
    const res = await resolveBrainAdapter({
      adapter: "auto",
      telemetryOptOut: true,
      credentialStore: store,
      probeOllama: async () => true,
    });
    expect(res.resolved).toBe("ollama");
  });

  it("falls to template when telemetryOptOut is true and ollama is down", async () => {
    const store = makeMemoryStore({ openai: openaiToken() });
    const res = await resolveBrainAdapter({
      adapter: "auto",
      telemetryOptOut: true,
      credentialStore: store,
      probeOllama: async () => false,
    });
    expect(res.resolved).toBe("template");
  });
});

describe("resolveBrainAdapter — explicit pins degrade gracefully", () => {
  it("explicit 'openai' without a token degrades to template (does not throw)", async () => {
    const store = makeMemoryStore();
    const res = await resolveBrainAdapter({
      adapter: "openai",
      credentialStore: store,
      probeChatGPTAuth: () => ({ authenticated: false, path: null }),
    });
    expect(res.resolved).toBe("template");
    expect(res.reason).toContain("no token");
  });

  it("explicit 'anthropic' with telemetryOptOut forces template", async () => {
    const store = makeMemoryStore({ anthropic: anthropicToken() });
    const res = await resolveBrainAdapter({
      adapter: "anthropic",
      telemetryOptOut: true,
      credentialStore: store,
    });
    expect(res.resolved).toBe("template");
    expect(res.reason).toContain("telemetryOptOut");
  });
});
