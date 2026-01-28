import { describe, test, expect } from "bun:test";
import { ManduContext } from "../../packages/core/src/filling/context";
import { createLifecycleStore, executeLifecycle } from "../../packages/core/src/runtime/lifecycle";

describe("runtime/lifecycle order", () => {
  test("runs hooks in expected order", async () => {
    const order: string[] = [];
    const lifecycle = createLifecycleStore();

    lifecycle.onRequest.push({ fn: () => order.push("request"), scope: "local" });
    lifecycle.onParse.push({ fn: () => order.push("parse"), scope: "local" });
    lifecycle.beforeHandle.push({ fn: () => order.push("before"), scope: "local" });
    lifecycle.afterHandle.push({
      fn: (_ctx, res) => {
        order.push("after");
        return res;
      },
      scope: "local",
    });
    lifecycle.mapResponse.push({
      fn: (_ctx, res) => {
        order.push("map");
        return res;
      },
      scope: "local",
    });
    lifecycle.afterResponse.push({
      fn: () => order.push("afterResponse"),
      scope: "local",
    });

    const ctx = new ManduContext(
      new Request("http://localhost/test", { method: "POST" })
    );

    const res = await executeLifecycle(lifecycle, ctx, async () => {
      order.push("handler");
      return new Response("ok");
    });

    expect(res.status).toBe(200);

    // afterResponse는 microtask로 실행되므로 한 번 기다림
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(order).toEqual([
      "request",
      "parse",
      "before",
      "handler",
      "after",
      "map",
      "afterResponse",
    ]);
  });
});
