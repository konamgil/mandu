/**
 * Ergonomic helper for authoring `ManduPlugin` objects — Phase 18.τ.
 *
 * Passes the plugin through unchanged while validating the shape at
 * definition time. Fail-fast is critical: a plugin that silently
 * corrupts the hook chain (e.g. typo on the hook name, non-function
 * `setup`) is nearly impossible to diagnose from a 5xx log line.
 *
 * Importable from the `@mandujs/core/plugins/define` subpath so users
 * who only want the lightweight plugin API do not pull the whole
 * `@mandujs/core/plugins` surface (registry + categories + etc.) into
 * their dependency graph.
 *
 * @example
 * ```ts
 * import { definePlugin } from "@mandujs/core/plugins/define";
 *
 * export const sitemap = definePlugin({
 *   name: "sitemap",
 *   hooks: {
 *     async onManifestBuilt(manifest) {
 *       await writeSitemap(manifest);
 *     },
 *   },
 * });
 * ```
 *
 * @throws {TypeError} when `name` is missing / empty, `hooks` isn't an
 *   object, or `setup` isn't a function. These errors fire at import
 *   time so bad plugins never reach production.
 */

import type { ManduHooks, ManduPlugin } from "./hooks";

/**
 * Known hook names — used to catch `onRouteRegitered` style typos at
 * definition time. Kept in a runtime-visible array so adding a hook to
 * `ManduHooks` only requires one diff instead of two.
 */
const KNOWN_HOOK_NAMES: ReadonlyArray<keyof ManduHooks> = [
  // Legacy lifecycle
  "onBeforeBuild",
  "onAfterBuild",
  "onDevStart",
  "onDevStop",
  "onRouteChange",
  "onBeforeStart",
  // Phase 18.τ
  "onRouteRegistered",
  "onManifestBuilt",
  "defineBundlerPlugin",
  "onBundleComplete",
  "definePrerenderHook",
  "defineMiddlewareChain",
  "defineTestTransform",
];

/**
 * Validate + pass through a `ManduPlugin`. Use at export time:
 *
 * ```ts
 * export default definePlugin({ name: "my-plugin", hooks: { ... } });
 * ```
 *
 * The returned value is `===` the input — the helper does not clone,
 * wrap, or freeze the object, so users retain full control over the
 * plugin instance (e.g. swapping hooks at runtime for tests).
 */
export function definePlugin(plugin: ManduPlugin): ManduPlugin {
  if (!plugin || typeof plugin !== "object") {
    throw new TypeError(
      "[Mandu Plugin] definePlugin() requires a plugin object"
    );
  }
  if (typeof plugin.name !== "string" || plugin.name.length === 0) {
    throw new TypeError(
      "[Mandu Plugin] definePlugin() requires a non-empty `name` string"
    );
  }

  if (plugin.hooks !== undefined) {
    if (typeof plugin.hooks !== "object" || plugin.hooks === null) {
      throw new TypeError(
        `[Mandu Plugin "${plugin.name}"] hooks must be an object`
      );
    }
    for (const key of Object.keys(plugin.hooks)) {
      const asHookKey = key as keyof ManduHooks;
      if (!KNOWN_HOOK_NAMES.includes(asHookKey)) {
        throw new TypeError(
          `[Mandu Plugin "${plugin.name}"] unknown hook "${key}". Known hooks: ${KNOWN_HOOK_NAMES.join(", ")}`
        );
      }
      const fn = (plugin.hooks as Record<string, unknown>)[key];
      if (fn !== undefined && typeof fn !== "function") {
        throw new TypeError(
          `[Mandu Plugin "${plugin.name}"] hook "${key}" must be a function (got ${typeof fn})`
        );
      }
    }
  }

  if (plugin.setup !== undefined && typeof plugin.setup !== "function") {
    throw new TypeError(
      `[Mandu Plugin "${plugin.name}"] setup must be a function when provided (got ${typeof plugin.setup})`
    );
  }

  return plugin;
}

/**
 * Type guard for runtime checks (e.g. in `validate.ts`).
 */
export function isManduPlugin(value: unknown): value is ManduPlugin {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || v.name.length === 0) return false;
  if (v.hooks !== undefined && (typeof v.hooks !== "object" || v.hooks === null)) {
    return false;
  }
  if (v.setup !== undefined && typeof v.setup !== "function") return false;
  return true;
}
