/**
 * `@mandujs/edge/netlify` — Netlify Edge Functions adapter for Mandu.
 *
 * Public API:
 *   - `createNetlifyEdgeHandler(manifest, options?)` — builds a
 *     Netlify-Edge-shaped fetch handler from a Mandu routes manifest.
 *   - `generateNetlifyEdgeConfig(options)` — emits `netlify.toml`.
 *   - `getNetlifyEdgeCtx()` — access the Netlify `Context` object
 *     (`geo`, `ip`, `deploy`, `env.get`, `next()`) from inside request
 *     handlers.
 *
 * Netlify Edge Functions run on Deno Deploy, so Deno-side constraints
 * apply (no Bun.sql / Bun.s3 / Bun.cron). See `@mandujs/edge/deno` for
 * the Deno adapter — Netlify adds its own build-time integration
 * (netlify.toml, deploy contexts) on top.
 */

export {
  createNetlifyEdgeHandler,
  getNetlifyEdgeCtx,
  type CreateNetlifyEdgeHandlerOptions,
  type NetlifyEdgeContext,
  type NetlifyEdgeFetchHandler,
} from "./fetch-handler";

export {
  generateNetlifyEdgeConfig,
  type NetlifyEdgeConfigOptions,
} from "./netlify-config";

export {
  installNetlifyEdgePolyfills,
} from "./polyfills";
