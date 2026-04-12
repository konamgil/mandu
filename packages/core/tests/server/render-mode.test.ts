import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import React from "react";
import {
  clearDefaultRegistry,
  createServerRegistry,
  startServer,
  type ManduServer,
  type ServerRegistry,
} from "../../src/runtime/server";
import { ManduFilling } from "../../src/filling/filling";
import type { RoutesManifest } from "../../src/spec/schema";

function TestPage({ loaderData }: { params: Record<string, string>; loaderData?: unknown }) {
  const count = (loaderData as { count?: number } | undefined)?.count ?? 0;
  return React.createElement("div", null, `count:${count}`);
}

const manifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "page/home",
      pattern: "/",
      kind: "page",
      module: ".mandu/generated/server/page-home.ts",
      componentModule: "app/page.tsx",
    },
  ],
};

describe("render mode integration", () => {
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

  it("dynamic render mode bypasses the SSR cache even when cache options exist", async () => {
    let count = 0;
    const filling = new ManduFilling()
      .loader(() => ({ count: ++count }), { revalidate: 60 })
      .render("dynamic", { revalidate: 60 });

    registry.registerPageHandler("page/home", async () => ({
      component: TestPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry, cache: true });
    const port = server.server.port;

    const first = await fetch(`http://localhost:${port}/`);
    const firstHtml = await first.text();
    const second = await fetch(`http://localhost:${port}/`);
    const secondHtml = await second.text();

    expect(first.headers.get("X-Mandu-Cache")).toBeNull();
    expect(second.headers.get("X-Mandu-Cache")).toBeNull();
    expect(firstHtml).toContain("count:1");
    expect(secondHtml).toContain("count:2");
  });

  it("isr render mode serves cached HTML on subsequent requests", async () => {
    let count = 0;
    const filling = new ManduFilling()
      .loader(() => ({ count: ++count }), { revalidate: 60 })
      .render("isr", { revalidate: 60 });

    registry.registerPageHandler("page/home", async () => ({
      component: TestPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry, cache: true });
    const port = server.server.port;

    const first = await fetch(`http://localhost:${port}/`);
    const firstHtml = await first.text();
    let second: Response | null = null;
    let secondHtml = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      second = await fetch(`http://localhost:${port}/`);
      secondHtml = await second.text();
      if (second.headers.get("X-Mandu-Cache") === "HIT") {
        break;
      }
    }

    expect(first.headers.get("X-Mandu-Cache")).toBeNull();
    expect(second?.headers.get("X-Mandu-Cache")).toBe("HIT");
    expect(firstHtml).toContain("count:1");
    expect(secondHtml).toContain("count:1");
  });

  it("ppr render mode caches the shell but serves fresh loader data each request", async () => {
    let count = 0;
    const filling = new ManduFilling()
      .loader(() => ({ count: ++count }), { revalidate: 3600 })
      .render("ppr", { revalidate: 3600 });

    registry.registerPageHandler("page/home", async () => ({
      component: TestPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry, cache: true });
    const port = server.server.port;

    // First request: full SSR render (shell MISS)
    const first = await fetch(`http://localhost:${port}/`);
    const firstHtml = await first.text();
    expect(firstHtml).toContain("count:1");
    // No PPR header on the first request (full render)
    expect(first.headers.get("X-Mandu-PPR")).toBeNull();

    // Allow the background shell cache write to complete
    let secondHtml = "";
    let second: Response | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      second = await fetch(`http://localhost:${port}/`);
      secondHtml = await second.text();
      if (second.headers.get("X-Mandu-PPR") === "shell-hit") {
        break;
      }
    }

    // Second request: shell cached (contains stale rendered HTML),
    // but __MANDU_DATA__ script carries fresh loader data for client hydration
    expect(second?.headers.get("X-Mandu-PPR")).toBe("shell-hit");
    // Shell still contains the original render from the first request
    expect(secondHtml).toContain("count:1");
    // Fresh data is injected via script for client-side hydration
    expect(secondHtml).toContain('"count":2');

    // Third request: still fresh data (count:3) in the script, same cached shell
    const third = await fetch(`http://localhost:${port}/`);
    const thirdHtml = await third.text();
    expect(third.headers.get("X-Mandu-PPR")).toBe("shell-hit");
    expect(thirdHtml).toContain("count:1"); // shell unchanged
    expect(thirdHtml).toContain('"count":3'); // fresh data in script
  });
});
