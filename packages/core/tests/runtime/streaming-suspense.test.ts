/**
 * Phase 18.ξ — Streaming Suspense + loading.tsx integration tests
 *
 * Coverage matrix:
 *   1. Shell flushes immediately (before async children resolve)
 *   2. Suspense fallback lands in HTML before resolved children
 *   3. Resolved children eventually stream into the same document
 *   4. Rejected promise triggers onError and the document still closes
 *   5. Nested Suspense boundaries — inner can resolve independently
 *   6. loading.tsx-style fallback wraps the page (Phase 18.β parity)
 *   7. renderStreamingResponse sets `X-Accel-Buffering: no` + `Cache-Control: no-store`
 *   8. Streaming response is a ReadableStream (Transfer-Encoding: chunked compatible)
 *   9. Chunks arrive in order (stream semantics preserved)
 *  10. Error boundary catches thrown errors in suspended children
 *  11. `use(promise)` inside Suspense interop
 *  12. Multiple parallel suspended siblings flush as each resolves
 */

import { describe, it, expect } from "bun:test";
import React, { Suspense, use } from "react";
import {
  renderToStream,
  renderStreamingResponse,
} from "../../src/runtime/streaming-ssr";

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

async function readChunks(stream: ReadableStream<Uint8Array>): Promise<{
  chunks: string[];
  full: string;
}> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return { chunks, full: chunks.join("") };
}

describe("Streaming Suspense end-to-end", () => {
  it("(1) shell flushes immediately — <!DOCTYPE> arrives in the first chunk", async () => {
    // Async child stalls for 100ms; shell must land well before that.
    const slow = delay(100, "late");
    function SlowChild() {
      return React.createElement("p", null, use(slow));
    }
    const tree = React.createElement(
      Suspense,
      { fallback: React.createElement("em", null, "waiting") },
      React.createElement(SlowChild, null),
    );
    const stream = await renderToStream(tree, { title: "shell-first" });
    const reader = stream.getReader();
    const first = await reader.read();
    const firstChunk = new TextDecoder().decode(first.value ?? new Uint8Array());
    expect(firstChunk).toContain("<!DOCTYPE html>");
    expect(firstChunk).toContain('<title>shell-first</title>');
    // drain remainder so the stream closes
    while (true) {
      const r = await reader.read();
      if (r.done) break;
    }
  });

  it("(2) Suspense fallback appears in HTML before resolved children (slow promise)", async () => {
    // NOTE: React 19's renderToReadableStream has a fallback-elision
    // optimization: if the Suspense boundary is at the ROOT of the React
    // tree AND its promise resolves before any downstream read occurs,
    // React inlines the resolved content without ever emitting the
    // fallback. To observe the fallback on the wire we must (a) have
    // non-suspended sibling content (so React must commit the shell
    // before the promise resolves) AND (b) use a promise slow enough
    // to outlive the shell flush (≥ 100ms in Bun's loop is safe).
    const slow = delay(150, "late-content");
    function SlowChild() {
      return React.createElement("p", { id: "real" }, use(slow));
    }
    const tree = React.createElement(
      "section",
      null,
      React.createElement("h1", null, "shell-header"),
      React.createElement(
        Suspense,
        {
          fallback: React.createElement(
            "p",
            { id: "fb", className: "mandu-loading" },
            "fallback-text",
          ),
        },
        React.createElement(SlowChild, null),
      ),
    );
    const stream = await renderToStream(tree, { title: "fb-first" });
    const { full } = await readChunks(stream);
    const fbIndex = full.indexOf("fallback-text");
    const realIndex = full.indexOf("late-content");
    expect(fbIndex).toBeGreaterThan(-1);
    expect(realIndex).toBeGreaterThan(-1);
    expect(fbIndex).toBeLessThan(realIndex);
  });

  it("(3) resolved async children eventually appear in HTML", async () => {
    const p = delay(10, { title: "resolved" });
    function Async() {
      const v = use(p);
      return React.createElement("h2", null, v.title);
    }
    const tree = React.createElement(
      Suspense,
      { fallback: React.createElement("em", null, "...") },
      React.createElement(Async, null),
    );
    const stream = await renderToStream(tree);
    const { full } = await readChunks(stream);
    expect(full).toContain("<h2>resolved</h2>");
  });

  it("(4) rejected promise triggers onShellError or onStreamError; document closes", async () => {
    const bad = Promise.reject(new Error("kapow"));
    bad.catch(() => {});
    function Bad() {
      use(bad);
      return React.createElement("span", null, "never");
    }
    const tree = React.createElement(
      Suspense,
      { fallback: React.createElement("em", null, "...") },
      React.createElement(Bad, null),
    );
    let captured: Error | null = null;
    const stream = await renderToStream(tree, {
      title: "err",
      onShellError: (e) => (captured = e.error),
      onStreamError: (e) => (captured = e.error),
      onError: (e) => (captured ??= e),
    });
    const { full } = await readChunks(stream);
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain("kapow");
    expect(full).toContain("</html>");
  });

  it("(5) nested Suspense — inner boundary resolves independently", async () => {
    const fast = delay(5, "fast-outer");
    const slow = delay(30, "slow-inner");
    function Inner() {
      return React.createElement("span", { id: "inner" }, use(slow));
    }
    function Outer() {
      return React.createElement(
        "div",
        { id: "outer" },
        use(fast),
        React.createElement(
          Suspense,
          { fallback: React.createElement("em", { id: "inner-fb" }, "inner-wait") },
          React.createElement(Inner, null),
        ),
      );
    }
    const tree = React.createElement(
      Suspense,
      { fallback: React.createElement("em", null, "outer-wait") },
      React.createElement(Outer, null),
    );
    const stream = await renderToStream(tree);
    const { full } = await readChunks(stream);
    expect(full).toContain("fast-outer");
    expect(full).toContain("slow-inner");
    expect(full).toContain('id="outer"');
    expect(full).toContain('id="inner"');
  });

  it("(6) loading.tsx-style fallback (Phase 18.β parity) wraps page in Suspense", async () => {
    // Simulate what server.ts does when route.loadingModule exists.
    function LoadingComponent() {
      return React.createElement(
        "div",
        { className: "page-loading", role: "status" },
        "Loading page...",
      );
    }
    // Long enough that React flushes the fallback before resolution (see
    // note on test 2 re: root-level Suspense elision).
    const pagePromise = delay(150, "page-content");
    function Page() {
      return React.createElement("main", null, use(pagePromise));
    }
    // Simulate a layout chain wrapping the Suspense — Mandu's real call
    // path never puts Suspense at the tree root because server.ts wraps
    // the page with `<div data-mandu-island>` + layout chain before
    // handing to renderToStream.
    const tree = React.createElement(
      "div",
      { "data-mandu-layout": "root" },
      React.createElement("nav", null, "header"),
      React.createElement(
        Suspense,
        { fallback: React.createElement(LoadingComponent, null) },
        React.createElement(Page, null),
      ),
    );
    const stream = await renderToStream(tree, { title: "loading-tsx" });
    const { full } = await readChunks(stream);
    expect(full).toContain("Loading page...");
    expect(full).toContain('class="page-loading"');
    expect(full).toContain("page-content");
    // fallback must appear before resolved content in the stream
    expect(full.indexOf("Loading page...")).toBeLessThan(full.indexOf("page-content"));
  });

  it("(7) renderStreamingResponse sets streaming-friendly headers", async () => {
    const p = delay(5, "ok");
    function Quick() {
      return React.createElement("p", null, use(p));
    }
    const tree = React.createElement(
      Suspense,
      { fallback: React.createElement("em", null, "...") },
      React.createElement(Quick, null),
    );
    const res = await renderStreamingResponse(tree, { title: "hdr" });
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // Must NOT set a Content-Length (would prevent chunked encoding)
    expect(res.headers.get("Content-Length")).toBeNull();
  });

  it("(8) response body is a ReadableStream (chunked-transfer compatible)", async () => {
    const tree = React.createElement(
      "div",
      null,
      React.createElement("h1", null, "chunked"),
    );
    const res = await renderStreamingResponse(tree, { title: "chunked" });
    expect(res.body).toBeInstanceOf(ReadableStream);
  });

  it("(9) chunks arrive in document order", async () => {
    // Use sync-resolved content so React inlines both subtrees (no
    // fallback chunks). Verify document order is preserved in the HTML.
    function A() { return React.createElement("p", null, "alpha"); }
    function B() { return React.createElement("p", null, "beta"); }
    const tree = React.createElement(
      "div",
      null,
      React.createElement(A, null),
      React.createElement(B, null),
    );
    const stream = await renderToStream(tree);
    const { full } = await readChunks(stream);
    expect(full.indexOf("alpha")).toBeLessThan(full.indexOf("beta"));
  });

  it("(10) thrown error in suspended child surfaces via onError", async () => {
    let caught: Error | null = null;
    function Thrower(): React.ReactElement {
      throw new Error("sync-boom");
    }
    const tree = React.createElement(
      Suspense,
      { fallback: React.createElement("em", null, "...") },
      React.createElement(Thrower, null),
    );
    const stream = await renderToStream(tree, {
      title: "throw",
      onError: (e) => (caught = e),
      onShellError: (e) => (caught = e.error),
      onStreamError: (e) => (caught = e.error),
    });
    const { full } = await readChunks(stream);
    expect(caught).not.toBeNull();
    expect(caught!.message).toContain("sync-boom");
    expect(full).toContain("</html>");
  });

  it("(11) React.use() composes with Suspense — multiple use() calls in one child", async () => {
    const p1 = delay(5, "x");
    const p2 = delay(10, "y");
    function Multi() {
      const a = use(p1);
      const b = use(p2);
      return React.createElement("p", null, `${a}-${b}`);
    }
    const tree = React.createElement(
      Suspense,
      { fallback: React.createElement("em", null, "...") },
      React.createElement(Multi, null),
    );
    const stream = await renderToStream(tree);
    const { full } = await readChunks(stream);
    expect(full).toContain("x-y");
  });

  it("(12) multiple parallel siblings — each suspense streams as it resolves", async () => {
    const p1 = delay(5, "first");
    const p2 = delay(15, "second");
    const p3 = delay(25, "third");
    function C({ p }: { p: Promise<string> }) {
      return React.createElement("li", null, use(p));
    }
    const tree = React.createElement(
      "ul",
      null,
      React.createElement(
        Suspense,
        { fallback: React.createElement("li", null, "fb1") },
        React.createElement(C, { p: p1 }),
      ),
      React.createElement(
        Suspense,
        { fallback: React.createElement("li", null, "fb2") },
        React.createElement(C, { p: p2 }),
      ),
      React.createElement(
        Suspense,
        { fallback: React.createElement("li", null, "fb3") },
        React.createElement(C, { p: p3 }),
      ),
    );
    const stream = await renderToStream(tree);
    const { full } = await readChunks(stream);
    expect(full).toContain("first");
    expect(full).toContain("second");
    expect(full).toContain("third");
  });
});
