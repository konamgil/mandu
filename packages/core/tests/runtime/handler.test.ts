/**
 * Fetch Handler Factory Tests
 */
import { describe, it, expect } from "bun:test";
import { createFetchHandler } from "../../src/runtime/handler";

// Minimal mock objects
const mockRouter = { match: () => null } as any;
const mockRegistry = { settings: {} } as any;

function mockHandleRequest(_req: Request): Promise<Response> {
  return Promise.resolve(new Response("OK", { status: 200 }));
}

describe("createFetchHandler", () => {
  it("returns a function", () => {
    const handler = createFetchHandler({
      router: mockRouter,
      registry: mockRegistry,
      corsOptions: false,
      middlewareFn: null,
      middlewareConfig: null,
      handleRequest: mockHandleRequest,
    });
    expect(typeof handler).toBe("function");
  });

  it("passes request to handleRequest when no middleware", async () => {
    let receivedUrl = "";
    const handler = createFetchHandler({
      router: mockRouter,
      registry: mockRegistry,
      corsOptions: false,
      middlewareFn: null,
      middlewareConfig: null,
      handleRequest: async (req) => {
        receivedUrl = req.url;
        return new Response("OK");
      },
    });

    await handler(new Request("http://localhost/test"));
    expect(receivedUrl).toBe("http://localhost/test");
  });

  it("runs middleware when path matches", async () => {
    let middlewareRan = false;
    const handler = createFetchHandler({
      router: mockRouter,
      registry: mockRegistry,
      corsOptions: false,
      middlewareFn: async (_ctx, next) => {
        middlewareRan = true;
        return next();
      },
      middlewareConfig: { matcher: ["/api/*"] },
      handleRequest: mockHandleRequest,
    });

    await handler(new Request("http://localhost/api/users"));
    expect(middlewareRan).toBe(true);
  });

  it("skips middleware when path does not match", async () => {
    let middlewareRan = false;
    const handler = createFetchHandler({
      router: mockRouter,
      registry: mockRegistry,
      corsOptions: false,
      middlewareFn: async (_ctx, next) => {
        middlewareRan = true;
        return next();
      },
      middlewareConfig: { matcher: ["/api/*"] },
      handleRequest: mockHandleRequest,
    });

    await handler(new Request("http://localhost/about"));
    expect(middlewareRan).toBe(false);
  });

  it("returns 500 when middleware throws", async () => {
    const handler = createFetchHandler({
      router: mockRouter,
      registry: mockRegistry,
      corsOptions: false,
      middlewareFn: async () => { throw new Error("boom"); },
      middlewareConfig: null,
      handleRequest: mockHandleRequest,
    });

    const res = await handler(new Request("http://localhost/test"));
    expect(res.status).toBe(500);
  });

  it("middleware can short-circuit with redirect", async () => {
    const handler = createFetchHandler({
      router: mockRouter,
      registry: mockRegistry,
      corsOptions: false,
      middlewareFn: async (ctx) => ctx.redirect("/login"),
      middlewareConfig: null,
      handleRequest: mockHandleRequest,
    });

    const res = await handler(new Request("http://localhost/dashboard"));
    expect(res.status).toBe(302);
  });
});
