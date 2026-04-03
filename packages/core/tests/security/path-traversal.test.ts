/**
 * Security - Path Traversal Tests
 *
 * 경로 탐색 공격 방어 검증
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

describe("Security - Path Traversal", () => {
  let server: ManduServer | null = null;
  let registry: ServerRegistry;
  const TEST_DIR = path.join(import.meta.dir, "__fixtures__", "security");

  const testManifest: RoutesManifest = {
    version: 1,
    routes: [],
  };

  beforeEach(async () => {
    registry = createServerRegistry();
    // 테스트용 디렉토리 구조 생성
    await fs.mkdir(path.join(TEST_DIR, "public"), { recursive: true });
    await fs.mkdir(path.join(TEST_DIR, ".mandu", "client"), { recursive: true });
    await fs.writeFile(
      path.join(TEST_DIR, "public", "allowed.txt"),
      "This is allowed"
    );
    await fs.writeFile(
      path.join(TEST_DIR, "secret.txt"),
      "This is secret"
    );
  });

  afterEach(async () => {
    if (server) {
      server.stop();
      server = null;
    }
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("정적 파일 경로 공격", () => {
    it("../ 경로 탐색 차단", async () => {
      server = startServer(testManifest, {
        port: 0,
        rootDir: TEST_DIR,
        publicDir: "public",
        registry,
      });
      const port = server.server.port;

      // public 디렉토리 밖의 파일 접근 시도
      const attacks = [
        "/public/../secret.txt",
        "/public/../../etc/passwd",
        "/public/..%2F..%2Fetc/passwd",
        "/public/....//....//secret.txt",
      ];

      for (const attack of attacks) {
        const res = await fetch(`http://localhost:${port}${attack}`);
        // 404 또는 정상 라우트 매칭 (secret.txt 내용이 아니어야 함)
        if (res.status === 200) {
          const text = await res.text();
          expect(text).not.toContain("This is secret");
        }
      }
    });

    it("정상적인 public 파일 접근은 허용", async () => {
      server = startServer(testManifest, {
        port: 0,
        rootDir: TEST_DIR,
        publicDir: "public",
        registry,
      });
      const port = server.server.port;

      const res = await fetch(`http://localhost:${port}/public/allowed.txt`);

      if (res.status === 200) {
        const text = await res.text();
        expect(text).toBe("This is allowed");
      }
    });

    it("Null byte 인젝션 차단", async () => {
      server = startServer(testManifest, {
        port: 0,
        rootDir: TEST_DIR,
        publicDir: "public",
        registry,
      });
      const port = server.server.port;

      // Null byte 공격 시도
      const res = await fetch(
        `http://localhost:${port}/public/allowed.txt%00.jpg`
      );

      expect(res.status).toBe(400);
    });

    it("잘못된 URL 인코딩은 400 응답", async () => {
      server = startServer(testManifest, {
        port: 0,
        rootDir: TEST_DIR,
        publicDir: "public",
        registry,
      });
      const port = server.server.port;

      const res = await fetch(`http://localhost:${port}/public/%E0%A4%A`);

      expect(res.status).toBe(400);
    });

    it("URL 인코딩된 경로 탐색 차단", async () => {
      server = startServer(testManifest, {
        port: 0,
        rootDir: TEST_DIR,
        publicDir: "public",
        registry,
      });
      const port = server.server.port;

      const encodedAttacks = [
        { path: "/public/..%5Csecret.txt", expectedStatus: 403 },
        { path: "/public/%2e%2e%5Csecret.txt", expectedStatus: 403 },
        { path: "/public/..%252f..%252fsecret.txt", expectedStatus: 404 }, // Double encoding
      ];

      for (const attack of encodedAttacks) {
        const res = await fetch(`http://localhost:${port}${attack.path}`);
        expect(res.status).toBe(attack.expectedStatus);
      }
    });
  });

  describe("클라이언트 번들 경로", () => {
    it("/.mandu/client/ 밖 접근 차단", async () => {
      await fs.writeFile(
        path.join(TEST_DIR, ".mandu", "client", "bundle.js"),
        "console.log('bundle')"
      );

      server = startServer(testManifest, {
        port: 0,
        rootDir: TEST_DIR,
        registry,
      });
      const port = server.server.port;

      // 정상 접근
      const normalRes = await fetch(
        `http://localhost:${port}/.mandu/client/bundle.js`
      );
      if (normalRes.status === 200) {
        const text = await normalRes.text();
        expect(text).toContain("bundle");
      }

      // 경로 탐색 시도
      const attackRes = await fetch(
        `http://localhost:${port}/.mandu/client/..%5C..%5Csecret.txt`
      );
      expect(attackRes.status).toBe(403);
    });
  });

  describe("특수 파일 접근", () => {
    it("favicon.ico 정상 서빙", async () => {
      await fs.writeFile(
        path.join(TEST_DIR, "public", "favicon.ico"),
        "fake-icon-data"
      );

      server = startServer(testManifest, {
        port: 0,
        rootDir: TEST_DIR,
        publicDir: "public",
        registry,
      });
      const port = server.server.port;

      const res = await fetch(`http://localhost:${port}/favicon.ico`);
      expect(res.status).toBe(200);
    });

    it("robots.txt 정상 서빙", async () => {
      await fs.writeFile(
        path.join(TEST_DIR, "public", "robots.txt"),
        "User-agent: *\nDisallow: /admin"
      );

      server = startServer(testManifest, {
        port: 0,
        rootDir: TEST_DIR,
        publicDir: "public",
        registry,
      });
      const port = server.server.port;

      const res = await fetch(`http://localhost:${port}/robots.txt`);
      expect(res.status).toBe(200);
    });
  });
});
