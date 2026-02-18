/**
 * Mandu Contract Client Tests
 *
 * 클라이언트 타입 추론 및 기능 테스트
 */

import { describe, it, expect, mock } from "bun:test";
import { z } from "zod";
import { Mandu } from "../index";
import { createClient, contractFetch } from "./index";

// === Test Contract ===
const testContract = Mandu.contract({
  description: "Test API",
  tags: ["test"],
  request: {
    GET: {
      query: z.object({
        page: z.coerce.number().default(1),
        search: z.string().optional(),
      }),
    },
    POST: {
      body: z.object({
        name: z.string(),
        email: z.string().email(),
      }),
    },
    PUT: {
      params: z.object({
        id: z.string(),
      }),
      body: z.object({
        name: z.string().optional(),
      }),
    },
    DELETE: {
      params: z.object({
        id: z.string(),
      }),
    },
  },
  response: {
    200: z.object({
      data: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
        })
      ),
      total: z.number(),
    }),
    201: z.object({
      data: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      }),
    }),
    204: z.undefined(),
    404: z.object({
      error: z.string(),
    }),
  },
});

describe("Contract Client", () => {
  it("should create a client with all HTTP methods", () => {
    const client = createClient(testContract, {
      baseUrl: "http://localhost:3000/api/test",
    });

    expect(client.GET).toBeDefined();
    expect(client.POST).toBeDefined();
    expect(client.PUT).toBeDefined();
    expect(client.DELETE).toBeDefined();
    expect(typeof client.GET).toBe("function");
    expect(typeof client.POST).toBe("function");
  });

  it("should build query string correctly", async () => {
    let capturedUrl = "";

    const mockFetch = mock(async (url: string, _options: RequestInit) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient(testContract, {
      baseUrl: "http://localhost:3000/api/test",
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.GET({ query: { page: 2, search: "hello" } });

    expect(capturedUrl).toContain("page=2");
    expect(capturedUrl).toContain("search=hello");
  });

  it("should send JSON body for POST requests", async () => {
    let capturedBody = "";
    let capturedContentType = "";

    const mockFetch = mock(async (_url: string, options: RequestInit) => {
      capturedBody = options.body as string;
      capturedContentType =
        (options.headers as Record<string, string>)["Content-Type"] || "";
      return new Response(
        JSON.stringify({
          data: { id: "1", name: "Test", email: "test@example.com" },
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }
      );
    });

    const client = createClient(testContract, {
      baseUrl: "http://localhost:3000/api/test",
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.POST({ body: { name: "Test", email: "test@example.com" } });

    expect(capturedContentType).toBe("application/json");
    expect(JSON.parse(capturedBody)).toEqual({
      name: "Test",
      email: "test@example.com",
    });
  });

  it("should parse JSON response", async () => {
    const mockData = {
      data: [
        { id: "1", name: "User 1" },
        { id: "2", name: "User 2" },
      ],
      total: 2,
    };

    const mockFetch = mock(async () => {
      return new Response(JSON.stringify(mockData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient(testContract, {
      baseUrl: "http://localhost:3000/api/test",
      fetch: mockFetch as unknown as typeof fetch,
    });

    const result = await client.GET({ query: { page: 1 } });

    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(mockData);
  });

  it("should include default headers", async () => {
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = mock(async (_url: string, options: RequestInit) => {
      capturedHeaders = options.headers as Record<string, string>;
      return new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient(testContract, {
      baseUrl: "http://localhost:3000/api/test",
      headers: {
        Authorization: "Bearer token123",
        "X-Custom-Header": "custom-value",
      },
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.GET();

    expect(capturedHeaders["Authorization"]).toBe("Bearer token123");
    expect(capturedHeaders["X-Custom-Header"]).toBe("custom-value");
  });

  it("should allow per-request headers", async () => {
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = mock(async (_url: string, options: RequestInit) => {
      capturedHeaders = options.headers as Record<string, string>;
      return new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = createClient(testContract, {
      baseUrl: "http://localhost:3000/api/test",
      headers: { "X-Default": "default" },
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.GET({
      headers: { "X-Custom": "per-request" },
    });

    expect(capturedHeaders["X-Default"]).toBe("default");
    expect(capturedHeaders["X-Custom"]).toBe("per-request");
  });
});

describe("contractFetch", () => {
  it("should make type-safe fetch call", async () => {
    const mockFetch = mock(async () => {
      return new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await contractFetch(
      testContract,
      "GET",
      "http://localhost:3000/api/test",
      { query: { page: 1 } },
      { fetch: mockFetch as unknown as typeof fetch }
    );

    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
  });

  it("should handle path parameters", async () => {
    let capturedUrl = "";

    const mockFetch = mock(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await contractFetch(
      testContract,
      "PUT",
      "http://localhost:3000/api/test/:id",
      { params: { id: "123" }, body: { name: "Updated" } },
      { fetch: mockFetch as unknown as typeof fetch }
    );

    expect(capturedUrl).toBe("http://localhost:3000/api/test/123");
  });
});

describe("Mandu.client", () => {
  it("should be accessible via Mandu namespace", () => {
    expect(Mandu.client).toBe(createClient);
  });

  it("should work via Mandu namespace", async () => {
    const mockFetch = mock(async () => {
      return new Response(JSON.stringify({ data: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const client = Mandu.client(testContract, {
      baseUrl: "http://localhost:3000/api/test",
      fetch: mockFetch as unknown as typeof fetch,
    });

    const result = await client.GET({ query: { page: 1 } });

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ data: [], total: 0 });
  });
});

describe("Mandu.fetch", () => {
  it("should be accessible via Mandu namespace", () => {
    expect(Mandu.fetch).toBe(contractFetch);
  });
});

describe("Type Safety (Compile-time)", () => {
  it("should enforce query types", () => {
    // This test verifies that the type system is working
    // If the types are wrong, this won't compile
    const client = createClient(testContract, {
      baseUrl: "http://localhost:3000/api/test",
    });

    // These are valid calls (would compile)
    const _validGet = () => client.GET({ query: { page: 1 } });
    const _validPost = () =>
      client.POST({ body: { name: "Test", email: "test@example.com" } });

    // Type-level assertions
    expect(typeof client.GET).toBe("function");
    expect(typeof client.POST).toBe("function");
  });
});
