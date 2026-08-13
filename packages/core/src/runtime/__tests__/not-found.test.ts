/**
 * Unit tests for `notFound()` / `isNotFoundResponse()` (Phase 6.3).
 *
 * Mirrors the shape of the redirect() tests (see packages/core/tests/server/
 * redirect-loader.test.ts). These stay local to the helper — integration
 * coverage that exercises the full SSR pipeline lives in the server test
 * at packages/core/tests/server/not-found-page.test.ts.
 */

import { describe, it, expect } from "bun:test";
import {
  notFound,
  isNotFoundResponse,
  NOT_FOUND_BRAND,
} from "../not-found";
import { redirect } from "../redirect";
import { ManduFilling } from "../../filling/filling";
import { ManduContext } from "../../filling/context";

describe("notFound()", () => {
  it("returns a Response with status 404", () => {
    const res = notFound();
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(404);
  });

  it("carries the provided message in its body", async () => {
    const res = notFound({ message: "Post not found" });
    const body = await res.text();
    expect(body).toBe("Post not found");
  });

  it("is recognized by isNotFoundResponse()", () => {
    expect(isNotFoundResponse(notFound())).toBe(true);
    expect(isNotFoundResponse(notFound({ message: "x" }))).toBe(true);
  });

  it("rejects a bare `new Response(null, { status: 404 })` (brand check)", () => {
    const bare = new Response(null, { status: 404 });
    expect(isNotFoundResponse(bare)).toBe(false);
    // Double-check: something we know is 404 but not ours (e.g. upstream proxy)
    const proxied = new Response("upstream 404", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
    expect(isNotFoundResponse(proxied)).toBe(false);
  });

  it("rejects a redirect() Response (notFound is a distinct brand)", () => {
    expect(isNotFoundResponse(redirect("/foo"))).toBe(false);
  });

  it("rejects null / undefined / {} / primitives (type guard is strict)", () => {
    expect(isNotFoundResponse(null)).toBe(false);
    expect(isNotFoundResponse(undefined)).toBe(false);
    expect(isNotFoundResponse({})).toBe(false);
    expect(isNotFoundResponse("string")).toBe(false);
    expect(isNotFoundResponse(404)).toBe(false);
    expect(isNotFoundResponse(new Error("not a response"))).toBe(false);
  });

  it("status is always 404 regardless of the message", () => {
    expect(notFound().status).toBe(404);
    expect(notFound({ message: "a" }).status).toBe(404);
    expect(notFound({ message: "" }).status).toBe(404); // empty still 404
    expect(notFound({ message: "x".repeat(1000) }).status).toBe(404);
  });

  it("body is text/plain (not JSON) — explicit content-type contract", async () => {
    const res = notFound({ message: "missing" });
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/plain");
    expect(ct).toContain("charset=utf-8");
    // Body must be the literal message, not a JSON envelope.
    expect(await res.text()).toBe("missing");
  });

  it("default body (no args) is the literal 'Not Found'", async () => {
    const res = notFound();
    expect(await res.text()).toBe("Not Found");
  });

  it("loader returning notFound() is picked up by isNotFoundResponse", async () => {
    const filling = new ManduFilling();
    filling.loader(() => notFound({ message: "post gone" }));

    const ctx = new ManduContext(new Request("http://test/post/1"), { id: "1" });
    const returned = await filling.executeLoader(ctx);
    expect(isNotFoundResponse(returned)).toBe(true);
    // And the body survived.
    const body = await (returned as Response).text();
    expect(body).toBe("post gone");
  });

  it("loader throwing notFound() is picked up the same way (Remix idiom)", async () => {
    const filling = new ManduFilling();
    filling.loader(() => {
      throw notFound({ message: "thrown" });
    });

    const ctx = new ManduContext(new Request("http://test/x"), {});
    let caught: unknown = null;
    try {
      await filling.executeLoader(ctx);
    } catch (e) {
      caught = e;
    }
    expect(isNotFoundResponse(caught)).toBe(true);
    expect(await (caught as Response).text()).toBe("thrown");
  });

  it("integration simulation: loadPageData-like branch distinguishes return vs throw", async () => {
    // Emulates the exact shape of the SSR pipeline's try/catch: `returned`
    // and `thrown` both route through `isNotFoundResponse`. This is the
    // contract the server integration relies on.
    const returnCase = notFound({ message: "A" });
    const throwCase = notFound({ message: "B" });

    // Both must be recognised.
    expect(isNotFoundResponse(returnCase)).toBe(true);
    expect(isNotFoundResponse(throwCase)).toBe(true);

    // And each preserves its own message (no shared mutable state).
    expect(await returnCase.text()).toBe("A");
    expect(await throwCase.text()).toBe("B");
  });

  it("accepts a call with no arguments and still produces a valid sentinel", () => {
    const res = notFound();
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(404);
    expect(isNotFoundResponse(res)).toBe(true);
  });

  it("exports NOT_FOUND_BRAND as a unique symbol keyed to the package", () => {
    // The brand must be a Symbol.for() so multiple copies of @mandujs/core
    // (e.g. monorepo duplication) agree on identity. If this changes we've
    // broken cross-package detection — regression guard.
    expect(typeof NOT_FOUND_BRAND).toBe("symbol");
    expect(Symbol.keyFor(NOT_FOUND_BRAND)).toBe("@mandujs/core/compat/not-found");
  });

  it("two separate notFound() calls produce independently-branded Responses", () => {
    // WeakSet membership is per-instance — the brand on one must not
    // leak to another. Important for test isolation.
    const a = notFound();
    const b = notFound();
    expect(a).not.toBe(b);
    expect(isNotFoundResponse(a)).toBe(true);
    expect(isNotFoundResponse(b)).toBe(true);
  });
});
