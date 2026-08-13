/**
 * SSR Rendering Tests
 *
 * Covers renderToHTML output structure, CSS injection, link hoisting,
 * HMR/DevTools script injection, title escaping, and zero-JS mode.
 */
import { describe, it, expect } from "bun:test";
import React from "react";
import { renderToHTML, wrapWithIsland } from "../../src/runtime/ssr";
import type { BundleManifest } from "../../src/bundler/types";
import { PORTS } from "../../src/constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalManifest(overrides?: Partial<BundleManifest>): BundleManifest {
  return {
    version: 1,
    buildTime: new Date().toISOString(),
    env: "development",
    bundles: {},
    shared: {
      runtime: "/.mandu/client/runtime.js",
      vendor: "/.mandu/client/vendor.js",
    },
    ...overrides,
  };
}

function manifestWithRoute(
  routeId: string,
  overrides?: Partial<BundleManifest>
): BundleManifest {
  return minimalManifest({
    bundles: {
      [routeId]: {
        js: `/.mandu/client/${routeId}.js`,
        dependencies: [],
        priority: "visible",
      },
    },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// 1. Basic HTML structure
// ---------------------------------------------------------------------------

describe("renderToHTML — HTML structure", () => {
  it("produces valid HTML skeleton with doctype, html, head, body, div#root", () => {
    const html = renderToHTML(React.createElement("p", null, "hello"));

    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("<html lang=");
    expect(html).toContain("<head>");
    expect(html).toContain("<meta charset=\"UTF-8\">");
    expect(html).toContain("<meta name=\"viewport\"");
    expect(html).toContain("</head>");
    expect(html).toContain("<body>");
    expect(html).toContain('<div id="root">');
    expect(html).toContain("</body>");
    expect(html).toContain("</html>");
  });

  it("uses default title 'Mandu App' when none provided", () => {
    const html = renderToHTML(React.createElement("span", null, "x"));
    expect(html).toContain("<title>Mandu App</title>");
  });

  it("uses custom title when provided", () => {
    const html = renderToHTML(React.createElement("span", null, "x"), {
      title: "My Page",
    });
    expect(html).toContain("<title>My Page</title>");
  });

  it("uses custom lang attribute", () => {
    const html = renderToHTML(React.createElement("span", null, "x"), {
      lang: "en",
    });
    expect(html).toContain('<html lang="en">');
  });

  it("defaults lang to ko", () => {
    const html = renderToHTML(React.createElement("span", null, "x"));
    expect(html).toContain('<html lang="ko">');
  });

  it("renders child content inside div#root", () => {
    const html = renderToHTML(
      React.createElement("section", { className: "app" }, "content-here")
    );
    expect(html).toContain('<div id="root"><section class="app">content-here</section></div>');
  });
});

// ---------------------------------------------------------------------------
// 2. Title escaping (XSS prevention)
// ---------------------------------------------------------------------------

describe("renderToHTML — title escaping", () => {
  it("escapes HTML entities in title to prevent XSS", () => {
    const html = renderToHTML(React.createElement("div"), {
      title: '<script>alert("xss")</script>',
    });

    // The title text must be escaped; no raw <script> inside <title>
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes ampersands in title", () => {
    const html = renderToHTML(React.createElement("div"), {
      title: "A & B",
    });
    expect(html).toContain("<title>A &amp; B</title>");
  });

  it("hoists JSX title from the body when no explicit metadata title exists", () => {
    const html = renderToHTML(
      React.createElement(
        React.Fragment,
        null,
        React.createElement("title", null, "JSX A & B"),
        React.createElement("main", null, "body"),
      ),
    );
    expect(html).toContain("<title>JSX A &amp; B</title>");
    expect(html).toContain("<main>body</main>");
    expect((html.match(/<title/g) ?? []).length).toBe(1);
    expect(html).not.toContain('<div id="root"><title>');
  });

  it("keeps an explicit metadata title ahead of a JSX body title", () => {
    const html = renderToHTML(
      React.createElement(
        React.Fragment,
        null,
        React.createElement("title", null, "Body Title"),
        React.createElement("main", null, "body"),
      ),
      { title: "Metadata Title" },
    );
    expect(html).toContain("<title>Metadata Title</title>");
    expect((html.match(/<title/g) ?? []).length).toBe(1);
    expect(html).not.toContain("Body Title");
  });
});

// ---------------------------------------------------------------------------
// 3. CSS link tag injection
// ---------------------------------------------------------------------------

describe("renderToHTML — CSS injection", () => {
  it("injects CSS link tag when cssPath is provided", () => {
    const html = renderToHTML(React.createElement("div"), {
      cssPath: "/styles/app.css",
    });

    expect(html).toContain('<link rel="stylesheet" href="/styles/app.css">');
  });

  it("does NOT inject CSS link tag when cssPath is false", () => {
    const html = renderToHTML(React.createElement("div"), {
      cssPath: false,
    });

    expect(html).not.toContain('rel="stylesheet"');
  });

  it("does NOT inject CSS link tag when cssPath is undefined (default)", () => {
    const html = renderToHTML(React.createElement("div"));

    // No stylesheet link should appear from the cssLinkTag logic
    expect(html).not.toContain('href="/.mandu/client/globals.css"');
  });

  it("appends cache-bust query param in dev mode", () => {
    const html = renderToHTML(React.createElement("div"), {
      cssPath: "/app.css",
      isDev: true,
    });

    // Should have ?t= for cache busting
    expect(html).toMatch(/href="\/app\.css\?t=\d+"/);
  });

  it("does NOT append cache-bust query param in production mode", () => {
    const html = renderToHTML(React.createElement("div"), {
      cssPath: "/app.css",
      isDev: false,
    });

    expect(html).toContain('href="/app.css"');
    expect(html).not.toMatch(/href="\/app\.css\?t=/);
  });
});

// ---------------------------------------------------------------------------
// 4. Link tag hoisting (#179)
// ---------------------------------------------------------------------------

describe("renderToHTML — link hoisting (#179)", () => {
  it("hoists <link rel='stylesheet'> from body content to head", () => {
    // Simulate a component that renders a <link> tag (e.g., Google Fonts)
    const el = React.createElement("div", {
      dangerouslySetInnerHTML: {
        __html: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
      },
    });

    const html = renderToHTML(el, { title: "hoist-test" });

    // The link should appear in <head>, not inside <div id="root">
    const headSection = html.split("<head>")[1]?.split("</head>")[0] ?? "";
    const bodySection = html.split("<body>")[1]?.split("</body>")[0] ?? "";

    expect(headSection).toContain("fonts.googleapis.com");
    // The link should be removed from body content
    expect(bodySection).not.toContain('rel="stylesheet" href="https://fonts.googleapis.com');
  });

  it("hoists <link rel='preconnect'> from body to head", () => {
    const el = React.createElement("div", {
      dangerouslySetInnerHTML: {
        __html: '<link rel="preconnect" href="https://cdn.example.com">',
      },
    });

    const html = renderToHTML(el, { title: "preconnect-test" });
    const headSection = html.split("<head>")[1]?.split("</head>")[0] ?? "";
    expect(headSection).toContain("cdn.example.com");
  });

  it("hoists <link rel='icon'> from body to head", () => {
    const el = React.createElement("div", {
      dangerouslySetInnerHTML: {
        __html: '<link rel="icon" href="/favicon.ico">',
      },
    });

    const html = renderToHTML(el, { title: "icon-test" });
    const headSection = html.split("<head>")[1]?.split("</head>")[0] ?? "";
    expect(headSection).toContain('href="/favicon.ico"');
  });

  it("does NOT hoist non-resource link tags", () => {
    const el = React.createElement("div", {
      dangerouslySetInnerHTML: {
        __html: '<a href="/about">About</a>',
      },
    });

    const html = renderToHTML(el, { title: "no-hoist" });
    const bodySection = html.split("<body>")[1]?.split("</body>")[0] ?? "";

    // <a> tags should remain in body
    expect(bodySection).toContain('<a href="/about">About</a>');
  });
});

// ---------------------------------------------------------------------------
// 4b. Meta / JSON-LD hoisting (#317)
// ---------------------------------------------------------------------------

describe("renderToHTML — meta/JSON-LD hoisting (#317)", () => {
  const head = (html: string): string =>
    html.split("<head>")[1]?.split("</head>")[0] ?? "";
  const body = (html: string): string =>
    html.split("<body>")[1]?.split("</body>")[0] ?? "";

  it("hoists og:/twitter <meta> from body to head", () => {
    const el = React.createElement("main", {
      dangerouslySetInnerHTML: {
        __html:
          '<meta property="og:title" content="Hello"><meta name="twitter:card" content="summary">',
      },
    });

    const html = renderToHTML(el, { title: "og-test" });

    expect(head(html)).toContain('property="og:title"');
    expect(head(html)).toContain('name="twitter:card"');
    expect(body(html)).not.toContain('property="og:title"');
    expect(body(html)).not.toContain('name="twitter:card"');
  });

  it("hoists <meta name='description'> from body to head", () => {
    const el = React.createElement("main", {
      dangerouslySetInnerHTML: {
        __html: '<meta name="description" content="A page about pledges">',
      },
    });

    const html = renderToHTML(el, { title: "desc-test" });
    expect(head(html)).toContain('content="A page about pledges"');
    expect(body(html)).not.toContain('content="A page about pledges"');
  });

  it("hoists <script type='application/ld+json'> from body to head", () => {
    const el = React.createElement("main", {
      dangerouslySetInnerHTML: {
        __html:
          '<script type="application/ld+json">{"@context":"https://schema.org"}</script>',
      },
    });

    const html = renderToHTML(el, { title: "ldjson-test" });
    expect(head(html)).toContain('type="application/ld+json"');
    expect(head(html)).toContain('"@context":"https://schema.org"');
    expect(body(html)).not.toContain('type="application/ld+json"');
  });

  it("does NOT hoist microdata <meta itemprop=...> (stays in body)", () => {
    const el = React.createElement("main", {
      dangerouslySetInnerHTML: {
        __html: '<meta itemprop="price" content="9.99">',
      },
    });

    const html = renderToHTML(el, { title: "microdata-test" });
    // itemprop metas are content, not document metadata — must stay in body.
    expect(body(html)).toContain('itemprop="price"');
    expect(head(html)).not.toContain('itemprop="price"');
  });
});

// ---------------------------------------------------------------------------
// 5. HMR script injection
// ---------------------------------------------------------------------------

describe("renderToHTML — HMR script", () => {
  it("injects HMR script when isDev and hmrPort are provided", () => {
    const hmrPort = 4000;
    const html = renderToHTML(React.createElement("div"), {
      isDev: true,
      hmrPort,
    });

    const expectedWsPort = hmrPort + PORTS.HMR_OFFSET;
    expect(html).toContain("__MANDU_HMR_PORT__");
    expect(html).toContain(String(expectedWsPort));
    expect(html).toContain("WebSocket");
    expect(html).toContain("CustomEvent('__MANDU_ERROR__'");
    expect(html).toContain("BuildError");
  });

  it("does NOT inject HMR script when isDev is false", () => {
    const html = renderToHTML(React.createElement("div"), {
      isDev: false,
      hmrPort: 4000,
    });

    expect(html).not.toContain("__MANDU_HMR_PORT__");
  });

  it("does NOT inject HMR script when hmrPort is not provided", () => {
    const html = renderToHTML(React.createElement("div"), {
      isDev: true,
    });

    expect(html).not.toContain("__MANDU_HMR_PORT__");
  });
});

// ---------------------------------------------------------------------------
// 6. DevTools script injection
//    Issue #191 + #259 — dev-mode default is to inject the `_devtools.js`
//    bundle regardless of island count, so SSR-only landing pages still get
//    the Kitchen panel. Prod always skips. Exhaustive matrix coverage lives
//    in `devtools-inject.test.ts`; this block keeps a minimal smoke suite.
// ---------------------------------------------------------------------------

describe("renderToHTML — DevTools script", () => {
  it("injects DevTools script in dev mode when the manifest has islands", () => {
    const html = renderToHTML(React.createElement("div"), {
      isDev: true,
      routeId: "home",
      hydration: { strategy: "island", priority: "visible", preload: false },
      bundleManifest: manifestWithRoute("home"),
    });

    expect(html).toContain("_devtools.js");
  });

  it("injects DevTools script in dev mode even when hasIslands is false (#259)", () => {
    const html = renderToHTML(React.createElement("div"), {
      isDev: true,
    });

    expect(html).toContain("_devtools.js");
  });

  it("does NOT inject DevTools script in production mode", () => {
    const html = renderToHTML(React.createElement("div"), {
      isDev: false,
    });

    expect(html).not.toContain("_devtools.js");
  });

  it("does NOT inject DevTools script when isDev is omitted (default false)", () => {
    const html = renderToHTML(React.createElement("div"));

    expect(html).not.toContain("_devtools.js");
  });
});

describe("renderToHTML — immutable build generations", () => {
  it("pins hydration, runtime, import-map, and devtools URLs to one generation", () => {
    const manifest = manifestWithRoute("home", {
      generationId: "generation-123",
      importMap: {
        imports: {
          react: "/.mandu/client/vendor.js",
        },
      },
    });
    const html = renderToHTML(React.createElement("div", null, "generated"), {
      isDev: true,
      routeId: "home",
      hydration: { strategy: "island", priority: "visible", preload: false },
      bundleManifest: manifest,
    });

    expect(html).toContain("/.mandu/client/home.js?g=generation-123&amp;t=");
    expect(html).toContain('src="/.mandu/client/runtime.js?g=generation-123"');
    expect(html).toContain("/.mandu/client/vendor.js?g=generation-123");
    expect(html).toContain("_devtools.js?g=generation-123&v=");
    expect(html).not.toContain("?g=generation-123?t=");
    expect(manifest.bundles.home.js).toBe("/.mandu/client/home.js");
  });
});

// ---------------------------------------------------------------------------
// 7. Zero-JS: no script tags when hydration is not needed
// ---------------------------------------------------------------------------

describe("renderToHTML — Zero-JS mode", () => {
  it("produces no <script> tags (ignoring the spa=false legacy flag) when no hydration/dev options are set", () => {
    // Issue #192 — the hover-prefetch helper is injected by default in all
    //   SSR output. A "truly Zero-JS" page requires `prefetch: false`.
    // Issue #208 — the inline SPA-nav helper is also injected by default
    //   (so `hydration: "none"` projects still feel like a SPA). Opt out
    //   with `spa: false` — which ALSO causes Issue #193's legacy
    //   `<script>window.__MANDU_SPA__=false;</script>` flag to emit so
    //   the full client router (when present) reverts to opt-in via
    //   `data-mandu-link`. That single 33-byte `<script>` is intentional
    //   and byte-minimal; the page still has no loader, vendor, runtime,
    //   prefetch, or SPA-nav scripts.
    // Dev is false by default, so no HMR / DevTools scripts either.
    const html = renderToHTML(React.createElement("p", null, "static"), {
      prefetch: false,
      spa: false,
    });

    // Only the __MANDU_SPA__ flag script should appear, and nothing
    // else. We assert both the count and that the one present script
    // is the tiny flag (not a full bundle).
    const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [];
    expect(scripts.length).toBe(1);
    expect(scripts[0]).toBe("<script>window.__MANDU_SPA__=false;</script>");
  });

  it("produces no module scripts when hydration strategy is 'none'", () => {
    const html = renderToHTML(React.createElement("p", null, "static"), {
      hydration: { strategy: "none", priority: "visible", preload: false },
      routeId: "home",
      bundleManifest: manifestWithRoute("home"),
    });

    // No runtime/vendor module scripts should be present
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain("modulepreload");
  });

  it("produces no data script when there is no serverData or no hydration", () => {
    const html = renderToHTML(React.createElement("p", null, "static"), {
      serverData: { count: 42 },
      // No hydration config => needsHydration is false
    });

    expect(html).not.toContain("__MANDU_DATA__");
  });
});

// ---------------------------------------------------------------------------
// 8. Hydration scripts
// ---------------------------------------------------------------------------

describe("renderToHTML — hydration scripts", () => {
  it("injects hydration scripts when hydration, routeId, and bundleManifest are provided", () => {
    const routeId = "counter";
    const html = renderToHTML(React.createElement("div", null, "counter"), {
      hydration: { strategy: "island", priority: "visible", preload: false },
      routeId,
      bundleManifest: manifestWithRoute(routeId),
    });

    // Should have runtime module script
    expect(html).toContain('type="module"');
    expect(html).toContain("runtime.js");
    // Should have vendor modulepreload
    expect(html).toContain('rel="modulepreload"');
    expect(html).toContain("vendor.js");
  });

  it("wraps content with island div when hydration is needed", () => {
    const routeId = "todo";
    const html = renderToHTML(React.createElement("span", null, "item"), {
      hydration: { strategy: "island", priority: "visible", preload: false },
      routeId,
      bundleManifest: manifestWithRoute(routeId),
    });

    expect(html).toContain('data-mandu-island="todo"');
    expect(html).toContain('data-mandu-priority="visible"');
    expect(html).toContain('style="display:contents"');
  });

  it("does NOT double-wrap when islandPreWrapped is true", () => {
    const routeId = "widget";
    const html = renderToHTML(
      React.createElement("div", { "data-mandu-island": "widget" }, "pre-wrapped"),
      {
        hydration: { strategy: "island", priority: "idle", preload: false },
        routeId,
        bundleManifest: manifestWithRoute(routeId),
        islandPreWrapped: true,
      }
    );

    // Should only have the original island marker, not a second wrapper
    const islandDivCount = (html.match(/data-mandu-island/g) || []).length;
    expect(islandDivCount).toBe(1);
  });

  it("serializes server data when hydration is needed", () => {
    const routeId = "data-page";
    const html = renderToHTML(React.createElement("div"), {
      hydration: { strategy: "island", priority: "visible", preload: false },
      routeId,
      bundleManifest: manifestWithRoute(routeId),
      serverData: { items: [1, 2, 3] },
    });

    expect(html).toContain("__MANDU_DATA__");
    expect(html).toContain("__MANDU_DATA_RAW__");
  });
});

// ---------------------------------------------------------------------------
// 9. headTags and bodyEndTags
// ---------------------------------------------------------------------------

describe("renderToHTML — custom head/body tags", () => {
  it("injects headTags into head section", () => {
    const html = renderToHTML(React.createElement("div"), {
      headTags: '<meta property="og:title" content="Test">',
    });

    const headSection = html.split("<head>")[1]?.split("</head>")[0] ?? "";
    expect(headSection).toContain('property="og:title"');
  });

  it("injects bodyEndTags before closing body", () => {
    const html = renderToHTML(React.createElement("div"), {
      bodyEndTags: '<script src="/analytics.js"></script>',
    });

    const bodySection = html.split("<body>")[1]?.split("</body>")[0] ?? "";
    expect(bodySection).toContain("/analytics.js");
  });
});

// ---------------------------------------------------------------------------
// 10. wrapWithIsland helper
// ---------------------------------------------------------------------------

describe("wrapWithIsland", () => {
  it("wraps content with island marker div", () => {
    const result = wrapWithIsland("<span>hi</span>", "my-island");

    expect(result).toContain('data-mandu-island="my-island"');
    expect(result).toContain('data-mandu-priority="visible"');
    expect(result).toContain('style="display:contents"');
    expect(result).toContain("<span>hi</span>");
  });

  it("uses specified priority", () => {
    const result = wrapWithIsland("<div/>", "comp", "idle");
    expect(result).toContain('data-mandu-priority="idle"');
  });

  it("includes data-mandu-src when bundleSrc is provided", () => {
    const result = wrapWithIsland("<div/>", "comp", "visible", "/bundle.js");
    expect(result).toContain("data-mandu-src=");
    expect(result).toContain("/bundle.js");
  });

  it("escapes routeId to prevent attribute injection", () => {
    const result = wrapWithIsland("<div/>", 'xss" onclick="alert(1)');
    expect(result).not.toContain('onclick="alert(1)"');
    expect(result).toContain("&quot;");
  });
});
