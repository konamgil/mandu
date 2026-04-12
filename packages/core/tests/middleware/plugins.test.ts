import { describe, it, expect } from "bun:test";
import { timeout } from "../../src/middleware/timeout";
import { logger } from "../../src/middleware/logger";
import { compress } from "../../src/middleware/compress";
import { ManduContext } from "../../src/filling/context";

function makeCtx(url = "http://localhost:3000/test", headers?: Record<string, string>): ManduContext {
  const req = new Request(url, { headers });
  return new ManduContext(req);
}

// ===== timeout =====

describe("timeout", () => {
  it("returns a MiddlewarePlugin with beforeHandle and afterHandle", () => {
    const plugin = timeout(5000);
    expect(typeof plugin.beforeHandle).toBe("function");
    expect(typeof plugin.afterHandle).toBe("function");
  });

  it("afterHandle returns 408 when _timeout_expired is true", async () => {
    const plugin = timeout({ ms: 1, message: "Too slow" });
    const ctx = makeCtx();

    // Simulate expired state directly
    ctx.set("_timeout_expired", true);

    const original = new Response("ok", { status: 200 });
    const res = await plugin.afterHandle!(ctx, original);
    expect(res.status).toBe(408);
    const body = await res.json();
    expect(body.error).toBe("Too slow");
  });

  it("afterHandle passes response through when not expired", async () => {
    const plugin = timeout(5000);
    const ctx = makeCtx();

    await plugin.beforeHandle!(ctx);

    const original = new Response("ok", { status: 200 });
    const res = await plugin.afterHandle!(ctx, original);
    expect(res.status).toBe(200);
  });

  it("accepts a plain number as options", () => {
    const plugin = timeout(3000);
    expect(typeof plugin.beforeHandle).toBe("function");
  });
});

// ===== logger =====

describe("logger", () => {
  it("returns a MiddlewarePlugin with beforeHandle and afterHandle", () => {
    const plugin = logger();
    expect(typeof plugin.beforeHandle).toBe("function");
    expect(typeof plugin.afterHandle).toBe("function");
  });

  it("afterHandle returns the response unchanged", async () => {
    const messages: string[] = [];
    const plugin = logger({ log: (m) => messages.push(m) });
    const ctx = makeCtx("http://localhost:3000/hello");

    await plugin.beforeHandle!(ctx);
    const original = new Response("data", { status: 200 });
    const res = await plugin.afterHandle!(ctx, original);

    expect(res).toBe(original);
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain("GET");
    expect(messages[0]).toContain("/hello");
    expect(messages[0]).toContain("200");
  });

  it("detailed format includes arrow separator", async () => {
    const messages: string[] = [];
    const plugin = logger({ format: "detailed", log: (m) => messages.push(m) });
    const ctx = makeCtx();

    await plugin.beforeHandle!(ctx);
    await plugin.afterHandle!(ctx, new Response("ok"));

    expect(messages[0]).toContain("\u2192"); // arrow character
  });
});

// ===== compress =====

describe("compress", () => {
  it("returns a MiddlewarePlugin with beforeHandle and afterHandle", () => {
    const plugin = compress();
    expect(typeof plugin.beforeHandle).toBe("function");
    expect(typeof plugin.afterHandle).toBe("function");
  });

  it("compresses large body when Accept-Encoding includes gzip", async () => {
    const plugin = compress({ threshold: 1024 });
    const ctx = makeCtx("http://localhost:3000/", { "Accept-Encoding": "gzip, deflate" });

    await plugin.beforeHandle!(ctx);

    const largeBody = "x".repeat(2048);
    const original = new Response(largeBody, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

    const res = await plugin.afterHandle!(ctx, original);
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
    expect(res.headers.get("Vary")).toBe("Accept-Encoding");

    const compressed = await res.arrayBuffer();
    expect(compressed.byteLength).toBeLessThan(largeBody.length);
  });

  it("does not compress when Accept-Encoding lacks gzip", async () => {
    const plugin = compress();
    const ctx = makeCtx("http://localhost:3000/", { "Accept-Encoding": "deflate" });

    await plugin.beforeHandle!(ctx);

    const original = new Response("x".repeat(2048), {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

    const res = await plugin.afterHandle!(ctx, original);
    expect(res.headers.get("Content-Encoding")).toBeNull();
  });

  it("does not compress when body is below threshold", async () => {
    const plugin = compress({ threshold: 4096 });
    const ctx = makeCtx("http://localhost:3000/", { "Accept-Encoding": "gzip" });

    await plugin.beforeHandle!(ctx);

    const original = new Response("small", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });

    const res = await plugin.afterHandle!(ctx, original);
    expect(res.headers.get("Content-Encoding")).toBeNull();
  });

  it("does not compress non-compressible content types", async () => {
    const plugin = compress();
    const ctx = makeCtx("http://localhost:3000/", { "Accept-Encoding": "gzip" });

    await plugin.beforeHandle!(ctx);

    const original = new Response("x".repeat(2048), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });

    const res = await plugin.afterHandle!(ctx, original);
    expect(res.headers.get("Content-Encoding")).toBeNull();
  });
});
