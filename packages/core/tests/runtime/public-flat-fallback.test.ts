/**
 * Issue #251 — `mandu dev` 가 `/public/<asset>` 경로로만 정적 파일을 서빙해
 * `mandu build --static` 의 평탄화(public/* → dist 루트)와 dev 가 어긋났다.
 *
 * 작성자가 `<img src="/images/foo.webp">` 처럼 `/public/` 없이 참조하면 prod
 * 에서는 200, dev 에서는 404 였다. 이 테스트는 dev/prod 양쪽에서 자산 확장자
 * 가 있는 root URL 이 `public/<rest>` 로 fallback 되는지 확인한다.
 *
 * 추가로 라우트가 fallback 보다 우선되는지(파일이 없으면 라우터로 흘러가는지)
 * 도 검증한다 — `/api/foo.json` 같은 라우트가 가려지지 않아야 한다.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  startServer,
  createServerRegistry,
  type ManduServer,
  type ServerRegistry,
} from "../../src/runtime/server";
import type { RoutesManifest } from "../../src/spec/schema";
import path from "path";
import fs from "fs/promises";
import os from "os";

const emptyManifest: RoutesManifest = { version: 1, routes: [] };

describe("Issue #251 — public flat-fallback", () => {
  let server: ManduServer | null = null;
  let registry: ServerRegistry;
  let TEST_DIR: string;

  beforeEach(async () => {
    registry = createServerRegistry();
    TEST_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-public-flat-"));
    await fs.mkdir(path.join(TEST_DIR, "public", "images"), { recursive: true });
    await fs.writeFile(path.join(TEST_DIR, "public", "images", "hero.webp"), "fake-webp");
    await fs.writeFile(path.join(TEST_DIR, "public", "logo.png"), "fake-png");
  });

  afterEach(async () => {
    if (server) {
      server.stop();
      server = null;
    }
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("serves /images/hero.webp from public/images/hero.webp (flat fallback)", async () => {
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
      isDev: true,
    });
    const res = await fetch(`http://localhost:${server.server.port}/images/hero.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/webp");
  });

  it("still serves /public/images/hero.webp (legacy form)", async () => {
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
      isDev: true,
    });
    const res = await fetch(`http://localhost:${server.server.port}/public/images/hero.webp`);
    expect(res.status).toBe(200);
  });

  it("returns 404 for missing asset with asset extension when no route matches", async () => {
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
      isDev: true,
    });
    const res = await fetch(`http://localhost:${server.server.port}/images/missing.webp`);
    expect(res.status).toBe(404);
  });

  it("non-asset path (no recognised extension) falls through to routing untouched", async () => {
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
      isDev: true,
    });
    // No matching route, no public file — falls through to 404 from the router,
    // not blocked by the static handler.
    const res = await fetch(`http://localhost:${server.server.port}/some/api/path`);
    expect(res.status).toBe(404);
  });

  it("falls through to dotted FS routes like /robots.txt when public file is missing", async () => {
    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          id: "robots.txt",
          pattern: "/robots.txt",
          kind: "api",
          module: "app/robots.txt/route.ts",
          methods: ["GET"],
        },
      ],
    };
    registry.registerApiHandler(
      "robots.txt",
      async () => new Response("User-agent: *\nAllow: /\n", {
        headers: { "Content-Type": "text/plain" },
      }),
    );
    server = startServer(manifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
      isDev: true,
    });

    const res = await fetch(`http://localhost:${server.server.port}/robots.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("User-agent");
  });

  it("flat-fallback also works in production mode", async () => {
    server = startServer(emptyManifest, {
      port: 0,
      rootDir: TEST_DIR,
      registry,
      isDev: false,
    });
    const res = await fetch(`http://localhost:${server.server.port}/logo.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/png");
  });
});
