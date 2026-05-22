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

  it("emits canonical data-hydrate attributes on streaming island wrappers", async () => {
    const response = await renderPageResponse({
      app: React.createElement("main", null, "stream-hydrated-page"),
      useStreaming: true,
      title: "Stream Hydrated Page",
      headTags: "",
      isDev: false,
      routeId: "home",
      routePattern: "/",
      loaderData: { ok: true },
      hydration: { strategy: "island", priority: "interaction", preload: false },
      bundleManifest: HYDRATED_MANIFEST,
      transitions: false,
      prefetch: false,
      spa: false,
      devtools: false,
    });

    const html = await response.text();
    expect(html).toContain('data-mandu-island="home"');
    expect(html).toContain('data-mandu-priority="interaction"');
    expect(html).toContain('data-hydrate="interaction"');
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

  it("serializes props for inline client components rendered by async server pages", async () => {
    function PledgeAccordion({ pledges }: { pledges: Array<{ id: string; title: string }> }) {
      return React.createElement(
        "ul",
        null,
        pledges.map((pledge) => React.createElement("li", { key: pledge.id }, pledge.title)),
      );
    }

    async function CandidatePage() {
      const pledges = [
        { id: "p1", title: "Public transit" },
        { id: "p2", title: "Housing" },
      ];
      return React.createElement(
        "main",
        null,
        React.createElement(PledgeAccordion, { pledges }),
      );
    }

    const response = await renderPageResponse({
      app: React.createElement(CandidatePage),
      useStreaming: false,
      title: "Candidate",
      headTags: "",
      isDev: false,
      routeId: "candidates-$id",
      routePattern: "/candidates/:id",
      hydration: { strategy: "island", priority: "immediate", preload: false },
      bundleManifest: {
        ...HYDRATED_MANIFEST,
        bundles: {
          "candidates-$id": {
            js: "/.mandu/client/candidates-$id.island.js",
            dependencies: ["_runtime", "_react"],
            priority: "immediate",
          },
        },
      },
      loaderData: undefined,
      transitions: false,
      prefetch: false,
      spa: false,
      devtools: false,
      inlineClientHydration: {
        routeId: "candidates-$id",
        src: "/.mandu/client/candidates-$id.island.js",
        priority: "immediate",
        component: PledgeAccordion,
      },
    });

    const html = await response.text();
    expect(html).toContain('data-mandu-island="candidates-$id--0"');
    expect(html).toContain('data-mandu-src="/.mandu/client/candidates-$id.island.js"');
    expect(html).toContain('type="application/json" data-mandu-props="candidates-$id--0"');
    expect(html).toContain("&quot;pledges&quot;");
    expect(html).toContain('"pledges"');
    expect(html).toContain("Public transit");
    expect(html).not.toContain('data-mandu-island="candidates-$id"');
  });

  it("does not invoke sync function components while looking for inline client targets", async () => {
    function ClientWidget({ label }: { label: string }) {
      return React.createElement("button", null, label);
    }

    function HookPage() {
      const id = React.useId();
      return React.createElement("main", { id }, React.createElement(ClientWidget, { label: "Click" }));
    }

    const response = await renderPageResponse({
      app: React.createElement(HookPage),
      useStreaming: false,
      title: "Hook Page",
      headTags: "",
      isDev: false,
      routeId: "hook-page",
      routePattern: "/hook",
      hydration: { strategy: "island", priority: "visible", preload: false },
      bundleManifest: {
        ...HYDRATED_MANIFEST,
        bundles: {
          "hook-page": {
            js: "/.mandu/client/hook-page.island.js",
            dependencies: ["_runtime", "_react"],
            priority: "visible",
          },
        },
      },
      loaderData: undefined,
      transitions: false,
      prefetch: false,
      spa: false,
      devtools: false,
      inlineClientHydration: {
        routeId: "hook-page",
        src: "/.mandu/client/hook-page.island.js",
        priority: "visible",
        component: ClientWidget,
      },
    });

    const html = await response.text();
    expect(html).toContain("Hook Page");
    expect(html).toContain("Click");
    expect(html).toContain('data-mandu-island="hook-page"');
    expect(html).not.toContain('data-mandu-island="hook-page--0"');
  });

  it("assigns inline client island IDs in document order", async () => {
    function ClientWidget({ label }: { label: string }) {
      return React.createElement("button", null, label);
    }

    async function SlowSection() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return React.createElement(ClientWidget, { label: "first" });
    }

    async function FastSection() {
      return React.createElement(ClientWidget, { label: "second" });
    }

    async function OrderedPage() {
      return [
        React.createElement(SlowSection, { key: "slow" }),
        React.createElement(FastSection, { key: "fast" }),
      ];
    }

    const response = await renderPageResponse({
      app: React.createElement(OrderedPage),
      useStreaming: false,
      title: "Ordered",
      headTags: "",
      isDev: false,
      routeId: "ordered",
      routePattern: "/ordered",
      hydration: { strategy: "island", priority: "visible", preload: false },
      bundleManifest: {
        ...HYDRATED_MANIFEST,
        bundles: {
          ordered: {
            js: "/.mandu/client/ordered.island.js",
            dependencies: ["_runtime", "_react"],
            priority: "visible",
          },
        },
      },
      loaderData: undefined,
      transitions: false,
      prefetch: false,
      spa: false,
      devtools: false,
      inlineClientHydration: {
        routeId: "ordered",
        src: "/.mandu/client/ordered.island.js",
        priority: "visible",
        component: ClientWidget,
      },
    });

    const html = await response.text();
    expect(html.indexOf('data-mandu-island="ordered--0"')).toBeLessThan(
      html.indexOf('data-mandu-island="ordered--1"'),
    );
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
  });
});
