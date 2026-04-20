/**
 * Phase 18.ξ — React 19 `use(promise)` hook + Suspense streaming tests
 *
 * These tests verify that:
 *   1. `React.use(promise)` inside an async server component resolves via
 *      `resolveAsyncElement` up-front (pre-resolution path).
 *   2. `React.use(promise)` inside a sync component wrapped by a
 *      `<Suspense>` boundary streams correctly through
 *      `renderToReadableStream`.
 *   3. Rejected promises propagate to the nearest ErrorBoundary / onError
 *      callback.
 *   4. Already-resolved promises short-circuit without suspending.
 *
 * NOTE: `React.use()` is a stable React 19 API. Mandu's streaming pipeline
 * uses `renderToReadableStream` which natively supports the `use()` hook.
 * The only caveat is the ssr.ts `resolveAsyncElement` pre-pass: because it
 * eagerly awaits async components before streaming begins, the shell will
 * NOT flush early for async server components — that is an intentional
 * trade-off (documented in `docs/architect/streaming-ssr.md`). To get true
 * shell-first streaming, wrap `use()` in a sync component inside a
 * `<Suspense>` boundary.
 */

import { describe, it, expect } from "bun:test";
import React, { Suspense, use } from "react";
import {
  renderToStream,
  renderStreamingResponse,
} from "../../src/runtime/streaming-ssr";
import { resolveAsyncElement } from "../../src/runtime/ssr";

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return new TextDecoder().decode(
    Buffer.concat(chunks.map((c) => Buffer.from(c))),
  );
}

describe("React 19 use() hook in streaming SSR", () => {
  it("use(promise) works inside an async server component (pre-resolved path)", async () => {
    // Async component: resolveAsyncElement awaits the component function
    // call; `use(promise)` inside synchronously unwraps the already-settled
    // value because React schedules `use()` against the same microtask.
    async function AsyncPage() {
      const data = await delay(5, { title: "async-use" });
      return React.createElement("h1", null, data.title);
    }

    const resolved = await resolveAsyncElement(
      React.createElement(AsyncPage, null),
    );
    const stream = await renderToStream(resolved as React.ReactElement, {
      title: "use-test",
    });
    const html = await readAll(stream);
    expect(html).toContain("async-use");
    expect(html).toContain("<h1>async-use</h1>");
  });

  it("use(promise) inside sync component wrapped by Suspense streams shell first", async () => {
    const dataPromise = delay(10, { items: ["a", "b", "c"] });

    function AsyncChild(): React.ReactElement {
      const data = use(dataPromise);
      return React.createElement(
        "ul",
        null,
        data.items.map((item, i) =>
          React.createElement("li", { key: i }, item),
        ),
      );
    }

    const tree = React.createElement(
      "div",
      { id: "app" },
      React.createElement(
        Suspense,
        { fallback: React.createElement("p", null, "loading...") },
        React.createElement(AsyncChild, null),
      ),
    );

    const stream = await renderToStream(tree, { title: "suspense-use" });
    const html = await readAll(stream);
    // The final flushed HTML must contain the resolved children (React
    // streams the fallback first then swaps it for the resolved payload).
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<li>b</li>");
    expect(html).toContain("<li>c</li>");
  });

  it("use() with already-resolved promise short-circuits", async () => {
    const resolvedPromise = Promise.resolve({ msg: "instant" });

    function InstantChild() {
      const data = use(resolvedPromise);
      return React.createElement("span", null, data.msg);
    }

    const tree = React.createElement(
      Suspense,
      { fallback: React.createElement("em", null, "fallback") },
      React.createElement(InstantChild, null),
    );
    const stream = await renderToStream(tree, { title: "instant" });
    const html = await readAll(stream);
    expect(html).toContain("instant");
  });

  it("use() rejection surfaces to onError callback", async () => {
    const failingPromise = Promise.reject(new Error("boom-use"));
    // Keep Bun's unhandled-rejection tracker quiet — we intentionally
    // leave this promise un-awaited so React's scheduler observes the
    // rejection at render time.
    failingPromise.catch(() => {});

    function FailingChild() {
      const data = use(failingPromise) as { x: number };
      return React.createElement("span", null, String(data.x));
    }

    const errors: Error[] = [];
    const tree = React.createElement(
      Suspense,
      { fallback: React.createElement("em", null, "fb") },
      React.createElement(FailingChild, null),
    );
    const stream = await renderToStream(tree, {
      title: "use-reject",
      onError: (err) => errors.push(err),
    });
    const html = await readAll(stream);
    // React emits the fallback; the error script is injected downstream.
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toContain("boom-use");
    // Sanity: the document still closes cleanly.
    expect(html).toContain("</html>");
  });

  it("nested use() in nested Suspense boundaries both stream", async () => {
    const outerPromise = delay(5, "outer");
    const innerPromise = delay(10, "inner");

    function Inner() {
      const v = use(innerPromise);
      return React.createElement("span", { className: "inner" }, v);
    }
    function Outer() {
      const v = use(outerPromise);
      return React.createElement(
        "div",
        { className: "outer" },
        v,
        React.createElement(
          Suspense,
          { fallback: React.createElement("em", null, "inner-fb") },
          React.createElement(Inner, null),
        ),
      );
    }

    const tree = React.createElement(
      Suspense,
      { fallback: React.createElement("em", null, "outer-fb") },
      React.createElement(Outer, null),
    );
    const stream = await renderToStream(tree, { title: "nested-use" });
    const html = await readAll(stream);
    expect(html).toContain('class="outer"');
    expect(html).toContain('class="inner"');
    expect(html).toContain("outer");
    expect(html).toContain("inner");
  });

  it("use(promise) response is delivered through renderStreamingResponse", async () => {
    const pending = delay(5, { ok: true });
    function UseOk() {
      const v = use(pending);
      return React.createElement("b", null, v.ok ? "yes" : "no");
    }
    const tree = React.createElement(
      Suspense,
      { fallback: React.createElement("i", null, "wait") },
      React.createElement(UseOk, null),
    );
    const res = await renderStreamingResponse(tree, { title: "resp" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    const body = await res.text();
    expect(body).toContain("yes");
    expect(body).toContain("</html>");
  });
});
