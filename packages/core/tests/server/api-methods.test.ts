/**
 * Server API Methods Tests
 *
 * GET/POST/PUT/DELETE 메서드별 핸들링 검증
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  startServer,
  createServerRegistry,
  type ManduServer,
  type ServerRegistry,
} from "../../src/runtime/server";
import type { RoutesManifest } from "../../src/spec/schema";

describe("Server API Methods", () => {
  let server: ManduServer | null = null;
  let registry: ServerRegistry;

  const testManifest: RoutesManifest = {
    version: 1,
    routes: [
      {
        id: "api/users",
        pattern: "/api/users",
        kind: "api",
        module: ".mandu/generated/server/api-users.ts",
        methods: ["GET", "POST"],
      },
      {
        id: "api/users/[id]",
        pattern: "/api/users/:id",
        kind: "api",
        module: ".mandu/generated/server/api-users-id.ts",
        methods: ["GET", "PUT", "DELETE"],
      },
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

  describe("GET 요청", () => {
    it("GET /api/users - 목록 조회", async () => {
      const users = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }];

      registry.registerApiHandler("api/users", async (req) => {
        if (req.method === "GET") {
          return Response.json(users);
        }
        return new Response("Method not allowed", { status: 405 });
      });

      server = startServer(testManifest, { port: 0, registry });
      const port = server.server.port;

      const res = await fetch(`http://localhost:${port}/api/users`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual(users);
    });

    it("GET /api/users/:id - 단일 조회", async () => {
      const user = { id: 1, name: "Alice" };

      registry.registerApiHandler("api/users/[id]", async (req, params) => {
        if (req.method === "GET") {
          return Response.json({ ...user, id: Number(params.id) });
        }
        return new Response("Method not allowed", { status: 405 });
      });

      server = startServer(testManifest, { port: 0, registry });
      const port = server.server.port;

      const res = await fetch(`http://localhost:${port}/api/users/1`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.id).toBe(1);
    });
  });

  describe("POST 요청", () => {
    it("POST /api/users - 새 사용자 생성", async () => {
      registry.registerApiHandler("api/users", async (req) => {
        if (req.method === "POST") {
          const body = await req.json();
          return Response.json(
            { id: 3, ...body },
            { status: 201 }
          );
        }
        return new Response("Method not allowed", { status: 405 });
      });

      server = startServer(testManifest, { port: 0, registry });
      const port = server.server.port;

      const res = await fetch(`http://localhost:${port}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Charlie" }),
      });
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.id).toBe(3);
      expect(data.name).toBe("Charlie");
    });

    it("POST 빈 body 처리", async () => {
      registry.registerApiHandler("api/users", async (req) => {
        if (req.method === "POST") {
          try {
            const body = await req.json();
            return Response.json({ received: body });
          } catch {
            return Response.json(
              { error: "Invalid JSON" },
              { status: 400 }
            );
          }
        }
        return new Response("Method not allowed", { status: 405 });
      });

      server = startServer(testManifest, { port: 0, registry });
      const port = server.server.port;

      const res = await fetch(`http://localhost:${port}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "",
      });

      expect(res.status).toBe(400);
    });
  });

  describe("PUT 요청", () => {
    it("PUT /api/users/:id - 사용자 수정", async () => {
      registry.registerApiHandler("api/users/[id]", async (req, params) => {
        if (req.method === "PUT") {
          const body = await req.json();
          return Response.json({
            id: Number(params.id),
            ...body,
            updatedAt: new Date().toISOString(),
          });
        }
        return new Response("Method not allowed", { status: 405 });
      });

      server = startServer(testManifest, { port: 0, registry });
      const port = server.server.port;

      const res = await fetch(`http://localhost:${port}/api/users/1`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice Updated" }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.id).toBe(1);
      expect(data.name).toBe("Alice Updated");
      expect(data.updatedAt).toBeDefined();
    });

    it("PUT 존재하지 않는 리소스", async () => {
      registry.registerApiHandler("api/users/[id]", async (req, params) => {
        if (req.method === "PUT") {
          const id = Number(params.id);
          if (id > 100) {
            return Response.json(
              { error: "User not found" },
              { status: 404 }
            );
          }
          return Response.json({ id });
        }
        return new Response("Method not allowed", { status: 405 });
      });

      server = startServer(testManifest, { port: 0, registry });
      const port = server.server.port;

      const res = await fetch(`http://localhost:${port}/api/users/999`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Ghost" }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE 요청", () => {
    it("DELETE /api/users/:id - 사용자 삭제", async () => {
      registry.registerApiHandler("api/users/[id]", async (req, params) => {
        if (req.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        return new Response("Method not allowed", { status: 405 });
      });

      server = startServer(testManifest, { port: 0, registry });
      const port = server.server.port;

      const res = await fetch(`http://localhost:${port}/api/users/1`, {
        method: "DELETE",
      });

      expect(res.status).toBe(204);
    });

    it("DELETE 후 GET 시 404", async () => {
      const deleted = new Set<string>();

      registry.registerApiHandler("api/users/[id]", async (req, params) => {
        const id = params.id;

        if (req.method === "DELETE") {
          deleted.add(id);
          return new Response(null, { status: 204 });
        }

        if (req.method === "GET") {
          if (deleted.has(id)) {
            return Response.json(
              { error: "User not found" },
              { status: 404 }
            );
          }
          return Response.json({ id: Number(id), name: "User" });
        }

        return new Response("Method not allowed", { status: 405 });
      });

      server = startServer(testManifest, { port: 0, registry });
      const port = server.server.port;

      // 먼저 삭제
      await fetch(`http://localhost:${port}/api/users/1`, {
        method: "DELETE",
      });

      // 삭제된 리소스 조회
      const res = await fetch(`http://localhost:${port}/api/users/1`);

      expect(res.status).toBe(404);
    });
  });

  describe("에러 핸들링", () => {
    it("핸들러 에러 시 500 응답", async () => {
      registry.registerApiHandler("api/users", async () => {
        throw new Error("Internal error");
      });

      server = startServer(testManifest, { port: 0, registry });
      const port = server.server.port;

      const res = await fetch(`http://localhost:${port}/api/users`);

      expect(res.status).toBe(500);
    });

    it("등록되지 않은 핸들러 404 응답", async () => {
      // 핸들러 등록 없이 서버 시작
      server = startServer(testManifest, { port: 0, registry });
      const port = server.server.port;

      const res = await fetch(`http://localhost:${port}/api/users`);

      // 핸들러가 없으면 404 또는 500
      expect([404, 500]).toContain(res.status);
    });
  });
});
