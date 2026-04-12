import { describe, it, expect } from "bun:test";
import {
  matchesMiddlewarePath,
  createMiddlewareContext,
  type MiddlewareConfig,
} from "../../src/runtime/middleware";

describe("matchesMiddlewarePath", () => {
  it("matches all paths when config is null", () => {
    expect(matchesMiddlewarePath("/anything", null)).toBe(true);
    expect(matchesMiddlewarePath("/", null)).toBe(true);
  });

  it("matches all paths when config has no matcher", () => {
    expect(matchesMiddlewarePath("/x", {})).toBe(true);
    expect(matchesMiddlewarePath("/x", { matcher: [] })).toBe(true);
  });

  it("wildcard /api/* matches subpaths and /api itself", () => {
    const cfg: MiddlewareConfig = { matcher: ["/api/*"] };
    expect(matchesMiddlewarePath("/api/users", cfg)).toBe(true);
    expect(matchesMiddlewarePath("/api/users/123", cfg)).toBe(true);
    expect(matchesMiddlewarePath("/api", cfg)).toBe(true);
  });

  it("wildcard /api/* does not match unrelated paths", () => {
    const cfg: MiddlewareConfig = { matcher: ["/api/*"] };
    expect(matchesMiddlewarePath("/other", cfg)).toBe(false);
    expect(matchesMiddlewarePath("/apiary", cfg)).toBe(false);
  });

  it("exact pattern matches only that path", () => {
    const cfg: MiddlewareConfig = { matcher: ["/about"] };
    expect(matchesMiddlewarePath("/about", cfg)).toBe(true);
    expect(matchesMiddlewarePath("/about/team", cfg)).toBe(false);
    expect(matchesMiddlewarePath("/", cfg)).toBe(false);
  });

  it("exclude takes priority over matcher", () => {
    const cfg: MiddlewareConfig = {
      matcher: ["/api/*"],
      exclude: ["/api/health"],
    };
    expect(matchesMiddlewarePath("/api/users", cfg)).toBe(true);
    expect(matchesMiddlewarePath("/api/health", cfg)).toBe(false);
  });

  it("exclude without matcher blocks only excluded paths", () => {
    const cfg: MiddlewareConfig = { exclude: ["/static/*"] };
    expect(matchesMiddlewarePath("/page", cfg)).toBe(true);
    expect(matchesMiddlewarePath("/static/logo.png", cfg)).toBe(false);
  });
});

describe("createMiddlewareContext", () => {
  function makeReq(url: string) {
    return new Request(url, {
      headers: { cookie: "session=abc123" },
    });
  }

  it("has correct url property", () => {
    const ctx = createMiddlewareContext(makeReq("http://localhost:3000/dashboard?q=1"));
    expect(ctx.url.pathname).toBe("/dashboard");
    expect(ctx.url.searchParams.get("q")).toBe("1");
  });

  it("exposes cookies from the request", () => {
    const ctx = createMiddlewareContext(makeReq("http://localhost:3000/"));
    expect(ctx.cookies.get("session")).toBe("abc123");
  });

  it("redirect returns a Response with Location header", () => {
    const ctx = createMiddlewareContext(makeReq("http://localhost:3000/old"));
    const res = ctx.redirect("/new", 301);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("http://localhost:3000/new");
  });

  it("redirect defaults to 302", () => {
    const ctx = createMiddlewareContext(makeReq("http://localhost:3000/"));
    const res = ctx.redirect("/login");
    expect(res.status).toBe(302);
  });

  it("json returns a JSON response with correct status", async () => {
    const ctx = createMiddlewareContext(makeReq("http://localhost:3000/"));
    const res = ctx.json({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("json defaults to 200", () => {
    const ctx = createMiddlewareContext(makeReq("http://localhost:3000/"));
    const res = ctx.json({ ok: true });
    expect(res.status).toBe(200);
  });

  it("set/get store passes data through", () => {
    const ctx = createMiddlewareContext(makeReq("http://localhost:3000/"));
    ctx.set("user", { id: 42 });
    expect(ctx.get<{ id: number }>("user")).toEqual({ id: 42 });
  });

  it("get returns undefined for missing key", () => {
    const ctx = createMiddlewareContext(makeReq("http://localhost:3000/"));
    expect(ctx.get("nope")).toBeUndefined();
  });

  it("rewrite returns a new Request with rewritten url", () => {
    const ctx = createMiddlewareContext(makeReq("http://localhost:3000/old-path"));
    const rewritten = ctx.rewrite("/new-path");
    expect(new URL(rewritten.url).pathname).toBe("/new-path");
    expect(rewritten.method).toBe("GET");
  });
});
