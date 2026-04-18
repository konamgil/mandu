/**
 * Phase 7.1 B-2 — Browser-side Fast Refresh glue.
 *
 * This module runs in the dev-mode browser. It is the **only** module that
 * imports `react-refresh/runtime`, so the attack surface (Phase 7.1.E
 * security audit) is exactly one file and one well-known global:
 * `window.__MANDU_HMR__`.
 *
 * Why this file exists
 * ─────────────────────
 * Bun 1.3.12's `Bun.build({ reactFastRefresh: true })` inserts calls to
 * `$RefreshReg$` and `$RefreshSig$` into every `.tsx`/`.ts` module. Those
 * globals must be present **before** the transformed module evaluates.
 * `installGlobal()` wires them up to the official React Refresh runtime,
 * and also exposes the three-call surface described in
 * `fast-refresh-types.ts` (`acceptFile` / `performReactRefresh` /
 * `isBoundary`) so the rest of Mandu's HMR plumbing (bundler-injected
 * boundary code + `hmr-client.ts`'s `dispatchReplacement`) has a single
 * stable API to talk to.
 *
 * Design constraints honored here:
 *
 * 1. **Deduplicated boundaries** — `acceptFile(url)` is idempotent. Calling
 *    it twice for the same URL is a no-op. This matters because the same
 *    island JS file is loaded once at hydration and re-loaded after every
 *    hot replace; both loads re-execute the bundler-injected call.
 *
 * 2. **Coalesced refreshes** — multiple replacements in the same tick (for
 *    example, a batched rebuild that emitted 3 new island bundles) must
 *    produce a single React tree re-render. We schedule the refresh on a
 *    microtask and clear the flag when it fires; subsequent same-tick
 *    calls are absorbed.
 *
 * 3. **Degradable** — if `react-refresh/runtime` fails to load (user
 *    ejected it, firewall, whatever), `installGlobal()` still installs a
 *    no-op `__MANDU_HMR__` so `dispatchReplacement` doesn't throw; it just
 *    never triggers a refresh, so the fallback full-reload path in the
 *    HMR client script owns recovery.
 *
 * 4. **Test-only reset** — `_testOnly_reset()` clears both the boundary
 *    registry and any pending microtask. It is exposed via the runtime
 *    API surface (and namespaced with `_testOnly_` to make audit easy),
 *    not via a separate export, because the HTML preamble binds against
 *    `__MANDU_HMR__` and we want tests to exercise the same object.
 *
 * References:
 *   docs/bun/phase-7-1-diagnostics/fast-refresh-strategy.md §4
 *   docs/bun/phase-7-1-team-plan.md §4 Agent B
 *   packages/core/src/runtime/fast-refresh-types.ts
 *   https://github.com/facebook/react/tree/main/packages/react-refresh
 */

import type { ManduHMRGlobal } from "./fast-refresh-types";

// ============================================
// react-refresh/runtime shape (structural)
// ============================================

/**
 * Subset of the `react-refresh/runtime` API we consume. Kept as a local
 * structural type rather than `@types/react-refresh` to avoid introducing
 * a dev-dep and keep this module compilable even when the runtime is
 * absent (see degradable design above). The four members below are
 * stable across `react-refresh` >=0.10 per the upstream README.
 */
export interface ReactRefreshRuntime {
  /**
   * Install module-registry hooks into React internals. Called once
   * during `installGlobal()`. Idempotent in the upstream runtime.
   */
  injectIntoGlobalHook: (target: typeof globalThis) => void;
  /**
   * Register a component type so its next swap can be matched. Bundler
   * emits `$RefreshReg$(type, id)` which delegates here.
   */
  register: (type: unknown, id: string) => void;
  /**
   * Return a function used to wrap components and annotate hook usage.
   * Bundler emits `$RefreshSig$()` → returns the wrapper — then calls
   * the wrapper with the component and its hook hash.
   */
  createSignatureFunctionForTransform: () => (
    ...args: readonly unknown[]
  ) => unknown;
  /**
   * Walk every registered family and force a React re-render of any
   * component whose identity has changed since the last refresh. Safe to
   * call with no changes — a no-op in that case.
   */
  performReactRefresh: () => void;
}

// ============================================
// Internal state
// ============================================

/**
 * Fully loaded runtime. `null` until `installGlobal()` resolves the import.
 */
let runtime: ReactRefreshRuntime | null = null;

/**
 * Boundary registry. Each entry is a module URL the bundler (or the
 * user, via `window.__MANDU_HMR__.acceptFile(...)`) has claimed as a
 * Fast Refresh root.
 */
const boundaries = new Set<string>();

/**
 * Coalescing flag for `performReactRefresh`. Set to `true` the moment a
 * refresh is scheduled and cleared inside the microtask body. Further
 * calls in the same tick short-circuit.
 */
let refreshScheduled = false;

// ============================================
// Exports
// ============================================

/**
 * Install a stub `$RefreshReg$` / `$RefreshSig$` on the target object
 * **before** any transformed module evaluates. The stubs are inert —
 * they capture the minimum information we need to connect to the real
 * runtime later via `bindRuntime()`. Exposed separately so the HTML
 * preamble (Phase 7.1 B-3, `bundler/dev.ts`) can call it inline without
 * waiting for the ES-module-loaded runtime.
 *
 * Calling this before the runtime has loaded is the correct sequence
 * per React Refresh docs: Vite does the same thing in its preamble.
 */
export function installPreamble(target: typeof globalThis): void {
  // These stubs must be assignable even in strict mode — cast via
  // `(target as any)` so TS doesn't complain about unknown globals.
  const t = target as unknown as {
    $RefreshReg$?: unknown;
    $RefreshSig$?: unknown;
  };
  if (!t.$RefreshReg$) {
    t.$RefreshReg$ = () => undefined;
  }
  if (!t.$RefreshSig$) {
    // Identity signature — returns a function whose return is its arg.
    t.$RefreshSig$ = () => (type: unknown) => type;
  }
}

/**
 * Connect the loaded `react-refresh/runtime` to the globals and to our
 * dispatcher. After this runs:
 *   - `$RefreshReg$(type, id)` → `runtime.register(type, id)`
 *   - `$RefreshSig$()` → `runtime.createSignatureFunctionForTransform()`
 *   - `window.__MANDU_HMR__.performReactRefresh()` is backed by the real
 *     `runtime.performReactRefresh`
 *
 * Safe to call multiple times; the last runtime wins.
 */
export function bindRuntime(rt: ReactRefreshRuntime): void {
  runtime = rt;

  // Install into React internals. `react-refresh` manages its own
  // idempotency so re-binding the same runtime is fine.
  try {
    rt.injectIntoGlobalHook(globalThis as typeof globalThis);
  } catch (err) {
    // Non-fatal — we still want the stubs installed. Log and continue.
    // eslint-disable-next-line no-console
    console.error(
      "[Mandu Fast Refresh] injectIntoGlobalHook threw; refresh will be a no-op:",
      err,
    );
  }

  // Replace the stubs the preamble installed with live wrappers.
  const g = globalThis as unknown as {
    $RefreshReg$?: (type: unknown, id: string) => void;
    $RefreshSig$?: () => (...args: readonly unknown[]) => unknown;
  };
  g.$RefreshReg$ = (type: unknown, id: string): void => {
    try {
      rt.register(type, id);
    } catch {
      // Mismatched runtime versions or bad transforms — never throw
      // into user code during HMR.
    }
  };
  g.$RefreshSig$ = (): ((...args: readonly unknown[]) => unknown) => {
    try {
      return rt.createSignatureFunctionForTransform();
    } catch {
      // Return identity so transformed code keeps working.
      return (t: unknown) => t;
    }
  };
}

/**
 * The `ManduHMRGlobal` implementation installed at
 * `window.__MANDU_HMR__`. Kept as a named export so tests can assert on
 * it directly without inspecting `window`.
 */
export const manduHMR: ManduHMRGlobal = {
  acceptFile(moduleUrl: string): void {
    if (typeof moduleUrl !== "string" || moduleUrl.length === 0) return;
    // Idempotent — `Set` already handles this but kept explicit for
    // clarity in security audit reviews.
    boundaries.add(moduleUrl);
  },

  isBoundary(moduleUrl: string): boolean {
    return boundaries.has(moduleUrl);
  },

  performReactRefresh(): void {
    // Coalesce: if another call already scheduled a refresh for this
    // tick, defer to it. This matters when a batched rebuild replaces
    // 3 modules — we only want one refresh pass.
    if (refreshScheduled) return;

    // No runtime = degraded mode. The HMR client's full-reload path
    // owns recovery, so we just silently no-op.
    if (runtime === null) return;

    refreshScheduled = true;
    // Microtask beats both `setTimeout` and `requestAnimationFrame`
    // here — we want the refresh to run before the next paint so the
    // user doesn't see the stale tree flash. `queueMicrotask` is
    // available in every browser Mandu targets (ES2020+).
    queueMicrotask(() => {
      refreshScheduled = false;
      try {
        runtime?.performReactRefresh();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[Mandu Fast Refresh] performReactRefresh threw:", err);
      }
    });
  },

  _testOnly_reset(): void {
    boundaries.clear();
    refreshScheduled = false;
    runtime = null;
  },
};

/**
 * Install the preamble stubs, attach `__MANDU_HMR__`, and asynchronously
 * bind the real `react-refresh/runtime`. This is the single entry point
 * the HTML preamble calls. Safe to call from a `<script type="module">`
 * or a cold top-level import.
 *
 * The async-bind shape is intentional: the preamble runs inline, but
 * the runtime binary is an ES module that must be fetched. During the
 * window between "preamble runs" and "runtime binds", transformed
 * modules that import-then-call `$RefreshReg$` hit the stub, which is a
 * no-op. The worst-case consequence is that the first module evaluated
 * in the page isn't registered — which is fine, because a refresh
 * can't target an unloaded module anyway.
 */
export async function installGlobal(options?: {
  runtime?: ReactRefreshRuntime;
  runtimeImport?: () => Promise<ReactRefreshRuntime | { default: ReactRefreshRuntime }>;
}): Promise<void> {
  installPreamble(globalThis as typeof globalThis);

  // Attach the global. We keep a single identity across calls so tests
  // that import `manduHMR` directly see the same object as
  // `window.__MANDU_HMR__`.
  const w = globalThis as unknown as { __MANDU_HMR__?: ManduHMRGlobal };
  w.__MANDU_HMR__ = manduHMR;

  let rt: ReactRefreshRuntime | null = options?.runtime ?? null;
  if (rt === null && options?.runtimeImport) {
    try {
      const mod = await options.runtimeImport();
      rt =
        (mod as { default?: ReactRefreshRuntime }).default ??
        (mod as ReactRefreshRuntime);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        "[Mandu Fast Refresh] failed to load react-refresh runtime:",
        err,
      );
      rt = null;
    }
  }

  if (rt !== null) {
    bindRuntime(rt);
  }
}

// ============================================
// Test helpers — NOT part of the public API
// ============================================

/**
 * Test-only: inspect registered boundary count.
 * @internal
 */
export function _getBoundaryCountForTests(): number {
  return boundaries.size;
}

/**
 * Test-only: inspect whether a refresh is queued.
 * @internal
 */
export function _isRefreshScheduledForTests(): boolean {
  return refreshScheduled;
}

/**
 * Test-only: reset module-level state. Equivalent to
 * `manduHMR._testOnly_reset()` but exposed as a named export so tests
 * can be explicit.
 * @internal
 */
export function _resetForTests(): void {
  manduHMR._testOnly_reset();
}
