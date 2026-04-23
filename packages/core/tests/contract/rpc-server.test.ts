/**
 * Phase 18.κ — Typed RPC server-side tests.
 *
 * Covers `defineRpc()` contract, request dispatch, input validation,
 * output validation, handler-error path, wire envelope shape.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { z } from "zod";
import {
  defineRpc,
  registerRpc,
  getRpc,
  clearRpcRegistry,
  listRpcEndpoints,
  matchRpcPath,
  dispatchRpc,
  type RpcWireEnvelope,
} from "../../src/contract/rpc";

function makeReq(url: string, body: unknown, method = "POST"): Request {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = body === undefined ? null : JSON.stringify(body);
  }
  return new Request(url, init);
}

async function envelope<T>(r: Response): Promise<RpcWireEnvelope<T>> {
  return (await r.json()) as RpcWireEnvelope<T>;
}

beforeEach(() => {
  clearRpcRegistry();
});

describe("defineRpc()", () => {
  it("tags the returned object with __rpc: true", () => {
    const def = defineRpc({
      ping: {
        output: z.literal("pong"),
        handler: () => "pong" as const,
      },
    });
    expect(def.__rpc).toBe(true);
    expect(def.procedures.ping).toBeDefined();
  });

  it("throws when a procedure is missing handler", () => {
    expect(() =>
      defineRpc({
        // @ts-expect-error — intentional missing handler
        broken: { output: z.string() },
      })
    ).toThrow(/missing a handler/i);
  });

  it("throws when a procedure is missing output schema", () => {
    expect(() =>
      defineRpc({
        // @ts-expect-error — intentional missing output
        broken: { handler: () => "x" },
      })
    ).toThrow(/missing an output/i);
  });

  it("throws when procedure value is not an object", () => {
    expect(() =>
      defineRpc({
        // @ts-expect-error — intentional wrong shape
        broken: null,
      })
    ).toThrow(/not an object/i);
  });

  it("throws when input schema is not a Zod type", () => {
    expect(() =>
      defineRpc({
        broken: {
          // @ts-expect-error — intentional wrong input type
          input: { not: "zod" },
          output: z.string(),
          handler: () => "x",
        },
      })
    ).toThrow(/invalid input schema/i);
  });
});

describe("registry", () => {
  it("registers and looks up endpoints by name", () => {
    const def = defineRpc({ a: { output: z.string(), handler: () => "x" } });
    registerRpc("alpha", def);
    expect(getRpc("alpha")).toBe(def);
    expect(listRpcEndpoints()).toContain("alpha");
  });

  it("overwrites on re-registration (HMR-friendly)", () => {
    const a = defineRpc({ m: { output: z.string(), handler: () => "one" } });
    const b = defineRpc({ m: { output: z.string(), handler: () => "two" } });
    registerRpc("k", a);
    registerRpc("k", b);
    expect(getRpc("k")).toBe(b);
  });

  it("rejects non-RpcDefinition values", () => {
    expect(() =>
      // @ts-expect-error — intentional wrong shape
      registerRpc("bad", { procedures: {} })
    ).toThrow(/defineRpc/i);
  });
});

describe("matchRpcPath()", () => {
  it("matches /api/rpc/<endpoint>/<method>", () => {
    expect(matchRpcPath("/api/rpc/posts/list")).toEqual({
      endpoint: "posts",
      method: "list",
    });
  });

  it("returns null for non-rpc paths", () => {
    expect(matchRpcPath("/api/posts")).toBeNull();
    expect(matchRpcPath("/api/rpc")).toBeNull();
    expect(matchRpcPath("/api/rpc/")).toBeNull();
    expect(matchRpcPath("/api/rpc/only")).toBeNull();
  });

  it("rejects nested path segments (path traversal hardening)", () => {
    expect(matchRpcPath("/api/rpc/posts/list/extra")).toBeNull();
    expect(matchRpcPath("/api/rpc/posts/../admin")).toBeNull();
  });

  it("rejects non-alphanumeric endpoint / method names", () => {
    expect(matchRpcPath("/api/rpc/posts;drop/list")).toBeNull();
    expect(matchRpcPath("/api/rpc/posts/list%20hack")).toBeNull();
  });
});

describe("dispatchRpc()", () => {
  const posts = defineRpc({
    list: {
      input: z.object({ limit: z.number().int().positive().optional() }).optional(),
      output: z.array(z.object({ id: z.string(), title: z.string() })),
      handler: async ({ input }) => {
        const limit = input?.limit ?? 2;
        return Array.from({ length: limit }, (_, i) => ({
          id: `p${i}`,
          title: `Post ${i}`,
        }));
      },
    },
    get: {
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string(), title: z.string() }),
      handler: async ({ input }) => ({ id: input.id, title: `Title of ${input.id}` }),
    },
    fail: {
      input: z.object({ why: z.string() }),
      output: z.string(),
      handler: async ({ input }) => {
        throw new Error(`boom: ${input.why}`);
      },
    },
    badOutput: {
      output: z.object({ n: z.number() }),
      // Return a string to force output validation to fail.
      handler: async () => "not-an-object" as unknown as { n: number },
    },
  });

  beforeEach(() => {
    registerRpc("posts", posts);
  });

  it("dispatches a valid call with input validation + typed output", async () => {
    const req = makeReq("http://x/api/rpc/posts/list", { input: { limit: 3 } });
    const res = await dispatchRpc(req, "posts", "list");
    expect(res.status).toBe(200);
    const body = await envelope<{ id: string; title: string }[]>(res);
    expect(body.ok).toBe(true);
    if (body.ok) {
      expect(body.data).toHaveLength(3);
      expect(body.data[0]).toEqual({ id: "p0", title: "Post 0" });
    }
  });

  it("dispatches a procedure with undefined input", async () => {
    const req = makeReq("http://x/api/rpc/posts/list", { input: undefined });
    const res = await dispatchRpc(req, "posts", "list");
    const body = await envelope<unknown[]>(res);
    expect(body.ok).toBe(true);
    if (body.ok) expect(body.data).toHaveLength(2);
  });

  it("rejects non-POST methods with METHOD_NOT_ALLOWED", async () => {
    const req = new Request("http://x/api/rpc/posts/list", { method: "GET" });
    const res = await dispatchRpc(req, "posts", "list");
    expect(res.status).toBe(405);
    const body = await envelope(res);
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("returns NOT_FOUND for unknown endpoint name", async () => {
    const req = makeReq("http://x/api/rpc/missing/list", { input: {} });
    const res = await dispatchRpc(req, "missing", "list");
    expect(res.status).toBe(404);
    const body = await envelope(res);
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND for unknown procedure name", async () => {
    const req = makeReq("http://x/api/rpc/posts/nope", { input: {} });
    const res = await dispatchRpc(req, "posts", "nope");
    expect(res.status).toBe(404);
    const body = await envelope(res);
    if (!body.ok) expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns INPUT_INVALID with Zod issues on bad input", async () => {
    const req = makeReq("http://x/api/rpc/posts/get", { input: { id: 123 } });
    const res = await dispatchRpc(req, "posts", "get");
    expect(res.status).toBe(400);
    const body = await envelope(res);
    expect(body.ok).toBe(false);
    if (!body.ok) {
      expect(body.error.code).toBe("INPUT_INVALID");
      expect(body.error.issues?.length ?? 0).toBeGreaterThan(0);
      expect(body.error.issues?.[0].path).toEqual(["id"]);
    }
  });

  it("returns BAD_JSON for malformed JSON body", async () => {
    const req = new Request("http://x/api/rpc/posts/get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });
    const res = await dispatchRpc(req, "posts", "get");
    expect(res.status).toBe(400);
    const body = await envelope(res);
    if (!body.ok) expect(body.error.code).toBe("BAD_JSON");
  });

  it("returns HANDLER_ERROR with masked message in prod, raw in dev", async () => {
    const req = () => makeReq("http://x/api/rpc/posts/fail", { input: { why: "test" } });

    const prod = await dispatchRpc(req(), "posts", "fail", { isDev: false });
    expect(prod.status).toBe(500);
    const prodBody = await envelope(prod);
    if (!prodBody.ok) {
      expect(prodBody.error.code).toBe("HANDLER_ERROR");
      expect(prodBody.error.message).toBe("Internal RPC error");
    }

    const dev = await dispatchRpc(req(), "posts", "fail", { isDev: true });
    expect(dev.status).toBe(500);
    const devBody = await envelope(dev);
    if (!devBody.ok) {
      expect(devBody.error.code).toBe("HANDLER_ERROR");
      expect(devBody.error.message).toContain("boom: test");
    }
  });

  it("returns OUTPUT_INVALID when handler returns wrong shape", async () => {
    const req = makeReq("http://x/api/rpc/posts/badOutput", { input: undefined });
    const res = await dispatchRpc(req, "posts", "badOutput", { isDev: true });
    expect(res.status).toBe(500);
    const body = await envelope(res);
    if (!body.ok) {
      expect(body.error.code).toBe("OUTPUT_INVALID");
      expect(body.error.issues?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("masks OUTPUT_INVALID issues in prod", async () => {
    const req = makeReq("http://x/api/rpc/posts/badOutput", { input: undefined });
    const res = await dispatchRpc(req, "posts", "badOutput", { isDev: false });
    const body = await envelope(res);
    if (!body.ok) {
      expect(body.error.code).toBe("OUTPUT_INVALID");
      expect(body.error.issues).toBeUndefined();
      expect(body.error.message).toBe("Internal RPC error");
    }
  });

  it("ships JSON envelope with Content-Type: application/json", async () => {
    const req = makeReq("http://x/api/rpc/posts/get", { input: { id: "abc" } });
    const res = await dispatchRpc(req, "posts", "get");
    expect(res.headers.get("content-type")?.toLowerCase()).toContain("application/json");
  });
});
