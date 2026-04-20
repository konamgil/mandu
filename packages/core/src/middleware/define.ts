/**
 * Canonical Middleware Composition API — Phase 18.ε
 *
 * This module defines Mandu's request-level middleware contract. It is the
 * runtime analogue of Next.js `middleware.ts` and SvelteKit's `hooks.server.ts`
 * `handle` sequence: each middleware is a thin onion layer that wraps the
 * final route handler, can short-circuit by returning a Response without
 * calling `next()`, and executes in declaration order (outermost first).
 *
 * This API is intentionally **request-level**, not context-level:
 *
 *   - `filling().use(...)` / `MiddlewarePlugin` — operates on a per-route
 *     `ManduContext`. Good for inline concerns like `csrf()` / `session()`
 *     / `secure()` that a single filling chain wants to compose.
 *
 *   - `Middleware` / `compose()` (this module) — operates on the raw
 *     `Request` BEFORE route dispatch. Good for app-wide policies:
 *     auth gates, tenant resolution, rate limiting, request logging,
 *     rewrites, redirects.
 *
 * Both APIs co-exist. Bridge wrappers live alongside each individual
 * middleware module (e.g. `csrf.ts` exports `csrfMiddleware(...)`) so users
 * who want the canonical composition API for an existing middleware can
 * plug it in without boilerplate.
 *
 * @example
 * ```ts
 * import { defineMiddleware, compose } from "@mandujs/core/middleware";
 *
 * const requestId = defineMiddleware({
 *   name: "request-id",
 *   async handler(req, next) {
 *     const id = req.headers.get("x-request-id") ?? crypto.randomUUID();
 *     const res = await next();
 *     res.headers.set("x-request-id", id);
 *     return res;
 *   },
 * });
 *
 * const authGate = defineMiddleware({
 *   name: "auth-gate",
 *   match: (req) => new URL(req.url).pathname.startsWith("/admin"),
 *   async handler(req, next) {
 *     if (!req.headers.get("authorization")) {
 *       return new Response("Unauthorized", { status: 401 });
 *     }
 *     return next();
 *   },
 * });
 *
 * // In mandu.config.ts:
 * export default {
 *   middleware: [requestId, authGate],
 * } satisfies ManduConfig;
 * ```
 */

/**
 * A request-level middleware. Runs BEFORE route dispatch in declaration order.
 *
 *   - `name` identifies the middleware in error messages and diagnostic traces.
 *   - `match?` is an optional filter: middleware whose `match(req)` returns
 *     `false` are skipped (the chain proceeds to the next middleware). Absent
 *     means "always match".
 *   - `handler(req, next)` does the actual work. Return a Response directly
 *     to short-circuit (downstream middleware and the route handler are
 *     skipped). Call `next()` to invoke the rest of the chain and receive
 *     its Response — at which point you may mutate headers, re-wrap the
 *     body, log, etc.
 *
 * The `req` argument is the Request the current layer sees; a middleware
 * may pass a modified Request to `next()` by calling it with a Request
 * argument (rewrite pattern). When called with no argument, `next()` uses
 * the Request passed into the handler.
 */
export interface Middleware {
  /** Display name used in diagnostics. Must be non-empty. */
  name: string;
  /**
   * Optional route filter. When present and returns `false`, the chain
   * skips this middleware entirely (proceeds to the next layer / final
   * handler). When absent the middleware matches all requests.
   *
   * Must be synchronous and side-effect-free — `match` runs once per
   * request per middleware and any throw short-circuits the chain with
   * a 500 response.
   */
  match?: (req: Request) => boolean;
  /**
   * Middleware handler. Receives the current Request and a `next()` thunk
   * that invokes the rest of the chain (or the final route handler, if
   * this is the innermost middleware). Must return a Response.
   *
   * - Call `next()` to continue the chain with the same request.
   * - Call `next(modifiedReq)` to continue with a rewritten request
   *   (downstream middleware and the final handler see `modifiedReq`).
   * - Return a Response directly WITHOUT calling `next()` to short-circuit.
   */
  handler: (
    req: Request,
    next: (req?: Request) => Promise<Response>
  ) => Promise<Response>;
}

/**
 * Ergonomic helper — passes the middleware object through unchanged but
 * preserves full type inference and documents intent at the call site.
 * Mirrors Next.js `defineMiddleware()` and SvelteKit `Handle` exports.
 *
 * @throws {TypeError} when `m` is missing `name` or `handler`, or when
 *   `name` is empty. Fail-fast at definition time — we do NOT want a
 *   silent no-op layer corrupting a composition chain.
 */
export function defineMiddleware(m: Middleware): Middleware {
  if (!m || typeof m !== "object") {
    throw new TypeError("[Mandu Middleware] defineMiddleware requires an object");
  }
  if (typeof m.name !== "string" || m.name.length === 0) {
    throw new TypeError("[Mandu Middleware] defineMiddleware requires a non-empty `name`");
  }
  if (typeof m.handler !== "function") {
    throw new TypeError(
      `[Mandu Middleware] defineMiddleware requires a \`handler\` function (middleware "${m.name}")`
    );
  }
  if (m.match !== undefined && typeof m.match !== "function") {
    throw new TypeError(
      `[Mandu Middleware] \`match\` must be a function when provided (middleware "${m.name}")`
    );
  }
  return m;
}
