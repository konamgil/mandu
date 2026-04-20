/**
 * Canonical Plugin Hook Runner — Phase 18.τ.
 *
 * This module is the only place where plugin hook dispatch + merge
 * semantics are implemented. Every integration point (bundler, prerender,
 * router scanner, runtime server) imports from here so the rules are
 * consistent and easy to audit.
 *
 * Dispatch order, common to every hook:
 *   1. Config-level hooks (from `ManduConfig.hooks`) run FIRST.
 *   2. Plugin hooks (from `ManduConfig.plugins[].hooks`) run in
 *      declaration order.
 *   3. Each invocation is isolated in try/catch — one failure does not
 *      block subsequent hooks. Errors are collected in the returned
 *      {@link HookRunReport} so callers can surface a single rollup.
 *
 * Merge semantics (per hook type):
 *
 *   | Hook                    | Return type            | Merge rule          |
 *   | ----------------------- | ---------------------- | ------------------- |
 *   | `onRouteRegistered`     | void                   | —                   |
 *   | `onBundleComplete`      | void                   | —                   |
 *   | `definePrerenderHook`   | PrerenderOverride|void | Object spread       |
 *   | `onManifestBuilt`       | RoutesManifest|void    | Pipe (last wins)    |
 *   | `defineBundlerPlugin`   | BunPlugin|BunPlugin[]  | Concat              |
 *   | `defineMiddlewareChain` | Middleware[]           | Concat              |
 *   | `defineTestTransform`   | string                 | Pipe (each sees prev)|
 *
 * @see `docs/architect/plugin-api.md`
 * @see `./hooks.ts` for the typed surface
 */

import type { BunPlugin } from "bun";
import type { Middleware } from "../middleware/define";
import type { BundleStats } from "../bundler/types";
import type { RouteSpec, RoutesManifest } from "../spec/schema";
import type {
  ManduPlugin,
  ManduHooks,
  PluginContext,
  PrerenderContext,
  PrerenderOverride,
  TestTransformContext,
} from "./hooks";

// ═══════════════════════════════════════════════════════════════════════
// Shared types
// ═══════════════════════════════════════════════════════════════════════

/**
 * Per-hook-invocation error record. Attached to the returned report so
 * callers can log "plugin X failed on hook Y" without swallowing the
 * stack trace.
 */
export interface HookError {
  /** Hook name that failed. */
  hook: keyof ManduHooks;
  /** Plugin label — either `"config"` or `plugin.name`. */
  source: string;
  /** Captured error. */
  error: Error;
}

export interface HookRunReport<T = unknown> {
  /** Merged result (shape varies by hook — see merge table above). */
  result: T;
  /** Errors swallowed per hook invocation. Empty when all plugins succeeded. */
  errors: HookError[];
}

/**
 * Args common to every runner call.
 */
export interface RunnerArgs {
  plugins: readonly ManduPlugin[];
  configHooks?: Partial<ManduHooks>;
}

// ═══════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Yield every `(source, fn)` pair for a given hook name, in the canonical
 * dispatch order: config hook first, then plugin hooks by declaration.
 */
function* iterateHook<K extends keyof ManduHooks>(
  hookName: K,
  args: RunnerArgs,
): Generator<{ source: string; fn: NonNullable<ManduHooks[K]> }> {
  const configFn = args.configHooks?.[hookName];
  if (configFn) {
    yield { source: "config", fn: configFn as NonNullable<ManduHooks[K]> };
  }
  for (const plugin of args.plugins) {
    const pluginFn = plugin.hooks?.[hookName];
    if (pluginFn) {
      yield {
        source: plugin.name,
        fn: pluginFn as NonNullable<ManduHooks[K]>,
      };
    }
  }
}

/**
 * Invoke a hook function and surface any thrown error as a HookError so
 * the caller can carry on with the next plugin. Returns the function's
 * return value (or `undefined` on error).
 */
async function invokeSafely<R>(
  hookName: keyof ManduHooks,
  source: string,
  thunk: () => R | Promise<R>,
  errors: HookError[],
): Promise<R | undefined> {
  try {
    return await thunk();
  } catch (raw) {
    const error = raw instanceof Error ? raw : new Error(String(raw));
    errors.push({ hook: hookName, source, error });
    // Surface to stderr too — matches the legacy `runHook` behaviour so
    // users see the failure even if the caller ignores the report.
    console.error(`[plugin] ${hookName} failed in ${source}: ${error.message}`);
    return undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Observer runners (void return — "fire and forget")
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fire `onRouteRegistered` for each scanned route. Errors in one plugin
 * don't stop the scan, or even other plugins for the same route.
 */
export async function runOnRouteRegistered(
  route: RouteSpec,
  args: RunnerArgs,
): Promise<HookRunReport<void>> {
  const errors: HookError[] = [];
  for (const { source, fn } of iterateHook("onRouteRegistered", args)) {
    await invokeSafely("onRouteRegistered", source, () => fn(route), errors);
  }
  return { result: undefined, errors };
}

/**
 * Fire `onBundleComplete` with the final BundleStats.
 */
export async function runOnBundleComplete(
  stats: BundleStats,
  args: RunnerArgs,
): Promise<HookRunReport<void>> {
  const errors: HookError[] = [];
  for (const { source, fn } of iterateHook("onBundleComplete", args)) {
    await invokeSafely("onBundleComplete", source, () => fn(stats), errors);
  }
  return { result: undefined, errors };
}

// ═══════════════════════════════════════════════════════════════════════
// Transformer runners (return-value pipe / spread)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Merge strategy for `definePrerenderHook`:
 *
 *   - Each plugin's non-undefined return spreads onto the accumulator so
 *     later plugins can override earlier fields (`{ skip: true }` wins
 *     unless a later plugin sets `{ skip: false }` explicitly).
 *   - An undefined / void return is treated as "no change".
 */
export async function runDefinePrerenderHook(
  ctx: PrerenderContext,
  args: RunnerArgs,
): Promise<HookRunReport<PrerenderOverride>> {
  const errors: HookError[] = [];
  let merged: PrerenderOverride = {};
  for (const { source, fn } of iterateHook("definePrerenderHook", args)) {
    const out = await invokeSafely(
      "definePrerenderHook",
      source,
      () => fn(ctx),
      errors,
    );
    if (out && typeof out === "object") {
      merged = { ...merged, ...out };
    }
  }
  return { result: merged, errors };
}

/**
 * Pipe `onManifestBuilt` across plugins. Each plugin receives the
 * manifest the previous plugin returned. A `void` / `undefined` return
 * means "no change, pass through".
 */
export async function runOnManifestBuilt(
  manifest: RoutesManifest,
  args: RunnerArgs,
): Promise<HookRunReport<RoutesManifest>> {
  const errors: HookError[] = [];
  let current: RoutesManifest = manifest;
  for (const { source, fn } of iterateHook("onManifestBuilt", args)) {
    const out = await invokeSafely(
      "onManifestBuilt",
      source,
      () => fn(current),
      errors,
    );
    if (out && typeof out === "object") {
      current = out;
    }
  }
  return { result: current, errors };
}

/**
 * Collect BunPlugin contributions across every plugin. Scalar returns are
 * wrapped into a single-element array; array returns are concatenated.
 * `undefined` is skipped.
 */
export async function runDefineBundlerPlugin(
  args: RunnerArgs,
): Promise<HookRunReport<BunPlugin[]>> {
  const errors: HookError[] = [];
  const collected: BunPlugin[] = [];
  for (const { source, fn } of iterateHook("defineBundlerPlugin", args)) {
    const out = await invokeSafely(
      "defineBundlerPlugin",
      source,
      () => fn(),
      errors,
    );
    if (!out) continue;
    if (Array.isArray(out)) {
      collected.push(...out);
    } else {
      collected.push(out);
    }
  }
  return { result: collected, errors };
}

/**
 * Concatenate Middleware arrays from every plugin that provides a
 * `defineMiddlewareChain`. The returned array is prepended to the
 * user-declared `ManduConfig.middleware` at server boot time (see
 * `runtime/server.ts`).
 */
export async function runDefineMiddlewareChain(
  ctx: PluginContext,
  args: RunnerArgs,
): Promise<HookRunReport<Middleware[]>> {
  const errors: HookError[] = [];
  const collected: Middleware[] = [];
  for (const { source, fn } of iterateHook("defineMiddlewareChain", args)) {
    const out = await invokeSafely(
      "defineMiddlewareChain",
      source,
      () => fn(ctx),
      errors,
    );
    if (Array.isArray(out)) {
      collected.push(...out);
    }
  }
  return { result: collected, errors };
}

/**
 * Pipe test-file source through every plugin's `defineTestTransform`.
 * Each plugin sees the output of the previous plugin. A thrown error
 * leaves the source unchanged for that step.
 */
export async function runDefineTestTransform(
  ctx: TestTransformContext,
  args: RunnerArgs,
): Promise<HookRunReport<string>> {
  const errors: HookError[] = [];
  let current = ctx.source;
  for (const { source, fn } of iterateHook("defineTestTransform", args)) {
    const out = await invokeSafely(
      "defineTestTransform",
      source,
      () => fn({ testFile: ctx.testFile, source: current }),
      errors,
    );
    if (typeof out === "string") {
      current = out;
    }
  }
  return { result: current, errors };
}

/**
 * Driver-friendly wrapper for `runDefineMiddlewareChain` that returns
 * the merged Middleware[] directly (errors are logged to stderr via
 * the same path as the inner runner). Use when a sync caller like
 * `startServer()` needs the array pre-resolved — wrap the call in
 * `await` from your driver (the CLI), then pass the result in as a
 * PREFIX to `options.middleware`.
 *
 * @example
 * ```ts
 * const pluginMiddleware = await resolvePluginMiddleware({
 *   plugins: config.plugins ?? [],
 *   configHooks: config.hooks,
 *   rootDir: process.cwd(),
 *   mode: isDev ? "development" : "production",
 * });
 * startServer(manifest, {
 *   ...serverOptions,
 *   middleware: [...pluginMiddleware, ...(config.middleware ?? [])],
 *   plugins: config.plugins,
 *   configHooks: config.hooks,
 * });
 * ```
 */
export async function resolvePluginMiddleware(input: {
  plugins: readonly ManduPlugin[];
  configHooks?: Partial<ManduHooks>;
  rootDir: string;
  mode: "development" | "production";
}): Promise<Middleware[]> {
  const ctx: PluginContext = {
    rootDir: input.rootDir,
    mode: input.mode,
    logger: {
      debug: (m, d) => console.debug(`[plugin] ${m}`, d ?? ""),
      info: (m, d) => console.info(`[plugin] ${m}`, d ?? ""),
      warn: (m, d) => console.warn(`[plugin] ${m}`, d ?? ""),
      error: (m, d) => console.error(`[plugin] ${m}`, d ?? ""),
    },
  };
  const report = await runDefineMiddlewareChain(ctx, {
    plugins: input.plugins,
    configHooks: input.configHooks,
  });
  return report.result;
}

// ═══════════════════════════════════════════════════════════════════════
// Convenience: summarize errors for CLI output
// ═══════════════════════════════════════════════════════════════════════

/**
 * Render an error rollup the CLI can print. Returns `null` when the
 * report is clean — callers should treat `null` as "nothing to log".
 */
export function formatHookErrors(
  report: HookRunReport<unknown>,
): string | null {
  if (report.errors.length === 0) return null;
  const lines = [`[plugin] ${report.errors.length} hook failure(s):`];
  for (const e of report.errors) {
    lines.push(`  - ${e.hook} in ${e.source}: ${e.error.message}`);
  }
  return lines.join("\n");
}
