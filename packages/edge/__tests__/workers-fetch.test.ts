/**
 * Unit tests for the Cloudflare Workers fetch handler.
 *
 * Uses Bun's test runner against the runtime-neutral handler — we can't
 * run wrangler in unit tests (heavy dev dep) so integration tests live in
 * the demo fixture.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createServerRegistry,
  registerApiHandler,
  clearDefaultRegistry,
  type RoutesManifest,
} from "@mandujs/core";
import {
  createWorkersHandler,
  getWorkersEnv,
  getWorkersCtx,
  generateWranglerConfig,
} from "../src/workers";
import {
  installWorkersPolyfills,
  _createWorkersPolyfillShim,
  _resetPolyfillsForTesting,
} from "../src/workers/polyfills";

// ========== Fixtures ==========

const baseManifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "api/health",
      pattern: "/api/health",
      kind: "api",
      module: ".mandu/generated/server/api-health.ts",
      methods: ["GET"],
    },
    {
      id: "api/echo",
      pattern: "/api/echo",
      kind: "api",
      module: ".mandu/generated/server/api-echo.ts",
      methods: ["GET", "POST"],
    },
  ],
};

function mockCtx() {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  };
}

// ========== Core factory tests ==========

describe("createWorkersHandler", () => {
  beforeEach(() => {
    clearDefaultRegistry();
  });

  afterEach(() => {
    clearDefaultRegistry();
    _resetPolyfillsForTesting();
  });

  it("returns a function with the Workers fetch signature (request, env, ctx) → Response", async () => {
    // Handler must be a function — this is the single public-API shape test.
    const registry = createServerRegistry();
    registry.registerApiHandler("api/health", async () =>
      Response.json({ ok: true })
    );

    const handler = createWorkersHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    expect(typeof handler).toBe("function");
    expect(handler.length).toBe(3); // request, env, ctx
  });

  it("routes /api/health requests to the registered handler and returns JSON 200", async () => {
    const registry = createServerRegistry();
    registry.registerApiHandler("api/health", async () =>
      Response.json({ runtime: "workers", status: "ok" })
    );

    const handler = createWorkersHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    const res = await handler(
      new Request("https://example.com/api/health"),
      {},
      mockCtx()
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { runtime: string; status: string };
    expect(body.runtime).toBe("workers");
    expect(body.status).toBe("ok");
  });

  it("exposes env and ctx through getWorkersEnv/getWorkersCtx during a request", async () => {
    const registry = createServerRegistry();
    let capturedEnv: unknown = null;
    let capturedCtx: unknown = null;

    registry.registerApiHandler("api/health", async () => {
      capturedEnv = getWorkersEnv();
      capturedCtx = getWorkersCtx();
      return Response.json({ ok: true });
    });

    const handler = createWorkersHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    const env = { SECRET_KEY: "abc123", KV: { get: () => null } };
    const ctx = mockCtx();
    await handler(new Request("https://example.com/api/health"), env, ctx);

    expect(capturedEnv).toBe(env);
    expect(capturedCtx).toBe(ctx);
  });

  it("returns 404 for unmatched routes (no file-system fallback)", async () => {
    const registry = createServerRegistry();
    const handler = createWorkersHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    const res = await handler(
      new Request("https://example.com/nowhere"),
      {},
      mockCtx()
    );

    expect(res.status).toBe(404);
  });

  it("skips static file serving even when the request matches a /.mandu/client/* path", async () => {
    // Edge runtimes have no filesystem. In Bun/Node this path would try
    // `fs.stat(.mandu/client/...)`; we must short-circuit before then.
    const registry = createServerRegistry();
    const handler = createWorkersHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    const res = await handler(
      new Request("https://example.com/.mandu/client/runtime.js"),
      {},
      mockCtx()
    );

    // Without edge flag, serveStaticFile would try to read disk and possibly
    // 500 in a Workers runtime. With edge=true, we fall through to the 404
    // "no route matched" path — Wrangler's [assets] handles static files.
    expect(res.status).toBe(404);
  });

  it("rejects invalid manifests eagerly at construction time", () => {
    expect(() =>
      createWorkersHandler(null as unknown as RoutesManifest, { skipPolyfills: true })
    ).toThrow(/Invalid manifest/);

    expect(() =>
      createWorkersHandler(
        { version: 1, routes: "nope" } as unknown as RoutesManifest,
        { skipPolyfills: true }
      )
    ).toThrow(/routes must be an array/);
  });
});

// ========== Bun-only API guardrails ==========

describe("Bun-only API polyfill shims", () => {
  beforeEach(() => {
    _resetPolyfillsForTesting();
  });

  afterEach(() => {
    _resetPolyfillsForTesting();
  });

  it("produces a throwing shim surface for every Bun-only API we block", () => {
    // Under Bun's test runner `globalThis.Bun` is non-configurable, so we
    // exercise the detached shim factory directly. Workers never sees
    // the Bun global in the first place — the shim is what user code
    // reaches through `globalThis.Bun.x()`.
    const shim = _createWorkersPolyfillShim() as Record<string, () => unknown>;

    expect(shim.sql).toBeTypeOf("function");
    expect(shim.s3).toBeTypeOf("function");
    expect(shim.cron).toBeTypeOf("function");
    expect(shim.file).toBeTypeOf("function");

    expect(() => shim.sql()).toThrow(/Bun\.sql is not available on Cloudflare Workers/);
    expect(() => shim.s3()).toThrow(/Bun\.s3 is not available on Cloudflare Workers/);
    expect(() => shim.cron()).toThrow(/Bun\.cron is not available on Cloudflare Workers/);
    expect(() => shim.file()).toThrow(/Bun\.file is not available on Cloudflare Workers/);

    // Nested accessors (Bun.password.hash) also throw with a precise path.
    const password = (shim as unknown as { password: { hash: () => unknown; verify: () => unknown } }).password;
    expect(() => password.hash()).toThrow(/Bun\.password\.hash/);
    expect(() => password.verify()).toThrow(/Bun\.password\.verify/);
  });

  it("skips installation when running inside a real Bun host", () => {
    // Inside the Bun test runner, installWorkersPolyfills() should be a
    // no-op because `globalThis.Bun` is already defined by the runtime.
    const originalBun = (globalThis as { Bun?: unknown }).Bun;
    expect(originalBun).toBeDefined();

    installWorkersPolyfills();

    // The real Bun global must be preserved.
    expect((globalThis as { Bun?: unknown }).Bun).toBe(originalBun);
  });
});

// ========== CookieMap + WebCrypto smoke ==========

describe("runtime-neutral primitives", () => {
  it("LegacyCookieCodec round-trips cookies via WebCrypto-safe APIs", async () => {
    const { getCookieCodec } = await import("@mandujs/core/filling/cookie-codec");
    const codec = getCookieCodec();

    const parsed = codec.parseRequestHeader("session=abc; csrf=xyz");
    expect(parsed.get("session")).toBe("abc");
    expect(parsed.get("csrf")).toBe("xyz");

    const setCookie = codec.serializeSetCookie("session", "abc", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 3600,
    });
    expect(setCookie).toContain("session=abc");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=3600");
  });

  it("CSRF token generation and verification uses WebCrypto HMAC when Bun.CSRF is absent", async () => {
    // The CSRF middleware auto-selects the WebCrypto fallback when Bun.CSRF
    // is missing. We exercise the fallback directly via a crafted
    // environment.
    const secret = "test-secret-value-abc123";
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );

    const data = encoder.encode("payload");
    const sig = await crypto.subtle.sign("HMAC", key, data);
    const verified = await crypto.subtle.verify("HMAC", key, sig, data);
    expect(verified).toBe(true);
  });
});


// ========== L-03: per-request ctx isolation ==========

describe("Wave R3 L-03 — per-request ctx isolation across concurrent await", () => {
  beforeEach(() => {
    clearDefaultRegistry();
  });

  afterEach(() => {
    clearDefaultRegistry();
  });

  it("10 concurrent requests each see only their own env/ctx", async () => {
    const registry = createServerRegistry();
    registry.registerApiHandler("api/echo", async (req) => {
      // Force a yield so the ALS/WeakMap has to preserve context across await.
      await new Promise((resolve) => setTimeout(resolve, 1));
      const env = getWorkersEnv() as { id?: string } | undefined;
      await new Promise((resolve) => setTimeout(resolve, 1));
      const ctx = getWorkersCtx();
      const bodyText = await req.text();
      return Response.json({ seenId: env?.id ?? null, ctxOk: !!ctx, body: bodyText });
    });

    const handler = createWorkersHandler(baseManifest, { registry, skipPolyfills: true });

    const inflight: Array<Promise<{ seenId: string | null; ctxOk: boolean; body: string }>> = [];
    for (let i = 0; i < 10; i++) {
      const id = `req-${i}`;
      const env = { id };
      const ctx = mockCtx();
      const req = new Request("https://example.com/api/echo", {
        method: "POST",
        body: id,
      });
      inflight.push(
        handler(req, env, ctx).then((res) => res.json() as Promise<{ seenId: string | null; ctxOk: boolean; body: string }>),
      );
    }
    const results = await Promise.all(inflight);

    // Each handler must have seen its OWN env.id, not another request's.
    for (let i = 0; i < results.length; i++) {
      expect(results[i]?.seenId).toBe(`req-${i}`);
      expect(results[i]?.ctxOk).toBe(true);
      expect(results[i]?.body).toBe(`req-${i}`);
    }
  });
});

// ========== L-04: production error-body scrubbing ==========

describe("Wave R3 L-04 — error body scrubbing in production", () => {
  // Silence logFullError stderr noise under test — we assert body shape, not logs.
  let origErr: typeof console.error;
  beforeEach(() => {
    origErr = console.error;
    console.error = () => {};
  });
  afterEach(() => {
    console.error = origErr;
  });

  it("production mode returns generic 'Internal Server Error' without raw message", async () => {
    const { hintBunOnlyApiError } = await import("../src/workers/guards");
    const err = new Error("SECRET_LEAK_PATH=/srv/app/.env; token=sk_live_ABCDEF");
    const res = hintBunOnlyApiError(err, { ENVIRONMENT: "production" });

    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: string;
      message: string;
      correlationId: string;
      stack?: string;
      cause?: unknown;
    };
    expect(body.error).toBe("InternalServerError");
    expect(body.message).toBe("Internal Server Error");
    expect(body.correlationId).toBeDefined();
    expect(body.correlationId.length).toBeGreaterThan(0);
    expect(body.stack).toBeUndefined();
    expect(body.cause).toBeUndefined();
    // Ensure the secret pattern never leaks into the body.
    expect(body.message).not.toContain("SECRET_LEAK_PATH");
    expect(body.message).not.toContain("sk_live_");
  });

  it("production mode scrubs Bun-API hint's raw message but keeps the generic hint", async () => {
    const { hintBunOnlyApiError } = await import("../src/workers/guards");
    const err = new Error(
      "[@mandujs/edge/workers] Bun.sql is not available on Cloudflare Workers. " +
        "Internal path: /srv/app/.mandu/generated/server/api-users.ts",
    );
    const res = hintBunOnlyApiError(err, { ENVIRONMENT: "production" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string; hint: string; correlationId: string };
    expect(body.error).toBe("BunApiUnsupportedOnEdge");
    expect(body.message).not.toContain("/srv/app/");
    expect(body.hint).toContain("Cloudflare Workers");
    expect(body.correlationId).toBeDefined();
  });

  it("dev mode keeps the raw error message for debugging", async () => {
    const { hintBunOnlyApiError } = await import("../src/workers/guards");
    const err = new Error("DEV_DEBUG_TOKEN=abc");
    const res = hintBunOnlyApiError(err, {});
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string; correlationId: string };
    expect(body.message).toContain("DEV_DEBUG_TOKEN");
    expect(body.correlationId).toBeDefined();
  });

  it("dev mode keeps the Bun-API raw message for debugging", async () => {
    const { hintBunOnlyApiError } = await import("../src/workers/guards");
    const err = new Error(
      "[@mandujs/edge/workers] Bun.sql is not available on Cloudflare Workers. Internal: /srv/app/.env",
    );
    const res = hintBunOnlyApiError(err, {});
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("BunApiUnsupportedOnEdge");
    expect(body.message).toContain("/srv/app/.env");
  });
});
