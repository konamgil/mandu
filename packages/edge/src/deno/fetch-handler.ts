/**
 * Deno Deploy fetch handler factory.
 *
 * Wraps Mandu's runtime-neutral `createAppFetchHandler` with the Deno
 * contract: a single-argument `fetch(request) → Response` function that
 * is handed to `Deno.serve(handler)` at the application boot.
 *
 * ## Per-request context isolation
 *
 * Unlike Cloudflare Workers, Deno Deploy does not multiplex multiple
 * requests into a single isolate through module-level closures — each
 * request runs in its own `Deno.serve` callback. However, Mandu still
 * provides `getDenoEnv()` / `getDenoInfo()` helpers that delegate to
 * `AsyncLocalStorage` when available so user code can reach
 * `Deno.env.toObject()` and the connection info object without
 * threading them through every filler.
 *
 * Deno supports `node:async_hooks` with the compat flag; we lazily import
 * and gracefully fall back to a per-Request WeakMap when the module is
 * unavailable (e.g. when running under `deno run --no-check` against an
 * old Deno without Node compat).
 */

import {
  createAppFetchHandler,
  type AppFetchHandlerOptions,
  type RoutesManifest,
} from "@mandujs/core";
import { installDenoPolyfills } from "./polyfills";
import { assertEdgeCompatibleManifest, hintBunOnlyApiError } from "./guards";

/**
 * Opaque Deno env bag. User code reaches it through {@link getDenoEnv}.
 * Typed as `Record<string, unknown>` so we do not import `@types/deno`.
 */
export type DenoEnv = Record<string, unknown>;

/** Minimal subset of Deno's `Deno.ServeHandlerInfo` we rely on. */
export interface DenoServeInfo {
  /** Remote peer address for this request. */
  remoteAddr?: {
    hostname?: string;
    port?: number;
    transport?: string;
  };
  /** Deno Deployment ID when running on Deploy. */
  deploymentId?: string;
}

/**
 * Deno-compatible handler signature. Deno.serve hands the handler a
 * `Request` plus an info object; many Mandu routes only need the request,
 * so the info parameter is optional.
 */
export type DenoFetchHandler = (
  request: Request,
  info?: DenoServeInfo
) => Promise<Response>;

export interface CreateDenoHandlerOptions
  extends Omit<AppFetchHandlerOptions, "edge" | "rootDir"> {
  /**
   * Logical root path. Defaults to `"/"`. Used for module path validation
   * only — there is no real filesystem in Deno Deploy.
   */
  rootDir?: string;
  /**
   * Disable the install-once polyfills (for testing).
   * @default false
   */
  skipPolyfills?: boolean;
  /**
   * When `true`, tolerate routes whose module paths reference Bun-only APIs
   * (`Bun.sql`, `Bun.s3`, `Bun.cron`). Default: `false` — the handler returns
   * a 500 response with a structured error payload hinting at the
   * Deno-native replacement.
   */
  allowBunOnlyApis?: boolean;
  /**
   * Optional env snapshot exposed via {@link getDenoEnv}. Defaults to
   * calling `Deno.env.toObject()` at handler construction if the `Deno`
   * global is present.
   */
  env?: DenoEnv;
}

/** Per-request context bag tracked by AsyncLocalStorage or WeakMap. */
interface DenoRequestStore {
  env: DenoEnv;
  info: DenoServeInfo | undefined;
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage backing (primary) with WeakMap fallback
// ---------------------------------------------------------------------------

interface AlsLike<T> {
  run<R>(store: T, fn: () => R): R;
  getStore(): T | undefined;
}

let alsInstance: AlsLike<DenoRequestStore> | null = null;
let alsInitAttempted = false;

const requestToStore = new WeakMap<Request, DenoRequestStore>();
let fallbackCurrentRequest: Request | undefined;

async function ensureAls(): Promise<AlsLike<DenoRequestStore> | null> {
  if (alsInstance) return alsInstance;
  if (alsInitAttempted) return null;
  alsInitAttempted = true;
  try {
    const mod = (await import("node:async_hooks")) as {
      AsyncLocalStorage?: new <T>() => AlsLike<T>;
    };
    if (mod?.AsyncLocalStorage) {
      alsInstance = new mod.AsyncLocalStorage<DenoRequestStore>();
    }
  } catch {
    alsInstance = null;
  }
  return alsInstance;
}

function currentStore(): DenoRequestStore | undefined {
  if (alsInstance) {
    return alsInstance.getStore();
  }
  if (fallbackCurrentRequest) {
    return requestToStore.get(fallbackCurrentRequest);
  }
  return undefined;
}

/**
 * Sniff the Deno env if the `Deno` global is present. Returns an empty
 * object when we are running in Bun/Node.
 */
function sniffDenoEnv(): DenoEnv {
  try {
    const denoGlobal = (globalThis as { Deno?: { env?: { toObject?: () => Record<string, string> } } }).Deno;
    const denoEnv = denoGlobal?.env;
    const toObject = denoEnv?.toObject;
    if (denoEnv && typeof toObject === "function") {
      return toObject.call(denoEnv) as DenoEnv;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * Build a Deno Deploy fetch handler from a Mandu manifest. Route handlers
 * must be registered via the usual `registerApiHandler` /
 * `registerPageHandler` calls before the first request lands — the bundled
 * `register.ts` entry (emitted by `mandu build --target=deno`) does this
 * on module load.
 *
 * @example
 * ```ts
 * // .mandu/deno/server.ts (generated)
 * import { createDenoHandler } from "@mandujs/edge/deno";
 * import manifest from "./manifest.json" with { type: "json" };
 * import "./register.ts";
 *
 * const fetch = createDenoHandler(manifest);
 * Deno.serve(fetch);
 * ```
 */
export function createDenoHandler(
  manifest: RoutesManifest,
  options: CreateDenoHandlerOptions = {}
): DenoFetchHandler {
  if (!options.skipPolyfills) {
    installDenoPolyfills();
  }

  assertEdgeCompatibleManifest(manifest, { allowBunOnlyApis: options.allowBunOnlyApis });

  const capturedEnv: DenoEnv = options.env ?? sniffDenoEnv();

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

  return async function denoFetch(
    request: Request,
    info?: DenoServeInfo
  ): Promise<Response> {
    const store: DenoRequestStore = { env: capturedEnv, info };

    const als = await ensureAls();
    if (als) {
      return als.run(store, async () => {
        try {
          return await handler(request);
        } catch (error) {
          return hintBunOnlyApiError(error, capturedEnv);
        }
      });
    }

    requestToStore.set(request, store);
    const previousRequest = fallbackCurrentRequest;
    fallbackCurrentRequest = request;
    try {
      return await handler(request);
    } catch (error) {
      return hintBunOnlyApiError(error, capturedEnv);
    } finally {
      fallbackCurrentRequest = previousRequest;
    }
  };
}

/**
 * Access the Deno env bag from inside request handlers. Returns an empty
 * object when running outside Deno (e.g. Bun tests) or before the first
 * fetch() call has been routed.
 */
export function getDenoEnv(): DenoEnv | undefined {
  return currentStore()?.env;
}

/**
 * Access the Deno serve info object (remote addr etc.). Returns `undefined`
 * when the host did not supply it.
 */
export function getDenoInfo(): DenoServeInfo | undefined {
  return currentStore()?.info;
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
