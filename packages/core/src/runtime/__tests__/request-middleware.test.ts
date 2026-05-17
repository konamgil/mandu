import { describe, expect, it } from "bun:test";
import { defineMiddleware } from "../../middleware/define";
import {
  buildRequestMiddlewareChain,
  runRequestMiddleware,
} from "../request-middleware";

const req = new Request("https://example.test/api/echo");

describe("runtime request middleware wiring", () => {
  it("keeps the no-middleware path unset for hot-path passthrough", () => {
    expect(buildRequestMiddlewareChain(undefined)).toBeUndefined();
    expect(buildRequestMiddlewareChain([])).toBeUndefined();
  });

  it("returns undefined when there is no chain or middleware is skipped", async () => {
    let finalHits = 0;
    const finalHandler = async (): Promise<Response> => {
      finalHits++;
      return new Response("ok");
    };
    const middlewareChain = buildRequestMiddlewareChain([
      defineMiddleware({
        name: "marker",
        handler: async (_req, next) => next(),
      }),
    ]);

    await expect(
      runRequestMiddleware({ req, middlewareChain: undefined, finalHandler })
    ).resolves.toBeUndefined();
    await expect(
      runRequestMiddleware({
        req,
        middlewareChain,
        finalHandler,
        skipMiddleware: true,
      })
    ).resolves.toBeUndefined();
    expect(finalHits).toBe(0);
  });

  it("dispatches through the composed chain when configured", async () => {
    const trace: string[] = [];
    const middlewareChain = buildRequestMiddlewareChain([
      defineMiddleware({
        name: "outer",
        handler: async (_req, next) => {
          trace.push("before");
          const response = await next();
          trace.push("after");
          return response;
        },
      }),
    ]);

    const response = await runRequestMiddleware({
      req,
      middlewareChain,
      finalHandler: async () => {
        trace.push("final");
        return new Response("ok");
      },
    });

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("ok");
    expect(trace).toEqual(["before", "final", "after"]);
  });
});
