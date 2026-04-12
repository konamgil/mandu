/**
 * ManduFilling Action Dispatch Tests
 */

import { describe, it, expect } from "bun:test";
import { ManduFilling } from "../../src/filling/filling";

function jsonPost(url: string, body: Record<string, unknown>, headers?: Record<string, string>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("ManduFilling action dispatch", () => {
  it("dispatches POST with _action in JSON body to action handler", async () => {
    const filling = new ManduFilling()
      .action("create", async (ctx) => ctx.ok({ handler: "create" }))
      .post(async (ctx) => ctx.ok({ handler: "post" }));

    const req = jsonPost("http://localhost/items", { _action: "create", title: "test" });
    const res = await filling.handle(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.handler).toBe("create");
  });

  it("falls through to .post() handler when no _action in body", async () => {
    const filling = new ManduFilling()
      .action("create", async (ctx) => ctx.ok({ handler: "create" }))
      .post(async (ctx) => ctx.ok({ handler: "post" }));

    const req = jsonPost("http://localhost/items", { title: "test" });
    const res = await filling.handle(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.handler).toBe("post");
  });

  it("throws on empty action name", () => {
    expect(() => {
      new ManduFilling().action("", async (ctx) => ctx.ok({}));
    }).toThrow("Action name must be a non-empty string");

    expect(() => {
      new ManduFilling().action("   ", async (ctx) => ctx.ok({}));
    }).toThrow("Action name must be a non-empty string");
  });

  it("body _action takes priority over query _action", async () => {
    const filling = new ManduFilling()
      .action("create", async (ctx) => ctx.ok({ handler: "create" }))
      .action("delete", async (ctx) => ctx.ok({ handler: "delete" }));

    const req = jsonPost(
      "http://localhost/items?_action=create",
      { _action: "delete" },
    );
    const res = await filling.handle(req);
    const data = await res.json();

    expect(data.handler).toBe("delete");
  });

  it("returns revalidated JSON when action + loader + ManduAction header", async () => {
    const filling = new ManduFilling()
      .loader(async () => ({ items: ["a", "b"] }))
      .action("create", async (ctx) => ctx.ok({ created: true }));

    const req = jsonPost(
      "http://localhost/items",
      { _action: "create" },
      { "X-Requested-With": "ManduAction" },
    );
    const res = await filling.handle(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data._revalidated).toBe(true);
    expect(data._action).toBe("create");
    expect(data.loaderData).toEqual({ items: ["a", "b"] });
    expect(data.actionData).toEqual({ created: true });
  });

  it("returns action response directly for non-ManduAction request", async () => {
    const filling = new ManduFilling()
      .loader(async () => ({ items: ["a"] }))
      .action("create", async (ctx) => ctx.ok({ created: true }));

    const req = jsonPost(
      "http://localhost/items",
      { _action: "create" },
      { Accept: "text/html" },
    );
    const res = await filling.handle(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.created).toBe(true);
    expect(data._revalidated).toBeUndefined();
  });

  it("falls back to query _action when body has none", async () => {
    const filling = new ManduFilling()
      .action("search", async (ctx) => ctx.ok({ handler: "search" }))
      .post(async (ctx) => ctx.ok({ handler: "post" }));

    const req = jsonPost("http://localhost/items?_action=search", { title: "test" });
    const res = await filling.handle(req);
    const data = await res.json();

    expect(data.handler).toBe("search");
  });

  it("returns 405 for unregistered method without actions", async () => {
    const filling = new ManduFilling()
      .get(async (ctx) => ctx.ok({ ok: true }));

    const req = new Request("http://localhost/items", { method: "DELETE" });
    const res = await filling.handle(req);

    expect(res.status).toBe(405);
  });
});
