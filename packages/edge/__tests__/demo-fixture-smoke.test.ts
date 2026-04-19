/**
 * Demo fixture smoke test.
 *
 * Verifies that `createWorkersHandler` can serve a realistic SSR page +
 * API route combination without going through the CLI build pipeline.
 * This exercises the full Mandu runtime (router, filling, SSR) against
 * the Workers adapter — the only thing we don't exercise here is the
 * `Bun.build` bundling step, which runs as part of the CLI build test.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import React from "react";
import {
  createServerRegistry,
  Mandu,
  type RoutesManifest,
} from "@mandujs/core";
import { createWorkersHandler } from "../src/workers";

function mockCtx() {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  };
}

const demoManifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "api/health",
      pattern: "/api/health",
      kind: "api",
      module: "app/api/health/route.ts",
      methods: ["GET"],
    },
    {
      id: "index",
      pattern: "/",
      kind: "page",
      module: "app/page.tsx",
      componentModule: "app/page.tsx",
    },
  ],
};

describe("demo fixture — Workers handler end-to-end", () => {
  let registry: ReturnType<typeof createServerRegistry>;

  beforeEach(() => {
    registry = createServerRegistry();

    // API: /api/health
    const healthFilling = Mandu.filling().get((ctx) =>
      ctx.ok({
        runtime: "workers",
        status: "ok",
        timestamp: "2026-04-18T00:00:00.000Z",
      })
    );
    registry.registerApiHandler("api/health", async (req, params) =>
      healthFilling.handle(req, params)
    );

    // Page: / (pure SSR, no filling)
    registry.registerPageLoader("index", async () => ({
      default: function HomePage() {
        return React.createElement(
          "main",
          null,
          React.createElement("h1", null, "Hello Workers!"),
          React.createElement("p", null, "Mandu SSR on Cloudflare Workers")
        );
      },
    }));
  });

  afterEach(() => {
    registry.clear();
  });

  it("serves the SSR'd home page with a 200 and HTML body", async () => {
    const handler = createWorkersHandler(demoManifest, {
      registry,
      skipPolyfills: true,
    });

    const res = await handler(new Request("https://example.com/"), {}, mockCtx());
    expect(res.status).toBe(200);

    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toMatch(/text\/html/);

    const html = await res.text();
    expect(html).toContain("Hello Workers!");
    expect(html).toContain("Mandu SSR on Cloudflare Workers");
  });

  it("serves /api/health as JSON with the expected payload", async () => {
    const handler = createWorkersHandler(demoManifest, {
      registry,
      skipPolyfills: true,
    });

    const res = await handler(
      new Request("https://example.com/api/health"),
      { MY_SECRET: "hidden" },
      mockCtx()
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.runtime).toBe("workers");
    expect(body.status).toBe("ok");
  });

  it("returns 405 for unsupported methods on an API route", async () => {
    const handler = createWorkersHandler(demoManifest, {
      registry,
      skipPolyfills: true,
    });

    const res = await handler(
      new Request("https://example.com/api/health", { method: "DELETE" }),
      {},
      mockCtx()
    );
    expect(res.status).toBe(405);
  });
});
