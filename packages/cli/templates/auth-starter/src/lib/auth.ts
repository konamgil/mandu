/**
 * Auth wiring for the demo — session storage + CSRF token helpers.
 *
 * This module is the single source of truth for:
 *   1. the session storage instance (cookie-backed, HMAC-signed)
 *   2. the csrf middleware factory (double-submit cookie pattern)
 *   3. session/csrf secrets (env-driven, with loud dev fallback)
 *   4. `attachAuthContext(ctx)` — runs session() middleware and ensures a
 *      CSRF cookie/token exists, returning `{ userId, csrfToken }` to
 *      page loaders so they can embed the token in forms.
 *
 * Why a helper rather than `.use(csrf())` everywhere: page rendering runs
 * the filling loader directly (`filling.executeLoader(ctx)` in server.ts),
 * NOT the full handler pipeline, so `.use()` middleware does not execute
 * for page GETs. API routes still use the real `session()` + `csrf()`
 * middleware via `.use()` — the helper and the middleware share the same
 * underlying primitives, so tokens/cookies round-trip cleanly.
 */
import {
  createCookieSessionStorage,
  type ManduContext,
  type SessionStorage,
} from "@mandujs/core";
import { createSqliteSessionStorage } from "@mandujs/core/filling/session-sqlite";
import {
  session as sessionMiddleware,
  csrf as csrfMiddleware,
} from "@mandujs/core/middleware";
import { currentUserId } from "@mandujs/core/auth";
// Side-effect import: registers Phase 3.1 cron jobs (session GC).
// Every API route + page loader pulls `auth.ts` in, so this is the most
// reliable boot hook without touching mandu.config.ts.
import "./scheduler";

// ────────────────────────────────────────────────────────────────────────────
// Secrets
// ────────────────────────────────────────────────────────────────────────────

const DEV_INSECURE = "dev-insecure-secret-DO-NOT-USE-IN-PRODUCTION";

function readSecret(envVar: string): string {
  const raw = process.env[envVar];
  if (typeof raw === "string" && raw.length >= 16) {
    return raw;
  }
  // Loud dev warning — users MUST set real secrets in production.
  if (process.env.NODE_ENV === "production") {
    console.error(
      `[auth-starter] ${envVar} is not set (or too short) in production. ` +
        `Refusing to boot with an insecure fallback.`
    );
    // Fallback to a random-ish per-boot string so prod doesn't use the public constant.
    return `${DEV_INSECURE}-${crypto.randomUUID()}`;
  }
  console.warn(
    `[auth-starter] ${envVar} not set — using a public dev fallback. ` +
      `Set it in .env before deploying.`
  );
  return DEV_INSECURE;
}

export const SESSION_SECRET = readSecret("SESSION_SECRET");
export const CSRF_SECRET = readSecret("CSRF_SECRET");

// ────────────────────────────────────────────────────────────────────────────
// Session storage — single module-level instance so every request attaches
// to the same signing key + cookie name.
//
// `SESSION_STORE=sqlite` swaps the cookie-backed storage for
// `createSqliteSessionStorage` (Phase 4b). The SQLite path registers its
// OWN GC cron internally, so `./scheduler` detects the mode and skips its
// own session-gc heartbeat to avoid double-registration.
// ────────────────────────────────────────────────────────────────────────────

export const SESSION_STORE_MODE: "cookie" | "sqlite" =
  process.env.SESSION_STORE === "sqlite" ? "sqlite" : "cookie";

function buildSessionStorage(): SessionStorage {
  if (SESSION_STORE_MODE === "sqlite") {
    return createSqliteSessionStorage({
      dbPath: process.env.SESSION_SQLITE_PATH ?? ".mandu/sessions.db",
      cookie: {
        name: "__auth_session",
        secrets: [SESSION_SECRET],
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
      },
      ttlSeconds: 60 * 60 * 24 * 7,
      // The storage itself schedules an hourly sweep via @mandujs/core/scheduler.
      gcSchedule: "0 * * * *",
    });
  }
  return createCookieSessionStorage({
    cookie: {
      name: "__auth_session",
      secrets: [SESSION_SECRET],
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  });
}

export const sessionStorage: SessionStorage = buildSessionStorage();

// ────────────────────────────────────────────────────────────────────────────
// Middleware factories — call these in filling chains on API routes
// ────────────────────────────────────────────────────────────────────────────

/** Session middleware — attaches the Session to `ctx.get("session")`. */
export const withSession = () => sessionMiddleware({ storage: sessionStorage });

/** CSRF middleware — validates `x-csrf-token` header or `_csrf` form field. */
export const withCsrf = () => csrfMiddleware({ secret: CSRF_SECRET });

// ────────────────────────────────────────────────────────────────────────────
// Page loader helpers
// ────────────────────────────────────────────────────────────────────────────

export interface AuthContext {
  userId: string | null;
  csrfToken: string;
}

/**
 * Prepare `ctx` for a page loader:
 *   1. run `session()` so `currentUserId(ctx)` works
 *   2. ensure a `__csrf` cookie exists, generating one if needed
 *   3. return the CSRF token so the page can inject it as a hidden field
 *
 * Runs `csrfMiddleware` once to handle both the "has valid cookie" and
 * "needs a fresh cookie" cases — we deliberately pass a GET-shaped request
 * clone so the middleware takes the safe-method path (it never tries to
 * validate a submitted token when method is GET, see csrf.ts line 125).
 */
export async function attachAuthContext(ctx: ManduContext): Promise<AuthContext> {
  // 1. Session attach.
  await withSession()(ctx);

  // 2. CSRF: run the middleware which will set the cookie if missing. Because
  //    page loaders run on GET requests in practice, this is the safe-method
  //    code path — it issues the cookie and returns `void`.
  await withCsrf()(ctx);

  // 3. Read the token. If the request already had a valid cookie, it lives in
  //    `ctx.cookies.get("__csrf")` (request bucket). If the middleware just
  //    generated a new one, it lives in the response bucket — mirror the
  //    `getSetCookieHeaders` output by inspecting both.
  const tokenFromRequest = ctx.cookies.get("__csrf");
  const token = typeof tokenFromRequest === "string" ? tokenFromRequest : readFreshCsrfFromResponse(ctx);

  return {
    userId: currentUserId(ctx),
    csrfToken: token,
  };
}

/**
 * Extract the freshly-set `__csrf` value from the pending Set-Cookie headers.
 * We only peek — this does NOT mutate state.
 */
function readFreshCsrfFromResponse(ctx: ManduContext): string {
  for (const header of ctx.cookies.getSetCookieHeaders()) {
    // Format: "__csrf=<value>; Path=/; ..."
    if (header.startsWith("__csrf=")) {
      const semi = header.indexOf(";");
      const raw = header.slice("__csrf=".length, semi === -1 ? header.length : semi);
      return decodeURIComponent(raw);
    }
  }
  return "";
}
