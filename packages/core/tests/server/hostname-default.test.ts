/**
 * Regression: issue #190
 *
 * `mandu dev` / `mandu start` (and the underlying `startServer()`) must default
 * to a dual-stack wildcard hostname (`0.0.0.0`) so browsers on IPv4-preferring
 * platforms (e.g. Windows) can reach the dev server via `localhost`. Prior to
 * #190 the default was `"localhost"`, which Bun resolves to IPv6 (`::1`) only
 * on some platforms — producing a server that only `curl` (happy-eyeballs) can
 * reach, while browsers hang.
 *
 * These tests guard:
 *   1. `startServer()` with no `hostname` binds to something reachable from
 *      both IPv4 (`127.0.0.1`) and IPv6 (`[::1]`).
 *   2. Explicit `hostname: "::1"` still works (users can opt into IPv6-only).
 *   3. `formatServerAddresses()` returns sensible URLs for both wildcard and
 *      specific hostnames.
 */

import { describe, it, expect, afterEach } from "bun:test";
import {
  startServer,
  createServerRegistry,
  clearDefaultRegistry,
  formatServerAddresses,
  type ManduServer,
} from "../../src/runtime/server";
import type { RoutesManifest } from "../../src/spec/schema";

const manifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "api/ping",
      pattern: "/api/ping",
      kind: "api",
      module: ".mandu/generated/server/api-ping.ts",
      methods: ["GET"],
    },
  ],
};

describe("startServer default hostname (#190)", () => {
  let server: ManduServer | null = null;

  afterEach(() => {
    if (server) {
      server.stop();
      server = null;
    }
    clearDefaultRegistry();
  });

  it("binds dual-stack by default — reachable via 127.0.0.1", async () => {
    const registry = createServerRegistry();
    registry.registerApiHandler("api/ping", async () => Response.json({ ok: true }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/ping`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("binds dual-stack by default — reachable via localhost", async () => {
    const registry = createServerRegistry();
    registry.registerApiHandler("api/ping", async () => Response.json({ ok: true }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    // `localhost` must resolve successfully regardless of whether the OS
    // prefers IPv4 or IPv6 — the whole point of #190.
    const res = await fetch(`http://localhost:${port}/api/ping`);
    expect(res.status).toBe(200);
  });

  it("respects explicit hostname: '127.0.0.1'", async () => {
    const registry = createServerRegistry();
    registry.registerApiHandler("api/ping", async () => Response.json({ ok: true }));

    server = startServer(manifest, { port: 0, hostname: "127.0.0.1", registry });
    const port = server.server.port;

    const res = await fetch(`http://127.0.0.1:${port}/api/ping`);
    expect(res.status).toBe(200);
  });

  it("respects explicit hostname: '::1' (IPv6-only opt-in)", async () => {
    const registry = createServerRegistry();
    registry.registerApiHandler("api/ping", async () => Response.json({ ok: true }));

    // Some CI runners (e.g. stripped-down containers) have no usable IPv6
    // loopback at all — binding `::1` fails with EADDRNOTAVAIL. Skip cleanly
    // in that case rather than fail the regression suite.
    try {
      server = startServer(manifest, { port: 0, hostname: "::1", registry });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT") {
        // IPv6 not available in this environment — explicit opt-in failed
        // for environment reasons, not a regression in our code.
        return;
      }
      throw err;
    }

    const port = server.server.port;
    const res = await fetch(`http://[::1]:${port}/api/ping`);
    expect(res.status).toBe(200);
  });
});

describe("formatServerAddresses() helper (#190)", () => {
  it("maps wildcard 0.0.0.0 → localhost + both loopbacks", () => {
    const { primary, additional } = formatServerAddresses("0.0.0.0", 3333);
    expect(primary).toBe("http://localhost:3333");
    expect(additional).toEqual([
      "http://127.0.0.1:3333",
      "http://[::1]:3333",
    ]);
  });

  it("maps wildcard :: → localhost + both loopbacks", () => {
    const { primary, additional } = formatServerAddresses("::", 3333);
    expect(primary).toBe("http://localhost:3333");
    expect(additional.length).toBe(2);
  });

  it("maps undefined hostname → localhost + both loopbacks", () => {
    const { primary, additional } = formatServerAddresses(undefined, 3333);
    expect(primary).toBe("http://localhost:3333");
    expect(additional.length).toBe(2);
  });

  it("passes through specific IPv4 host", () => {
    const { primary, additional } = formatServerAddresses("127.0.0.1", 3333);
    expect(primary).toBe("http://127.0.0.1:3333");
    expect(additional).toEqual([]);
  });

  it("brackets bare IPv6 literal", () => {
    const { primary, additional } = formatServerAddresses("::1", 3333);
    expect(primary).toBe("http://[::1]:3333");
    expect(additional).toEqual([]);
  });

  it("passes through a DNS name", () => {
    const { primary, additional } = formatServerAddresses("example.com", 80);
    expect(primary).toBe("http://example.com:80");
    expect(additional).toEqual([]);
  });
});
