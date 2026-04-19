/**
 * Unit tests for the Vercel Edge fetch handler.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createServerRegistry,
  clearDefaultRegistry,
  type RoutesManifest,
} from "@mandujs/core";
import {
  createVercelEdgeHandler,
  getVercelEdgeCtx,
} from "../src/vercel";
import {
  installVercelEdgePolyfills,
  _createVercelEdgePolyfillShim,
  _resetPolyfillsForTesting,
} from "../src/vercel/polyfills";

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
    geo: { country: "US", city: "San Francisco" },
    ip: "127.0.0.1",
  };
}

describe("createVercelEdgeHandler", () => {
  beforeEach(() => {
    clearDefaultRegistry();
  });

  afterEach(() => {
    clearDefaultRegistry();
    _resetPolyfillsForTesting();
  });

  it("returns a function with the Vercel Edge fetch signature (request, ctx?) → Response", () => {
    const registry = createServerRegistry();
    registry.registerApiHandler("api/health", async () =>
      Response.json({ ok: true })
    );

    const handler = createVercelEdgeHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    expect(typeof handler).toBe("function");
  });

  it("routes /api/health requests to the registered handler and returns JSON 200", async () => {
    const registry = createServerRegistry();
    registry.registerApiHandler("api/health", async () =>
      Response.json({ runtime: "vercel-edge", status: "ok" })
    );

    const handler = createVercelEdgeHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    const res = await handler(
      new Request("https://example.com/api/health"),
      mockCtx()
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { runtime: string; status: string };
    expect(body.runtime).toBe("vercel-edge");
    expect(body.status).toBe("ok");
  });

  it("exposes the Vercel context through getVercelEdgeCtx during a request", async () => {
    const registry = createServerRegistry();
    let capturedCtx: unknown = null;

    registry.registerApiHandler("api/health", async () => {
      capturedCtx = getVercelEdgeCtx();
      return Response.json({ ok: true });
    });

    const handler = createVercelEdgeHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    const ctx = mockCtx();
    await handler(new Request("https://example.com/api/health"), ctx);

    expect(capturedCtx).toBe(ctx);
  });

  it("works without a context argument (static middleware case)", async () => {
    const registry = createServerRegistry();
    registry.registerApiHandler("api/health", async () =>
      Response.json({ ok: true })
    );

    const handler = createVercelEdgeHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    const res = await handler(new Request("https://example.com/api/health"));
    expect(res.status).toBe(200);
  });

  it("returns 404 for unmatched routes (no file-system fallback)", async () => {
    const registry = createServerRegistry();
    const handler = createVercelEdgeHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    const res = await handler(
      new Request("https://example.com/nowhere"),
      mockCtx()
    );

    expect(res.status).toBe(404);
  });

  it("skips static file serving even when the request matches a /.mandu/client/* path", async () => {
    const registry = createServerRegistry();
    const handler = createVercelEdgeHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    const res = await handler(
      new Request("https://example.com/.mandu/client/runtime.js"),
      mockCtx()
    );

    expect(res.status).toBe(404);
  });

  it("rejects invalid manifests eagerly at construction time", () => {
    expect(() =>
      createVercelEdgeHandler(null as unknown as RoutesManifest, { skipPolyfills: true })
    ).toThrow(/Invalid manifest/);

    expect(() =>
      createVercelEdgeHandler(
        { version: 1, routes: "nope" } as unknown as RoutesManifest,
        { skipPolyfills: true }
      )
    ).toThrow(/routes must be an array/);
  });
});

describe("Bun-only API polyfill shims (Vercel Edge)", () => {
  beforeEach(() => {
    _resetPolyfillsForTesting();
  });

  afterEach(() => {
    _resetPolyfillsForTesting();
  });

  it("produces a throwing shim surface for every Bun-only API we block", () => {
    const shim = _createVercelEdgePolyfillShim() as Record<string, () => unknown>;

    expect(shim.sql).toBeTypeOf("function");
    expect(shim.s3).toBeTypeOf("function");
    expect(shim.cron).toBeTypeOf("function");
    expect(shim.file).toBeTypeOf("function");

    expect(() => shim.sql()).toThrow(/Bun\.sql is not available on Vercel Edge/);
    expect(() => shim.s3()).toThrow(/Bun\.s3 is not available on Vercel Edge/);
    expect(() => shim.cron()).toThrow(/Bun\.cron is not available on Vercel Edge/);

    const password = (shim as unknown as { password: { hash: () => unknown; verify: () => unknown } }).password;
    expect(() => password.hash()).toThrow(/Bun\.password\.hash/);
  });

  it("skips installation when running inside a real Bun host", () => {
    const originalBun = (globalThis as { Bun?: unknown }).Bun;
    expect(originalBun).toBeDefined();

    installVercelEdgePolyfills();

    expect((globalThis as { Bun?: unknown }).Bun).toBe(originalBun);
  });
});

describe("per-request ctx isolation (Vercel Edge)", () => {
  beforeEach(() => {
    clearDefaultRegistry();
  });

  afterEach(() => {
    clearDefaultRegistry();
  });

  it("10 concurrent requests each see only their own ctx", async () => {
    const registry = createServerRegistry();
    registry.registerApiHandler("api/echo", async (req) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      const ctx = getVercelEdgeCtx();
      await new Promise((resolve) => setTimeout(resolve, 1));
      const ip = ctx?.ip ?? null;
      const bodyText = await req.text();
      return Response.json({ seenIp: ip, body: bodyText });
    });

    const handler = createVercelEdgeHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    const inflight: Array<Promise<{ seenIp: string | null; body: string }>> = [];
    for (let i = 0; i < 10; i++) {
      const ctx = { waitUntil: () => {}, ip: `10.0.0.${i}` };
      const req = new Request("https://example.com/api/echo", {
        method: "POST",
        body: `req-${i}`,
      });
      inflight.push(
        handler(req, ctx).then(
          (res) => res.json() as Promise<{ seenIp: string | null; body: string }>
        )
      );
    }
    const results = await Promise.all(inflight);
    for (let i = 0; i < results.length; i++) {
      expect(results[i]?.seenIp).toBe(`10.0.0.${i}`);
      expect(results[i]?.body).toBe(`req-${i}`);
    }
  });
});

describe("Vercel guards — error body scrubbing in production", () => {
  let origErr: typeof console.error;
  beforeEach(() => {
    origErr = console.error;
    console.error = () => {};
  });
  afterEach(() => {
    console.error = origErr;
  });

  it("production mode returns generic 'Internal Server Error' without raw message", async () => {
    const { hintBunOnlyApiError } = await import("../src/vercel/guards");
    const err = new Error("SECRET_LEAK_PATH=/srv/app/.env; token=sk_live_ABC");
    const res = hintBunOnlyApiError(err, { ENVIRONMENT: "production" });

    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: string;
      message: string;
      correlationId: string;
      runtime: string;
    };
    expect(body.error).toBe("InternalServerError");
    expect(body.message).toBe("Internal Server Error");
    expect(body.runtime).toBe("vercel-edge");
    expect(body.correlationId).toBeDefined();
    expect(body.message).not.toContain("SECRET_LEAK_PATH");
  });

  it("honors VERCEL_ENV=production as a production signal", async () => {
    const { hintBunOnlyApiError } = await import("../src/vercel/guards");
    const err = new Error("RAW=/srv/app/.env");
    const res = hintBunOnlyApiError(err, { VERCEL_ENV: "production" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Internal Server Error");
  });

  it("production mode scrubs Bun-API raw message but keeps the generic Vercel hint", async () => {
    const { hintBunOnlyApiError } = await import("../src/vercel/guards");
    const err = new Error(
      "[@mandujs/edge/vercel] Bun.sql is not available on Vercel Edge. " +
        "Internal path: /srv/app/.mandu/generated/server/api-users.ts",
    );
    const res = hintBunOnlyApiError(err, { ENVIRONMENT: "production" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: string;
      message: string;
      hint: string;
      runtime: string;
    };
    expect(body.error).toBe("BunApiUnsupportedOnEdge");
    expect(body.runtime).toBe("vercel-edge");
    expect(body.message).not.toContain("/srv/app/");
    expect(body.hint).toContain("Vercel Edge");
  });

  it("dev mode keeps the raw error message for debugging", async () => {
    const { hintBunOnlyApiError } = await import("../src/vercel/guards");
    const err = new Error("DEV_DEBUG_TOKEN=abc");
    const res = hintBunOnlyApiError(err, {});
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string; runtime: string };
    expect(body.runtime).toBe("vercel-edge");
    expect(body.message).toContain("DEV_DEBUG_TOKEN");
  });
});
