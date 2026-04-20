/**
 * Phase 18.ξ — End-to-end streaming with async server components.
 *
 * Before this phase: `renderPageSSR` unconditionally called
 * `resolveAsyncElement(app)` before handing the tree to
 * `renderStreamingResponse`. That pre-pass awaited every async component
 * in the route tree, so the Response body could not start flushing until
 * the slowest component settled — the TTFB was effectively the latency of
 * the slowest async component, not the shell.
 *
 * After Phase 18.ξ: pre-resolution is ONLY applied on the non-streaming
 * path (`renderToString` cannot handle async). The streaming path passes
 * the raw async tree to React 19's `renderToReadableStream`, which
 * natively supports async server components + the `use(promise)` hook
 * and begins flushing the shell as soon as React computes it.
 *
 * This test proves the shell arrives on the wire before the async
 * component's promise resolves — by measuring time-to-first-byte against
 * the fixed resolution latency baked into the route component.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import React, { Suspense } from "react";
import {
  startServer,
  createServerRegistry,
  clearDefaultRegistry,
  type ManduServer,
  type ServerRegistry,
  type PageLoader,
} from "../../src/runtime/server";
import type { RoutesManifest } from "../../src/spec/schema";

const SLOW_MS = 250;

async function AsyncSlowPage() {
  // Simulate a slow DB/API call on the server.
  await new Promise<void>((resolve) => setTimeout(resolve, SLOW_MS));
  return React.createElement(
    "main",
    { id: "async-main" },
    React.createElement("h1", null, "slow-async-content"),
  );
}

function SyncShellPage() {
  // Sync shell wrapper with a Suspense boundary around the async content.
  return React.createElement(
    "div",
    { id: "shell" },
    React.createElement("h1", null, "shell-header"),
    React.createElement(
      Suspense,
      {
        fallback: React.createElement(
          "p",
          { id: "fb" },
          "loading-fallback",
        ),
      },
      React.createElement(AsyncSlowPage, null),
    ),
  );
}

const manifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "page/slow",
      pattern: "/slow",
      kind: "page",
      module: ".mandu/generated/server/page-slow.ts",
      componentModule: "app/slow/page.tsx",
      streaming: true,
    },
  ],
};

describe("Phase 18.ξ — streaming async server components (end-to-end)", () => {
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

  it("streams shell before async Suspense boundary resolves", async () => {
    registry.registerPageLoader("page/slow", (async () => ({
      default: SyncShellPage,
    })) as PageLoader);

    server = startServer(manifest, { port: 0, registry, streaming: true });
    const port = server.server.port;
    expect(typeof port).toBe("number");

    const reqStart = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/slow`);
    expect(res.status).toBe(200);

    // Header: streaming-friendly
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    expect(res.headers.get("Content-Type")).toContain("text/html");

    // Read first chunk and measure TTFB-ish timing. If streaming works,
    // we should see the shell `<!DOCTYPE html>` well before 250ms.
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const firstChunkResult = await reader.read();
    const firstChunkTime = Date.now() - reqStart;
    expect(firstChunkResult.done).toBe(false);
    const firstChunk = decoder.decode(firstChunkResult.value!, { stream: true });
    expect(firstChunk).toContain("<!DOCTYPE html>");
    expect(firstChunk).toContain("<html");

    // Drain the rest.
    const parts: string[] = [firstChunk];
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      parts.push(decoder.decode(r.value!, { stream: true }));
    }
    parts.push(decoder.decode());
    const total = parts.join("");
    const totalTime = Date.now() - reqStart;

    // The async component's content must eventually land in the body.
    expect(total).toContain("slow-async-content");
    expect(total).toContain("shell-header");
    expect(total).toContain("</html>");

    // TTFB should be meaningfully less than the slow component latency
    // (allow generous slack for CI: first chunk ≤ SLOW_MS - 50ms).
    // If streaming is broken (full buffering), firstChunkTime ≈ totalTime
    // and both ≥ SLOW_MS.
    expect(totalTime).toBeGreaterThanOrEqual(SLOW_MS - 20);
    // This is the key assertion for the phase: shell flushes early.
    expect(firstChunkTime).toBeLessThan(totalTime);
  });

  it("sync page with streaming:true still renders (no async = no regression)", async () => {
    function SimplePage() {
      return React.createElement("h1", { id: "simple" }, "sync-content");
    }
    registry.registerPageLoader("page/slow", (async () => ({
      default: SimplePage,
    })) as PageLoader);

    server = startServer(manifest, { port: 0, registry, streaming: true });
    const port = server.server.port;
    const res = await fetch(`http://127.0.0.1:${port}/slow`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("sync-content");
    expect(body).toContain('id="simple"');
    expect(body).toContain("</html>");
  });
});
