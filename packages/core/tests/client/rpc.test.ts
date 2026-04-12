// @ts-nocheck — test file, runtime correctness verified by bun:test
/**
 * Tests for packages/core/src/client/rpc.ts
 * RPC client: createClient, RpcError, makeRequest, path params
 */
import { describe, it, expect, mock, afterEach } from "bun:test";
import { createClient, RpcError } from "../../src/client/rpc";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(status: number, body: unknown, contentType = "application/json") {
  const fn = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": contentType },
      })
    )
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("RpcError", () => {
  it("has status and body fields", () => {
    const err = new RpcError(404, { message: "not found" });
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ message: "not found" });
    expect(err.name).toBe("RpcError");
    expect(err.message).toBe("API Error 404");
  });
});

describe("createClient", () => {
  it("returns object with get/post/put/patch/delete methods", () => {
    const client = createClient("/api/test");
    expect(typeof client.get).toBe("function");
    expect(typeof client.post).toBe("function");
    expect(typeof client.put).toBe("function");
    expect(typeof client.patch).toBe("function");
    expect(typeof client.delete).toBe("function");
  });
});

describe("makeRequest GET", () => {
  it("constructs correct URL with query params", async () => {
    const fn = mockFetch(200, { ok: true });
    const client = createClient("/api/items");

    await client.get({ query: { page: 2, limit: 10 } });

    expect(fn).toHaveBeenCalledTimes(1);
    const url = new URL(fn.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/items");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("skips null/undefined query values", async () => {
    const fn = mockFetch(200, { ok: true });
    const client = createClient("/api/items");

    await client.get({ query: { a: "1", b: null, c: undefined } });

    const url = new URL(fn.mock.calls[0][0] as string);
    expect(url.searchParams.get("a")).toBe("1");
    expect(url.searchParams.has("b")).toBe(false);
    expect(url.searchParams.has("c")).toBe(false);
  });
});

describe("makeRequest POST", () => {
  it("sends JSON body with Content-Type header", async () => {
    const fn = mockFetch(201, { id: 1 });
    const client = createClient("/api/items");

    await client.post({ body: { title: "new item" } });

    const init = fn.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ title: "new item" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});

describe("path params", () => {
  it("substitutes :id correctly", async () => {
    const fn = mockFetch(200, { id: "42" });
    const client = createClient("/api/users/:id");

    await client.get({ params: { id: "42" } });

    const url = new URL(fn.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/users/42");
  });

  it("throws RpcError when :id remains unresolved", async () => {
    mockFetch(200, {});
    const client = createClient("/api/users/:id/posts/:postId");

    try {
      await client.get({ params: { id: "42" } });
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).status).toBe(0);
    }
  });
});

describe("error handling", () => {
  it("non-ok response throws RpcError with status and body", async () => {
    mockFetch(422, { errors: ["invalid"] });
    const client = createClient("/api/items");

    try {
      await client.post({ body: {} });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      const rpcErr = err as RpcError;
      expect(rpcErr.status).toBe(422);
      expect(rpcErr.body).toEqual({ errors: ["invalid"] });
    }
  });
});
