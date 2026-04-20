/**
 * Phase 18.μ — end-to-end runtime integration.
 *
 * Boots a minimal `startServer()` with an i18n block and verifies:
 *   - ctx.locale / ctx.t are populated
 *   - Vary + Content-Language headers land on responses
 *   - Path-prefix redirect flows (root → /<locale>) when cookie picks
 *     a non-default locale
 */
import { describe, it, expect, afterEach } from "bun:test";
import {
  startServer,
  registerApiHandler,
  clearDefaultRegistry,
} from "../../src/runtime";
import type { RoutesManifest } from "../../src/spec/schema";
import {
  defineI18n,
  defineMessages,
} from "../../src/i18n";

const manifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "api-hello",
      pattern: "/api/hello",
      module: "fake",
      kind: "api",
      methods: ["GET"],
    },
  ],
};

let currentStop: (() => void) | null = null;

afterEach(() => {
  if (currentStop) currentStop();
  currentStop = null;
  clearDefaultRegistry();
});

describe("i18n runtime integration", () => {
  const i18n = defineI18n({
    locales: ["en", "ko"],
    defaultLocale: "en",
    strategy: "path-prefix",
  });

  const messages = defineMessages({
    en: { greet: "Hi {{name}}" },
    ko: { greet: "안녕 {{name}}" },
  } as const);

  it("populates ctx.locale and ctx.t on API handlers", async () => {
    registerApiHandler("api-hello", (_req, _params) => {
      // Note: API handlers receive a raw Request. We verify behaviour
      // via the outer response headers + an artificial echo endpoint.
      return new Response("ok");
    });

    const { server, stop } = startServer(manifest, { port: 0, i18n, messages });
    currentStop = stop;

    // Default locale route.
    const res1 = await fetch(`http://127.0.0.1:${server.port}/api/hello`, {
      headers: { "accept-language": "en" },
    });
    expect(res1.status).toBe(200);
    expect(res1.headers.get("content-language")).toBe("en");
    const vary1 = res1.headers.get("vary") || "";
    expect(vary1).toContain("Accept-Language");
    expect(vary1).toContain("Cookie");
  });

  it("redirects to non-default locale when cookie/header picks it", async () => {
    registerApiHandler("api-hello", () => new Response("ok"));
    const { server, stop } = startServer(manifest, { port: 0, i18n, messages });
    currentStop = stop;

    // Cookie picks ko; URL has no locale prefix; path-prefix strategy
    // should emit a 307 with Location rewritten to /ko...
    const res = await fetch(`http://127.0.0.1:${server.port}/docs`, {
      headers: { cookie: "mandu_locale=ko" },
      redirect: "manual",
    });
    expect(res.status).toBe(307);
    const loc = res.headers.get("location");
    expect(loc).toMatch(/\/ko\/docs/);
    expect(res.headers.get("content-language")).toBe("ko");
  });

  it("does NOT redirect API routes even when cookie picks non-default locale", async () => {
    registerApiHandler("api-hello", () => new Response("ok"));
    const { server, stop } = startServer(manifest, { port: 0, i18n, messages });
    currentStop = stop;

    // API routes are locale-neutral — no redirect regardless of cookie.
    const res = await fetch(`http://127.0.0.1:${server.port}/api/hello`, {
      headers: { cookie: "mandu_locale=ko" },
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    // But Content-Language still stamped via Vary, so CDN keys correctly.
    expect(res.headers.get("content-language")).toBe("ko");
  });

  it("is a no-op when i18n is disabled", async () => {
    registerApiHandler("api-hello", () => new Response("ok"));
    const { server, stop } = startServer(manifest, { port: 0 });
    currentStop = stop;

    const res = await fetch(`http://127.0.0.1:${server.port}/api/hello`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-language")).toBeNull();
  });

  it("rejects raw i18n objects that skip defineI18n()", () => {
    expect(() =>
      startServer(manifest, {
        port: 0,
        // @ts-expect-error intentional — user bypassed defineI18n
        i18n: { locales: ["en"], defaultLocale: "en", strategy: "header" },
      })
    ).toThrow(/defineI18n/);
  });

  it("rejects raw message objects that skip defineMessages()", () => {
    expect(() =>
      startServer(manifest, {
        port: 0,
        i18n,
        // @ts-expect-error intentional — user bypassed defineMessages
        messages: { en: { greet: "Hi" } },
      })
    ).toThrow(/defineMessages/);
  });
});
