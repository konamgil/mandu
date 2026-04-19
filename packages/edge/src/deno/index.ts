/**
 * `@mandujs/edge/deno` — Deno Deploy adapter for Mandu.
 *
 * Public API:
 *   - `createDenoHandler(manifest, options?)` — builds a Deno.serve-shaped
 *     fetch handler from a Mandu routes manifest.
 *   - `generateDenoConfig(options)` — emits `deno.json`.
 *   - `getDenoEnv()` / `getDenoInfo()` — access env / serve info from
 *     inside request handlers.
 */

export {
  createDenoHandler,
  getDenoEnv,
  getDenoInfo,
  type CreateDenoHandlerOptions,
  type DenoEnv,
  type DenoServeInfo,
  type DenoFetchHandler,
} from "./fetch-handler";

export {
  generateDenoConfig,
  type DenoConfigOptions,
} from "./deno-config";

export {
  installDenoPolyfills,
} from "./polyfills";
