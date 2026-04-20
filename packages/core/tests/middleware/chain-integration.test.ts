/**
 * Phase 18.ε — end-to-end chain integration through startServer.
 *
 * Verifies:
 *   1. A composed request-level chain is invoked BEFORE route dispatch.
 *   2. Short-circuit from inside the chain bypasses the route handler.
 *   3. Mutations propagate (response headers set by outer middleware
 *      survive onto the final Response).
 *   4. Order is outer-to-inner across the full pipeline.
 *   5. Zero-overhead passthrough when no middleware is configured.
 */
import { describe, it, expect, afterEach } from "bun:test";
import {
  startServer,
  createServerRegistry,
  type ServerRegistry,
  type ManduServer,
} from "../../src/runtime/server";
import { defineMiddleware } from "../../src/middleware/define";
import type { RoutesManifest } from "../../src/spec/schema";

const testManifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "api/echo",
      pattern: "/api/echo",
      kind: "api",
      module: ".mandu/generated/server/api-echo.ts",
      methods: ["GET"],
    },
  ],
} as unknown as RoutesManifest;

function registerEcho(registry: ServerRegistry, onHit?: () => void): void {
  registry.registerApiHandler("api/echo", async (req) => {
    onHit?.();
    return Response.json({ ok: true, url: req.url });
  });
}

describe("Phase 18.ε — integration through startServer", () => {
  let server: ManduServer | null = null;
  afterEach(() => {
    server?.stop();
    server = null;
  });

  it("runs middleware chain BEFORE route dispatch and can short-circuit", async () => {
    const registry = createServerRegistry();
    let handlerHits = 0;
    registerEcho(registry, () => {
      handlerHits++;
    });
    const trace: string[] = [];

    const gate = defineMiddleware({
      name: "gate",
      handler: async () => {
        trace.push("gate");
        return new Response("denied", { status: 403 });
      },
    });

    server = startServer(testManifest, {
      port: 0,
      hostname: "127.0.0.1",
      registry,
      middleware: [gate],
    });

    const res = await fetch(`http://127.0.0.1:${server.server.port}/api/echo`);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("denied");
    // Route handler never ran because gate short-circuited.
    expect(trace).toEqual(["gate"]);
    expect(handlerHits).toBe(0);
  });

  it("outer → inner → dispatch → inner-after → outer-after", async () => {
    const registry = createServerRegistry();
    let handlerHits = 0;
    registerEcho(registry, () => {
      handlerHits++;
    });
    const trace: string[] = [];

    const outer = defineMiddleware({
      name: "outer",
      handler: async (_r, next) => {
        trace.push("outer-before");
        const res = await next();
        trace.push("outer-after");
        const headers = new Headers(res.headers);
        headers.set("x-outer", "1");
        return new Response(res.body, { status: res.status, headers });
      },
    });

    const inner = defineMiddleware({
      name: "inner",
      handler: async (_r, next) => {
        trace.push("inner-before");
        const res = await next();
        trace.push("inner-after");
        return res;
      },
    });

    server = startServer(testManifest, {
      port: 0,
      hostname: "127.0.0.1",
      registry,
      middleware: [outer, inner],
    });

    const res = await fetch(`http://127.0.0.1:${server.server.port}/api/echo`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-outer")).toBe("1");
    expect(handlerHits).toBe(1);
    expect(trace).toEqual([
      "outer-before",
      "inner-before",
      "inner-after",
      "outer-after",
    ]);
  });

  it("skipped middleware (match() === false) does not interrupt dispatch", async () => {
    const registry = createServerRegistry();
    registerEcho(registry);
    let filteredHits = 0;

    const adminOnly = defineMiddleware({
      name: "admin",
      match: (r) => new URL(r.url).pathname.startsWith("/admin"),
      handler: async () => {
        filteredHits++;
        return new Response("admin-only", { status: 401 });
      },
    });

    server = startServer(testManifest, {
      port: 0,
      hostname: "127.0.0.1",
      registry,
      middleware: [adminOnly],
    });

    const res = await fetch(`http://127.0.0.1:${server.server.port}/api/echo`);
    expect(res.status).toBe(200);
    expect(filteredHits).toBe(0);
  });

  it("no middleware configured — zero-overhead passthrough", async () => {
    const registry = createServerRegistry();
    registerEcho(registry);
    server = startServer(testManifest, {
      port: 0,
      hostname: "127.0.0.1",
      registry,
    });
    const res = await fetch(`http://127.0.0.1:${server.server.port}/api/echo`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; url: string };
    expect(body.ok).toBe(true);
  });
});
