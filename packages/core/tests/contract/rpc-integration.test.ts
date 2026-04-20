/**
 * Phase 18.κ — Typed RPC end-to-end integration tests.
 *
 * Boots a real `startServer()` on an ephemeral port, registers an RPC
 * endpoint via `ServerOptions.rpc.endpoints`, then drives it with the
 * client proxy (and with direct fetch) to verify the full pipeline.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import {
  startServer,
  createServerRegistry,
  clearDefaultRegistry,
  type ManduServer,
  type ServerRegistry,
} from "../../src/runtime/server";
import { defineRpc, clearRpcRegistry } from "../../src/contract/rpc";
import { createRpcClient, RpcCallError } from "../../src/client/rpc";
import type { RoutesManifest } from "../../src/spec/schema";

const emptyManifest: RoutesManifest = { version: 1, routes: [] };

describe("RPC end-to-end through startServer()", () => {
  let server: ManduServer | null = null;
  let registry: ServerRegistry;

  const posts = defineRpc({
    list: {
      input: z.object({ limit: z.number().int().positive().optional() }).optional(),
      output: z.array(z.object({ id: z.string(), title: z.string() })),
      handler: async ({ input }) => {
        const n = input?.limit ?? 2;
        return Array.from({ length: n }, (_, i) => ({
          id: `p${i}`,
          title: `Post ${i}`,
        }));
      },
    },
    get: {
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string(), title: z.string() }),
      handler: async ({ input }) => ({ id: input.id, title: `Title: ${input.id}` }),
    },
    echo: {
      input: z.object({ msg: z.string() }),
      output: z.object({ msg: z.string(), ts: z.number() }),
      handler: async ({ input }) => ({ msg: input.msg, ts: Date.now() }),
    },
  });

  beforeEach(() => {
    clearDefaultRegistry();
    clearRpcRegistry();
    registry = createServerRegistry();
  });

  afterEach(() => {
    if (server) {
      server.stop();
      server = null;
    }
    clearRpcRegistry();
  });

  it("serves an RPC call end-to-end via createRpcClient", async () => {
    server = startServer(emptyManifest, {
      port: 0,
      registry,
      rpc: { endpoints: { posts } },
    });
    const baseUrl = `http://localhost:${server.server.port}/api/rpc/posts`;

    const api = createRpcClient<typeof posts>({ baseUrl });
    const list = await api.list({ limit: 3 });
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({ id: "p0", title: "Post 0" });

    const one = await api.get({ id: "abc" });
    expect(one).toEqual({ id: "abc", title: "Title: abc" });
  });

  it("returns structured INPUT_INVALID envelope via direct curl-style POST", async () => {
    server = startServer(emptyManifest, {
      port: 0,
      registry,
      rpc: { endpoints: { posts } },
    });
    const url = `http://localhost:${server.server.port}/api/rpc/posts/get`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { id: 123 } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: boolean;
      error?: { code: string; issues?: unknown[] };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("INPUT_INVALID");
    expect(body.error?.issues?.length ?? 0).toBeGreaterThan(0);
  });

  it("returns 404 envelope for unknown endpoint", async () => {
    server = startServer(emptyManifest, {
      port: 0,
      registry,
      rpc: { endpoints: { posts } },
    });
    const url = `http://localhost:${server.server.port}/api/rpc/missing/any`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: {} }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean; error?: { code: string } };
    expect(body.error?.code).toBe("NOT_FOUND");
  });

  it("client proxy throws RpcCallError on server-reported error", async () => {
    server = startServer(emptyManifest, {
      port: 0,
      registry,
      rpc: { endpoints: { posts } },
    });
    const baseUrl = `http://localhost:${server.server.port}/api/rpc/posts`;
    const api = createRpcClient<typeof posts>({ baseUrl });

    try {
      // @ts-expect-error — intentionally wrong input to trigger INPUT_INVALID
      await api.get({ id: 99 });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RpcCallError);
      const rpcErr = err as RpcCallError;
      expect(rpcErr.status).toBe(400);
      expect(rpcErr.code).toBe("INPUT_INVALID");
    }
  });

  it("multiple endpoints coexist and do not collide with each other", async () => {
    const users = defineRpc({
      me: {
        output: z.object({ id: z.string(), name: z.string() }),
        handler: async () => ({ id: "u1", name: "Alice" }),
      },
    });
    server = startServer(emptyManifest, {
      port: 0,
      registry,
      rpc: { endpoints: { posts, users } },
    });
    const base = `http://localhost:${server.server.port}/api/rpc`;
    const postsApi = createRpcClient<typeof posts>({ baseUrl: `${base}/posts` });
    const usersApi = createRpcClient<typeof users>({ baseUrl: `${base}/users` });

    const pong = await postsApi.echo({ msg: "hi" });
    expect(pong.msg).toBe("hi");
    expect(typeof pong.ts).toBe("number");

    const me = await usersApi.me();
    expect(me).toEqual({ id: "u1", name: "Alice" });
  });
});
