/**
 * `@mandujs/edge/netlify` — Netlify Edge Functions adapter stub.
 *
 * Scheduled for Phase 15.3. Netlify Edge runs on Deno, so the adapter will
 * re-export most of `@mandujs/edge/deno` once that ships.
 */

export function createNetlifyEdgeHandler(): never {
  throw new Error(
    "[@mandujs/edge/netlify] Netlify Edge adapter is not yet implemented. " +
      "Scheduled for Phase 15.3. Use @mandujs/edge/workers for Cloudflare Workers today."
  );
}
