import { describe, expect, it } from "bun:test";
import React from "react";
import { renderPageResponse } from "../page-render-response";
import type { BundleManifest } from "../../bundler/types";

const HYDRATED_MANIFEST: BundleManifest = {
  version: 1,
  buildTime: "2026-05-19T00:00:00.000Z",
  env: "production",
  bundles: {
    home: {
      js: "/.mandu/client/home.island.js",
      dependencies: ["_runtime", "_react"],
      priority: "visible",
    },
  },
  shared: {
    runtime: "/.mandu/client/_runtime.js",
    vendor: "/.mandu/client/_react.js",
    router: "/.mandu/client/_router.js",
  },
  importMap: {
    imports: {
      react: "/.mandu/client/_react.js",
      "react-dom": "/.mandu/client/_react-dom.js",
      "react-dom/client": "/.mandu/client/_react-dom-client.js",
    },
  },
};

describe("runtime page render response orchestration", () => {
  it("pre-resolves async components on the non-streaming path", async () => {
    async function AsyncPage() {
      return React.createElement("main", null, "resolved-page");
    }

    const response = await renderPageResponse({
      app: React.createElement(AsyncPage),
      useStreaming: false,
      title: "Async Page",
      headTags: "",
      isDev: false,
      routeId: "page/async",
      routePattern: "/async",
      loaderData: { ok: true },
      transitions: false,
      prefetch: false,
      spa: false,
      devtools: false,
    });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("resolved-page");
    expect(html).toContain("Async Page");
  });

  it("uses the streaming renderer when requested", async () => {
    const response = await renderPageResponse({
      app: React.createElement("main", null, "stream-page"),
      useStreaming: true,
      title: "Stream Page",
      headTags: "",
      isDev: false,
      routeId: "page/stream",
      routePattern: "/stream",
      loaderData: { ok: true },
      transitions: false,
      prefetch: false,
      spa: false,
      devtools: false,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    const html = await response.text();
    expect(html).toContain("stream-page");
    expect(html).toContain("Stream Page");
  });

  it("serializes non-streaming loaderData as the route server data exactly once", async () => {
    const response = await renderPageResponse({
      app: React.createElement("main", null, "hydrated-page"),
      useStreaming: false,
      title: "Hydrated Page",
      headTags: "",
      isDev: false,
      routeId: "home",
      routePattern: "/",
      loaderData: { items: ["a", "b"] },
      hydration: { strategy: "island", priority: "visible", preload: false },
      bundleManifest: HYDRATED_MANIFEST,
      transitions: false,
      prefetch: false,
      spa: false,
      devtools: false,
    });

    const html = await response.text();
    expect(html).toContain('"home":{"serverData":{"items":["a","b"]}');
    expect(html).not.toContain('"serverData":{"home"');
  });
});
