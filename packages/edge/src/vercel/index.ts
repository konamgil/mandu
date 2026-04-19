/**
 * `@mandujs/edge/vercel` — Vercel Edge adapter for Mandu.
 *
 * Public API:
 *   - `createVercelEdgeHandler(manifest, options?)` — builds a
 *     Vercel-Edge-shaped fetch handler from a Mandu routes manifest.
 *   - `generateVercelEdgeConfig(options)` — emits `vercel.json`.
 *   - `getVercelEdgeCtx()` — access the Vercel `context` object
 *     (`waitUntil`, `geo`, `ip`) from inside request handlers.
 */

export {
  createVercelEdgeHandler,
  getVercelEdgeCtx,
  type CreateVercelEdgeHandlerOptions,
  type VercelEdgeContext,
  type VercelEdgeFetchHandler,
} from "./fetch-handler";

export {
  generateVercelEdgeConfig,
  type VercelConfigOptions,
} from "./vercel-config";

export {
  installVercelEdgePolyfills,
} from "./polyfills";
