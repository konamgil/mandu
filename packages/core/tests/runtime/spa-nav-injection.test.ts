/**
 * Issue #208 — Inline SPA-nav helper injection regression guard.
 *
 * The helper IIFE (`@mandujs/core/client/spa-nav-helper`) must land in
 * the `<head>` of every HTML SSR response UNLESS the user opts out via
 * `ssr.spa: false`. Paired with Issue #192's `@view-transition` rule,
 * zero-JS / `hydration: "none"` projects gain pushState SPA navigation
 * without needing to load the big client-router bundle.
 *
 * Paths under test:
 *   1. `renderToHTML` (non-streaming) default + opt-out
 *   2. `renderToStream` / `renderStreamingResponse` default + opt-out
 *   3. `renderSSR({ title: "Not Found" })` 404 surface
 *   4. Prerender output
 *
 * Exclusion-matrix parity with the full client router
 * (`router.ts::handleLinkClick`) is covered in a sibling test
 * (`spa-nav-helper-exclusions.test.ts`) that simulates clicks through
 * a dispatched DOM listener.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import React from "react";
import path from "path";
import fs from "fs/promises";
import { tmpdir } from "os";
import { gzipSync } from "zlib";
import { renderToHTML, renderSSR } from "../../src/runtime/ssr";
import {
  renderToStream,
  renderStreamingResponse,
} from "../../src/runtime/streaming-ssr";
import {
  SPA_NAV_HELPER_BODY,
  SPA_NAV_HELPER_SCRIPT,
} from "../../src/client/spa-nav-helper";
import { prerenderRoutes } from "../../src/bundler/prerender";
import type { RoutesManifest } from "../../src/spec/schema";

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

function Page({ msg = "hi" }: { msg?: string }) {
  return React.createElement("p", null, msg);
}

// ---------------------------------------------------------------------------
// 1. Helper source shape — structural invariants
// ---------------------------------------------------------------------------

describe("Issue #208 — SPA_NAV_HELPER_BODY structural invariants", () => {
  it("PREFETCH_HELPER_SCRIPT wrapping shape mirrors prefetch helper", () => {
    expect(SPA_NAV_HELPER_SCRIPT).toBe(`<script>${SPA_NAV_HELPER_BODY}</script>`);
  });

  it("body stays below the 3 KB ceiling (gzipped bytes)", () => {
    // Design contract — if this grows past 3 KB gz we should revisit
    // the inline-vs-external tradeoff. The ceiling is gzipped because
    // every production deployment serves the inline helper through
    // gzip/brotli; the raw budget (~6 KB) is intentionally looser.
    //
    // Current source ≈5.1 KB raw / ≈2.0 KB gz after the issue #220
    // observability + fallback rewrite (body-swap script re-exec,
    // container-fallback log, __MANDU_SPA_NAV__ event, hard-nav
    // fallback on every error path).
    const gzipSize = gzipSync(Buffer.from(SPA_NAV_HELPER_BODY, "utf8")).length;
    expect(gzipSize).toBeLessThan(3072);
    // Soft raw-bytes upper bound — catches accidental duplication but
    // leaves room for error-message detail required by #220.
    expect(SPA_NAV_HELPER_BODY.length).toBeLessThan(8192);
  });

  it("attaches a document-level click listener", () => {
    expect(SPA_NAV_HELPER_BODY).toContain("document.addEventListener");
    expect(SPA_NAV_HELPER_BODY).toContain(`"click"`);
  });

  it("checks event.defaultPrevented (co-exists with full router)", () => {
    expect(SPA_NAV_HELPER_BODY).toContain("defaultPrevented");
  });

  it("bails when the full client router is already installed", () => {
    // The full router (`initializeRouter`) sets `__MANDU_ROUTER_STATE__`
    // before its own listener registers. Helper must early-exit when
    // that global is present.
    expect(SPA_NAV_HELPER_BODY).toContain("__MANDU_ROUTER_STATE__");
  });

  it("covers all 10 exclusions from handleLinkClick", () => {
    // Same matrix as `router.ts::handleLinkClick`.
    // 1-4: modifier keys
    expect(SPA_NAV_HELPER_BODY).toContain("metaKey");
    expect(SPA_NAV_HELPER_BODY).toContain("altKey");
    expect(SPA_NAV_HELPER_BODY).toContain("ctrlKey");
    expect(SPA_NAV_HELPER_BODY).toContain("shiftKey");
    // 5: non-left click
    expect(SPA_NAV_HELPER_BODY).toContain("button");
    // 6: data-no-spa per-link opt-out
    expect(SPA_NAV_HELPER_BODY).toContain("data-no-spa");
    // 7: target other than _self
    expect(SPA_NAV_HELPER_BODY).toContain("target");
    expect(SPA_NAV_HELPER_BODY).toContain(`"_self"`);
    // 8: download attribute
    expect(SPA_NAV_HELPER_BODY).toContain("download");
    // 9: fragment-only links (#) — as of issue #222 these are now
    //    intercepted (pushState + scrollIntoView, no fetch); the old
    //    `charAt(0)==="#"` early-return was removed. Instead the helper
    //    branches into `samePageHashNav` when pathname + search match.
    expect(SPA_NAV_HELPER_BODY).toContain("samePageHashNav");
    // 10: cross-origin + non-http(s) schemes
    expect(SPA_NAV_HELPER_BODY).toContain("origin");
    expect(SPA_NAV_HELPER_BODY).toContain(`"http:"`);
    expect(SPA_NAV_HELPER_BODY).toContain(`"https:"`);
  });

  it("uses pushState + fetch for navigation", () => {
    expect(SPA_NAV_HELPER_BODY).toContain("pushState");
    expect(SPA_NAV_HELPER_BODY).toContain("fetch(");
  });

  it("uses the View Transitions API when available", () => {
    expect(SPA_NAV_HELPER_BODY).toContain("startViewTransition");
  });

  it("listens for popstate (back/forward)", () => {
    expect(SPA_NAV_HELPER_BODY).toContain(`"popstate"`);
  });

  it("falls back to full-page navigation on fetch failure", () => {
    // On `fetch` rejection or non-HTML response we set `location.href`
    // to let the browser do a real navigation — defense in depth.
    expect(SPA_NAV_HELPER_BODY).toContain("L.href");
  });

  it("guards against DOM-less environments", () => {
    // Prevents the helper from crashing if it somehow runs server-side
    // (e.g. during a Bun.file embed that evaluates scripts).
    expect(SPA_NAV_HELPER_BODY).toContain(`typeof document==="undefined"`);
  });
});

// ---------------------------------------------------------------------------
// 2. renderToHTML — non-streaming injection
// ---------------------------------------------------------------------------

describe("Issue #208 — renderToHTML injection", () => {
  it("injects the SPA-nav helper by default", () => {
    const html = renderToHTML(React.createElement(Page, { msg: "default" }));
    expect(html).toContain(SPA_NAV_HELPER_BODY);
    expect(html).toContain("pushState");
  });

  it("places the helper inside <head>", () => {
    const html = renderToHTML(React.createElement(Page));
    const head = html.split("<head>")[1]?.split("</head>")[0] ?? "";
    expect(head).toContain(SPA_NAV_HELPER_BODY);
  });

  it("omits the helper when spa=false", () => {
    const html = renderToHTML(React.createElement(Page), { spa: false });
    expect(html).not.toContain(SPA_NAV_HELPER_BODY);
    // Legacy `__MANDU_SPA__=false` flag still emitted for the full
    // router (issue #193 behavior preserved).
    expect(html).toContain("__MANDU_SPA__");
  });

  it("spa=true (explicit) behaves like the default", () => {
    const explicit = renderToHTML(React.createElement(Page), { spa: true });
    const def = renderToHTML(React.createElement(Page));
    expect(explicit).toContain(SPA_NAV_HELPER_BODY);
    expect(def).toContain(SPA_NAV_HELPER_BODY);
  });

  it("does not contaminate <body>", () => {
    const html = renderToHTML(React.createElement(Page, { msg: "body" }));
    const body = html.split("<body>")[1]?.split("</body>")[0] ?? "";
    expect(body).not.toContain(SPA_NAV_HELPER_BODY);
    expect(body).toContain("body");
  });

  it("ordering: helper appears after viewTransition + prefetch, before user headTags", () => {
    const html = renderToHTML(React.createElement(Page), {
      headTags: "<!--USER-HEAD-->",
    });
    const vtIdx = html.indexOf("@view-transition");
    const spaIdx = html.indexOf(SPA_NAV_HELPER_BODY);
    const userIdx = html.indexOf("<!--USER-HEAD-->");
    expect(vtIdx).toBeGreaterThan(0);
    expect(spaIdx).toBeGreaterThan(vtIdx);
    expect(userIdx).toBeGreaterThan(spaIdx);
  });
});

// ---------------------------------------------------------------------------
// 3. Streaming SSR injection
// ---------------------------------------------------------------------------

describe("Issue #208 — streaming SSR injection", () => {
  it("renderToStream emits the helper in the shell by default", async () => {
    const stream = await renderToStream(
      React.createElement(Page, { msg: "streamed" }),
    );
    const html = await drainStream(stream);
    expect(html).toContain(SPA_NAV_HELPER_BODY);
  });

  it("renderStreamingResponse body contains the helper", async () => {
    const response = await renderStreamingResponse(
      React.createElement(Page),
      { title: "Stream" },
    );
    const body = await response.text();
    expect(body).toContain(SPA_NAV_HELPER_BODY);
  });

  it("streaming spa: false suppresses the helper", async () => {
    const stream = await renderToStream(React.createElement(Page), {
      spa: false,
    });
    const html = await drainStream(stream);
    expect(html).not.toContain(SPA_NAV_HELPER_BODY);
  });

  it("streaming + non-streaming emit the same literal helper body", async () => {
    const sync = renderToHTML(React.createElement(Page));
    const stream = await drainStream(
      await renderToStream(React.createElement(Page)),
    );
    expect(sync).toContain(SPA_NAV_HELPER_BODY);
    expect(stream).toContain(SPA_NAV_HELPER_BODY);
  });
});

// ---------------------------------------------------------------------------
// 4. hydration: "none" zero-JS path — primary motivator for #208
// ---------------------------------------------------------------------------

describe("Issue #208 — zero-JS (hydration: none) path", () => {
  it("emits the helper on a pure-SSR response with no bundleManifest", () => {
    // Represents a `hydration: "none"` docs page: no routeId, no
    // bundleManifest → client router bundle NEVER ships. The inline
    // helper is the ONLY reason links feel like a SPA here.
    const html = renderToHTML(React.createElement(Page, { msg: "docs" }));
    expect(html).toContain(SPA_NAV_HELPER_BODY);
    // And critically, NO reference to the full client router module.
    expect(html).not.toContain("__MANDU_ROUTER__");
  });
});

// ---------------------------------------------------------------------------
// 5. 404 / error-page surfaces carry the helper
// ---------------------------------------------------------------------------

describe("Issue #208 — 404 / error surfaces", () => {
  it("404 page response contains the helper", async () => {
    const response = renderSSR(React.createElement(Page, { msg: "nf" }), {
      title: "Not Found",
    });
    const body = await response.text();
    expect(body).toContain(SPA_NAV_HELPER_BODY);
  });

  it("404 page honors spa: false", async () => {
    const response = renderSSR(React.createElement(Page, { msg: "nf" }), {
      title: "Not Found",
      spa: false,
    });
    const body = await response.text();
    expect(body).not.toContain(SPA_NAV_HELPER_BODY);
  });

  it("error-page render surface contains the helper", async () => {
    const response = renderSSR(React.createElement(Page, { msg: "err" }), {
      title: "Mandu App — Error",
    });
    const body = await response.text();
    expect(body).toContain(SPA_NAV_HELPER_BODY);
  });
});

// ---------------------------------------------------------------------------
// 6. Prerender output
// ---------------------------------------------------------------------------

describe("Issue #208 — prerender output", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(tmpdir(), "mandu-208-prerender-"));
  });

  afterAll(async () => {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  });

  it("prerendered static HTML contains the SPA-nav helper", async () => {
    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          kind: "page",
          id: "home",
          pattern: "/",
          module: "app/page.tsx",
        } as unknown as RoutesManifest["routes"][number],
      ],
    } as unknown as RoutesManifest;

    const fetchHandler = async (_req: Request): Promise<Response> =>
      renderSSR(React.createElement(Page, { msg: "prerendered" }), {
        title: "Home",
      });

    const outDir = path.join(workDir, "static");
    const result = await prerenderRoutes(manifest, fetchHandler, {
      rootDir: workDir,
      outDir,
    });
    expect(result.errors).toEqual([]);

    const html = await fs.readFile(path.join(outDir, "index.html"), "utf-8");
    expect(html).toContain(SPA_NAV_HELPER_BODY);
    expect(html).toContain("prerendered");
  });

  it("prerender honors spa: false end-to-end", async () => {
    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          kind: "page",
          id: "off",
          pattern: "/off",
          module: "app/off/page.tsx",
        } as unknown as RoutesManifest["routes"][number],
      ],
    } as unknown as RoutesManifest;

    const fetchHandler = async (_req: Request): Promise<Response> =>
      renderSSR(React.createElement(Page), {
        title: "Off",
        spa: false,
      });

    const outDir = path.join(workDir, "static-off");
    const result = await prerenderRoutes(manifest, fetchHandler, {
      rootDir: workDir,
      outDir,
    });
    expect(result.errors).toEqual([]);

    const html = await fs.readFile(
      path.join(outDir, "off", "index.html"),
      "utf-8",
    );
    expect(html).not.toContain(SPA_NAV_HELPER_BODY);
  });
});

// ---------------------------------------------------------------------------
// 7. Compatibility — does not break transitions: false or prefetch: false
// ---------------------------------------------------------------------------

describe("Issue #208 — independence from other opt-outs", () => {
  it("transitions: false does NOT remove the SPA-nav helper", () => {
    const html = renderToHTML(React.createElement(Page), {
      transitions: false,
    });
    expect(html).not.toContain("@view-transition");
    expect(html).toContain(SPA_NAV_HELPER_BODY);
  });

  it("prefetch: false does NOT remove the SPA-nav helper", () => {
    const html = renderToHTML(React.createElement(Page), { prefetch: false });
    expect(html).not.toContain('rel="prefetch"');
    expect(html).toContain(SPA_NAV_HELPER_BODY);
  });

  it("spa: false does NOT remove the @view-transition style", () => {
    const html = renderToHTML(React.createElement(Page), { spa: false });
    expect(html).toContain("@view-transition");
    expect(html).not.toContain(SPA_NAV_HELPER_BODY);
  });

  it("all three off strips every opt-in block", () => {
    const html = renderToHTML(React.createElement(Page), {
      spa: false,
      transitions: false,
      prefetch: false,
    });
    expect(html).not.toContain("@view-transition");
    expect(html).not.toContain(SPA_NAV_HELPER_BODY);
    expect(html).not.toContain('rel="prefetch"');
  });
});
