/**
 * Unit tests for the Deno Deploy fetch handler.
 *
 * Uses Bun's test runner against the runtime-neutral handler — we cannot
 * spawn a real Deno process in unit tests (heavy dev dep). Integration
 * tests against `deno run` live in the demo starter.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createServerRegistry,
  clearDefaultRegistry,
  type RoutesManifest,
} from "@mandujs/core";
import {
  createDenoHandler,
  getDenoEnv,
  getDenoInfo,
} from "../src/deno";
import {
  installDenoPolyfills,
  _createDenoPolyfillShim,
  _resetPolyfillsForTesting,
} from "../src/deno/polyfills";

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

function mockInfo() {
  return {
    remoteAddr: { hostname: "127.0.0.1", port: 0, transport: "tcp" },
    deploymentId: "test-deployment",
  };
}

describe("createDenoHandler", () => {
  beforeEach(() => {
    clearDefaultRegistry();
  });

  afterEach(() => {
    clearDefaultRegistry();
    _resetPolyfillsForTesting();
  });

  it("returns a function with the Deno.serve fetch signature", async () => {
    const registry = createServerRegistry();
    registry.registerApiHandler("api/health", async () =>
      Response.json({ ok: true })
    );

    const handler = createDenoHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    expect(typeof handler).toBe("function");
    // Deno.serve accepts (request, info) — info is optional in Mandu's shape.
    expect(handler.length).toBeGreaterThanOrEqual(1);
    expect(handler.length).toBeLessThanOrEqual(2);
  });

  it("routes /api/health requests to the registered handler and returns JSON 200", async () => {
    const registry = createServerRegistry();
    registry.registerApiHandler("api/health", async () =>
      Response.json({ runtime: "deno", status: "ok" })
    );

    const handler = createDenoHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    const res = await handler(
      new Request("https://example.com/api/health"),
      mockInfo()
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { runtime: string; status: string };
    expect(body.runtime).toBe("deno");
    expect(body.status).toBe("ok");
  });

  it("exposes env and info through getDenoEnv/getDenoInfo during a request", async () => {
    const registry = createServerRegistry();
    let capturedEnv: unknown = null;
    let capturedInfo: unknown = null;

    registry.registerApiHandler("api/health", async () => {
      capturedEnv = getDenoEnv();
      capturedInfo = getDenoInfo();
      return Response.json({ ok: true });
    });

    const env = { SECRET_KEY: "abc123", SHARED: "value" };
    const info = mockInfo();
    const handler = createDenoHandler(baseManifest, {
      registry,
      skipPolyfills: true,
      env,
    });

    await handler(new Request("https://example.com/api/health"), info);

    expect(capturedEnv).toEqual(env);
    expect(capturedInfo).toBe(info);
  });

  it("returns 404 for unmatched routes (no file-system fallback)", async () => {
    const registry = createServerRegistry();
    const handler = createDenoHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    const res = await handler(
      new Request("https://example.com/nowhere"),
      mockInfo()
    );

    expect(res.status).toBe(404);
  });

  it("skips static file serving even when the request matches a /.mandu/client/* path", async () => {
    const registry = createServerRegistry();
    const handler = createDenoHandler(baseManifest, {
      registry,
      skipPolyfills: true,
    });

    const res = await handler(
      new Request("https://example.com/.mandu/client/runtime.js"),
      mockInfo()
    );

    expect(res.status).toBe(404);
  });

  it("rejects invalid manifests eagerly at construction time", () => {
    expect(() =>
      createDenoHandler(null as unknown as RoutesManifest, { skipPolyfills: true })
    ).toThrow(/Invalid manifest/);

    expect(() =>
      createDenoHandler(
        { version: 1, routes: "nope" } as unknown as RoutesManifest,
        { skipPolyfills: true }
      )
    ).toThrow(/routes must be an array/);
  });
});

describe("Bun-only API polyfill shims (Deno)", () => {
  beforeEach(() => {
    _resetPolyfillsForTesting();
  });

  afterEach(() => {
    _resetPolyfillsForTesting();
  });

  it("produces a throwing shim surface for every Bun-only API we block", () => {
    const shim = _createDenoPolyfillShim() as Record<string, () => unknown>;

    expect(shim.sql).toBeTypeOf("function");
    expect(shim.s3).toBeTypeOf("function");
    expect(shim.cron).toBeTypeOf("function");
    expect(shim.file).toBeTypeOf("function");

    expect(() => shim.sql()).toThrow(/Bun\.sql is not available on Deno Deploy/);
    expect(() => shim.s3()).toThrow(/Bun\.s3 is not available on Deno Deploy/);
    expect(() => shim.cron()).toThrow(/Bun\.cron is not available on Deno Deploy/);
    expect(() => shim.file()).toThrow(/Bun\.file is not available on Deno Deploy/);

    const password = (shim as unknown as { password: { hash: () => unknown; verify: () => unknown } }).password;
    expect(() => password.hash()).toThrow(/Bun\.password\.hash/);
    expect(() => password.verify()).toThrow(/Bun\.password\.verify/);
  });

  it("skips installation when running inside a real Bun host", () => {
    const originalBun = (globalThis as { Bun?: unknown }).Bun;
    expect(originalBun).toBeDefined();

    installDenoPolyfills();

    expect((globalThis as { Bun?: unknown }).Bun).toBe(originalBun);
  });
});

describe("per-request isolation (Deno)", () => {
  beforeEach(() => {
    clearDefaultRegistry();
  });

  afterEach(() => {
    clearDefaultRegistry();
  });

  it("10 concurrent requests each see only their own env/info when different handlers are constructed per env", async () => {
    // Each handler owns its own captured env (Deno-style — env comes from
    // Deno.env.toObject() once per process). We exercise isolation of the
    // per-request `info` object instead.
    const registry = createServerRegistry();
    registry.registerApiHandler("api/echo", async (req) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      const info = getDenoInfo() as { remoteAddr?: { port?: number } } | undefined;
      await new Promise((resolve) => setTimeout(resolve, 1));
      const bodyText = await req.text();
      return Response.json({
        seenPort: info?.remoteAddr?.port ?? null,
        body: bodyText,
      });
    });

    const handler = createDenoHandler(baseManifest, {
      registry,
      skipPolyfills: true,
      env: { SHARED: "x" },
    });

    const inflight: Array<Promise<{ seenPort: number | null; body: string }>> = [];
    for (let i = 0; i < 10; i++) {
      const info = {
        remoteAddr: { hostname: "127.0.0.1", port: 10000 + i, transport: "tcp" },
      };
      const req = new Request("https://example.com/api/echo", {
        method: "POST",
        body: `req-${i}`,
      });
      inflight.push(
        handler(req, info).then(
          (res) => res.json() as Promise<{ seenPort: number | null; body: string }>
        )
      );
    }
    const results = await Promise.all(inflight);
    for (let i = 0; i < results.length; i++) {
      expect(results[i]?.seenPort).toBe(10000 + i);
      expect(results[i]?.body).toBe(`req-${i}`);
    }
  });
});

describe("Deno guards — error body scrubbing in production", () => {
  let origErr: typeof console.error;
  beforeEach(() => {
    origErr = console.error;
    console.error = () => {};
  });
  afterEach(() => {
    console.error = origErr;
  });

  it("production mode returns generic 'Internal Server Error' without raw message", async () => {
    const { hintBunOnlyApiError } = await import("../src/deno/guards");
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
    expect(body.runtime).toBe("deno");
    expect(body.correlationId).toBeDefined();
    expect(body.message).not.toContain("SECRET_LEAK_PATH");
  });

  it("production mode scrubs Bun-API raw message but keeps the generic Deno hint", async () => {
    const { hintBunOnlyApiError } = await import("../src/deno/guards");
    const err = new Error(
      "[@mandujs/edge/deno] Bun.sql is not available on Deno Deploy. " +
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
    expect(body.runtime).toBe("deno");
    expect(body.message).not.toContain("/srv/app/");
    expect(body.hint).toContain("Deno Deploy");
  });

  it("dev mode keeps the raw error message for debugging", async () => {
    const { hintBunOnlyApiError } = await import("../src/deno/guards");
    const err = new Error("DEV_DEBUG_TOKEN=abc");
    const res = hintBunOnlyApiError(err, {});
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string; runtime: string };
    expect(body.runtime).toBe("deno");
    expect(body.message).toContain("DEV_DEBUG_TOKEN");
  });
});
