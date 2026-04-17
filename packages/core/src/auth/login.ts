/**
 * @mandujs/core/auth/login
 *
 * Ergonomic helpers that bridge Phase 2.3's `session()` middleware with
 * Mandu's existing auth types in `filling/auth.ts`.
 *
 * These helpers **absorb the ordering hazard** from `saveSession` / `destroySession`
 * (see `middleware/session.ts` lines 99-102): callers must not build a Response
 * before committing the session. `loginUser` / `logoutUser` call those helpers
 * internally, so handler code collapses to:
 *
 * @example
 * ```ts
 * import { loginUser, logoutUser, currentUserId } from "@mandujs/core/auth";
 * import { hashPassword, verifyPassword } from "@mandujs/core/auth";
 *
 * // login route
 * const ok = await verifyPassword(plaintext, storedHash);
 * if (!ok) return ctx.unauthorized();
 * await loginUser(ctx, user.id);
 * return ctx.redirect("/dashboard");
 *
 * // logout route
 * await logoutUser(ctx);
 * return ctx.redirect("/");
 *
 * // read-side
 * const uid = currentUserId(ctx); // null if not logged in
 * ```
 *
 * **Note on `ctx.set("user", ...)` vs `session.get("userId")`:** this module
 * stores `userId` in the SESSION (persisted across requests via cookie).
 * `requireUser` / `requireRole` from `filling/auth.ts` read from the
 * REQUEST-SCOPED store at `ctx.get("user")`, which is a different location.
 * A typical app bridges the two with a tiny middleware placed AFTER
 * `session()`:
 *
 * ```ts
 * .use(session({ storage }))
 * .beforeHandle(async (ctx) => {
 *   const uid = currentUserId(ctx);
 *   if (uid) ctx.set("user", await db.users.findById(uid));
 * })
 * ```
 *
 * @module auth/login
 */

import type { ManduContext } from "../filling/context";
import type { Session } from "../filling/session";
import { saveSession, destroySession } from "../middleware/session";
import { AuthenticationError } from "../filling/auth";

// ========== Defaults ==========

/**
 * Session key under which `userId` is persisted. Kept short and stable so
 * upgrading from `loginUser` to reading the raw session still works.
 */
const DEFAULT_USER_ID_KEY = "userId";

/**
 * Session key under which the login timestamp (ms since epoch) is persisted.
 * Useful for session-age checks and re-authentication prompts.
 */
const DEFAULT_LOGGED_AT_KEY = "loginAt";

/** Default ctx key used by `session()` middleware. Mirrors `middleware/session.ts`. */
const DEFAULT_SESSION_ATTACH_KEY = "session";

// ========== Types ==========

/** Options passed when storing auth state in the session. */
export interface LoginOptions {
  /** Session key for user id. Default: `"userId"`. */
  userIdKey?: string;
  /** Session key for "logged at" timestamp (ms). Default: `"loginAt"`. */
  loggedAtKey?: string;
  /**
   * Extra session fields to set atomically with userId. Restricted to
   * JSON-serializable primitives so the session cookie round-trips cleanly.
   * If you need richer types, mutate the Session directly before calling
   * `loginUser`, or after it (before the response).
   */
  extras?: Record<string, string | number | boolean>;
}

// ========== Helpers ==========

/**
 * Mark the current session as authenticated for `userId`, commit it via
 * `saveSession` (so the `Set-Cookie` header lands on the next response),
 * and return. Must be called **before** returning a Response from the
 * handler — `saveSession` attaches cookies via `ctx.cookies`, which
 * `ctx.json` / `ctx.ok` / `ctx.redirect` snapshot at build time.
 *
 * Throws an {@link AuthenticationError} wrapping the underlying wiring
 * error when the `session()` middleware is not installed on this request.
 * Using `AuthenticationError` (and not raw `Error`) keeps the login path
 * uniformly catchable — the same catch block that handles bad credentials
 * can handle "no session middleware" as a generic auth failure.
 */
export async function loginUser(
  ctx: ManduContext,
  userId: string,
  options?: LoginOptions,
): Promise<void> {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new AuthenticationError("loginUser: userId must be a non-empty string");
  }

  const userIdKey = options?.userIdKey ?? DEFAULT_USER_ID_KEY;
  const loggedAtKey = options?.loggedAtKey ?? DEFAULT_LOGGED_AT_KEY;

  const session = ctx.get<Session>(DEFAULT_SESSION_ATTACH_KEY);
  if (!session) {
    throw new AuthenticationError(
      "Session middleware not installed: add `.use(session({ storage }))` before calling loginUser",
    );
  }

  // All three writes happen before the commit so they land atomically in the
  // same Set-Cookie. If any write throws, we propagate without committing.
  session.set(userIdKey, userId);
  session.set(loggedAtKey, Date.now());

  if (options?.extras) {
    for (const [key, value] of Object.entries(options.extras)) {
      session.set(key, value);
    }
  }

  // Commit — saveSession reads `ctx.get("session")` and attaches Set-Cookie.
  // Forwards the same wiring-error from saveSession if storageKey was wired
  // differently, though we already verified the session above.
  try {
    await saveSession(ctx);
  } catch (cause) {
    // Re-shape to AuthenticationError so callers have one error type on the
    // login path. Preserve the original via the `cause` property (ES2022).
    throw new AuthenticationError(
      `loginUser: failed to commit session — ${(cause as Error)?.message ?? String(cause)}`,
    );
  }
}

/**
 * Clear the current session by invoking `destroySession`: wipes in-memory
 * state and emits an expiring `Set-Cookie` (Max-Age=0) so the browser drops
 * its copy.
 *
 * Idempotent: calling on a request with no session cookie, or calling twice
 * in succession, is safe — `destroySession` always emits a fresh expiring
 * cookie. Throws an {@link AuthenticationError} only when the session
 * middleware itself was not installed (same rationale as {@link loginUser}).
 */
export async function logoutUser(
  ctx: ManduContext,
  options?: Pick<LoginOptions, "userIdKey">,
): Promise<void> {
  const session = ctx.get<Session>(DEFAULT_SESSION_ATTACH_KEY);
  if (!session) {
    throw new AuthenticationError(
      "Session middleware not installed: add `.use(session({ storage }))` before calling logoutUser",
    );
  }

  // `options.userIdKey` is accepted for symmetry with loginUser, but
  // destroySession wipes the entire session so per-key handling is unneeded.
  // We still `unset` it first to normalize dirty state in case a caller
  // composes logoutUser with pre/post inspection.
  const userIdKey = options?.userIdKey ?? DEFAULT_USER_ID_KEY;
  if (session.has(userIdKey)) {
    session.unset(userIdKey);
  }

  try {
    await destroySession(ctx);
  } catch (cause) {
    throw new AuthenticationError(
      `logoutUser: failed to destroy session — ${(cause as Error)?.message ?? String(cause)}`,
    );
  }
}

/**
 * Read the current `userId` from the session. Returns `null` when either:
 *   - The session middleware is not installed on this request
 *   - No `userId` key is present in the session
 *
 * **Never throws.** This is the read path; handlers call it to decide
 * whether to redirect to login, so a throwing contract would force every
 * caller to wrap in try/catch. Returning `null` is the ergonomic choice.
 */
export function currentUserId(
  ctx: ManduContext,
  options?: Pick<LoginOptions, "userIdKey">,
): string | null {
  const session = ctx.get<Session>(DEFAULT_SESSION_ATTACH_KEY);
  if (!session) return null;

  const userIdKey = options?.userIdKey ?? DEFAULT_USER_ID_KEY;
  const raw = session.get<unknown>(userIdKey);
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Read the login timestamp (ms since epoch) from the session. Returns `null`
 * when the session middleware is absent, the key is unset, or the stored
 * value is not a number (defensive against hand-edited / corrupted sessions).
 *
 * Useful for session-age checks ("re-authenticate after 30 min for sensitive
 * actions"): `Date.now() - (loggedAt(ctx) ?? 0) > THIRTY_MIN`.
 */
export function loggedAt(
  ctx: ManduContext,
  options?: Pick<LoginOptions, "loggedAtKey">,
): number | null {
  const session = ctx.get<Session>(DEFAULT_SESSION_ATTACH_KEY);
  if (!session) return null;

  const loggedAtKey = options?.loggedAtKey ?? DEFAULT_LOGGED_AT_KEY;
  const raw = session.get<unknown>(loggedAtKey);
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}
