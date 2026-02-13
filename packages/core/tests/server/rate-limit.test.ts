import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  startServer,
  createServerRegistry,
  createRateLimiter,
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
});

describe("createRateLimiter API", () => {
  it("수동 rate limiter를 생성하고 사용할 수 있다", () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 5000 });

    const req = new Request("http://localhost/test");
    const decision1 = limiter.check(req, "test-route");
    const decision2 = limiter.check(req, "test-route");
    const decision3 = limiter.check(req, "test-route");
    const decision4 = limiter.check(req, "test-route");

    expect(decision1.allowed).toBe(true);
    expect(decision1.remaining).toBe(2);

    expect(decision2.allowed).toBe(true);
    expect(decision2.remaining).toBe(1);

    expect(decision3.allowed).toBe(true);
    expect(decision3.remaining).toBe(0);

    expect(decision4.allowed).toBe(false);
    expect(decision4.remaining).toBe(0);
  });

  it("429 응답을 생성할 수 있다", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 5000, message: "Custom message" });

    const req = new Request("http://localhost/test");
    limiter.check(req, "test-route"); // 첫 번째 허용
    const decision = limiter.check(req, "test-route"); // 두 번째 거부

    const response = limiter.createResponse(decision);

    expect(response.status).toBe(429);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("1");
    expect(response.headers.get("Retry-After")).toBeDefined();
  });

  it("정상 응답에 rate limit 헤더를 추가할 수 있다", () => {
    const limiter = createRateLimiter({ max: 10, windowMs: 60000 });

    const req = new Request("http://localhost/test");
    const decision = limiter.check(req, "test-route");

    const originalResponse = Response.json({ data: "ok" });
    const responseWithHeaders = limiter.addHeaders(originalResponse, decision);

    expect(responseWithHeaders.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(responseWithHeaders.headers.get("X-RateLimit-Remaining")).toBe("9");
    expect(responseWithHeaders.headers.get("X-RateLimit-Reset")).toBeDefined();
  });

  it("라우트별로 독립적인 카운터를 유지한다", () => {
    const limiter = createRateLimiter({ max: 2, windowMs: 5000 });

    const req = new Request("http://localhost/test");

    // route-a에 2번 요청
    limiter.check(req, "route-a");
    limiter.check(req, "route-a");
    const decisionA3 = limiter.check(req, "route-a");

    // route-b에 1번 요청
    const decisionB1 = limiter.check(req, "route-b");

    expect(decisionA3.allowed).toBe(false); // route-a는 초과
    expect(decisionB1.allowed).toBe(true);  // route-b는 여유 있음
  });
});
