/**
 * CLI Lifecycle Hook System — Phase 18.τ expansion.
 *
 * The original `ManduHooks` surface covered a few coarse lifecycle points
 * (`onBeforeBuild`, `onAfterBuild`, `onDevStart`, `onDevStop`,
 * `onRouteChange`, `onBeforeStart`). Phase 18.τ extends it so consumers
 * can extend the bundler / prerender / middleware / router pipeline
 * without forking the core. Every new hook is **optional** and defaults
 * to "no-op" — existing plugins remain source-compatible.
 *
 * Contract:
 *   - Each hook is isolated: one failure does not block subsequent hooks.
 *   - Config-level hooks run first, plugin hooks run in declaration order.
 *   - Hooks that "return a value" (e.g. `definePrerenderHook`,
 *     `onManifestBuilt`, `defineTestTransform`, `defineMiddlewareChain`,
 *     `defineBundlerPlugin`) compose via documented merge semantics
 *     implemented in `./runner.ts`.
 *
 * The canonical runner lives in `./runner.ts`. The legacy `runHook()` in
 * this file remains for back-compat with callers that already wire the
 * original coarse hooks.
 *
 * @see `docs/architect/plugin-api.md`
 */

import type { BunPlugin } from "bun";
import type { Middleware } from "../middleware/define";
import type { BundleStats } from "../bundler/types";
import type { RouteSpec, RoutesManifest } from "../spec/schema";

// ═══════════════════════════════════════════════════════════════════════
// Contexts exposed to plugin hooks
// ═══════════════════════════════════════════════════════════════════════

/**
 * Shared context every hook receives. Kept intentionally small so
 * plugins do not couple to internals that are not part of the stable API.
 */
export interface PluginContext {
  /** Absolute project root directory. */
  rootDir: string;
  /** `"development"` during `mandu dev`, `"production"` during `mandu build`. */
  mode: "development" | "production";
  /** Plugin-scoped logger — honours the framework's structured log format. */
  logger: {
    debug: (msg: string, data?: unknown) => void;
    info: (msg: string, data?: unknown) => void;
    warn: (msg: string, data?: unknown) => void;
    error: (msg: string, data?: unknown) => void;
  };
}

/**
 * Context passed to `definePrerenderHook`. A plugin may inspect the
 * pathname / params / HTML being emitted and return a {@link PrerenderOverride}
 * to skip, rewrite, or replace the output.
 */
export interface PrerenderContext extends PluginContext {
  /** The URL pathname being prerendered (e.g. `/blog/hello-world`). */
  pathname: string;
  /** The route pattern (e.g. `/blog/:slug`) that matched. `undefined` for free-form `routes[]` paths. */
  pattern?: string;
  /** Dynamic params extracted from the pattern, when available. */
  params?: Record<string, string>;
  /**
   * The HTML the fetch handler produced. Plugins may return a mutated
   * copy via {@link PrerenderOverride.html}.
   */
  html: string;
}

/**
 * Return value of `definePrerenderHook`. All fields are optional; the
 * first plugin to set a field "wins" (later plugins in the chain may
 * override via the same field — last-write semantics documented in the
 * runner).
 */
export interface PrerenderOverride {
  /**
   * When `true`, the page is removed from the prerender output entirely.
   * The runtime will fall back to SSR for that URL.
   */
  skip?: boolean;
  /** Replacement HTML. Passed verbatim to `fs.writeFile`. */
  html?: string;
  /**
   * Rewrite the output pathname. Useful for e.g. writing `/about` to
   * `/about.html` for static hosts that need explicit extensions.
   */
  pathname?: string;
}

/**
 * Pair passed to `defineTestTransform`. Plugins return the new source
 * string (or a Promise thereof). Returning the original `source`
 * unchanged is a legal no-op.
 */
export interface TestTransformContext {
  /** Absolute path of the test file being processed. */
  testFile: string;
  /** Current source (may already be transformed by an earlier plugin). */
  source: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Hook surface — the plugin authoring contract
// ═══════════════════════════════════════════════════════════════════════

/**
 * Full `ManduHooks` surface. Every hook is optional; the runner gracefully
 * skips undefined entries. Hooks fall into three categories:
 *
 *   1. **Observers** — `onBeforeBuild`, `onAfterBuild`, `onDevStart`,
 *      `onDevStop`, `onRouteChange`, `onBeforeStart`, `onRouteRegistered`,
 *      `onBundleComplete`. Return value is ignored.
 *
 *   2. **Contributors** — `defineBundlerPlugin`, `defineMiddlewareChain`,
 *      `defineTestTransform`. The runner collects return values from all
 *      plugins and concatenates / pipes them (see merge semantics in
 *      `./runner.ts`).
 *
 *   3. **Transformers** — `definePrerenderHook`, `onManifestBuilt`. The
 *      runner folds the return value back into subsequent hook invocations
 *      (last non-undefined return wins).
 */
export interface ManduHooks {
  // ───── Legacy lifecycle observers (kept for back-compat) ─────
  onBeforeBuild?: () => void | Promise<void>;
  onAfterBuild?: (result: {
    success: boolean;
    duration: number;
  }) => void | Promise<void>;
  onDevStart?: (info: {
    port: number;
    hostname: string;
  }) => void | Promise<void>;
  onDevStop?: () => void | Promise<void>;
  onRouteChange?: (info: {
    routeId: string;
    pattern: string;
    kind: string;
  }) => void | Promise<void>;
  onBeforeStart?: () => void | Promise<void>;

  // ───── Phase 18.τ — router / manifest ─────

  /**
   * Fires once per route as the FS scanner discovers it. Pure observer —
   * throwing does not abort the scan; the runner isolates the error and
   * proceeds. Useful for dependency audits, custom guards, or telemetry.
   */
  onRouteRegistered?: (route: RouteSpec) => void | Promise<void>;

  /**
   * Fires after the routes manifest is built but before it is persisted
   * to `.mandu/manifest.json`. A plugin may return a mutated manifest;
   * subsequent plugins see the mutated form ("pipe" semantics).
   */
  onManifestBuilt?: (
    manifest: RoutesManifest
  ) => RoutesManifest | Promise<RoutesManifest | void> | void;

  // ───── Phase 18.τ — bundler ─────

  /**
   * Contribute additional `BunPlugin` entries to every `Bun.build` call
   * issued by the bundler (runtime / router / vendor / island paths).
   * May return a single plugin or an array. The returned plugins run
   * AFTER Mandu's default plugins so user transforms see already-resolved
   * imports.
   */
  defineBundlerPlugin?: () =>
    | BunPlugin
    | BunPlugin[]
    | Promise<BunPlugin | BunPlugin[]>;

  /**
   * Fires once per successful `buildClientBundles()` completion with the
   * final `BundleStats`. Purely observational — used for analytics,
   * size-budget enforcement, report emission, etc. Throwing does not
   * invalidate the build; the error is logged and swallowed.
   */
  onBundleComplete?: (stats: BundleStats) => void | Promise<void>;

  // ───── Phase 18.τ — prerender ─────

  /**
   * Intercept each prerender step. The runner calls every plugin's
   * hook in declaration order; returns are merged field-by-field with
   * last-write semantics. A plugin may short-circuit by returning
   * `{ skip: true }` — subsequent plugins still see the skip flag and
   * may unset it.
   */
  definePrerenderHook?: (
    ctx: PrerenderContext
  ) => PrerenderOverride | void | Promise<PrerenderOverride | void>;

  // ───── Phase 18.τ — middleware / test ─────

  /**
   * Contribute additional request-level middleware to the global chain
   * (prepended — runs BEFORE user-declared `ManduConfig.middleware`).
   * Returns are concatenated across all plugins in declaration order.
   *
   * Bridge wrappers like `csrfMiddleware()` / `sessionMiddleware()`
   * compose naturally here. See `@mandujs/core/middleware`.
   */
  defineMiddlewareChain?: (
    ctx: PluginContext
  ) => Middleware[] | Promise<Middleware[]>;

  /**
   * Transform test source before execution (Phase 12.1 `mandu test`).
   * Returns the new source string — returning the original input is a
   * legal no-op. Multiple plugins pipe through in declaration order:
   * each plugin sees the source produced by the previous one.
   */
  defineTestTransform?: (
    ctx: TestTransformContext
  ) => string | Promise<string>;
}

/**
 * A Mandu plugin — a named object with optional `hooks` + `setup`.
 *
 * Construct with {@link definePlugin} (from `./define.ts`) for validation
 * at definition time, or inline as a plain object literal — both work.
 */
export interface ManduPlugin {
  /** Plugin identifier shown in diagnostics. Must be unique per config. */
  name: string;
  /** Optional hook implementations. */
  hooks?: Partial<ManduHooks>;
  /**
   * One-shot setup hook. Called once at `loadPlugins()` time with the
   * plugin's slice of the user config (if any). Useful for registering
   * resources, opening files, or spinning up background workers.
   */
  setup?: (config: Record<string, unknown>) => void | Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════
// Legacy coarse runner — preserved for back-compat
// ═══════════════════════════════════════════════════════════════════════

/**
 * Run a named lifecycle hook across config-level hooks and plugins.
 *
 * Execution order:
 *   1. Config hook (from mandu.config.ts `hooks` field)
 *   2. Plugin hooks (from `plugins[].hooks`, in array order)
 *
 * Each invocation is wrapped in try/catch so a single failing hook
 * does not prevent the remaining hooks from executing.
 *
 * This is a thin observer-only runner — hook return values are ignored.
 * For transforming / contributing hooks (e.g. `definePrerenderHook`,
 * `onManifestBuilt`, `defineBundlerPlugin`) use the canonical runner in
 * `./runner.ts`.
 */
export async function runHook<K extends keyof ManduHooks>(
  hookName: K,
  plugins: ManduPlugin[],
  configHooks: Partial<ManduHooks> | undefined,
  ...args: Parameters<NonNullable<ManduHooks[K]>>
): Promise<void> {
  const invoke = async (
    label: string,
    fn: ((...a: unknown[]) => void | Promise<void>) | undefined,
  ) => {
    if (!fn) return;
    try {
      await fn(...args);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[plugin] ${hookName} failed in ${label}: ${msg}`);
    }
  };

  // Config-level hook runs first
  await invoke(
    "config",
    configHooks?.[hookName] as
      | ((...a: unknown[]) => void | Promise<void>)
      | undefined,
  );

  // Plugin hooks run in registration order
  for (const plugin of plugins) {
    await invoke(
      plugin.name,
      plugin.hooks?.[hookName] as
        | ((...a: unknown[]) => void | Promise<void>)
        | undefined,
    );
  }
}
