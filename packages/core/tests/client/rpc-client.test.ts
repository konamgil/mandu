/**
 * Phase 18.κ — Typed RPC client-side tests.
 *
 * Covers createRpcClient proxy behaviour, multi-method call, error
 * propagation, and compile-time type inference (this file is NOT
 * `@ts-nocheck` — the type checker is the assertion surface).
 */

import { describe, it, expect, mock } from "bun:test";
import { z } from "zod";
import { createRpcClient, RpcCallError } from "../../src/client/rpc";
import { defineRpc, type RpcWireEnvelope } from "../../src/contract/rpc";

// Build a sample RPC definition used for type inference tests. The
// `typeof` of the exported const is what the client generic pins to.
const sampleRpc = defineRpc({
  list: {
    input: z.object({ limit: z.number().optional() }).optional(),
    output: z.array(z.object({ id: z.string(), title: z.string() })),
    handler: async () => [],
  },
  get: {
    input: z.object({ id: z.string() }),
    output: z.object({ id: z.string(), title: z.string() }),
    handler: async () => ({ id: "", title: "" }),
  },
  ping: {
    output: z.literal("pong"),
    handler: async () => "pong" as const,
  },
});

type Sample = typeof sampleRpc;

function fakeFetch(response: RpcWireEnvelope | string, status = 200): typeof fetch {
  const body = typeof response === "string" ? response : JSON.stringify(response);
  return mock(() =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: { "Content-Type": "application/json" },
      })
    )
  ) as unknown as typeof fetch;
}

describe("createRpcClient — proxy basics", () => {
  it("returns a Proxy where arbitrary property access yields a function", () => {
    const api = createRpcClient<Sample>({ baseUrl: "/api/rpc/posts" });
    expect(typeof (api as unknown as Record<string, unknown>).list).toBe("function");
    expect(typeof (api as unknown as Record<string, unknown>).get).toBe("function");
    expect(typeof (api as unknown as Record<string, unknown>).ping).toBe("function");
  });

  it("is NOT thenable (does not leak into await chains)", () => {
    const api = createRpcClient<Sample>({ baseUrl: "/api/rpc/posts" });
    expect((api as unknown as { then?: unknown }).then).toBeUndefined();
  });

  it("toJSON is undefined so console.log / JSON.stringify do not throw", () => {
    const api = createRpcClient<Sample>({ baseUrl: "/api/rpc/posts" });
    expect((api as unknown as { toJSON?: unknown }).toJSON).toBeUndefined();
  });
});

describe("createRpcClient — request shape", () => {
  it("POSTs to baseUrl/<method> with { input } JSON body", async () => {
    const fx = fakeFetch({ ok: true, data: [] });
    const api = createRpcClient<Sample>({
      baseUrl: "/api/rpc/posts",
      fetch: fx,
    });
    await api.list({ limit: 5 });
    expect(fx).toHaveBeenCalledTimes(1);
    const [url, init] = (fx as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("/api/rpc/posts/list");
    expect(init?.method).toBe("POST");
    expect(((init?.headers ?? {}) as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ input: { limit: 5 } });
  });

  it("strips trailing slash from baseUrl", async () => {
    const fx = fakeFetch({ ok: true, data: "pong" });
    const api = createRpcClient<Sample>({
      baseUrl: "/api/rpc/posts/",
      fetch: fx,
    });
    await api.ping();
    const [url] = (fx as unknown as { mock: { calls: [string][] } }).mock.calls[0];
    expect(url).toBe("/api/rpc/posts/ping");
  });

  it("sends undefined input as empty-input JSON body (input key omitted by JSON.stringify)", async () => {
    const fx = fakeFetch({ ok: true, data: "pong" });
    const api = createRpcClient<Sample>({
      baseUrl: "/api/rpc/posts",
      fetch: fx,
    });
    await api.ping();
    const [, init] = (fx as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    // `JSON.stringify({ input: undefined })` elides the key — equivalent
    // to `{}` on the wire. The server dispatcher treats a missing
    // `input` as undefined, which is correct for no-input procedures.
    const parsed = JSON.parse(init?.body as string) as { input?: unknown };
    expect(parsed.input).toBeUndefined();
    expect(init?.body).toBe("{}");
  });

  it("merges custom headers with defaults", async () => {
    const fx = fakeFetch({ ok: true, data: "pong" });
    const api = createRpcClient<Sample>({
      baseUrl: "/api/rpc/posts",
      fetch: fx,
      headers: { Authorization: "Bearer xyz", "X-App": "test" },
    });
    await api.ping();
    const [, init] = (fx as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer xyz");
    expect(headers["X-App"]).toBe("test");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("createRpcClient — response handling", () => {
  it("unwraps { ok: true, data } into the resolved value", async () => {
    const fx = fakeFetch({ ok: true, data: [{ id: "p1", title: "Hello" }] });
    const api = createRpcClient<Sample>({
      baseUrl: "/api/rpc/posts",
      fetch: fx,
    });
    const result = await api.list({ limit: 1 });
    expect(result).toEqual([{ id: "p1", title: "Hello" }]);
  });

  it("throws RpcCallError on { ok: false, error }", async () => {
    const fx = fakeFetch(
      {
        ok: false,
        error: {
          code: "INPUT_INVALID",
          message: "bad",
          issues: [{ path: ["id"], message: "Required", code: "invalid_type" }],
        },
      },
      400
    );
    const api = createRpcClient<Sample>({
      baseUrl: "/api/rpc/posts",
      fetch: fx,
    });
    try {
      await api.get({ id: "" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RpcCallError);
      const rpcErr = err as RpcCallError;
      expect(rpcErr.status).toBe(400);
      expect(rpcErr.code).toBe("INPUT_INVALID");
      expect(rpcErr.issues?.[0].path).toEqual(["id"]);
    }
  });

  it("synthesises an error envelope on non-JSON transport failure", async () => {
    const fx = fakeFetch("internal server error", 500);
    const api = createRpcClient<Sample>({
      baseUrl: "/api/rpc/posts",
      fetch: fx,
    });
    try {
      await api.ping();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RpcCallError);
      const rpcErr = err as RpcCallError;
      expect(rpcErr.status).toBe(500);
      expect(rpcErr.code).toBe("HTTP_500");
    }
  });

  it("supports multi-method dispatch through one proxy instance", async () => {
    // Two mocks chained through a queued fake fetch.
    const responses = [
      new Response(JSON.stringify({ ok: true, data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      new Response(JSON.stringify({ ok: true, data: { id: "x", title: "T" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ];
    const fx = mock(() => Promise.resolve(responses.shift()!));
    const api = createRpcClient<Sample>({
      baseUrl: "/api/rpc/posts",
      fetch: fx as unknown as typeof fetch,
    });

    const a = await api.list({ limit: 0 });
    const b = await api.get({ id: "x" });
    expect(a).toEqual([]);
    expect(b).toEqual({ id: "x", title: "T" });
    expect(fx).toHaveBeenCalledTimes(2);
  });
});

describe("createRpcClient — type inference (compile-time)", () => {
  // These tests exercise the TypeScript compiler. Their presence is
  // the assertion: if inference regresses, `bun test` still passes
  // but `tsc --noEmit` fails the quality gate.
  it("infers parameter & return types from the typeof import", async () => {
    const fx = fakeFetch({ ok: true, data: [{ id: "p", title: "T" }] });
    const api = createRpcClient<Sample>({
      baseUrl: "/api/rpc/posts",
      fetch: fx,
    });

    // `list` input is optional-ish (the whole object is .optional())
    const xs = await api.list({ limit: 2 });
    // xs is inferred as Array<{ id: string; title: string }>
    expect(Array.isArray(xs)).toBe(true);

    // `get` requires a { id: string } input — the next two lines
    // would be TS errors if un-commented:
    //   api.get({ id: 123 });          // TS2322
    //   api.get();                     // TS2554
    const one = await (async () => {
      const fx2 = fakeFetch({ ok: true, data: { id: "abc", title: "T" } });
      const api2 = createRpcClient<Sample>({
        baseUrl: "/api/rpc/posts",
        fetch: fx2,
      });
      return api2.get({ id: "abc" });
    })();
    expect(one.id).toBe("abc");
  });

  it("ping (no input) is callable with zero args", async () => {
    const fx = fakeFetch({ ok: true, data: "pong" });
    const api = createRpcClient<Sample>({
      baseUrl: "/api/rpc/posts",
      fetch: fx,
    });
    const p = await api.ping();
    expect(p).toBe("pong");
  });
});

describe("RpcCallError", () => {
  it("forwards code + issues from the wire envelope", () => {
    const err = new RpcCallError(400, {
      code: "INPUT_INVALID",
      message: "bad",
      issues: [{ path: ["a", 0], message: "x" }],
    });
    expect(err.status).toBe(400);
    expect(err.code).toBe("INPUT_INVALID");
    expect(err.issues?.[0].path).toEqual(["a", 0]);
    expect(err.message).toContain("INPUT_INVALID");
    expect(err.message).toContain("bad");
  });
});
