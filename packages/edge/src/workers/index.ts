/**
 * `@mandujs/edge/workers` — Cloudflare Workers adapter for Mandu.
 *
 * Public API:
 *   - `createWorkersHandler(manifest, options?)` — builds a ModuleWorker
 *     fetch handler from a Mandu routes manifest.
 *   - `generateWranglerConfig(options)` — emits `wrangler.toml`.
 *   - `getWorkersEnv()` / `getWorkersCtx()` — access bindings from handlers.
 */

export {
  createWorkersHandler,
  getWorkersEnv,
  getWorkersCtx,
  type CreateWorkersHandlerOptions,
  type WorkersEnv,
  type WorkersExecutionContext,
  type WorkersFetchHandler,
} from "./fetch-handler";

export {
  generateWranglerConfig,
  type WranglerConfigOptions,
} from "./wrangler-config";

export {
  installWorkersPolyfills,
} from "./polyfills";
