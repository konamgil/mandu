/**
 * DX-1: Page module default export normalization.
 *
 * A `page.tsx` can default-export either shape:
 *   (a) `export default function Page() {…}`
 *   (b) `export default { component, filling }`
 *
 * Both MUST render (200). A malformed default (missing / non-component /
 * non-object) MUST surface as a loud error response (not a silent 404),
 * since a silent 404 sends developers into long debugging sessions.
 *
 * Regression guard for the four invariants:
 *   1. registerPageLoader + bare function default → 200
 *   2. registerPageLoader + { component, filling } default → 200
 *   3. registerPageLoader + no default export → 5xx with route.id in message
 *   4. registerPageHandler + malformed registration (non-function component)
 *      → 5xx with route.id in message (not silent 404)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  startServer,
  createServerRegistry,
  clearDefaultRegistry,
  type ManduServer,
  type ServerRegistry,
  type PageLoader,
  type PageHandler,
} from "../../src/runtime/server";
import { ManduFilling } from "../../src/filling/filling";
import type { RoutesManifest } from "../../src/spec/schema";
import React from "react";

// ---------- Fixtures ----------

function TestPage(props: { params: Record<string, string>; loaderData?: unknown }) {
  return React.createElement(
    "div",
    { id: "ok" },
    `rendered:${JSON.stringify(props.loaderData ?? null)}`
  );
}

const manifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "page/dx1",
      pattern: "/dx1",
      kind: "page",
      module: ".mandu/generated/server/page-dx1.ts",
      componentModule: "app/dx1/page.tsx",
    },
  ],
};

describe("DX-1: page default-export normalization", () => {
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

  it("1. pageLoader: bare `export default function Page()` renders 200", async () => {
    // Simulate an ESM module whose default is the bare component function.
    registry.registerPageLoader("page/dx1", async () => ({
      default: TestPage,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/dx1`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("rendered:");
  });

  it("2. pageLoader: `export default { component, filling }` renders 200 and runs the loader", async () => {
    const filling = new ManduFilling();
    filling.loader(() => ({ user: "alice" }));

    // PageLoader's public typing expects `{ default: ComponentType }`, but the
    // runtime accepts `{ default: { component, filling } }` for legacy users.
    // The test intentionally exercises the legacy shape, so cast at the edge.
    const loader = (async () => ({
      default: { component: TestPage, filling },
    })) as unknown as PageLoader;
    registry.registerPageLoader("page/dx1", loader);

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/dx1`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("alice");
  });

  it("3. pageLoader: missing default export fails LOUD (5xx) with route id in body", async () => {
    // Simulate a page module that forgot `export default`. Before the DX-1
    // fix this produced a silent 404, stumping users — now it's a 5xx with a
    // clear message pointing at the route so the build log tells the story.
    const loader = (async () => ({
      // no `default` key at all
      filling: undefined,
    })) as unknown as PageLoader;
    registry.registerPageLoader("page/dx1", loader);

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/dx1`);
    // NOT a silent 404 — any 5xx acceptable, as long as it's not 404.
    expect(res.status).not.toBe(404);
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = await res.text();
    // The error must reference the route identifier so devs can find the file.
    expect(body).toContain("page/dx1");
  });

  it("4. pageLoader: primitive default export fails LOUD (5xx)", async () => {
    // e.g. `export default "hello"` — accidental stringification.
    const loader = (async () => ({
      default: "not a component",
    })) as unknown as PageLoader;
    registry.registerPageLoader("page/dx1", loader);

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/dx1`);
    expect(res.status).not.toBe(404);
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = await res.text();
    expect(body).toContain("page/dx1");
  });

  it("5. pageHandler: non-function component in registration fails LOUD (5xx)", async () => {
    // Direct registerPageHandler misuse — user code returns an object that
    // doesn't satisfy PageRegistration. Previously this produced a silent 404
    // in defaultCreateApp; now it throws during ensurePageRouteMetadata and
    // is surfaced as a 5xx with the route id.
    const handler = (async () => ({
      component: "oops",
      filling: undefined,
    })) as unknown as PageHandler;
    registry.registerPageHandler("page/dx1", handler);

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/dx1`);
    expect(res.status).not.toBe(404);
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = await res.text();
    expect(body).toContain("page/dx1");
  });

  it("6. pageHandler: component is a valid function renders 200 (regression anchor)", async () => {
    registry.registerPageHandler("page/dx1", async () => ({
      component: TestPage,
      filling: undefined,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/dx1`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("rendered:");
  });
});
