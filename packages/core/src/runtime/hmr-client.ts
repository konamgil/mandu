/**
 * Phase 7.0 — Browser-side `import.meta.hot` runtime (Mandu subset of the Vite API).
 *
 * This module runs in the browser. It is the moral equivalent of Vite's
 * `packages/vite/src/client/client.ts` HMR context factory, but only
 * implements the surface Mandu commits to in Phase 7.0 v0.1:
 *
 *   - `accept()`          — self-accept, no callback
 *   - `accept(cb)`        — self-accept with new-module callback
 *   - `accept(dep, cb)`   — accept updates to a specific dependency
 *   - `dispose(cb)`       — register a pre-replacement cleanup
 *   - `data`              — per-module persist object (carried across updates)
 *   - `invalidate(msg?)`  — bail out, propagate update to importers
 *   - `on(event, cb)`     — 4 built-in Vite events
 *
 * Design notes:
 *
 * 1. **Registry identity key**: the *module URL*. Each call to
 *    `createManduHot("/src/foo.ts")` returns a context whose `data`
 *    object is preserved across calls for the same URL — this is the
 *    guarantee Vite's HMR API makes. We reach into the registry so the
 *    same identity is also preserved across a hot-replace that tears
 *    down the old module and evaluates a fresh one.
 *
 * 2. **No global WebSocket ownership**: this module *does not* own the
 *    HMR WebSocket. The dev-time HMR client script (built by Agent C's
 *    `createHMRClientScript` in `bundler/dev.ts`) owns the socket and
 *    calls `dispatchReplacement` / `dispatchDependencyUpdate` /
 *    `dispatchEvent` from the message handler. Tests pass in a mock
 *    `send` via `setInvalidateTransport()` so `invalidate()` is
 *    observable without spinning up a real socket.
 *
 * 3. **`accept` overload dispatch**: both overloads are a single
 *    function internally; we branch on `typeof depOrCb === "function"`
 *    so TypeScript narrowing aligns with runtime behavior.
 *
 * References:
 *   docs/bun/phase-7-diagnostics/industry-benchmark.md §2 (Vite spec)
 *   packages/core/src/bundler/hmr-types.ts (`ManduHot`, `HMREventName`)
 */

import type { ManduHot, HMREventName } from "../bundler/hmr-types";

// ============================================
// Internal registry shape
// ============================================

/**
 * A module's HMR context record — the backing store behind every
 * `ManduHot` returned for a given module URL. Shared across hot
 * replaces so `data` survives and listeners aren't orphaned.
 */
interface ModuleRecord {
  /** Per-module state preserved across HMR updates. */
  data: Record<string, unknown>;
  /**
   * Map key: `""` for self-accept, `<dep url>` for dep-accept.
   * Value: the user-supplied callback. Only the most recent callback
   * per key is retained (Vite's semantics — re-calling `accept(dep)`
   * overwrites the prior registration).
   */
  acceptCallbacks: Map<string, (mod: unknown) => void>;
  /** Ordered list of dispose cleanups, oldest first. */
  disposeCallbacks: Array<(data: Record<string, unknown>) => void>;
  /** Vite-compat event listeners. */
  eventListeners: Map<HMREventName, Set<(payload: unknown) => void>>;
}

function freshRecord(): ModuleRecord {
  return {
    data: {},
    acceptCallbacks: new Map(),
    disposeCallbacks: [],
    eventListeners: new Map(),
  };
}

/**
 * Shared registry. Exported via `_getRegistryForTests` so unit tests
 * can reset between cases; production code has no legitimate reason
 * to touch it directly.
 */
const registry = new Map<string, ModuleRecord>();

// ============================================
// Transport seam — for `invalidate()`
// ============================================

/**
 * When a module calls `invalidate()`, we cannot hot-replace in place;
 * the update must escalate to the server. In production this transport
 * is `ws.send(...)` wired by `createHMRClientScript`. In tests it is a
 * jest-style mock so the payload is observable.
 */
type InvalidateTransport = (payload: {
  type: "invalidate";
  moduleUrl: string;
  message?: string;
}) => void;

let invalidateTransport: InvalidateTransport = (_payload) => {
  // Default no-op so tests that don't care about `invalidate` wiring
  // don't blow up. Real usage must call `setInvalidateTransport`.
};

/**
 * Install the transport used by `ManduHot.invalidate()`. Call this
 * once at client boot from the HMR client script. Idempotent — the
 * last installed transport wins.
 */
export function setInvalidateTransport(fn: InvalidateTransport): void {
  invalidateTransport = fn;
}

// ============================================
// Public factory
// ============================================

/**
 * Return a `ManduHot` instance for the given module URL. Calling this
 * twice for the same URL yields two separate `ManduHot` objects, but
 * both are views onto the same underlying `ModuleRecord` — in
 * particular their `data` is the same object identity, their accept
 * registrations collide, and `dispose` callbacks accumulate.
 */
export function createManduHot(moduleUrl: string): ManduHot {
  let rec = registry.get(moduleUrl);
  if (rec === undefined) {
    rec = freshRecord();
    registry.set(moduleUrl, rec);
  }
  const record = rec;

  // Using `function` rather than an arrow so overload narrowing works
  // identically in the synthesized types — TypeScript treats both
  // forms the same here, but `function` reads more naturally.
  function accept(
    depOrCb?: string | ((newModule: unknown) => void),
    cb?: (newDep: unknown) => void,
  ): void {
    if (typeof depOrCb === "function") {
      // accept(cb) — self-accept with callback
      record.acceptCallbacks.set("", depOrCb);
      return;
    }
    if (typeof depOrCb === "string") {
      // accept(dep, cb) — dep-accept. Require cb present (Vite allows
      // it to be omitted for the batch overload, which we defer).
      if (typeof cb !== "function") {
        throw new TypeError(
          `import.meta.hot.accept("${depOrCb}", cb): callback is required`,
        );
      }
      record.acceptCallbacks.set(depOrCb, cb as (mod: unknown) => void);
      return;
    }
    // accept() — no callback. Mark the module as accepting its own
    // updates by recording an entry whose callback is a no-op. The
    // presence of a "" key is what `hasSelfAccept()` tests.
    if (!record.acceptCallbacks.has("")) {
      record.acceptCallbacks.set("", () => undefined);
    }
  }

  function dispose(cb: (data: Record<string, unknown>) => void): void {
    record.disposeCallbacks.push(cb);
  }

  function invalidate(message?: string): void {
    invalidateTransport({ type: "invalidate", moduleUrl, message });
  }

  function on(event: HMREventName, cb: (payload: unknown) => void): void {
    let set = record.eventListeners.get(event);
    if (set === undefined) {
      set = new Set();
      record.eventListeners.set(event, set);
    }
    set.add(cb);
  }

  return {
    get data() {
      return record.data;
    },
    accept: accept as ManduHot["accept"],
    dispose,
    invalidate,
    on,
  };
}

// ============================================
// Replacement dispatch — called by the HMR client script
// ============================================

/**
 * Fire `dispose` callbacks then the matching `accept` callback for a
 * self-accept. Called when the server says "module X was replaced" and
 * X was registered as self-accepting.
 *
 * Phase 7.1 B-4 extension: after the user-supplied accept callback
 * runs, if the module URL is registered with the browser-side Fast
 * Refresh registry (`window.__MANDU_HMR__.isBoundary`), queue a
 * `performReactRefresh()`. This is how Mandu composes Bun's source
 * transform (`$RefreshReg$` / `$RefreshSig$` injection) with React's
 * component-tree swap logic — without it, the new module loads but
 * React doesn't know to re-render. Coalescing is handled inside
 * `performReactRefresh` so multiple dispatches in the same tick yield a
 * single refresh pass.
 *
 * Returns `true` if the module had a self-accept registration and the
 * callback ran (possibly a no-op), `false` if there was no handler
 * (meaning the caller should escalate to a full reload).
 */
export function dispatchReplacement(
  moduleUrl: string,
  newModule: unknown,
): boolean {
  const rec = registry.get(moduleUrl);
  if (rec === undefined) return false;

  const cb = rec.acceptCallbacks.get("");
  if (cb === undefined) return false;

  // Run dispose first, preserving `data` so the new module sees the
  // old state.
  for (const d of rec.disposeCallbacks) {
    try {
      d(rec.data);
    } catch (err) {
      // A buggy dispose must not prevent the replacement from
      // happening — that would wedge HMR. Log and continue.
      console.error(`[Mandu HMR] dispose() threw for ${moduleUrl}:`, err);
    }
  }
  // After dispose runs, the stored callbacks for the *old* module body
  // are consumed. The replacement will re-register any it still wants.
  rec.disposeCallbacks = [];

  cb(newModule);

  // Phase 7.1 B-4: trigger React Fast Refresh if this module was
  // registered as a boundary by the bundler-emitted onLoad epilogue.
  // The guard is defensive: SSR (no window), missing preamble, and
  // production builds (no `__MANDU_HMR__` installed) all short-circuit
  // without throwing. Wrapped in try/catch because the refresh runtime
  // is third-party code and we must not wedge the HMR client if it
  // throws.
  try {
    const w =
      typeof globalThis !== "undefined"
        ? (globalThis as unknown as {
            __MANDU_HMR__?: {
              isBoundary(url: string): boolean;
              performReactRefresh(): void;
            };
          })
        : null;
    const hmr = w?.__MANDU_HMR__;
    if (hmr && hmr.isBoundary(moduleUrl)) {
      hmr.performReactRefresh();
    }
  } catch (err) {
    console.error(
      `[Mandu HMR] Fast Refresh dispatch for ${moduleUrl} threw:`,
      err,
    );
  }

  return true;
}

/**
 * Fire the dep-accept callback for a specific `(importer, dep)` pair.
 * The server decides which importer handles the update (it walks the
 * import graph); from the client's perspective we just look up the
 * callback and fire.
 */
export function dispatchDependencyUpdate(
  importerUrl: string,
  depUrl: string,
  newDep: unknown,
): boolean {
  const rec = registry.get(importerUrl);
  if (rec === undefined) return false;
  const cb = rec.acceptCallbacks.get(depUrl);
  if (cb === undefined) return false;
  cb(newDep);
  return true;
}

/**
 * Emit a Vite-compat lifecycle event to any module that called `on()`
 * with that event name. Broadcasts across the entire registry — Vite
 * does the same; events are not per-module.
 */
export function dispatchEvent(event: HMREventName, payload: unknown): void {
  for (const rec of registry.values()) {
    const set = rec.eventListeners.get(event);
    if (set === undefined) continue;
    for (const listener of set) {
      try {
        listener(payload);
      } catch (err) {
        console.error(`[Mandu HMR] ${event} listener threw:`, err);
      }
    }
  }
}

// ============================================
// Test helpers — NOT part of the public API
// ============================================

/**
 * Test-only: clear the shared registry. Call in `beforeEach` to
 * guarantee clean slate between cases. Production code must not call
 * this — it would orphan live HMR state.
 *
 * @internal
 */
export function _resetRegistryForTests(): void {
  registry.clear();
  invalidateTransport = () => undefined;
}

/**
 * Test-only: inspect the registry size without exposing the internal
 * map shape. Useful for "no leaks" assertions.
 *
 * @internal
 */
export function _getRegistrySizeForTests(): number {
  return registry.size;
}
