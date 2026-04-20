/**
 * Middleware composition — Phase 18.ε
 *
 * Builds a request pipeline from an array of `Middleware` layers and a
 * final handler. The resulting function has Next.js / SvelteKit semantics:
 *
 *   - **Declaration order = outer-to-inner.** `compose(a, b, c)` runs
 *     `a.handler(req, nextA)` first; `nextA()` runs `b.handler`, whose
 *     `nextB()` runs `c.handler`, whose `nextC()` invokes `finalHandler`.
 *
 *   - **Short-circuit.** Any middleware may return a Response without
 *     calling `next()`. Downstream middleware and the final handler are
 *     skipped; the outer chain receives the short-circuit Response.
 *
 *   - **Rewrite.** `next(modifiedReq)` propagates `modifiedReq` to the
 *     remainder of the chain. The current middleware still sees the
 *     original `req` argument (no mutation).
 *
 *   - **Match filter.** Middleware with a `match(req) === false` are
 *     skipped at their position in the chain — `next()` transparently
 *     advances to the next layer.
 *
 *   - **Error propagation.** Throws inside middleware are re-thrown to
 *     the caller. Mandu's outer `handleRequest` wraps this in the
 *     framework's error boundary (error → 500 via `errorToResponse`),
 *     so middleware authors never need their own top-level try/catch
 *     unless they want to convert specific errors to specific responses.
 *
 *   - **Double-next guard.** Calling `next()` twice inside a single
 *     middleware is a programming error (it would re-execute downstream
 *     layers with duplicate side effects). The second call throws a
 *     `MiddlewareError` with the offending middleware's name so the bug
 *     surfaces immediately in dev.
 *
 * @see {@link Middleware} for the interface.
 * @see `docs/architect/middleware-composition.md` for patterns.
 */
import type { Middleware } from "./define";

/**
 * The finalized request handler that sits at the bottom of the middleware
 * chain. Typically this is `handleRequest(req, router, registry)` adapted
 * to the `(req) => Promise<Response>` shape.
 */
export type FinalHandler = (req: Request) => Promise<Response>;

/**
 * The function produced by {@link compose}. Applies the middleware chain
 * on top of `finalHandler` for the given request.
 */
export type ComposedHandler = (
  req: Request,
  finalHandler: FinalHandler
) => Promise<Response>;

/**
 * Thrown when a middleware calls `next()` more than once. Identifies the
 * middleware by name so the diagnostic is actionable.
 */
export class MiddlewareError extends Error {
  override readonly name = "MiddlewareError";
  constructor(
    public readonly middlewareName: string,
    message: string
  ) {
    super(`[${middlewareName}] ${message}`);
  }
}

/**
 * Compose a middleware chain. Zero middleware produces a passthrough:
 * `compose()(req, final) === final(req)`.
 */
export function compose(...middlewares: Middleware[]): ComposedHandler {
  // Defensive copy — callers mutating the source array after compose() must
  // not affect the frozen pipeline. Also narrows index type for the inner
  // recursion and makes an empty-array fast path trivial.
  const chain = middlewares.slice();

  if (chain.length === 0) {
    return (req, finalHandler) => finalHandler(req);
  }

  return async function composed(
    req: Request,
    finalHandler: FinalHandler
  ): Promise<Response> {
    // Recursive dispatcher. `index` is the next middleware to try; `current`
    // is the Request object that layer will receive. Each invocation either:
    //   (a) index === chain.length → delegate to finalHandler(current)
    //   (b) chain[index].match(current) === false → skip, recurse to next
    //   (c) run chain[index].handler(current, next) where next() = dispatch(i+1, …)
    async function dispatch(index: number, current: Request): Promise<Response> {
      if (index >= chain.length) {
        return finalHandler(current);
      }
      const mw = chain[index]!;

      // Evaluate match filter. Throws in `match` are framework-bug territory —
      // we surface them to the outer error boundary rather than papering over.
      if (mw.match) {
        let matched: boolean;
        try {
          matched = mw.match(current);
        } catch (err) {
          throw new MiddlewareError(
            mw.name,
            `\`match(req)\` threw: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        if (!matched) {
          return dispatch(index + 1, current);
        }
      }

      // Single-use `next` guard — second invocation throws.
      let nextCalled = false;
      const next = (override?: Request): Promise<Response> => {
        if (nextCalled) {
          throw new MiddlewareError(
            mw.name,
            "next() was called more than once. Each middleware must call next() at most once."
          );
        }
        nextCalled = true;
        return dispatch(index + 1, override ?? current);
      };

      return mw.handler(current, next);
    }

    return dispatch(0, req);
  };
}
