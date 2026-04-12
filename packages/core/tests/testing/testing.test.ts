/**
 * Tests for packages/core/src/testing/index.ts
 * testFilling, createTestRequest, createTestContext
 */
import { describe, it, expect } from "bun:test";
import { testFilling, createTestRequest, createTestContext } from "../../src/testing/index";
import { ManduFilling } from "../../src/filling/filling";

// Simple filling for integration tests
const filling = new ManduFilling()
  .get((ctx) => ctx.ok({ method: "GET", query: ctx.query }))
  .post((ctx) => ctx.ok({ method: "POST" }))
  .action("test", (ctx) => ctx.ok({ action: "test" }));

describe("testFilling", () => {
  it("creates GET request and calls filling.handle", async () => {
    const res = await testFilling(filling, { method: "GET" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.method).toBe("GET");
  });

  it("passes query params through", async () => {
    const res = await testFilling(filling, {
      method: "GET",
      query: { page: "2", limit: "10" },
    });
    const data = await res.json();
    expect(data.query.page).toBe("2");
    expect(data.query.limit).toBe("10");
  });

  it("defaults to GET when no method specified", async () => {
    const res = await testFilling(filling);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.method).toBe("GET");
  });

  it("with action: auto-injects _action in body and ManduAction header", async () => {
    const res = await testFilling(filling, { action: "test" });
    expect(res.status).toBe(200);
    const data = await res.json();
    // action dispatch returns revalidated data or action response
    expect(data.action).toBe("test");
  });

  it("with action: defaults method to POST", async () => {
    const actionFilling = new ManduFilling().action("ping", (ctx) =>
      ctx.ok({ method: ctx.method })
    );
    const res = await testFilling(actionFilling, { action: "ping" });
    expect(res.status).toBe(200);
  });

  it("with FormData body", async () => {
    const formFilling = new ManduFilling().post(async (ctx) => {
      const body = await ctx.body();
      return ctx.ok({ received: true, body });
    });
    const form = new FormData();
    form.append("title", "hello");

    const res = await testFilling(formFilling, { method: "POST", body: form });
    expect(res.status).toBe(200);
  });
});

describe("createTestRequest", () => {
  it("creates request with correct URL and method", () => {
    const req = createTestRequest("/api/todos", { method: "POST" });
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/api/todos");
  });

  it("includes query params in URL", () => {
    const req = createTestRequest("/api/todos", {
      query: { status: "done" },
    });
    const url = new URL(req.url);
    expect(url.searchParams.get("status")).toBe("done");
  });

  it("includes headers", () => {
    const req = createTestRequest("/api/todos", {
      headers: { Authorization: "Bearer xyz" },
    });
    expect(req.headers.get("Authorization")).toBe("Bearer xyz");
  });

  it("defaults to GET method", () => {
    const req = createTestRequest("/api/test");
    expect(req.method).toBe("GET");
  });

  it("attaches JSON body on POST", async () => {
    const req = createTestRequest("/api/todos", {
      method: "POST",
      body: { title: "test" },
    });
    expect(req.headers.get("Content-Type")).toBe("application/json");
    const data = await req.json();
    expect(data.title).toBe("test");
  });
});

describe("createTestContext", () => {
  it("returns ManduContext with correct params", () => {
    const ctx = createTestContext("/api/users/123", {
      params: { id: "123" },
    });
    expect(ctx.params.id).toBe("123");
  });

  it("provides query from request URL", () => {
    const ctx = createTestContext("/api/users", {
      query: { role: "admin" },
    });
    expect(ctx.query.role).toBe("admin");
  });

  it("has correct request method", () => {
    const ctx = createTestContext("/api/items", { method: "DELETE" });
    expect(ctx.method).toBe("DELETE");
  });
});
