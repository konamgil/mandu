/**
 * Mandu redirect helper for SSR loaders.
 *
 * ## Usage
 *
 * ```ts
 * import { Mandu, redirect } from "@mandujs/core";
 *
 * export const filling = Mandu.filling().loader(async (ctx) => {
 *   const uid = currentUserId(ctx);
 *   if (!uid) return redirect("/login");   // short-circuit → 302
 *   return { user: await fetchUser(uid) };
 * });
 * ```
 *
 * Both `return redirect(...)` and `throw redirect(...)` are supported — the
 * SSR pipeline recognizes either shape. Thrown is idiomatic for bailing out
 * of a deep call stack without threading the result back up.
 *
 * ## Design
 *
 * `redirect()` returns a real `Response` object (same shape Remix/Next.js
 * use for their own loader-level redirects). This is preferred over a
 * custom sentinel for three reasons:
 *
 *   1. `Response` is already understood by every layer of the runtime
 *      (cookies via `applyToResponse`, streaming headers, etc.).
 *   2. A thrown `Response` is trivially distinguishable from a thrown
 *      `Error` — `instanceof Response` — so user bugs (`throw new Error(...)`)
 *      never get silently converted into redirects.
 *   3. The helper can be used outside loaders (middleware, guards) without
 *      additional plumbing.
 *
 * A hidden symbol (`REDIRECT_BRAND`) is stamped on the Response so the
 * runtime can distinguish redirects returned from a loader (for which we
 * short-circuit SSR) from a loader that merely returned an unrelated
 * Response (which would be a user error — loaders must return data). The
 * brand is non-enumerable and scoped to the runtime — clients never see it.
 */

export type RedirectStatus = 301 | 302 | 303 | 307 | 308;

const DEFAULT_REDIRECT_STATUS: RedirectStatus = 302;
const VALID_REDIRECT_STATUS = new Set<number>([301, 302, 303, 307, 308]);

/** Internal brand — identifies Response objects minted by `redirect()`. */
export const REDIRECT_BRAND: unique symbol = Symbol.for("@mandujs/core/compat/redirect");

/** Options for tuning a redirect response. */
export interface RedirectOptions {
  /** HTTP status code. Defaults to 302 (Found). */
  status?: RedirectStatus;
  /** Additional headers to merge into the redirect response. */
  headers?: HeadersInit;
}

/**
 * Create a redirect `Response` suitable for returning or throwing from an
 * SSR loader, handler, or middleware.
 *
 * @param url - Destination URL. Absolute or relative. Must be a non-empty
 *   string — empty/whitespace throws synchronously (catches silent bugs
 *   early rather than producing a useless redirect).
 * @param options - Optional `{ status, headers }`. Status defaults to 302.
 *
 * @throws {TypeError} When `url` is not a non-empty string, or when
 *   `options.status` is not one of 301/302/303/307/308.
 */
export function redirect(url: string, options: RedirectOptions = {}): Response {
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new TypeError(
      `[Mandu] redirect() requires a non-empty URL string (got: ${JSON.stringify(url)})`
    );
  }

  const status = options.status ?? DEFAULT_REDIRECT_STATUS;
  if (!VALID_REDIRECT_STATUS.has(status)) {
    throw new TypeError(
      `[Mandu] redirect() status must be 301/302/303/307/308 (got: ${status})`
    );
  }

  const headers = new Headers(options.headers);
  headers.set("Location", url);

  const response = new Response(null, { status, headers });
  brandResponse(response);
  return response;
}

/**
 * Attach the redirect brand to a Response (non-enumerable).
 * Kept separate so tests / advanced callers that mint their own
 * redirect-status Responses can opt in.
 */
function brandResponse(response: Response): void {
  Object.defineProperty(response, REDIRECT_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

/** True when `value` is a Response minted by `redirect()`. */
export function isManduRedirect(value: unknown): boolean {
  return (
    value instanceof Response &&
    (value as unknown as { [REDIRECT_BRAND]?: boolean })[REDIRECT_BRAND] === true
  );
}

/**
 * True when `value` is any Response with a redirect-range status code.
 *
 * Covers both:
 *   - `redirect("/x")` from this module (preferred)
 *   - `new Response(null, { status: 302, headers: { Location: ... } })`
 *     (idiomatic Remix-style throw; we accept it so users aren't forced
 *      into our helper)
 *
 * Deliberately excludes thrown `Error` instances, so a user's
 * `throw new Error("boom")` is never mistaken for a redirect — it falls
 * through to the existing error-handling path.
 */
export function isRedirectResponse(value: unknown): value is Response {
  if (!(value instanceof Response)) return false;
  if (isManduRedirect(value)) return true;
  if (!VALID_REDIRECT_STATUS.has(value.status)) return false;
  // A redirect without a Location header is malformed — treat as a plain
  // Response so we don't emit a broken 302 to the browser.
  return value.headers.has("Location");
}
