/**
 * Regression test for issue #319: a route that only registers a GET handler
 * via `Mandu.filling().get(...)` must serve HEAD requests as a body-less GET
 * (RFC 7231 §4.3.2) — returning the same status + headers with an empty body,
 * not a 405 Method Not Allowed.
 */
import { describe, it, expect } from "bun:test";
import { ManduFillingFactory } from "./filling";

describe("Filling HEAD handling (#319)", () => {
  it("serves HEAD via the GET handler with status + headers and an empty body", async () => {
    const filling = ManduFillingFactory.filling().get((ctx) =>
      ctx.json({ ok: true }),
    );

    const getRes = await filling.handle(
      new Request("http://localhost/api/health", { method: "GET" }),
    );
    expect(getRes.status).toBe(200);

    const headRes = await filling.handle(
      new Request("http://localhost/api/health", { method: "HEAD" }),
    );

    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("content-type")).toBe(
      getRes.headers.get("content-type"),
    );
    const headBody = await headRes.text();
    expect(headBody).toBe("");
  });

  it("prefers an explicit HEAD handler when one is registered", async () => {
    const filling = ManduFillingFactory.filling()
      .get((ctx) => ctx.json({ ok: true }))
      .head((ctx) => {
        const res = ctx.json({ ignored: true });
        res.headers.set("X-Explicit-Head", "1");
        return res;
      });

    const headRes = await filling.handle(
      new Request("http://localhost/api/health", { method: "HEAD" }),
    );

    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("X-Explicit-Head")).toBe("1");
  });

  it("still returns 405 for a method with no GET fallback", async () => {
    const filling = ManduFillingFactory.filling().post((ctx) => ctx.json({ ok: true }));

    const headRes = await filling.handle(
      new Request("http://localhost/api/health", { method: "HEAD" }),
    );

    expect(headRes.status).toBe(405);
  });

  it("lists HEAD in the Allow set when GET is registered but the method is unsupported", async () => {
    const filling = ManduFillingFactory.filling().get((ctx) => ctx.json({ ok: true }));

    const putRes = await filling.handle(
      new Request("http://localhost/api/health", { method: "PUT" }),
    );

    expect(putRes.status).toBe(405);
    const body = (await putRes.json()) as { allowed: string[] };
    expect(body.allowed).toContain("GET");
    expect(body.allowed).toContain("HEAD");
  });

  // Issue #321: 405 responses MUST carry an `Allow` header listing every
  // supported method — for multi-method routes too, not just single-method.
  it("sets the Allow header to a single method route's methods", async () => {
    const filling = ManduFillingFactory.filling().get((ctx) => ctx.json({ ok: true }));

    const putRes = await filling.handle(
      new Request("http://localhost/api/health", { method: "PUT" }),
    );

    expect(putRes.status).toBe(405);
    const allow = putRes.headers.get("Allow") ?? "";
    expect(allow.split(", ")).toContain("GET");
    expect(allow.split(", ")).toContain("HEAD");
  });

  it("sets the Allow header to ALL methods for a multi-method route (#321)", async () => {
    const filling = ManduFillingFactory.filling()
      .get((ctx) => ctx.json({ ok: true }))
      .post((ctx) => ctx.json({ ok: true }))
      .delete((ctx) => ctx.json({ ok: true }));

    const putRes = await filling.handle(
      new Request("http://localhost/api/pledges", { method: "PUT" }),
    );

    expect(putRes.status).toBe(405);
    const allow = putRes.headers.get("Allow") ?? "";
    const methods = allow.split(", ");
    expect(methods).toContain("GET");
    expect(methods).toContain("POST");
    expect(methods).toContain("DELETE");
    // HEAD is implied by GET.
    expect(methods).toContain("HEAD");
  });
});
