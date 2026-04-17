/**
 * Session Middleware Plugin
 *
 * Thin wrapper around the existing `SessionStorage` contract
 * (`packages/core/src/filling/session.ts`). Attaches an already-fetched
 * {@link Session} to the request context so handlers can do:
 *
 *   const session = ctx.get<Session>("session");
 *   session.set("userId", user.id);
 *   await saveSession(ctx);
 *
 * ...instead of threading storage + cookies through manually.
 *
 * Commit is **caller-driven**: the middleware pipeline has no after-response
 * hook that can mutate the outgoing Response, so auto-commit-on-exit is not
 * possible. Handlers must call `saveSession(ctx)` or `destroySession(ctx)`
 * explicitly before returning a response. `loginUser` / `logoutUser`
 * (Phase 2.4) will wrap those calls.
 *
 * @example
 * ```typescript
 * import { session, saveSession } from "@mandujs/core/middleware";
 * import { createCookieSessionStorage } from "@mandujs/core";
 *
 * const storage = createCookieSessionStorage({
 *   cookie: { secrets: [process.env.SESSION_SECRET!] },
 * });
 *
 * export default Mandu.filling()
 *   .use(session({ storage }))
 *   .post(async (ctx) => {
 *     const s = ctx.get<Session>("session");
 *     s.set("userId", "42");
 *     await saveSession(ctx);
 *     return ctx.ok({ ok: true });
 *   });
 * ```
 */
import type { ManduContext } from "../filling/context";
import type { Session, SessionStorage } from "../filling/session";

// ========== Types ==========

export interface SessionMiddlewareOptions {
  /** The storage implementation. Create via `createCookieSessionStorage(...)`. */
  storage: SessionStorage;
  /** Context key under which the Session is attached. Default: `"session"`. */
  attachAs?: string;
  /** Context key under which the storage is attached (for helpers). Default: `"_sessionStorage"`. */
  storageKey?: string;
}

/** Middleware signature matching `jwt.ts` / `csrf.ts`. */
type Middleware = (ctx: ManduContext) => Promise<Response | void>;

// ========== Defaults ==========

const DEFAULT_ATTACH_KEY = "session";
const DEFAULT_STORAGE_KEY = "_sessionStorage";

// ========== Middleware ==========

/**
 * Attach a `Session` (and its storage) to the context for the duration of the
 * request.
 *
 * Does NOT auto-commit on exit — the middleware pipeline has no after-response
 * hook that can both (a) run after the handler returns and (b) mutate the
 * outgoing Response. Handlers persist explicitly via {@link saveSession} or
 * {@link destroySession}.
 */
export function session(options: SessionMiddlewareOptions): Middleware {
  if (!options || !options.storage) {
    throw new Error("[Mandu Session] `storage` is required (use createCookieSessionStorage)");
  }
  const {
    storage,
    attachAs = DEFAULT_ATTACH_KEY,
    storageKey = DEFAULT_STORAGE_KEY,
  } = options;

  return async (ctx: ManduContext): Promise<Response | void> => {
    const s = await storage.getSession(ctx.cookies);
    ctx.set(attachAs, s);
    ctx.set(storageKey, storage);
  };
}

// ========== Helpers ==========

/**
 * Commit the attached session via its storage, applying the resulting
 * `Set-Cookie` header to `ctx.cookies` so the next `ctx.json/ok/redirect`
 * picks it up automatically.
 *
 * No-op when the session is not dirty (unless `force: true`). Throws when the
 * session middleware has not been installed on this request.
 *
 * IMPORTANT ordering: `ctx.json()` / `ctx.ok()` snapshot pending cookies at
 * the moment they build their Response. Call `saveSession` **before** any
 * response-producing method so the Set-Cookie makes it onto the wire.
 */
export async function saveSession(
  ctx: ManduContext,
  options?: { force?: boolean; attachAs?: string; storageKey?: string }
): Promise<void> {
  const attachAs = options?.attachAs ?? DEFAULT_ATTACH_KEY;
  const storageKey = options?.storageKey ?? DEFAULT_STORAGE_KEY;

  const { session: s, storage } = resolveSessionAndStorage(ctx, attachAs, storageKey);

  if (!options?.force && !s.isDirty()) {
    return;
  }

  const setCookie = await storage.commitSession(s);
  ctx.cookies.appendRawSetCookie(setCookie);
  s.markClean();
}

/**
 * Destroy the attached session: clears in-memory data AND emits an
 * expiring Set-Cookie so the browser drops its copy.
 *
 * Throws when the session middleware has not been installed on this request.
 *
 * Same ordering caveat as {@link saveSession}: call before the
 * response-producing method.
 */
export async function destroySession(
  ctx: ManduContext,
  options?: { attachAs?: string; storageKey?: string }
): Promise<void> {
  const attachAs = options?.attachAs ?? DEFAULT_ATTACH_KEY;
  const storageKey = options?.storageKey ?? DEFAULT_STORAGE_KEY;

  const { session: s, storage } = resolveSessionAndStorage(ctx, attachAs, storageKey);

  const setCookie = await storage.destroySession(s);
  // Wipe in-memory state first so subsequent handler code in the same request
  // sees an empty session (prevents accidental re-use of stale data between
  // destroy and response emit).
  s.clear();
  ctx.cookies.appendRawSetCookie(setCookie);
  // destroy() emits a new cookie; the session is now "clean" relative to that
  // just-written state — any further mutation would re-dirty it.
  s.markClean();
}

// ========== Internal ==========

/**
 * Fetch the Session + SessionStorage from context keys, throwing a clear
 * error when the middleware was not installed.
 *
 * Uses a plain `Error` rather than `AuthenticationError` because missing
 * middleware is a wiring mistake (500-class server error), not an end-user
 * auth failure (401).
 */
function resolveSessionAndStorage(
  ctx: ManduContext,
  attachAs: string,
  storageKey: string
): { session: Session; storage: SessionStorage } {
  const s = ctx.get<Session>(attachAs);
  const storage = ctx.get<SessionStorage>(storageKey);
  if (!s || !storage) {
    throw new Error(
      "[Mandu Session] saveSession/destroySession called without session() middleware installed. " +
        "Add `.use(session({ storage }))` to your filling chain."
    );
  }
  return { session: s, storage };
}
