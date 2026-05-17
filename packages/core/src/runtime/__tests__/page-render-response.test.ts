import { describe, expect, it } from "bun:test";
import React from "react";
import { renderPageResponse } from "../page-render-response";

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
});
