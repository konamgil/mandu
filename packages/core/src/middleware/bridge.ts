/**
 * Bridge wrappers — Phase 18.ε
 *
 * Adapters that expose Mandu's existing ctx-based middleware
 * (`csrf` / `session` / `secure` / `rateLimit`) through the canonical
 * request-level {@link Middleware} interface. Both call styles remain
 * supported forever — these bridges exist purely so the new
 * `compose(...)` API can slot in a familiar primitive without wiring
 * boilerplate.
 *
 * The bridge pattern:
 *
 *   1. Build a throwaway `ManduContext` from the incoming Request so the
 *      ctx-based handler has the API surface it expects (`ctx.headers`,
 *      `ctx.cookies`, `ctx.forbidden()`, etc.).
 *   2. Invoke the ctx-based handler.
 *   3. If it returns a Response, treat that as a short-circuit.
 *   4. Otherwise call `next()` to continue the chain, then apply any
 *      pending cookies the ctx-based handler wrote (e.g. CSRF cookie
 *      issuance, session commits) onto the downstream Response.
 *
 * Note: request-level composition happens BEFORE route matching, so the
 * `ctx.params` is always `{}` at this stage. Middleware that depends on
 * route params (unusual) should stick with `filling().use(...)`.
 */
import { defineMiddleware, type Middleware } from "./define";
import { ManduContext, type CookieManager } from "../filling/context";
import { csrf, type CsrfMiddlewareOptions } from "./csrf";
import {
  session,
  saveSession,
  destroySession,
  type SessionMiddlewareOptions,
} from "./session";
import {
  secure as secureCtx,
  type SecureMiddlewareOptions,
} from "./secure";
import {
  rateLimit as rateLimitCtx,
  type RateLimitMiddlewareOptions,
} from "./rate-limit";

// Re-export helpers so `saveSession` / `destroySession` are still reachable
// from call-sites that import from the bridge surface. Backward compat.
export { saveSession, destroySession };

/**
 * Copy pending Set-Cookie headers recorded on a `CookieManager` onto a
 * downstream Response. Mirrors the end-of-request commit path used by
 * `ManduContext.json()`/`ok()` so the ctx-based middleware's cookie
 * writes (e.g. CSRF token issuance) survive the bridge.
 */
function applyCookies(cookies: CookieManager, response: Response): Response {
  return cookies.hasPendingCookies() ? cookies.applyToResponse(response) : response;
}

/**
 * Build a bridge middleware from a ctx-based `(ctx) => Response | void`
 * handler. Short-circuits when the ctx handler returns a Response;
 * otherwise continues the chain and folds the ctx's pending cookies
 * back onto the final Response.
 */
function bridgeCtxMiddleware(
  name: string,
  build: () => (ctx: ManduContext) => Promise<Response | void> | Response | void
): Middleware {
  const ctxHandler = build();
  return defineMiddleware({
    name,
    async handler(req, next) {
      const ctx = new ManduContext(req);
      const early = await ctxHandler(ctx);
      if (early instanceof Response) {
        return applyCookies(ctx.cookies, early);
      }
      const response = await next();
      return applyCookies(ctx.cookies, response);
    },
  });
}

/**
 * Request-level CSRF middleware — issues a double-submit cookie on safe
 * methods and rejects with 403 when an unsafe request lacks a matching
 * token. See {@link csrf} for the full semantics.
 */
export function csrfMiddleware(options: CsrfMiddlewareOptions): Middleware {
  return bridgeCtxMiddleware("csrf", () => csrf(options));
}

/**
 * Request-level session middleware — attaches a `Session` under the
 * configured key. Commit remains caller-driven via {@link saveSession}
 * / {@link destroySession}. See {@link session} for full semantics.
 *
 * Note: because composition runs pre-dispatch, the attached session is
 * ONLY observable inside route handlers that read it via the same key
 * (e.g. `ctx.get("session")`). The bridge's `ManduContext` is discarded
 * after cookie-commit, so this bridge is strictly a convenience for
 * session *hydration* + cookie roll-over; writes performed inside the
 * route handler must still call `saveSession(routeCtx)` explicitly.
 */
export function sessionMiddleware(options: SessionMiddlewareOptions): Middleware {
  return bridgeCtxMiddleware("session", () => session(options));
}

/**
 * Request-level secure-headers middleware. Unlike the ctx-based
 * `secure()` which uses `afterHandle` on a filling plugin, this bridge
 * applies security headers via the `compose()` chain — it wraps the
 * downstream Response and mutates its headers. See {@link secureCtx}
 * for configuration.
 *
 * Implementation: calls the underlying `secure()` plugin's `afterHandle`
 * hook directly against the downstream Response, skipping its
 * `beforeHandle` (which only sets the CSP nonce for ctx-aware SSR — a
 * request-level chain cannot thread a nonce into the route component,
 * so nonce plumbing is intentionally out of scope for this bridge and
 * users who need it should keep `.use(secure(...))` inline).
 */
export function secureMiddleware(options: SecureMiddlewareOptions = {}): Middleware {
  const plugin = secureCtx(options);
  return defineMiddleware({
    name: "secure",
    async handler(req, next) {
      const response = await next();
      const ctx = new ManduContext(req);
      const afterHandle = plugin.afterHandle;
      if (typeof afterHandle !== "function") return response;
      const mutated = await afterHandle(ctx, response);
      return mutated ?? response;
    },
  });
}

/**
 * Request-level rate-limit middleware. Shares the underlying
 * `rateLimit()` store semantics (sliding window, pluggable store). When
 * the limiter rejects, returns the configured 429 Response directly
 * (short-circuits the chain).
 */
export function rateLimitMiddleware(
  options: RateLimitMiddlewareOptions
): Middleware {
  return bridgeCtxMiddleware("rate-limit", () => rateLimitCtx(options));
}
