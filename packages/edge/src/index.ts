/**
 * @mandujs/edge — Edge runtime adapters for Mandu
 *
 * Provides adapters for running Mandu apps on:
 *   - Cloudflare Workers (`@mandujs/edge/workers`) — Phase 15.1 (this MVP)
 *   - Deno Deploy (`@mandujs/edge/deno`) — Phase 15.2 (stub)
 *   - Vercel Edge (`@mandujs/edge/vercel`) — Phase 15.3 (stub)
 *   - Netlify Edge (`@mandujs/edge/netlify`) — Phase 15.3 (stub)
 *
 * The Bun/Node runtime continues to be served by `@mandujs/core`'s built-in
 * `adapterBun()`. Edge adapters are opt-in — import the specific subpath for
 * your target platform.
 */

export * from "./workers";
