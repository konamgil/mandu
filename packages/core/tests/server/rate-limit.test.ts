import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  startServer,
  createServerRegistry,
  type ManduServer,
  type ServerRegistry,
} from "../../src/runtime/server";
import type { RoutesManifest } from "../../src/spec/schema";

describe("Server Rate Limit", () => {
  let server: ManduServer | null = null;
  let registry: ServerRegistry;

  const testManifest: RoutesManifest = {
    version: "1.0.0",
    routes: [
      { id: "api/limited", pattern: "/api/limited", kind: "api", methods: ["GET"] },
      { id: "api/other", pattern: "/api/other", kind: "api", methods: ["GET"] },
    ],
  };

  beforeEach(() => {
    registry = createServerRegistry();
  });

  afterEach(() => {
    if (server) {
      server.stop();
      server = null;
    }
  });

  it("설정된 횟수를 초과하면 429를 반환한다", async () => {
    registry.registerApiHandler("api/limited", async () => Response.json({ ok: true }));

    server = startServer(testManifest, {
      port: 0,
      registry,
      rateLimit: { windowMs: 5000, max: 2 },
    });

    const port = server.server.port;
    const first = await fetch(`http://localhost:${port}/api/limited`);
    const second = await fetch(`http://localhost:${port}/api/limited`);
    const third = await fetch(`http://localhost:${port}/api/limited`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);

    expect(third.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(third.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(third.headers.get("Retry-After")).toBeDefined();

    const body = await third.json();
    expect(body.error).toBe("rate_limit_exceeded");
  });

  it("라우트별로 독립적으로 카운트한다", async () => {
    registry.registerApiHandler("api/limited", async () => Response.json({ route: "limited" }));
    registry.registerApiHandler("api/other", async () => Response.json({ route: "other" }));

    server = startServer(testManifest, {
      port: 0,
      registry,
      rateLimit: { windowMs: 5000, max: 1 },
    });

    const port = server.server.port;
    const limited1 = await fetch(`http://localhost:${port}/api/limited`);
    const limited2 = await fetch(`http://localhost:${port}/api/limited`);
    const other1 = await fetch(`http://localhost:${port}/api/other`);

    expect(limited1.status).toBe(200);
    expect(limited2.status).toBe(429);
    expect(other1.status).toBe(200);
  });

  it("기본값에서도 IP별로 구분하여 DoS 방지 (spoofing 가능)", async () => {
    registry.registerApiHandler("api/limited", async () => Response.json({ ok: true }));

    server = startServer(testManifest, {
      port: 0,
      registry,
      rateLimit: { windowMs: 5000, max: 1 },
    });

    const port = server.server.port;
    const first = await fetch(`http://localhost:${port}/api/limited`, {
      headers: { "x-forwarded-for": "1.1.1.1" },
    });
    const second = await fetch(`http://localhost:${port}/api/limited`, {
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    const firstAgain = await fetch(`http://localhost:${port}/api/limited`, {
      headers: { "x-forwarded-for": "1.1.1.1" },
    });

    // 서로 다른 IP는 독립적인 limit을 가짐 (DoS 방지)
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // 같은 IP 재요청은 차단
    expect(firstAgain.status).toBe(429);
  });

  it("trustProxy 활성화 시 전달된 IP 기준으로 분리 카운트한다", async () => {
    registry.registerApiHandler("api/limited", async () => Response.json({ ok: true }));

    server = startServer(testManifest, {
      port: 0,
      registry,
      rateLimit: { windowMs: 5000, max: 1, trustProxy: true },
    });

    const port = server.server.port;
    const firstIp = await fetch(`http://localhost:${port}/api/limited`, {
      headers: { "x-forwarded-for": "1.1.1.1" },
    });
    const secondIp = await fetch(`http://localhost:${port}/api/limited`, {
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    const firstIpAgain = await fetch(`http://localhost:${port}/api/limited`, {
      headers: { "x-forwarded-for": "1.1.1.1" },
    });

    expect(firstIp.status).toBe(200);
    expect(secondIp.status).toBe(200);
    expect(firstIpAgain.status).toBe(429);
  });
});
