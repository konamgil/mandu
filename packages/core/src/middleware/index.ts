/**
 * Mandu Middleware — two layers, one surface.
 *
 *   1. Filling-level (ctx-based): `.use(csrf(...))`, `.use(session(...))`
 *      etc. Runs inside the per-route filling chain with a `ManduContext`.
 *
 *   2. Request-level (Phase 18.ε — canonical composition API):
 *      `defineMiddleware(...)`, `compose(...)`. Runs BEFORE route
 *      dispatch on the raw `Request`. Formalized in `define.ts` /
 *      `compose.ts`; bridge wrappers for the existing ctx-based
 *      middleware live in `bridge.ts`.
 */

// Phase 18.ε — canonical composition API.
export {
  defineMiddleware,
  type Middleware,
} from "./define";
export {
  compose,
  MiddlewareError,
  type ComposedHandler,
  type FinalHandler,
} from "./compose";
export {
  csrfMiddleware,
  sessionMiddleware,
  secureMiddleware,
  rateLimitMiddleware,
} from "./bridge";

export {
  schedulerCron,
  setActiveSchedulerRegistration,
  getActiveSchedulerRegistration,
  type SchedulerCronMiddlewareOptions,
} from "./scheduler-cron";

export { cors, type CorsMiddlewareOptions } from "./cors";
export { jwt, type JwtMiddlewareOptions } from "./jwt";
export { csrf, type CsrfMiddlewareOptions } from "./csrf";
export { compress, type CompressMiddlewareOptions } from "./compress";
export { logger, type LoggerMiddlewareOptions } from "./logger";
export { timeout, type TimeoutMiddlewareOptions } from "./timeout";
export {
  session,
  saveSession,
  destroySession,
  type SessionMiddlewareOptions,
} from "./session";
export {
  oauth,
  github,
  google,
  type OAuthOptions,
  type OAuthProvider,
  type OAuthProfile,
} from "./oauth";
export {
  secure,
  applySecureHeadersToResponse,
  buildCsp,
  DEFAULT_CSP_DIRECTIVES,
  type SecureMiddlewareOptions,
  type CspOptions,
  type BuiltCsp,
  type HstsOptions,
  type ReferrerPolicyValue,
} from "./secure";
export {
  rateLimit,
  createRateLimitGuard,
  createInMemoryStore,
  createSqliteStore,
  RateLimitError,
  type RateLimitResult,
  type RateLimitStore,
  type RateLimitMiddleware,
  type RateLimitMiddlewareOptions,
  type RateLimitGuard,
  type RateLimitGuardOptions,
  type SqliteRateLimitStoreOptions,
} from "./rate-limit";
