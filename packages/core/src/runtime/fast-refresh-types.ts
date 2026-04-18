/**
 * Phase 7.1 — Fast Refresh shared types
 *
 * Bun 1.3.12 ships a native `Bun.build({ reactFastRefresh: true })` flag
 * that performs the `$RefreshReg$` / `$RefreshSig$` source transform
 * (equivalent to `babel-plugin-react-refresh`). Agent B's implementation
 * wires this into Mandu's bundler + a browser-side runtime that glues
 * `react-refresh/runtime` to our existing `ManduHot` dispatcher from
 * Phase 7.0.C.
 *
 * This file is the CONTRACT. Types only — the implementation lives in:
 *   - packages/core/src/bundler/fast-refresh-plugin.ts (Agent B new)
 *   - packages/core/src/runtime/fast-refresh-runtime.ts (Agent B new)
 *   - packages/core/src/bundler/build.ts (Agent B extend — vendor shim)
 *   - packages/core/src/bundler/dev.ts (Agent B extend — HTML preamble)
 *
 * References:
 *   docs/bun/phase-7-1-diagnostics/fast-refresh-strategy.md
 *   docs/bun/phase-7-1-team-plan.md §3.2
 *   https://bun.com/reference/bun/NormalBuildConfig/reactFastRefresh
 */

// ============================================
// Browser-side `__MANDU_HMR__` global
// ============================================

/**
 * The single global object Mandu's bundler-emitted boundary code talks
 * to. Installed by the HTML preamble script before any island runs.
 *
 * Keeping all Fast Refresh wiring behind this single namespace makes
 * the attack surface (Phase 7.1.E security audit) a single module.
 */
export interface ManduHMRGlobal {
  /**
   * Register a module URL as an HMR boundary. Emitted by the bundler
   * onLoad plugin (Agent B) for each `.client.tsx` / `.island.tsx`.
   * Idempotent — registering the same URL twice is a no-op.
   */
  acceptFile(moduleUrl: string): void;

  /**
   * Invoke `react-refresh/runtime.performReactRefresh()` on the next
   * microtask. Coalesces multiple calls within the same tick into a
   * single refresh, so a batched rebuild that swaps 3 modules only
   * re-renders the React tree once.
   */
  performReactRefresh(): void;

  /**
   * Whether `moduleUrl` was ever registered via `acceptFile`. Used by
   * `dispatchReplacement` (Phase 7.0.C runtime/hmr-client.ts) to decide
   * between "call performReactRefresh" vs "full reload fallback".
   */
  isBoundary(moduleUrl: string): boolean;

  /**
   * Reset state — test-only. Clears the boundary registry and React
   * refresh runtime scheduling state. Must NOT be exposed in production
   * bundles; tests import this via the `runtime/fast-refresh-runtime.ts`
   * module directly.
   */
  _testOnly_reset(): void;
}

/**
 * Metadata the bundler attaches to each emitted boundary. Not part of
 * the runtime API — consumed only by dev-mode tooling (hmr-bench,
 * Kitchen DevTools) and by the security audit (Phase 7.1.E) to verify
 * that every injected boundary traces back to a real source file.
 */
export interface RefreshBoundaryMetadata {
  /** URL the module is served under (e.g. `/.mandu/client/home.island.js`). */
  moduleUrl: string;
  /** Source files that were bundled into this module, from Bun.build's
   *  inline sourcemap `sources[]` (same mechanism Phase 7.0.B uses). */
  sources: readonly string[];
  /** Unix ms when the boundary was registered — for debug log ordering. */
  registeredAt: number;
}

// ============================================
// Bundler side
// ============================================

/**
 * Options passed to the Fast Refresh Bun.build plugin (Agent B new file
 * `bundler/fast-refresh-plugin.ts`). All optional — sensible defaults
 * match Vite's `@vitejs/plugin-react` behavior.
 */
export interface FastRefreshPluginOptions {
  /** Only transform files matching this test. Default: `/\.(client|island)\.tsx?$/`. */
  include?: RegExp;
  /** Bypass the transform entirely. Used for prod builds. Default: `false`. */
  disabled?: boolean;
  /**
   * Runtime module specifier the plugin's injected import points at.
   * Default: `"@mandujs/core/runtime/fast-refresh-runtime"`. Tests can
   * override to a tmpdir-local stub.
   */
  runtimeImport?: string;
}

/**
 * Classification of why a module was (or wasn't) made a Fast Refresh
 * boundary. Used by the plugin's debug log + Agent D's E2E assertions.
 */
export type BoundaryDecision =
  | { accepted: true; reason: "matched-include"; source: string }
  | { accepted: false; reason: "excluded-by-include" | "disabled" | "non-react" };

// ============================================
// Global augmentation — Window type
// ============================================

/**
 * Expose `__MANDU_HMR__` on the browser Window without polluting Node
 * typings. Users of the plugin see `window.__MANDU_HMR__.acceptFile(...)`
 * as strongly typed in TSX files.
 */
declare global {
  interface Window {
    /** Phase 7.1 Fast Refresh glue. Installed by HTML preamble. */
    __MANDU_HMR__?: ManduHMRGlobal;
  }
}

export {}; // ensure this file is a module for `declare global`
