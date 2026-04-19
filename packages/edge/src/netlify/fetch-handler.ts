/**
 * Netlify Edge Functions fetch handler factory.
 *
 * Netlify Edge Functions run on Deno Deploy. The handler signature is:
 *   `export default async (request: Request, context: Context) => Response`
 *
 * The `context` object exposes Netlify-specific metadata:
 *   - `geo`: client geolocation
 *   - `ip`: client IP
 *   - `next()`: pass through to the origin (routing middleware)
 *   - `env.get(name)`: read per-deploy environment variable
 *   - `deploy`: deployment metadata
 *
 * We track the context through AsyncLocalStorage (with a WeakMap fallback)
 * so user handlers can reach it via `getNetlifyEdgeCtx()` without
 * threading it through every filler.
 */

import {
  createAppFetchHandler,
  type AppFetchHandlerOptions,
  type RoutesManifest,
} from "@mandujs/core";
import { installNetlifyEdgePolyfills } from "./polyfills";
import { assertEdgeCompatibleManifest, hintBunOnlyApiError } from "./guards";

/**
 * Minimal subset of Netlify's `Context` object we rely on. Typed loosely
 * to avoid importing `@netlify/edge-functions`.
 */
export interface NetlifyEdgeContext {
  /** Client geolocation. */
  geo?: {
    city?: string;
    country?: { code?: string; name?: string };
    subdivision?: { code?: string; name?: string };
    timezone?: string;
  };
  /** Client IP address. */
  ip?: string;
  /** Deployment metadata. */
  deploy?: {
    id?: string;
    context?: "production" | "deploy-preview" | "branch-deploy";
    published?: boolean;
  };
  /** Per-deploy environment accessor. */
  env?: {
    get(name: string): string | undefined;
  };
  /** Pass through to the origin/next edge function. */
  next?: () => Promise<Response>;
  /** Log a structured message Netlify ingests into its log stream. */
  log?: (...args: unknown[]) => void;
}

/**
 * Netlify Edge handler signature. Netlify always invokes the default
 * export with both request and context — context is optional in Mandu's
 * shape to match older Netlify runtimes and simplify testing.
 */
export type NetlifyEdgeFetchHandler = (
  request: Request,
  context?: NetlifyEdgeContext
) => Promise<Response>;

export interface CreateNetlifyEdgeHandlerOptions
  extends Omit<AppFetchHandlerOptions, "edge" | "rootDir"> {
  /**
   * Logical root path. Defaults to `"/"`. No real filesystem on Netlify Edge.
   */
  rootDir?: string;
  /**
   * Disable the install-once polyfills (for testing).
   * @default false
   */
  skipPolyfills?: boolean;
  /**
   * Tolerate Bun-only APIs (returns a structured 500 at call time). Default: false.
   */
  allowBunOnlyApis?: boolean;
}

interface NetlifyEdgeRequestStore {
  ctx: NetlifyEdgeContext | undefined;
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage backing (primary) with WeakMap fallback
// ---------------------------------------------------------------------------

interface AlsLike<T> {
  run<R>(store: T, fn: () => R): R;
  getStore(): T | undefined;
}

let alsInstance: AlsLike<NetlifyEdgeRequestStore> | null = null;
let alsInitAttempted = false;

const requestToStore = new WeakMap<Request, NetlifyEdgeRequestStore>();
let fallbackCurrentRequest: Request | undefined;

async function ensureAls(): Promise<AlsLike<NetlifyEdgeRequestStore> | null> {
  if (alsInstance) return alsInstance;
  if (alsInitAttempted) return null;
  alsInitAttempted = true;
  try {
    const mod = (await import("node:async_hooks")) as {
      AsyncLocalStorage?: new <T>() => AlsLike<T>;
    };
    if (mod?.AsyncLocalStorage) {
      alsInstance = new mod.AsyncLocalStorage<NetlifyEdgeRequestStore>();
    }
  } catch {
    alsInstance = null;
  }
  return alsInstance;
}

function currentStore(): NetlifyEdgeRequestStore | undefined {
  if (alsInstance) {
    return alsInstance.getStore();
  }
  if (fallbackCurrentRequest) {
    return requestToStore.get(fallbackCurrentRequest);
  }
  return undefined;
}

/**
 * Build a Netlify Edge Functions fetch handler from a Mandu manifest.
 * Route handlers must be registered via `registerApiHandler` /
 * `registerPageHandler` before the first request lands — the bundled
 * `register.ts` entry (emitted by `mandu build --target=netlify-edge`)
 * does this on module load.
 *
 * @example
 * ```ts
 * // netlify/edge-functions/ssr.ts (generated)
 * import { createNetlifyEdgeHandler } from "@mandujs/edge/netlify";
 * import manifest from "../../.mandu/netlify/manifest.json" with { type: "json" };
 * import "../../.mandu/netlify/register.ts";
 *
 * const fetch = createNetlifyEdgeHandler(manifest);
 * export default fetch;
 * export const config = { path: "/*" };
 * ```
 */
export function createNetlifyEdgeHandler(
  manifest: RoutesManifest,
  options: CreateNetlifyEdgeHandlerOptions = {}
): NetlifyEdgeFetchHandler {
  if (!options.skipPolyfills) {
    installNetlifyEdgePolyfills();
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

  return async function netlifyEdgeFetch(
    request: Request,
    context?: NetlifyEdgeContext
  ): Promise<Response> {
    const store: NetlifyEdgeRequestStore = { ctx: context };

    const als = await ensureAls();
    if (als) {
      return als.run(store, async () => {
        try {
          return await handler(request);
        } catch (error) {
          return hintBunOnlyApiError(error, {});
        }
      });
    }

    requestToStore.set(request, store);
    const previousRequest = fallbackCurrentRequest;
    fallbackCurrentRequest = request;
    try {
      return await handler(request);
    } catch (error) {
      return hintBunOnlyApiError(error, {});
    } finally {
      fallbackCurrentRequest = previousRequest;
    }
  };
}

/**
 * Access the Netlify Edge context (`geo`, `ip`, `deploy`, `env.get`, ...)
 * from inside request handlers. Returns `undefined` when running outside
 * Netlify Edge or before the first fetch() call has been routed.
 */
export function getNetlifyEdgeCtx(): NetlifyEdgeContext | undefined {
  return currentStore()?.ctx;
}

/**
 * @internal Test-only reset for the AsyncLocalStorage init state.
 */
export function _resetAlsForTesting(): void {
  alsInstance = null;
  alsInitAttempted = false;
  fallbackCurrentRequest = undefined;
}
