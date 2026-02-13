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

  it("동시 요청에서도 제한 개수를 초과하지 않는다", async () => {
    registry.registerApiHandler("api/limited", async () => {
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 20)));
      return Response.json({ ok: true });
    });

    server = startServer(testManifest, {
      port: 0,
      registry,
      rateLimit: { windowMs: 5000, max: 3 },
    });

    const port = server.server.port;
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => fetch(`http://localhost:${port}/api/limited`))
    );

    const successCount = responses.filter((response) => response.status === 200).length;
    const limitedCount = responses.filter((response) => response.status === 429).length;

    expect(successCount).toBe(3);
    expect(limitedCount).toBe(7);
  });
});
