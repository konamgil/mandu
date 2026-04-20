/**
 * Issue #221 — Prerendered HTML served with incorrect `immutable`
 * Cache-Control header.
 *
 * Phase 18.γ's `tryServePrerendered()` short-circuits dispatch for any
 * URL that `mandu build` emitted under `.mandu/prerendered/`. The
 * original implementation stamped every such response with
 * `Cache-Control: public, max-age=31536000, immutable`. Prerendered
 * HTML lives at a stable URL (route → file — no content hash), so
 * `immutable` meant browsers pinned stale HTML for up to a year after
 * every deploy. This is the same failure mode #218 fixed for
 * `/.mandu/client/*`; the runtime fix reuses the same helpers.
 *
 * Contract tested here:
 *   1. Prerendered HTML served with `public, max-age=0, must-revalidate`
 *      by default (no `immutable`).
 *   2. Strong ETag emitted on the 200 response.
 *   3. `If-None-Match: "<etag>"` → `304 Not Modified`, empty body,
 *      `Cache-Control` + `ETag` preserved.
 *   4. Mismatched `If-None-Match` → 200 with fresh body.
 *   5. `If-None-Match: *` → 304 (wildcard per RFC 7232 §3.2).
 *   6. Comma-separated `If-None-Match` list → 304 when any entry matches.
 *   7. Weak form (`W/"<etag>"`) matches a strong server ETag.
 *   8. `PrerenderSettings.cacheControl` override is honoured verbatim
 *      (adapters in front of invalidating CDNs may opt into aggressive
 *      caching).
 *   9. Editing the prerendered file changes the ETag.
 *  10. Dev mode forces `no-cache, no-store, must-revalidate`.
 *  11. `X-Mandu-Cache: PRERENDERED` observability header present on
 *      both 200 and 304.
 *  12. HEAD request omits the body but keeps every header.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  startServer,
  createServerRegistry,
  __clearStaticEtagCacheForTests,
  type ManduServer,
  type ServerRegistry,
} from "../../src/runtime/server";
import type { RoutesManifest } from "../../src/spec/schema";
import {
  DEFAULT_PRERENDER_DIR,
  PRERENDER_INDEX_FILE,
  type PrerenderIndex,
} from "../../src/bundler/prerender";
import path from "path";
import fs from "fs/promises";
import os from "os";

const emptyManifest: RoutesManifest = { version: 1, routes: [] };

/**
 * Mint a throwaway project root with a valid prerender index + one
 * known HTML page. Mirrors what `mandu build` writes under
 * `.mandu/prerendered/`.
 */
async function seedPrerenderedProject(
  root: string,
  pathname: string,
  html: string,
): Promise<string> {
  const outDir = path.join(root, DEFAULT_PRERENDER_DIR);
  // Derive the on-disk file path from the pathname the same way
  // `bundler/prerender.ts` does (`/foo` → `foo/index.html`, `/` →
  // `index.html`). Tests don't exercise the optional-catchall edge
  // cases — those are covered by the bundler tests.
  const relative =
    pathname === "/"
      ? "index.html"
      : `${pathname.replace(/^\/+/, "").replace(/\/+$/, "")}/index.html`;
  const filePath = path.join(outDir, relative);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, html, "utf-8");

  const index: PrerenderIndex = {
    version: 1,
    generatedAt: new Date().toISOString(),
    pages: { [pathname]: relative.replace(/\\/g, "/") },
  };
  await fs.writeFile(
    path.join(outDir, PRERENDER_INDEX_FILE),
    JSON.stringify(index, null, 2),
    "utf-8",
  );
  return filePath;
}

describe("Issue #221 — prerendered HTML Cache-Control", () => {
  let server: ManduServer | null = null;
  let registry: ServerRegistry;
  let TEST_DIR: string;

  beforeEach(async () => {
    __clearStaticEtagCacheForTests();
    registry = createServerRegistry();
    TEST_DIR = await fs.mkdtemp(
      path.join(os.tmpdir(), "mandu-prerender-cc-"),
    );
  });

  afterEach(async () => {
    if (server) {
      server.stop();
      server = null;
    }
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  // ── Default policy: must-revalidate, no immutable ─────────────────────

  it("default prerendered response gets must-revalidate (not immutable)", async () => {
    await seedPrerenderedProject(
      TEST_DIR,
      "/docs/intro",
      "<!doctype html><title>intro</title>",
    );
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
    });
    const res = await fetch(
      `http://localhost:${server.server.port}/docs/intro`,
    );

    expect(res.status).toBe(200);
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toBe("public, max-age=0, must-revalidate");
    expect(cc).not.toContain("immutable");
    expect(cc).not.toMatch(/max-age=(?!0\b)/);
    expect(res.headers.get("X-Mandu-Cache")).toBe("PRERENDERED");
    const body = await res.text();
    expect(body).toContain("<title>intro</title>");
  });

  it("root path `/` also gets must-revalidate", async () => {
    await seedPrerenderedProject(
      TEST_DIR,
      "/",
      "<!doctype html><title>home</title>",
    );
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
    });
    const res = await fetch(`http://localhost:${server.server.port}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });

  // ── ETag emission ────────────────────────────────────────────────────

  it("prerendered response carries a strong ETag (no W/ prefix)", async () => {
    await seedPrerenderedProject(
      TEST_DIR,
      "/docs/intro",
      "<!doctype html><title>intro</title>",
    );
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
    });
    const res = await fetch(
      `http://localhost:${server.server.port}/docs/intro`,
    );

    const etag = res.headers.get("ETag");
    expect(etag).toBeTruthy();
    expect(etag!.startsWith("\"")).toBe(true);
    expect(etag!.startsWith("W/")).toBe(false);
    expect(etag!).toMatch(/^"[a-z0-9]+"$/);
  });

  it("different HTML content yields a different ETag", async () => {
    const filePath = await seedPrerenderedProject(
      TEST_DIR,
      "/docs/intro",
      "<!doctype html><title>v1</title>",
    );
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
    });
    const url = `http://localhost:${server.server.port}/docs/intro`;

    const etagA = (await fetch(url)).headers.get("ETag");

    // Bump mtime + content so the cache key changes deterministically
    // (1s guarantees bucket change on FAT-like filesystems too).
    await new Promise((r) => setTimeout(r, 1100));
    await fs.writeFile(filePath, "<!doctype html><title>v2 — new</title>");
    __clearStaticEtagCacheForTests();

    const etagB = (await fetch(url)).headers.get("ETag");
    expect(etagA).toBeTruthy();
    expect(etagB).toBeTruthy();
    expect(etagA).not.toBe(etagB);
  });

  // ── Conditional GET (304) ────────────────────────────────────────────

  it("If-None-Match round-trip produces 304 with empty body", async () => {
    await seedPrerenderedProject(
      TEST_DIR,
      "/docs/intro",
      "<!doctype html><title>intro</title>",
    );
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
    });
    const url = `http://localhost:${server.server.port}/docs/intro`;

    const first = await fetch(url);
    const etag = first.headers.get("ETag")!;
    await first.text();

    const second = await fetch(url, { headers: { "If-None-Match": etag } });
    expect(second.status).toBe(304);
    expect(second.headers.get("ETag")).toBe(etag);
    expect(second.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(second.headers.get("X-Mandu-Cache")).toBe("PRERENDERED");

    const body = await second.arrayBuffer();
    expect(body.byteLength).toBe(0);
  });

  it("mismatched If-None-Match falls through to 200 with body", async () => {
    await seedPrerenderedProject(
      TEST_DIR,
      "/docs/intro",
      "<!doctype html><title>fresh body</title>",
    );
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
    });
    const res = await fetch(
      `http://localhost:${server.server.port}/docs/intro`,
      { headers: { "If-None-Match": "\"not-the-right-hash\"" } },
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("fresh body");
  });

  it("If-None-Match `*` wildcard matches any current representation", async () => {
    await seedPrerenderedProject(
      TEST_DIR,
      "/docs/intro",
      "<!doctype html><title>intro</title>",
    );
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
    });
    const res = await fetch(
      `http://localhost:${server.server.port}/docs/intro`,
      { headers: { "If-None-Match": "*" } },
    );
    expect(res.status).toBe(304);
  });

  it("comma-separated If-None-Match matches when any entry matches", async () => {
    await seedPrerenderedProject(
      TEST_DIR,
      "/docs/intro",
      "<!doctype html><title>intro</title>",
    );
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
    });
    const url = `http://localhost:${server.server.port}/docs/intro`;

    const etag = (await fetch(url)).headers.get("ETag")!;
    const res = await fetch(url, {
      headers: { "If-None-Match": `"old-etag", ${etag}, "other"` },
    });
    expect(res.status).toBe(304);
  });

  it("weak-form If-None-Match (`W/...`) matches strong server ETag", async () => {
    await seedPrerenderedProject(
      TEST_DIR,
      "/docs/intro",
      "<!doctype html><title>intro</title>",
    );
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
    });
    const url = `http://localhost:${server.server.port}/docs/intro`;

    const strongEtag = (await fetch(url)).headers.get("ETag")!;
    const weakForm = `W/${strongEtag}`;
    const res = await fetch(url, { headers: { "If-None-Match": weakForm } });
    expect(res.status).toBe(304);
  });

  // ── User override precedence ─────────────────────────────────────────

  it("PrerenderSettings.cacheControl override is honoured verbatim", async () => {
    await seedPrerenderedProject(
      TEST_DIR,
      "/docs/intro",
      "<!doctype html><title>intro</title>",
    );
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
      prerender: { cacheControl: "public, max-age=60" },
    });
    const res = await fetch(
      `http://localhost:${server.server.port}/docs/intro`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    // ETag still emitted even when user overrides Cache-Control — the
    // override is about caching policy, not validator emission.
    expect(res.headers.get("ETag")).toMatch(/^"[a-z0-9]+"$/);
  });

  it("override `immutable` string is replaced by the framework default (legacy upgrade)", async () => {
    // Simulates a project upgrading from pre-#221 where the old
    // immutable default may have been persisted somewhere. The runtime
    // now treats that exact string as "framework default" and replaces
    // it with the safe must-revalidate policy.
    await seedPrerenderedProject(
      TEST_DIR,
      "/docs/intro",
      "<!doctype html><title>intro</title>",
    );
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
      prerender: { cacheControl: "public, max-age=31536000, immutable" },
    });
    const res = await fetch(
      `http://localhost:${server.server.port}/docs/intro`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(res.headers.get("Cache-Control")).not.toContain("immutable");
  });

  // ── Dev mode ────────────────────────────────────────────────────────

  it("dev mode forces no-cache on prerendered HTML", async () => {
    await seedPrerenderedProject(
      TEST_DIR,
      "/docs/intro",
      "<!doctype html><title>intro</title>",
    );
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
      isDev: true,
    });
    const res = await fetch(
      `http://localhost:${server.server.port}/docs/intro`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "no-cache, no-store, must-revalidate",
    );
  });

  // ── HEAD request ────────────────────────────────────────────────────

  it("HEAD request keeps headers but drops the body", async () => {
    await seedPrerenderedProject(
      TEST_DIR,
      "/docs/intro",
      "<!doctype html><title>intro</title>",
    );
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
    });
    const res = await fetch(
      `http://localhost:${server.server.port}/docs/intro`,
      { method: "HEAD" },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(res.headers.get("ETag")).toMatch(/^"[a-z0-9]+"$/);
    expect(res.headers.get("X-Mandu-Cache")).toBe("PRERENDERED");
    const body = await res.arrayBuffer();
    expect(body.byteLength).toBe(0);
  });
});
