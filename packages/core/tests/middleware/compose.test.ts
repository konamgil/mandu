/**
 * Phase 18.ε — request-level middleware composition regression suite.
 *
 * Covers: declaration order, short-circuit, error propagation, match
 * filter, rewrite via `next(req)`, double-next guard, empty chain,
 * async timing, mixed sync/async layers, defineMiddleware validation.
 */
import { describe, it, expect } from "bun:test";
import {
  compose,
  MiddlewareError,
  type FinalHandler,
} from "../../src/middleware/compose";
import { defineMiddleware, type Middleware } from "../../src/middleware/define";

const req = (url = "https://ex.test/") => new Request(url);
const ok = () => new Response("ok", { status: 200 });

describe("defineMiddleware", () => {
  it("passes a well-formed middleware through unchanged", () => {
    const mw = defineMiddleware({
      name: "noop",
      handler: async (_req, next) => next(),
    });
    expect(mw.name).toBe("noop");
    expect(typeof mw.handler).toBe("function");
  });

  it("throws when `name` is missing or empty", () => {
    expect(() =>
      defineMiddleware({
        name: "",
        handler: async (_r: Request, n: () => Promise<Response>) => n(),
      })
    ).toThrow(/non-empty `name`/);
    expect(() =>
      defineMiddleware({
        handler: async (_r: Request, n: () => Promise<Response>) => n(),
      } as unknown as Middleware)
    ).toThrow(/non-empty `name`/);
  });

  it("throws when `handler` is not a function", () => {
    expect(() =>
      defineMiddleware({ name: "bad", handler: "nope" } as unknown as Middleware)
    ).toThrow(/`handler` function/);
  });

  it("throws when `match` is provided but not a function", () => {
    expect(() =>
      defineMiddleware({
        name: "bad-match",
        match: "/admin" as unknown as (req: Request) => boolean,
        handler: async (_r, n) => n(),
      })
    ).toThrow(/`match` must be a function/);
  });
});

describe("compose — empty chain", () => {
  it("empty chain delegates straight to finalHandler", async () => {
    const final: FinalHandler = async () => new Response("final");
    const composed = compose();
    const res = await composed(req(), final);
    expect(await res.text()).toBe("final");
  });
});

describe("compose — declaration order", () => {
  it("executes outer → inner → final → inner-after → outer-after", async () => {
    const trace: string[] = [];
    const a = defineMiddleware({
      name: "a",
      handler: async (_r, next) => {
        trace.push("a-before");
        const res = await next();
        trace.push("a-after");
        return res;
      },
    });
    const b = defineMiddleware({
      name: "b",
      handler: async (_r, next) => {
        trace.push("b-before");
        const res = await next();
        trace.push("b-after");
        return res;
      },
    });
    const final: FinalHandler = async () => {
      trace.push("final");
      return ok();
    };
    await compose(a, b)(req(), final);
    expect(trace).toEqual(["a-before", "b-before", "final", "b-after", "a-after"]);
  });
});

describe("compose — short-circuit", () => {
  it("middleware that returns without calling next() skips downstream + final", async () => {
    let finalRan = false;
    let innerRan = false;
    const gate = defineMiddleware({
      name: "gate",
      handler: async () => new Response("blocked", { status: 403 }),
    });
    const inner = defineMiddleware({
      name: "inner",
      handler: async (_r, next) => {
        innerRan = true;
        return next();
      },
    });
    const final: FinalHandler = async () => {
      finalRan = true;
      return ok();
    };
    const res = await compose(gate, inner)(req(), final);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("blocked");
    expect(innerRan).toBe(false);
    expect(finalRan).toBe(false);
  });

  it("outer middleware still sees short-circuit Response from inner", async () => {
    let outerSawStatus = 0;
    const outer = defineMiddleware({
      name: "outer",
      handler: async (_r, next) => {
        const res = await next();
        outerSawStatus = res.status;
        return res;
      },
    });
    const gate = defineMiddleware({
      name: "gate",
      handler: async () => new Response("nope", { status: 401 }),
    });
    const res = await compose(outer, gate)(req(), async () => ok());
    expect(res.status).toBe(401);
    expect(outerSawStatus).toBe(401);
  });
});

describe("compose — match filter", () => {
  it("skips middleware whose match(req) returns false", async () => {
    let ran = false;
    const onlyAdmin = defineMiddleware({
      name: "admin-gate",
      match: (r) => new URL(r.url).pathname.startsWith("/admin"),
      handler: async (_r, next) => {
        ran = true;
        return next();
      },
    });
    const res = await compose(onlyAdmin)(req("https://ex.test/public"), async () => ok());
    expect(res.status).toBe(200);
    expect(ran).toBe(false);
  });

  it("runs middleware whose match(req) returns true", async () => {
    let ran = false;
    const onlyAdmin = defineMiddleware({
      name: "admin-gate",
      match: (r) => new URL(r.url).pathname.startsWith("/admin"),
      handler: async (_r, next) => {
        ran = true;
        return next();
      },
    });
    await compose(onlyAdmin)(req("https://ex.test/admin/x"), async () => ok());
    expect(ran).toBe(true);
  });

  it("throwing inside match() surfaces a MiddlewareError naming the layer", async () => {
    const bad = defineMiddleware({
      name: "bad-match",
      match: () => {
        throw new Error("boom");
      },
      handler: async (_r, next) => next(),
    });
    const run = async () => compose(bad)(req(), async () => ok());
    await expect(run()).rejects.toThrow(/bad-match/);
    await expect(run()).rejects.toThrow(/match\(req\)/);
  });
});

describe("compose — error propagation", () => {
  it("middleware throws propagate to the caller", async () => {
    const boom = defineMiddleware({
      name: "boom",
      handler: async () => {
        throw new Error("kaboom");
      },
    });
    await expect(compose(boom)(req(), async () => ok())).rejects.toThrow("kaboom");
  });

  it("final handler throws propagate through wrapping middleware", async () => {
    let afterRan = false;
    const outer = defineMiddleware({
      name: "outer",
      handler: async (_r, next) => {
        try {
          return await next();
        } finally {
          afterRan = true;
        }
      },
    });
    await expect(
      compose(outer)(req(), async () => {
        throw new Error("final-boom");
      })
    ).rejects.toThrow("final-boom");
    expect(afterRan).toBe(true);
  });
});

describe("compose — rewrite via next(req)", () => {
  it("next(rewrittenReq) propagates the rewrite to downstream + final", async () => {
    let finalUrl = "";
    const rewriter = defineMiddleware({
      name: "rewriter",
      handler: async (_r, next) => next(new Request("https://ex.test/rewritten")),
    });
    const res = await compose(rewriter)(
      req("https://ex.test/original"),
      async (r) => {
        finalUrl = r.url;
        return ok();
      }
    );
    expect(res.status).toBe(200);
    expect(finalUrl).toBe("https://ex.test/rewritten");
  });

  it("rewrite is visible to middleware further down the chain", async () => {
    let innerSawPath = "";
    const rewriter = defineMiddleware({
      name: "rewriter",
      handler: async (_r, next) => next(new Request("https://ex.test/rw")),
    });
    const inner = defineMiddleware({
      name: "inner",
      handler: async (r, next) => {
        innerSawPath = new URL(r.url).pathname;
        return next();
      },
    });
    await compose(rewriter, inner)(req("https://ex.test/orig"), async () => ok());
    expect(innerSawPath).toBe("/rw");
  });
});

describe("compose — double-next guard", () => {
  it("calling next() twice throws MiddlewareError naming the layer", async () => {
    const buggy = defineMiddleware({
      name: "buggy",
      handler: async (_r, next) => {
        await next();
        return next();
      },
    });
    await expect(compose(buggy)(req(), async () => ok())).rejects.toThrow(MiddlewareError);
    await expect(compose(buggy)(req(), async () => ok())).rejects.toThrow(
      /\[buggy\] next\(\) was called more than once/
    );
  });
});

describe("compose — async timing", () => {
  it("awaits async work in declaration order (serial, not parallel)", async () => {
    const trace: string[] = [];
    const delay = (label: string, ms: number) =>
      defineMiddleware({
        name: label,
        handler: async (_r, next) => {
          trace.push(`${label}-start`);
          await new Promise((r) => setTimeout(r, ms));
          trace.push(`${label}-mid`);
          const res = await next();
          trace.push(`${label}-end`);
          return res;
        },
      });
    await compose(delay("a", 5), delay("b", 1))(req(), async () => {
      trace.push("final");
      return ok();
    });
    expect(trace).toEqual([
      "a-start",
      "a-mid",
      "b-start",
      "b-mid",
      "final",
      "b-end",
      "a-end",
    ]);
  });
});

describe("compose — response mutation after next()", () => {
  it("outer middleware can rewrap the downstream Response", async () => {
    const annotator = defineMiddleware({
      name: "annotator",
      handler: async (_r, next) => {
        const res = await next();
        const headers = new Headers(res.headers);
        headers.set("x-mw-ran", "yes");
        return new Response(res.body, { status: res.status, headers });
      },
    });
    const res = await compose(annotator)(req(), async () => ok());
    expect(res.headers.get("x-mw-ran")).toBe("yes");
  });
});

describe("compose — callable repeatedly", () => {
  it("the same ComposedHandler handles many sequential requests independently", async () => {
    let count = 0;
    const counter = defineMiddleware({
      name: "counter",
      handler: async (_r, next) => {
        count++;
        return next();
      },
    });
    const composed = compose(counter);
    const final: FinalHandler = async () => ok();
    await composed(req("https://ex.test/a"), final);
    await composed(req("https://ex.test/b"), final);
    await composed(req("https://ex.test/c"), final);
    expect(count).toBe(3);
  });
});

describe("compose — defensive array copy", () => {
  it("mutating the source array post-compose() does not affect the pipeline", async () => {
    const first = defineMiddleware({
      name: "first",
      handler: async (_r, next) => {
        const res = await next();
        const headers = new Headers(res.headers);
        headers.set("x-first", "1");
        return new Response(res.body, { status: res.status, headers });
      },
    });
    const list: Middleware[] = [first];
    const composed = compose(...list);
    list.length = 0; // mutate after compose
    list.push(
      defineMiddleware({
        name: "should-not-run",
        handler: async () => {
          throw new Error("should not run");
        },
      })
    );
    const res = await composed(req(), async () => ok());
    expect(res.headers.get("x-first")).toBe("1");
  });
});
