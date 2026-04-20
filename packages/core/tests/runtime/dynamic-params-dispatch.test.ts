/**
 * Issue #214 — runtime dispatch guard tests.
 *
 * Drives `startServer` + the real HTTP path to confirm that:
 *   - `dynamicParams: false` + known param      → 200 (page renders)
 *   - `dynamicParams: false` + unknown param    → 404 (guard trips)
 *   - `dynamicParams: false` + empty staticParams → every URL → 404
 *   - `dynamicParams: true`  / undefined        → 200 (SSR fallback unchanged)
 *   - Route-level `not-found.tsx` (via notFoundHandler) is honored
 *   - Nested dynamic (`/[lang]/[slug]`) — only declared pairs render
 *   - Catch-all (`/docs/:slug*`) — joined path must match
 *   - API routes are NEVER gated (dynamicParams is page-only)
 *   - Loader is NOT invoked when the guard trips (no side effects)
 *
 * Mirror shape of `tests/server/not-found-page.test.ts`: one server per test,
 * ephemeral port, clean registry in beforeEach/afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  startServer,
  createServerRegistry,
  clearDefaultRegistry,
  type ManduServer,
  type ServerRegistry,
} from "../../src/runtime/server";
import { ManduFilling } from "../../src/filling/filling";
import type { RoutesManifest, RouteSpec } from "../../src/spec/schema";
import React from "react";

// ---------- Fixtures ----------

function LangPage({
  params,
  loaderData,
}: {
  params?: { lang?: string };
  loaderData?: unknown;
}) {
  return React.createElement(
    "div",
    { id: "lang-page" },
    `hello from ${params?.lang ?? "??"} with ${JSON.stringify(loaderData)}`
  );
}

function NotFoundComponent({ loaderData }: { loaderData?: unknown }) {
  const data = (loaderData ?? {}) as { message?: string };
  return React.createElement(
    "main",
    { id: "mandu-not-found" },
    React.createElement("h1", null, "404 — Not Found"),
    React.createElement(
      "p",
      { id: "not-found-message" },
      data.message ?? "missing"
    )
  );
}

function buildManifest(route: { id: string; pattern: string; [key: string]: unknown }): RoutesManifest {
  return {
    version: 1,
    routes: [
      {
        kind: "page",
        module: `.mandu/generated/server/${route.id}.ts`,
        componentModule: "app/page.tsx",
        ...route,
      } as unknown as RouteSpec,
    ],
  };
}

// ---------- Suite ----------

describe("Issue #214 — runtime dynamicParams guard", () => {
  let server: ManduServer | null = null;
  let registry: ServerRegistry;

  beforeEach(() => {
    registry = createServerRegistry();
  });

  afterEach(() => {
    if (server) {
      server.stop();
      server = null;
    }
    clearDefaultRegistry();
  });

  it("dynamicParams=false + known param → 200 (page renders)", async () => {
    const manifest = buildManifest({
      id: "page-lang",
      pattern: "/:lang",
      dynamicParams: false,
      staticParams: [{ lang: "en" }, { lang: "ko" }],
    } as unknown as RouteSpec);

    const filling = new ManduFilling();
    filling.loader(() => ({ hi: "there" }));
    registry.registerPageHandler("page-lang", async () => ({
      component: LangPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/en`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("lang-page");
    expect(body).toContain("hello from en");
  });

  it("dynamicParams=false + unknown param → 404 (guard trips)", async () => {
    const manifest = buildManifest({
      id: "page-lang",
      pattern: "/:lang",
      dynamicParams: false,
      staticParams: [{ lang: "en" }, { lang: "ko" }],
    } as unknown as RouteSpec);

    const filling = new ManduFilling();
    filling.loader(() => ({ hi: "there" }));
    registry.registerPageHandler("page-lang", async () => ({
      component: LangPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/path`);
    expect(res.status).toBe(404);
  });

  it("dynamicParams=false + unknown param + notFoundHandler → custom 404 HTML", async () => {
    const manifest = buildManifest({
      id: "page-lang",
      pattern: "/:lang",
      dynamicParams: false,
      staticParams: [{ lang: "en" }],
    } as unknown as RouteSpec);

    const filling = new ManduFilling();
    filling.loader(() => ({ hi: "there" }));
    registry.registerPageHandler("page-lang", async () => ({
      component: LangPage,
      filling,
    }));
    registry.registerNotFoundHandler(async () => ({
      component: NotFoundComponent,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/does-not-exist`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("mandu-not-found");
    expect(body).toContain("404 — Not Found");
  });

  it("dynamicParams=false + empty staticParams → every URL → 404", async () => {
    const manifest = buildManifest({
      id: "page-lang",
      pattern: "/:lang",
      dynamicParams: false,
      staticParams: [],
    } as unknown as RouteSpec);

    const filling = new ManduFilling();
    filling.loader(() => ({ hi: "there" }));
    registry.registerPageHandler("page-lang", async () => ({
      component: LangPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res1 = await fetch(`http://localhost:${port}/en`);
    const res2 = await fetch(`http://localhost:${port}/random`);
    expect(res1.status).toBe(404);
    expect(res2.status).toBe(404);
  });

  it("dynamicParams=true → 200 for any param (SSR fallback unchanged)", async () => {
    const manifest = buildManifest({
      id: "page-lang",
      pattern: "/:lang",
      dynamicParams: true,
      staticParams: [{ lang: "en" }],
    } as unknown as RouteSpec);

    const filling = new ManduFilling();
    filling.loader(() => ({ hi: "there" }));
    registry.registerPageHandler("page-lang", async () => ({
      component: LangPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/fr`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("hello from fr");
  });

  it("dynamicParams undefined (default) → 200 for any param (existing behavior preserved)", async () => {
    // No dynamicParams / no staticParams on spec — legacy manifest shape.
    const manifest = buildManifest({
      id: "page-lang",
      pattern: "/:lang",
    } as unknown as RouteSpec);

    const filling = new ManduFilling();
    filling.loader(() => ({ hi: "there" }));
    registry.registerPageHandler("page-lang", async () => ({
      component: LangPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/anything`);
    expect(res.status).toBe(200);
  });

  it("nested dynamic: only enumerated (lang, slug) pairs render; unknown pair 404s", async () => {
    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          kind: "page",
          id: "page-lang-slug",
          pattern: "/:lang/:slug",
          module: ".mandu/generated/server/page-lang-slug.ts",
          componentModule: "app/[lang]/[slug]/page.tsx",
          dynamicParams: false,
          staticParams: [
            { lang: "en", slug: "intro" },
            { lang: "ko", slug: "intro" },
          ],
        } as RouteSpec,
      ],
    };

    const filling = new ManduFilling();
    filling.loader(() => ({ ok: true }));
    registry.registerPageHandler("page-lang-slug", async () => ({
      component: LangPage,
      filling,
    }));
    registry.registerNotFoundHandler(async () => ({
      component: NotFoundComponent,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    // Known pair
    const ok = await fetch(`http://localhost:${port}/en/intro`);
    expect(ok.status).toBe(200);

    // Unknown slug for known lang
    const miss1 = await fetch(`http://localhost:${port}/en/random`);
    expect(miss1.status).toBe(404);

    // Unknown lang for known slug
    const miss2 = await fetch(`http://localhost:${port}/de/intro`);
    expect(miss2.status).toBe(404);
  });

  it("catch-all: declared string[] joins match request path", async () => {
    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          kind: "page",
          id: "page-docs",
          pattern: "/docs/:slug*",
          module: ".mandu/generated/server/page-docs.ts",
          componentModule: "app/docs/[...slug]/page.tsx",
          dynamicParams: false,
          staticParams: [
            { slug: ["guide", "intro"] },
            { slug: ["advanced", "hooks"] },
          ],
        } as RouteSpec,
      ],
    };

    const filling = new ManduFilling();
    filling.loader(() => ({ ok: true }));
    registry.registerPageHandler("page-docs", async () => ({
      component: LangPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const ok = await fetch(`http://localhost:${port}/docs/guide/intro`);
    expect(ok.status).toBe(200);

    const miss = await fetch(`http://localhost:${port}/docs/random/page`);
    expect(miss.status).toBe(404);
  });

  it("API routes are NEVER gated (dynamicParams is page-only)", async () => {
    // Even if user manually sets dynamicParams on an API route via manifest
    // edit, the guard must not apply — it's a page-only contract.
    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          kind: "api",
          id: "api-echo",
          pattern: "/api/:who",
          module: ".mandu/generated/server/api-echo.ts",
          // These fields aren't typed for api routes but could slip in
          // from bad hand-editing — we still must not 404 here.
          dynamicParams: false,
          staticParams: [{ who: "alice" }],
        } as unknown as RouteSpec,
      ],
    };

    registry.registerApiHandler(
      "api-echo",
      async (_req, params) =>
        new Response(JSON.stringify({ hello: params?.who ?? null }), {
          headers: { "Content-Type": "application/json" },
        })
    );

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/api/anyone`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ hello: "anyone" });
  });

  it("guard trips BEFORE loader runs (no side effects on unknown params)", async () => {
    let loaderCalls = 0;
    const manifest = buildManifest({
      id: "page-lang",
      pattern: "/:lang",
      dynamicParams: false,
      staticParams: [{ lang: "en" }],
    } as unknown as RouteSpec);

    const filling = new ManduFilling();
    filling.loader(() => {
      loaderCalls++;
      return { ok: true };
    });
    registry.registerPageHandler("page-lang", async () => ({
      component: LangPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    // Known param — loader runs (1 call).
    const ok = await fetch(`http://localhost:${port}/en`);
    expect(ok.status).toBe(200);
    expect(loaderCalls).toBe(1);

    // Unknown params — loader MUST NOT run.
    const miss1 = await fetch(`http://localhost:${port}/fr`);
    const miss2 = await fetch(`http://localhost:${port}/de`);
    expect(miss1.status).toBe(404);
    expect(miss2.status).toBe(404);
    expect(loaderCalls).toBe(1); // unchanged
  });

  it("unknown params on known dynamicParams=false route still go to built-in 404 when no notFoundHandler", async () => {
    const manifest = buildManifest({
      id: "page-lang",
      pattern: "/:lang",
      dynamicParams: false,
      staticParams: [{ lang: "en" }],
    } as unknown as RouteSpec);

    const filling = new ManduFilling();
    filling.loader(() => ({ ok: true }));
    registry.registerPageHandler("page-lang", async () => ({
      component: LangPage,
      filling,
    }));
    // No registerNotFoundHandler → built-in JSON fallback.

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/xyz`);
    expect(res.status).toBe(404);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("application/json");
  });
});
