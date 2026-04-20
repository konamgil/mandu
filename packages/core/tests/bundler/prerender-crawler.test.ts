/**
 * Issue #213 — prerender link-crawler regression tests.
 *
 * The crawler previously applied `/href=["']([^"']+)["']/g` to the raw
 * rendered HTML, which matched `href` attributes embedded in doc code
 * examples (`<pre>`, `<code>`, fenced markdown, inline spans). This
 * caused the `mandujs.com` build to emit `.mandu/static/path/index.html`
 * and friends from literal `<Link href="/path">` examples.
 *
 * Fix: strip code regions + HTML comments before scanning, and apply a
 * configurable denylist of placeholder paths (`/path`, `/example`,
 * `/your-*`, etc.).
 *
 * These tests exercise the pure extraction helpers so we don't need a
 * full build harness.
 */

import { describe, expect, it } from "bun:test";
import {
  compileCrawlDenylist,
  extractInternalLinks,
  stripCodeRegions,
  DEFAULT_CRAWL_DENYLIST,
} from "../../src/bundler/prerender";

describe("prerender link crawler — Issue #213", () => {
  describe("stripCodeRegions", () => {
    it("strips <pre> blocks even with attributes", () => {
      const input = `<pre class="language-tsx"><a href="/ghost">no</a></pre><a href="/real">yes</a>`;
      const out = stripCodeRegions(input);
      expect(out).not.toContain("/ghost");
      expect(out).toContain("/real");
    });

    it("strips <code> blocks case-insensitively", () => {
      const input = `<CODE><a href="/ghost">x</a></CODE><a href="/real">y</a>`;
      const out = stripCodeRegions(input);
      expect(out).not.toContain("/ghost");
      expect(out).toContain("/real");
    });

    it("strips fenced markdown ``` blocks with info string", () => {
      const input =
        "some text\n```tsx\n<Link href=\"/path\">demo</Link>\n```\nmore <a href=\"/real\">text</a>";
      const out = stripCodeRegions(input);
      expect(out).not.toContain("/path");
      expect(out).toContain("/real");
    });

    it("strips ~~~ fenced markdown blocks", () => {
      const input = "prelude\n~~~\n<a href=\"/ghost\">x</a>\n~~~\n<a href=\"/real\">y</a>";
      const out = stripCodeRegions(input);
      expect(out).not.toContain("/ghost");
      expect(out).toContain("/real");
    });

    it("strips inline backtick code spans", () => {
      const input = "Try `<a href=\"/ghost\">click</a>` then use /real via <a href=\"/real\">text</a>";
      const out = stripCodeRegions(input);
      expect(out).not.toContain("/ghost");
      expect(out).toContain("/real");
    });

    it("strips HTML comments", () => {
      const input = `<!-- <a href="/ghost">x</a> --><a href="/real">y</a>`;
      const out = stripCodeRegions(input);
      expect(out).not.toContain("/ghost");
      expect(out).toContain("/real");
    });
  });

  describe("compileCrawlDenylist", () => {
    it("compiles defaults when options omitted", () => {
      const patterns = compileCrawlDenylist(undefined);
      expect(patterns.length).toBe(DEFAULT_CRAWL_DENYLIST.length);
      expect(patterns.some((re) => re.test("/path"))).toBe(true);
      expect(patterns.some((re) => re.test("/example"))).toBe(true);
    });

    it("merges user extras with defaults by default", () => {
      const patterns = compileCrawlDenylist({ exclude: ["/skip-me"] });
      expect(patterns.some((re) => re.test("/path"))).toBe(true);
      expect(patterns.some((re) => re.test("/skip-me"))).toBe(true);
    });

    it("replaces defaults when replaceDefaultExclude=true", () => {
      const patterns = compileCrawlDenylist({
        exclude: ["/only-this"],
        replaceDefaultExclude: true,
      });
      expect(patterns.some((re) => re.test("/path"))).toBe(false);
      expect(patterns.some((re) => re.test("/only-this"))).toBe(true);
    });

    it("translates `*` globs to regex", () => {
      const patterns = compileCrawlDenylist({ exclude: ["/admin/*"] });
      expect(patterns.some((re) => re.test("/admin/users"))).toBe(true);
      expect(patterns.some((re) => re.test("/admin/users/42"))).toBe(true);
      expect(patterns.some((re) => re.test("/admin"))).toBe(false);
    });
  });

  describe("extractInternalLinks", () => {
    const denylist = compileCrawlDenylist(undefined);

    it("ignores hrefs inside <pre><code> doc blocks", () => {
      const html = `
        <html><body>
          <p>See this example:</p>
          <pre><code>&lt;Link href="/inside-code"&gt;demo&lt;/Link&gt;</code></pre>
          <a href="/real">real link</a>
        </body></html>
      `;
      const out = extractInternalLinks(html, denylist);
      expect(out).toContain("/real");
      expect(out).not.toContain("/inside-code");
    });

    it("ignores hrefs inside fenced markdown blocks", () => {
      const html = "```tsx\n<Link href=\"/fenced-example\">x</Link>\n```\n<a href=\"/alive\">y</a>";
      const out = extractInternalLinks(html, denylist);
      expect(out).toContain("/alive");
      expect(out).not.toContain("/fenced-example");
    });

    it("excludes default placeholders /path and /example", () => {
      const html = `<a href="/path">a</a><a href="/example">b</a><a href="/real">c</a>`;
      const out = extractInternalLinks(html, denylist);
      expect(out).not.toContain("/path");
      expect(out).not.toContain("/example");
      expect(out).toContain("/real");
    });

    it("excludes /your-* default glob", () => {
      const html = `<a href="/your-route">a</a><a href="/your-page">b</a><a href="/docs">c</a>`;
      const out = extractInternalLinks(html, denylist);
      expect(out).not.toContain("/your-route");
      expect(out).not.toContain("/your-page");
      expect(out).toContain("/docs");
    });

    it("normalizes case + trailing slash for de-duplication", () => {
      const html = `<a href="/Docs">a</a><a href="/docs/">b</a><a href="/docs">c</a>`;
      const out = extractInternalLinks(html, denylist);
      expect(out).toEqual(["/docs"]);
    });

    it("ignores external + protocol-relative hrefs", () => {
      const html =
        `<a href="https://example.com/real">a</a>` +
        `<a href="//cdn.example.com/asset">b</a>` +
        `<a href="/internal">c</a>`;
      const out = extractInternalLinks(html, denylist);
      expect(out).toEqual(["/internal"]);
    });

    it("ignores static-asset hrefs (.js/.css/.png/etc.)", () => {
      const html =
        `<a href="/bundle.js">a</a>` +
        `<a href="/style.css">b</a>` +
        `<a href="/logo.png">c</a>` +
        `<a href="/page">d</a>`;
      const out = extractInternalLinks(html, denylist);
      expect(out).toEqual(["/page"]);
    });

    it("strips query + hash before matching", () => {
      const html = `<a href="/docs?v=1">a</a><a href="/docs#anchor">b</a>`;
      const out = extractInternalLinks(html, denylist);
      expect(out).toEqual(["/docs"]);
    });

    it("MDX-specific shape: <pre> wrapping <code> wrapping mdx HTML", () => {
      const html = `
        <article>
          <pre class="astro-code shiki">
            <code class="language-tsx">&lt;a href="/mdx-ghost"&gt;click&lt;/a&gt;</code>
          </pre>
          <p>A real internal link: <a href="/guides/intro">guide</a>.</p>
        </article>
      `;
      const out = extractInternalLinks(html, denylist);
      expect(out).toContain("/guides/intro");
      expect(out).not.toContain("/mdx-ghost");
    });

    it("ignores hrefs inside HTML comments", () => {
      const html = `<!-- <a href="/ghost">x</a> --><a href="/real">y</a>`;
      const out = extractInternalLinks(html, denylist);
      expect(out).toEqual(["/real"]);
    });

    it("respects custom denylist extension", () => {
      const extra = compileCrawlDenylist({ exclude: ["/skip", "/stub-*"] });
      const html = `<a href="/skip">a</a><a href="/stub-api">b</a><a href="/real">c</a>`;
      const out = extractInternalLinks(html, extra);
      expect(out).not.toContain("/skip");
      expect(out).not.toContain("/stub-api");
      expect(out).toContain("/real");
    });
  });
});
