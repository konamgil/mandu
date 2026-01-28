import { describe, test, expect } from "bun:test";
import { Mandu } from "../../packages/core/src/filling/filling";

describe("filling middleware", () => {
  test("runs compose middleware around handler", async () => {
    const order: number[] = [];

    const filling = Mandu.filling()
      .middleware(async (_ctx, next) => {
        order.push(1);
        await next();
        order.push(3);
      })
      .middleware(async (_ctx, next) => {
        order.push(2);
        await next();
      })
      .get((ctx) => {
        order.push(4);
        return ctx.ok({ ok: true });
      });

    const res = await filling.handle(new Request("http://localhost/test"));
    expect(res.status).toBe(200);
    expect(order).toEqual([1, 2, 4, 3]);
  });

  test("middleware can short-circuit response", async () => {
    const order: string[] = [];
    const filling = Mandu.filling()
      .middleware(async () => {
        order.push("blocked");
        return new Response("nope", { status: 401 });
      })
      .get((ctx) => {
        order.push("handler");
        return ctx.ok({ ok: true });
      });

    const res = await filling.handle(new Request("http://localhost/test"));
    expect(res.status).toBe(401);
    expect(order).toEqual(["blocked"]);
  });
});
