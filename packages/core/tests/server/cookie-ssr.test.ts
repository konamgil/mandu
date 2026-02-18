/**
 * SSR Cookie Integration Tests
 *
 * filling.loader에서 설정한 쿠키가 SSR Response에 반영되는지 검증
 * + Signed Cookie, Typed Cookie 기능 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  startServer,
  createServerRegistry,
  clearDefaultRegistry,
  type ManduServer,
  type ServerRegistry,
} from "../../src/runtime/server";
import { ManduFilling } from "../../src/filling/filling";
import { CookieManager } from "../../src/filling/context";
import type { RoutesManifest } from "../../src/spec/schema";
import React from "react";

// ========== Test Page Component ==========

function TestPage({ params, loaderData }: { params: Record<string, string>; loaderData?: unknown }) {
  return React.createElement("div", null, `Hello ${JSON.stringify(loaderData)}`);
}

// ========== SSR Cookie → Response ==========

describe("SSR Cookie Integration", () => {
  let server: ManduServer | null = null;
  let registry: ServerRegistry;

  const manifest: RoutesManifest = {
    version: 1,
    routes: [
      { id: "page/home", pattern: "/", kind: "page", module: ".mandu/generated/server/page-home.ts", componentModule: "app/page.tsx" },
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
    clearDefaultRegistry();
  });

  it("filling.loader에서 설정한 쿠키가 SSR Response에 포함된다", async () => {
    const filling = new ManduFilling();
    filling.loader((ctx) => {
      ctx.cookies.set("session", "abc123", { httpOnly: true, maxAge: 3600 });
      return { message: "hello" };
    });

    registry.registerPageHandler("page/home", async () => ({
      component: TestPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);

    const setCookies = res.headers.getSetCookie();
    expect(setCookies.length).toBeGreaterThanOrEqual(1);

    const sessionCookie = setCookies.find(c => c.includes("session="));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain("abc123");
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Max-Age=3600");
  });

  it("여러 쿠키 동시 설정", async () => {
    const filling = new ManduFilling();
    filling.loader((ctx) => {
      ctx.cookies.set("token", "t1", { httpOnly: true });
      ctx.cookies.set("lang", "ko", { path: "/" });
      return {};
    });

    registry.registerPageHandler("page/home", async () => ({
      component: TestPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/`);
    const setCookies = res.headers.getSetCookie();

    expect(setCookies.length).toBeGreaterThanOrEqual(2);
    expect(setCookies.some(c => c.includes("token="))).toBe(true);
    expect(setCookies.some(c => c.includes("lang="))).toBe(true);
  });

  it("쿠키 삭제가 SSR Response에 반영된다", async () => {
    const filling = new ManduFilling();
    filling.loader((ctx) => {
      ctx.cookies.delete("old_session");
      return {};
    });

    registry.registerPageHandler("page/home", async () => ({
      component: TestPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/`);
    const setCookies = res.headers.getSetCookie();

    const deleteCookie = setCookies.find(c => c.includes("old_session="));
    expect(deleteCookie).toBeDefined();
    expect(deleteCookie).toContain("Max-Age=0");
  });

  it("_data JSON 응답에도 쿠키가 포함된다", async () => {
    const filling = new ManduFilling();
    filling.loader((ctx) => {
      ctx.cookies.set("api_token", "xyz", { httpOnly: true });
      return { data: "ok" };
    });

    registry.registerPageHandler("page/home", async () => ({
      component: TestPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/?_data`);
    expect(res.status).toBe(200);

    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some(c => c.includes("api_token="))).toBe(true);

    const body = await res.json();
    expect(body.loaderData).toEqual({ data: "ok" });
  });

  it("loader가 쿠키를 설정하지 않으면 Set-Cookie 헤더가 없다", async () => {
    const filling = new ManduFilling();
    filling.loader(() => {
      return { plain: true };
    });

    registry.registerPageHandler("page/home", async () => ({
      component: TestPage,
      filling,
    }));

    server = startServer(manifest, { port: 0, registry });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);

    const setCookies = res.headers.getSetCookie();
    expect(setCookies.length).toBe(0);
  });
});

// ========== Signed Cookie ==========

describe("Signed Cookie", () => {
  const SECRET = "test-secret-key-32bytes!";

  it("setSigned/getSigned 라운드트립이 성공한다", async () => {
    const req = new Request("http://localhost/");
    const manager = new CookieManager(req);

    await manager.setSigned("session", "user123", SECRET, { httpOnly: true });

    // Set-Cookie 헤더에서 값 추출하여 새 Request 생성
    const headers = manager.getSetCookieHeaders();
    expect(headers.length).toBe(1);

    // 쿠키 값 파싱 (name=value 추출)
    const cookieValue = headers[0].split(";")[0]; // "session=encoded.signature"
    const readReq = new Request("http://localhost/", {
      headers: { cookie: cookieValue },
    });
    const readManager = new CookieManager(readReq);

    const result = await readManager.getSigned("session", SECRET);
    expect(result).toBe("user123");
  });

  it("잘못된 서명은 false를 반환한다", async () => {
    const req = new Request("http://localhost/", {
      headers: { cookie: "session=tamperedvalue.invalidsig" },
    });
    const manager = new CookieManager(req);

    const result = await manager.getSigned("session", SECRET);
    expect(result).toBe(false);
  });

  it("존재하지 않는 쿠키는 null을 반환한다", async () => {
    const req = new Request("http://localhost/");
    const manager = new CookieManager(req);

    const result = await manager.getSigned("nonexistent", SECRET);
    expect(result).toBeNull();
  });

  it("서명이 없는 값은 false를 반환한다", async () => {
    const req = new Request("http://localhost/", {
      headers: { cookie: "session=notsigned" },
    });
    const manager = new CookieManager(req);

    const result = await manager.getSigned("session", SECRET);
    expect(result).toBe(false);
  });

  it("다른 secret으로는 검증 실패한다", async () => {
    const req = new Request("http://localhost/");
    const manager = new CookieManager(req);

    await manager.setSigned("token", "data", SECRET);

    const headers = manager.getSetCookieHeaders();
    const cookieValue = headers[0].split(";")[0];

    const readReq = new Request("http://localhost/", {
      headers: { cookie: cookieValue },
    });
    const readManager = new CookieManager(readReq);

    const result = await readManager.getSigned("token", "wrong-secret");
    expect(result).toBe(false);
  });
});

// ========== Typed Cookie (getParsed) ==========

describe("Typed Cookie (getParsed)", () => {
  it("JSON 쿠키를 스키마로 파싱한다", () => {
    const json = encodeURIComponent(JSON.stringify({ theme: "dark", fontSize: 14 }));
    const req = new Request("http://localhost/", {
      headers: { cookie: `prefs=${json}` },
    });
    const manager = new CookieManager(req);

    // Zod 호환 duck typing 스키마
    const schema = {
      parse(v: unknown) {
        const obj = v as { theme: string; fontSize: number };
        if (typeof obj.theme !== "string" || typeof obj.fontSize !== "number") {
          throw new Error("Invalid");
        }
        return obj;
      },
    };

    const result = manager.getParsed("prefs", schema);
    expect(result).toEqual({ theme: "dark", fontSize: 14 });
  });

  it("존재하지 않는 쿠키는 null을 반환한다", () => {
    const req = new Request("http://localhost/");
    const manager = new CookieManager(req);

    const schema = { parse: (v: unknown) => v as string };
    const result = manager.getParsed("missing", schema);
    expect(result).toBeNull();
  });

  it("JSON 파싱 실패 시 null을 반환한다", () => {
    const req = new Request("http://localhost/", {
      headers: { cookie: "prefs=not-json" },
    });
    const manager = new CookieManager(req);

    const schema = { parse: (v: unknown) => v as Record<string, unknown> };
    const result = manager.getParsed("prefs", schema);
    expect(result).toBeNull();
  });

  it("스키마 검증 실패 시 null을 반환한다", () => {
    const json = encodeURIComponent(JSON.stringify({ wrong: "data" }));
    const req = new Request("http://localhost/", {
      headers: { cookie: `prefs=${json}` },
    });
    const manager = new CookieManager(req);

    const schema = {
      parse(v: unknown) {
        const obj = v as { theme?: string };
        if (!obj.theme) throw new Error("theme required");
        return obj;
      },
    };

    const result = manager.getParsed("prefs", schema);
    expect(result).toBeNull();
  });
});
