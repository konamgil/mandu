/**
 * Mandu notFound() helper for SSR loaders and handlers.
 *
 * Symmetric with `redirect()` — both short-circuit the SSR pipeline by
 * returning (or throwing) a marked `Response`. Where `redirect()` tells
 * the runtime "navigate somewhere else", `notFound()` tells the runtime
 * "this resource does not exist; render the 404 surface".
 *
 * ## Usage
 *
 * ```ts
 * import { Mandu, notFound } from "@mandujs/core";
 *
 * export const filling = Mandu.filling().loader(async (ctx) => {
 *   const post = await db.post.find(ctx.params.slug);
 *   if (!post) return notFound();       // or: throw notFound();
 *   return { post };
 * });
 * ```
 *
 * The SSR pipeline (server.ts `loadPageData`) checks each loader result
 * with `isNotFoundResponse()`. On a hit it:
 *
 *   1. Prefers `app/not-found.tsx` (if registered) — rendered as a normal
 *      page with status 404 and any pending cookies preserved.
 *   2. Falls back to the framework's built-in 404 JSON error.
 *
 * ## Why a branded Response
 *
 * A bare `new Response(null, { status: 404 })` is NOT treated as a
 * notFound sentinel. That's intentional: a loader that accidentally
 * returns a generic 404 Response (e.g. proxying an upstream fetch) must
 * NOT hijack the page to show our 404 page. Only values minted through
 * `notFound()` carry the internal brand.
 *
 * The brand is a non-enumerable WeakSet membership stamped on the
 * Response object. Never serialised, never visible to clients.
 */

/** Internal brand — identifies Response objects minted by `notFound()`. */
export const NOT_FOUND_BRAND: unique symbol = Symbol.for("@mandujs/core/compat/not-found");

/** WeakSet of Response instances tagged as notFound. Avoids property writes. */
const brandedNotFoundResponses = new WeakSet<Response>();

/** Options for tuning a notFound response. */
export interface NotFoundOptions {
  /** Optional human-readable message. Surfaced to the 404 page via body. */
  message?: string;
}

/**
 * Create a `Response` that signals "not found" to the Mandu SSR pipeline.
 *
 * Returns a real `Response` (status 404) for three reasons:
 *
 *   1. Loaders that `return` or `throw` it are treated identically — no
 *      extra plumbing for the "deep call stack wants to bail out" case.
 *   2. Consumers outside an SSR loader (route handlers, middleware) can
 *      use the same helper without a separate API.
 *   3. A hostile or buggy loader returning a bare `new Response(null, {status:404})`
 *      does NOT trigger the framework's 404 page path — it falls through
 *      the existing error channel like any other unexpected Response.
 *
 * @param options - Optional `{ message }`. Message is serialised into the
 *   response body as `text/plain; charset=utf-8`. If omitted, the body
 *   defaults to `"Not Found"`.
 */
export function notFound(options: NotFoundOptions = {}): Response {
  const message = typeof options.message === "string" && options.message.length > 0
    ? options.message
    : "Not Found";

  const response = new Response(message, {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
  brandedNotFoundResponses.add(response);
  return response;
}

/**
 * True when `value` is a Response produced by `notFound()`.
 *
 * Deliberately strict — only branded responses match. A bare
 * `new Response(null, { status: 404 })` is NOT recognised, nor is a
 * redirect Response (even one with a 404-like status, which would be
 * malformed but shouldn't confuse us).
 */
export function isNotFoundResponse(value: unknown): value is Response {
  if (!(value instanceof Response)) return false;
  return brandedNotFoundResponses.has(value);
}
