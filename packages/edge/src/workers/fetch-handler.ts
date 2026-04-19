/**
 * Cloudflare Workers fetch handler factory.
 *
 * Wraps Mandu's runtime-neutral `createAppFetchHandler` with the Workers
 * execution contract: `fetch(request, env, ctx) → Response`.
 *
 * ## Per-request ctx isolation (Wave R3 L-03)
 *
 * Workers isolates multiplex many concurrent `fetch()` invocations — we
 * cannot store per-request state on `globalThis`. Two requests that both
 * yield at `await` points would see each other's ctx/env.
 *
 * We use `AsyncLocalStorage` from `node:async_hooks`, which Cloudflare
 * Workers support when `compatibility_flags = ["nodejs_als"]` (or the
 * full `nodejs_compat` bundle) is set in `wrangler.toml`. The stored
 * context is scoped to the `.run(store, fn)` call, so concurrent
 * requests each see their own bindings regardless of interleaving.
 *
 * Module-load guard: we lazily-import `node:async_hooks`. If the host
 * runtime cannot resolve the module (pre-flag Workers config, or
 * minified bundles that strip node: imports), we fall back to a
 * per-Request WeakMap keyed on the Request object. That path is not
 * concurrency-safe for nested `waitUntil` callbacks that outlive the
 * fetch, but it preserves request-to-request isolation — which is what
 * the race finding called out.
 */

import {
  createAppFetchHandler,
  type AppFetchHandlerOptions,
  type RoutesManifest,
} from "@mandujs/core";
import { installWorkersPolyfills } from "./polyfills";
import { assertEdgeCompatibleManifest, hintBunOnlyApiError } from "./guards";

/**
 * Opaque Cloudflare Workers bindings. User code reaches these through
 * {@link getWorkersEnv} / {@link getWorkersCtx}. Typed loosely as `unknown`
 * to avoid importing `@cloudflare/workers-types` from core.
 */
export type WorkersEnv = Record<string, unknown>;

/** Minimal subset of Workers `ExecutionContext` we rely on. */
export interface WorkersExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * The Worker handler signature expected by `export default { fetch }`.
 * Matches Cloudflare's ModuleWorker fetch shape without importing their
 * `@cloudflare/workers-types`.
 */
export type WorkersFetchHandler = (
  request: Request,
  env: WorkersEnv,
  ctx: WorkersExecutionContext
) => Promise<Response>;

export interface CreateWorkersHandlerOptions
  extends Omit<AppFetchHandlerOptions, "edge" | "rootDir"> {
  /**
   * Logical root path. Defaults to `"/"`. Used for module path validation
   * only — there is no real filesystem in Workers.
   */
  rootDir?: string;
  /**
   * Disable the install-once WebCrypto-based polyfills (for testing).
   * @default false
   */
  skipPolyfills?: boolean;
  /**
   * When `true`, tolerate routes whose module paths reference Bun-only APIs
   * (`Bun.sql`, `Bun.s3`, `Bun.cron`). Default: `false` — the handler returns
   * a 500 response with a structured error payload hinting at the Phase 15.2+
   * replacement.
   */
  allowBunOnlyApis?: boolean;
}

/** Per-request context bag tracked by AsyncLocalStorage or WeakMap. */
interface WorkersRequestStore {
  env: WorkersEnv;
  ctx: WorkersExecutionContext;
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage backing (primary) with WeakMap fallback
// ---------------------------------------------------------------------------

interface AlsLike<T> {
  run<R>(store: T, fn: () => R): R;
  getStore(): T | undefined;
}

let alsInstance: AlsLike<WorkersRequestStore> | null = null;
/** Module-load flag — we only attempt the dynamic import once. */
let alsInitAttempted = false;

/**
 * Request-object → store fallback. Works when `node:async_hooks` isn't
 * resolvable in the current runtime (e.g. Workers without
 * `nodejs_als`/`nodejs_compat`). Keyed on the exact Request instance so
 * each fetch() sees only its own bindings.
 */
const requestToStore = new WeakMap<Request, WorkersRequestStore>();

/**
 * Most-recent request — used ONLY by the fallback path when user handlers
 * haven't been threaded a `Request` reference. In the AsyncLocalStorage
 * path this is unused and each request is correctly isolated.
 */
let fallbackCurrentRequest: Request | undefined;

async function ensureAls(): Promise<AlsLike<WorkersRequestStore> | null> {
  if (alsInstance) return alsInstance;
  if (alsInitAttempted) return null;
  alsInitAttempted = true;
  try {
    const mod = (await import("node:async_hooks")) as {
      AsyncLocalStorage?: new <T>() => AlsLike<T>;
    };
    if (mod?.AsyncLocalStorage) {
      alsInstance = new mod.AsyncLocalStorage<WorkersRequestStore>();
    }
  } catch {
    // Workers without nodejs_als/nodejs_compat — use WeakMap fallback.
    alsInstance = null;
  }
  return alsInstance;
}

/**
 * Best-effort synchronous accessor used by {@link getWorkersEnv} /
 * {@link getWorkersCtx}. On platforms with AsyncLocalStorage we return
 * the ALS store; otherwise the WeakMap bound to the current request.
 */
function currentStore(): WorkersRequestStore | undefined {
  if (alsInstance) {
    return alsInstance.getStore();
  }
  if (fallbackCurrentRequest) {
    return requestToStore.get(fallbackCurrentRequest);
  }
  return undefined;
}

/**
 * Build a Cloudflare Workers ModuleWorker fetch handler from a Mandu
 * manifest. Route handlers must be registered via the usual
 * `registerApiHandler` / `registerPageHandler` calls before the first
 * request lands — the bundled `register.js` entry (emitted by
 * `mandu build --target=workers`) does this on module load.
 *
 * @example
 * ```ts
 * // .mandu/workers/worker.js (generated)
 * import { createWorkersHandler } from "@mandujs/edge/workers";
 * import manifest from "../routes.manifest.json";
 * import "./register.js";
 *
 * const fetch = createWorkersHandler(manifest);
 * export default { fetch };
 * ```
 */
export function createWorkersHandler(
  manifest: RoutesManifest,
  options: CreateWorkersHandlerOptions = {}
): WorkersFetchHandler {
  if (!options.skipPolyfills) {
    installWorkersPolyfills();
  }

  assertEdgeCompatibleManifest(manifest, { allowBunOnlyApis: options.allowBunOnlyApis });

  const handler = createAppFetchHandler(manifest, {
    rootDir: options.rootDir ?? "/",
    edge: true,
    bundleManifest: options.bundleManifest,
    cors: options.cors,
    streaming: options.streaming,
    rateLimit: options.rateLimit,
    cssPath: options.cssPath ?? false,
    registry: options.registry,
    middleware: options.middleware,
  });

  return async function workersFetch(
    request: Request,
    env: WorkersEnv,
    ctx: WorkersExecutionContext
  ): Promise<Response> {
    const store: WorkersRequestStore = { env, ctx };

    const als = await ensureAls();
    if (als) {
      // AsyncLocalStorage path — concurrency-safe even with `await` inside.
      return als.run(store, async () => {
        try {
          return await handler(request);
        } catch (error) {
          return hintBunOnlyApiError(error, env);
        }
      });
    }

    // Fallback — WeakMap keyed on this exact Request instance.
    requestToStore.set(request, store);
    const previousRequest = fallbackCurrentRequest;
    fallbackCurrentRequest = request;
    try {
      return await handler(request);
    } catch (error) {
      return hintBunOnlyApiError(error, env);
    } finally {
      fallbackCurrentRequest = previousRequest;
      // WeakMap entry cleaned up when GC reclaims the Request object.
    }
  };
}

/**
 * Access the Cloudflare Workers `env` binding from inside request handlers.
 * Returns `undefined` when running outside Workers (e.g. Bun tests) or
 * before the first fetch() call has been routed.
 */
export function getWorkersEnv(): WorkersEnv | undefined {
  return currentStore()?.env;
}

/**
 * Access the Cloudflare Workers `ExecutionContext` (for `waitUntil` etc.).
 * Returns `undefined` when running outside Workers.
 */
export function getWorkersCtx(): WorkersExecutionContext | undefined {
  return currentStore()?.ctx;
}

/**
 * Test-only hook: reset the AsyncLocalStorage init state so unit tests
 * can exercise the fallback path. Never call this from production code.
 *
 * @internal
 */
export function _resetAlsForTesting(): void {
  alsInstance = null;
  alsInitAttempted = false;
  fallbackCurrentRequest = undefined;
}
