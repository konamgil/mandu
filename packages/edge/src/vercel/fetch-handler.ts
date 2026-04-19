/**
 * Vercel Edge fetch handler factory.
 *
 * Vercel Edge Functions and Middleware use a Web-Fetch-standard signature:
 *   `export default function handler(request: Request): Response | Promise<Response>`
 *
 * Optionally the handler receives a `context` object with `waitUntil()` for
 * background tasks. We accept it positionally (similar to Workers) and
 * expose it through `getVercelEdgeCtx()`.
 *
 * ## Per-request ctx isolation
 *
 * Vercel Edge runs on V8 isolates that may serve multiple concurrent
 * requests through async interleaving. We use `AsyncLocalStorage` from
 * `node:async_hooks` (supported on Vercel Edge as of early 2024) with a
 * per-Request WeakMap fallback for older runtimes.
 */

import {
  createAppFetchHandler,
  type AppFetchHandlerOptions,
  type RoutesManifest,
} from "@mandujs/core";
import { installVercelEdgePolyfills } from "./polyfills";
import { assertEdgeCompatibleManifest, hintBunOnlyApiError } from "./guards";

/** Minimal subset of Vercel Edge's `context` object. */
export interface VercelEdgeContext {
  /**
   * Promise to wait on beyond the main response — used for background
   * logging / queue writes without blocking the user response.
   */
  waitUntil(promise: Promise<unknown>): void;
  /** Optional geolocation / IP metadata Vercel injects. */
  geo?: {
    city?: string;
    country?: string;
    region?: string;
    latitude?: string;
    longitude?: string;
  };
  /** Client IP address. */
  ip?: string;
}

/**
 * Vercel Edge handler signature. Matches Vercel's `export default`
 * contract. Context is optional because some deployments (e.g. static
 * middleware) omit it.
 */
export type VercelEdgeFetchHandler = (
  request: Request,
  context?: VercelEdgeContext
) => Promise<Response>;

export interface CreateVercelEdgeHandlerOptions
  extends Omit<AppFetchHandlerOptions, "edge" | "rootDir"> {
  /**
   * Logical root path. Defaults to `"/"`. No real filesystem on Vercel Edge.
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

interface VercelEdgeRequestStore {
  ctx: VercelEdgeContext | undefined;
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage backing (primary) with WeakMap fallback
// ---------------------------------------------------------------------------

interface AlsLike<T> {
  run<R>(store: T, fn: () => R): R;
  getStore(): T | undefined;
}

let alsInstance: AlsLike<VercelEdgeRequestStore> | null = null;
let alsInitAttempted = false;

const requestToStore = new WeakMap<Request, VercelEdgeRequestStore>();
let fallbackCurrentRequest: Request | undefined;

async function ensureAls(): Promise<AlsLike<VercelEdgeRequestStore> | null> {
  if (alsInstance) return alsInstance;
  if (alsInitAttempted) return null;
  alsInitAttempted = true;
  try {
    const mod = (await import("node:async_hooks")) as {
      AsyncLocalStorage?: new <T>() => AlsLike<T>;
    };
    if (mod?.AsyncLocalStorage) {
      alsInstance = new mod.AsyncLocalStorage<VercelEdgeRequestStore>();
    }
  } catch {
    alsInstance = null;
  }
  return alsInstance;
}

function currentStore(): VercelEdgeRequestStore | undefined {
  if (alsInstance) {
    return alsInstance.getStore();
  }
  if (fallbackCurrentRequest) {
    return requestToStore.get(fallbackCurrentRequest);
  }
  return undefined;
}

/**
 * Build a Vercel Edge fetch handler from a Mandu manifest. Route handlers
 * must be registered via `registerApiHandler` / `registerPageHandler`
 * before the first request lands — the bundled `register.ts` entry
 * (emitted by `mandu build --target=vercel-edge`) does this on module
 * load.
 *
 * @example
 * ```ts
 * // api/_mandu.ts (generated)
 * export const config = { runtime: "edge" };
 *
 * import { createVercelEdgeHandler } from "@mandujs/edge/vercel";
 * import manifest from "../.mandu/vercel/manifest.json";
 * import "../.mandu/vercel/register.ts";
 *
 * const fetch = createVercelEdgeHandler(manifest);
 * export default fetch;
 * ```
 */
export function createVercelEdgeHandler(
  manifest: RoutesManifest,
  options: CreateVercelEdgeHandlerOptions = {}
): VercelEdgeFetchHandler {
  if (!options.skipPolyfills) {
    installVercelEdgePolyfills();
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

  return async function vercelEdgeFetch(
    request: Request,
    context?: VercelEdgeContext
  ): Promise<Response> {
    const store: VercelEdgeRequestStore = { ctx: context };

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
 * Access the Vercel Edge context (`waitUntil`, `geo`, `ip`) from inside
 * request handlers. Returns `undefined` when running outside Vercel Edge
 * or before the first fetch() call has been routed.
 */
export function getVercelEdgeCtx(): VercelEdgeContext | undefined {
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
