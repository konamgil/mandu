import { describe, test, expect } from "bun:test";
import { ManduContext } from "../../packages/core/src/filling/context";
import { compose, type MiddlewareEntry } from "../../packages/core/src/runtime/compose";

describe("runtime/compose", () => {
  test("executes middleware in order and supports early Response", async () => {
    const order: number[] = [];
    const middleware: MiddlewareEntry[] = [
      {
        fn: async (_ctx, next) => {
          order.push(1);
          await next();
          order.push(4);
        },
      },
      {
        fn: async (_ctx, next) => {
          order.push(2);
          await next();
        },
      },
      {
        fn: async () => {
          order.push(3);
          return new Response("ok");
        },
      },
    ];

    const handler = compose(middleware, {
      onNotFound: (ctx) => ctx.notFound(),
    });

    const ctx = new ManduContext(new Request("http://localhost/test"));
    const res = await handler(ctx);

    expect(res.status).toBe(200);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  test("throws on next() called multiple times", async () => {
    const middleware: MiddlewareEntry[] = [
      {
        fn: async (_ctx, next) => {
          await next();
          await next();
        },
      },
    ];

    const handler = compose(middleware);
    const ctx = new ManduContext(new Request("http://localhost/test"));

    await expect(handler(ctx)).rejects.toThrow("next() called multiple times");
  });

  test("uses onNotFound when no middleware matches", async () => {
    const handler = compose([], {
      onNotFound: (ctx) => ctx.notFound(),
    });

    const ctx = new ManduContext(new Request("http://localhost/test"));
    const res = await handler(ctx);

    expect(res.status).toBe(404);
  });
});
