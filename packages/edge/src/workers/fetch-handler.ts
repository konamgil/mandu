/**
 * Cloudflare Workers fetch handler factory.
 *
 * Wraps Mandu's runtime-neutral `createAppFetchHandler` with the Workers
 * execution contract: `fetch(request, env, ctx) → Response`. The `env` and
 * `ctx` bindings are exposed via `globalThis.__MANDU_WORKERS_ENV__` and
 * `globalThis.__MANDU_WORKERS_CTX__` so user handlers can reach them through
 * a small accessor API without leaking Workers-specific types through
 * `@mandujs/core`.
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

// Expose bindings to user code through a stable `globalThis` slot. Cast
// through `unknown` to avoid polluting the global type.
interface MandWorkersGlobals {
  __MANDU_WORKERS_ENV__?: WorkersEnv;
  __MANDU_WORKERS_CTX__?: WorkersExecutionContext;
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
    const globals = globalThis as unknown as MandWorkersGlobals;
    globals.__MANDU_WORKERS_ENV__ = env;
    globals.__MANDU_WORKERS_CTX__ = ctx;

    try {
      return await handler(request);
    } catch (error) {
      return hintBunOnlyApiError(error);
    } finally {
      // Intentionally keep env/ctx on globals — nested `waitUntil`
      // callbacks may fire after the fetch() returns. Workers isolates
      // are short-lived so this does not leak across invocations.
    }
  };
}

/**
 * Access the Cloudflare Workers `env` binding from inside request handlers.
 * Returns `undefined` when running outside Workers (e.g. Bun tests).
 */
export function getWorkersEnv(): WorkersEnv | undefined {
  const globals = globalThis as unknown as MandWorkersGlobals;
  return globals.__MANDU_WORKERS_ENV__;
}

/**
 * Access the Cloudflare Workers `ExecutionContext` (for `waitUntil` etc.).
 * Returns `undefined` when running outside Workers.
 */
export function getWorkersCtx(): WorkersExecutionContext | undefined {
  const globals = globalThis as unknown as MandWorkersGlobals;
  return globals.__MANDU_WORKERS_CTX__;
}
