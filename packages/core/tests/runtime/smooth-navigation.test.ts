/**
 * Issue #192 — Smooth Navigation Primitives
 *
 * Verifies that `renderToHTML` (and, by extension, `renderSSR`) injects
 * the `@view-transition` `<style>` block and the hover prefetch `<script>`
 * into `<head>` by default, and that each opts out cleanly when the
 * respective config flag is `false`.
 *
 * Covers:
 *   1. Default on — both tags present for a bare `renderToHTML()` call.
 *   2. transitions: false → `<style>@view-transition...` absent.
 *   3. prefetch: false → prefetch `<script>` absent.
 *   4. Both false → neither tag present (headline Zero-regression case).
 *   5. Ordering — tags land in `<head>`, before `headTags` user block.
 *   6. Prefetch IIFE shape — `data-no-prefetch` honored in source.
 *   7. No conflict with cssPath / title / HMR injection paths.
 */
import { describe, it, expect } from "bun:test";
import React from "react";
import { renderToHTML } from "../../src/runtime/ssr";
import {
  PREFETCH_HELPER_BODY,
  PREFETCH_HELPER_SCRIPT,
} from "../../src/client/prefetch-helper";

// ---------------------------------------------------------------------------
// 1. Defaults — both tags injected
// ---------------------------------------------------------------------------

describe("renderToHTML — smooth navigation defaults", () => {
  it("injects the @view-transition style block by default", () => {
    const html = renderToHTML(React.createElement("p", null, "hi"));
    expect(html).toContain("@view-transition");
    expect(html).toContain("navigation:auto");
  });

  it("injects the prefetch helper script by default", () => {
    const html = renderToHTML(React.createElement("p", null, "hi"));
    // The inner IIFE should be present verbatim
    expect(html).toContain(PREFETCH_HELPER_BODY);
  });

  it("places both tags inside <head>", () => {
    const html = renderToHTML(React.createElement("p", null, "body-content"));
    const headSection = html.split("<head>")[1]?.split("</head>")[0] ?? "";
    expect(headSection).toContain("@view-transition");
    expect(headSection).toContain("rel=\"prefetch\"");
  });
});

// ---------------------------------------------------------------------------
// 2. Opt-out via transitions: false
// ---------------------------------------------------------------------------

describe("renderToHTML — transitions opt-out", () => {
  it("omits the @view-transition style block when transitions=false", () => {
    const html = renderToHTML(React.createElement("p"), {
      transitions: false,
    });
    expect(html).not.toContain("@view-transition");
  });

  it("still injects the prefetch helper when only transitions are off", () => {
    const html = renderToHTML(React.createElement("p"), {
      transitions: false,
    });
    expect(html).toContain(PREFETCH_HELPER_BODY);
  });

  it("transitions: true explicit — behaves the same as default", () => {
    const defaultHtml = renderToHTML(React.createElement("p"));
    const explicitHtml = renderToHTML(React.createElement("p"), {
      transitions: true,
    });
    // Both should contain the style block
    expect(defaultHtml).toContain("@view-transition");
    expect(explicitHtml).toContain("@view-transition");
  });
});

// ---------------------------------------------------------------------------
// 3. Opt-out via prefetch: false
// ---------------------------------------------------------------------------

describe("renderToHTML — prefetch opt-out", () => {
  it("omits the prefetch helper script when prefetch=false", () => {
    const html = renderToHTML(React.createElement("p"), {
      prefetch: false,
    });
    expect(html).not.toContain(PREFETCH_HELPER_BODY);
    // Should NOT find the characteristic inner tokens
    expect(html).not.toContain("rel=\"prefetch\"");
  });

  it("still injects the view-transition style when only prefetch is off", () => {
    const html = renderToHTML(React.createElement("p"), {
      prefetch: false,
    });
    expect(html).toContain("@view-transition");
  });
});

// ---------------------------------------------------------------------------
// 4. Full opt-out — both disabled (pre-#192 parity)
// ---------------------------------------------------------------------------

describe("renderToHTML — full opt-out", () => {
  it("omits both tags when transitions=false AND prefetch=false", () => {
    const html = renderToHTML(React.createElement("p"), {
      transitions: false,
      prefetch: false,
    });
    expect(html).not.toContain("@view-transition");
    expect(html).not.toContain(PREFETCH_HELPER_BODY);
    // And of course no prefetch script of any form
    expect(html).not.toContain("rel=\"prefetch\"");
  });

  it("still produces a valid HTML skeleton when both are off", () => {
    const html = renderToHTML(React.createElement("p", null, "still-works"), {
      transitions: false,
      prefetch: false,
    });
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("<html lang=");
    expect(html).toContain("</body>");
    expect(html).toContain("</html>");
    expect(html).toContain("still-works");
  });
});

// ---------------------------------------------------------------------------
// 5. Ordering — tags appear after CSS, before user headTags
// ---------------------------------------------------------------------------

describe("renderToHTML — injection ordering", () => {
  it("places view-transition + prefetch AFTER cssLinkTag", () => {
    const html = renderToHTML(React.createElement("p"), {
      cssPath: "/ordered.css",
    });
    const cssIdx = html.indexOf("/ordered.css");
    const vtIdx = html.indexOf("@view-transition");
    const pfIdx = html.indexOf(PREFETCH_HELPER_BODY);
    expect(cssIdx).toBeGreaterThan(0);
    expect(vtIdx).toBeGreaterThan(cssIdx);
    expect(pfIdx).toBeGreaterThan(cssIdx);
  });

  it("places view-transition + prefetch BEFORE user-provided headTags", () => {
    const html = renderToHTML(React.createElement("p"), {
      headTags: "<!--USER-HEAD-MARKER-->",
    });
    const vtIdx = html.indexOf("@view-transition");
    const userIdx = html.indexOf("<!--USER-HEAD-MARKER-->");
    expect(vtIdx).toBeGreaterThan(0);
    expect(userIdx).toBeGreaterThan(vtIdx);
  });
});

// ---------------------------------------------------------------------------
// 6. Prefetch IIFE — data-no-prefetch respected in source
// ---------------------------------------------------------------------------

describe("prefetch helper IIFE — source content", () => {
  it("exports PREFETCH_HELPER_BODY wrapped in <script>", () => {
    expect(PREFETCH_HELPER_SCRIPT).toBe(`<script>${PREFETCH_HELPER_BODY}</script>`);
  });

  it("uses WeakSet for dedup", () => {
    expect(PREFETCH_HELPER_BODY).toContain("WeakSet");
  });

  it("checks data-no-prefetch attribute before issuing the prefetch", () => {
    expect(PREFETCH_HELPER_BODY).toContain("noPrefetch");
  });

  it("scopes to same-origin paths via a[href^='/']", () => {
    expect(PREFETCH_HELPER_BODY).toContain("a[href^='/']");
  });

  it("emits rel=prefetch with as=document", () => {
    expect(PREFETCH_HELPER_BODY).toContain("\"prefetch\"");
    expect(PREFETCH_HELPER_BODY).toContain("\"document\"");
  });

  it("uses passive + capture listener options", () => {
    expect(PREFETCH_HELPER_BODY).toContain("passive:true");
    expect(PREFETCH_HELPER_BODY).toContain("capture:true");
  });

  it("skips downloads and target=_blank links", () => {
    expect(PREFETCH_HELPER_BODY).toContain("download");
    expect(PREFETCH_HELPER_BODY).toContain("_self");
  });

  it("helper body stays below 1 KB (raw bytes)", () => {
    // Sanity bound — if this grows beyond 1KB, we should reconsider the
    // inline-vs-external tradeoff. ~500 B target, 1024 B ceiling.
    expect(PREFETCH_HELPER_BODY.length).toBeLessThan(1024);
  });
});

// ---------------------------------------------------------------------------
// 7. No conflict with existing paths
// ---------------------------------------------------------------------------

describe("renderToHTML — compatibility with other head features", () => {
  it("coexists with custom title + cssPath + lang", () => {
    const html = renderToHTML(React.createElement("p"), {
      title: "My App",
      cssPath: "/app.css",
      lang: "en",
    });
    expect(html).toContain("<title>My App</title>");
    expect(html).toContain("/app.css");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("@view-transition");
    expect(html).toContain(PREFETCH_HELPER_BODY);
  });

  it("coexists with dev-mode HMR script", () => {
    const html = renderToHTML(React.createElement("p"), {
      isDev: true,
      hmrPort: 4321,
    });
    expect(html).toContain("__MANDU_HMR_PORT__");
    expect(html).toContain("@view-transition");
    expect(html).toContain(PREFETCH_HELPER_BODY);
  });

  it("does not contaminate body content", () => {
    const html = renderToHTML(React.createElement("p", null, "body-text"));
    const bodySection = html.split("<body>")[1]?.split("</body>")[0] ?? "";
    // The view-transition style and prefetch script live in <head>,
    // NOT in <body>. Body should contain only #root and existing scripts.
    expect(bodySection).not.toContain("@view-transition");
    expect(bodySection).not.toContain(PREFETCH_HELPER_BODY);
    expect(bodySection).toContain("body-text");
  });
});

// ---------------------------------------------------------------------------
// 8. Sample HTML (regression catch)
// ---------------------------------------------------------------------------

describe("renderToHTML — sample output smoke", () => {
  it("produces the exact expected style tag (byte-stable)", () => {
    const html = renderToHTML(React.createElement("p"));
    // Exact literal — if the at-rule format ever changes, the issue
    // #192 fix needs to be audited. Lock the content down.
    expect(html).toContain(
      "<style>@view-transition{navigation:auto}</style>",
    );
  });

  it("produces the exact expected prefetch script tag (byte-stable)", () => {
    const html = renderToHTML(React.createElement("p"));
    expect(html).toContain(PREFETCH_HELPER_SCRIPT);
  });
});
