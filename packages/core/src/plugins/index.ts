/**
 * DNA-001: Plugin System
 *
 * Mandu 플러그인 시스템
 * - Guard 프리셋 플러그인
 * - 빌드 플러그인
 * - 로거 전송 플러그인
 * - MCP 도구 플러그인
 * - 미들웨어 플러그인
 *
 * Phase 18.τ — expanded `ManduPlugin` hook surface (bundler / prerender /
 * middleware / test pipeline). The lightweight `definePlugin()` helper
 * for that shape lives in `./define.ts` and is re-exported as
 * `defineManduPlugin` to avoid colliding with the legacy heavy
 * `Plugin`-type `definePlugin` from `./registry.ts`.
 *
 * @see `./hooks.ts` for the typed hook surface.
 * @see `./runner.ts` for canonical dispatch + merge semantics.
 * @see `docs/architect/plugin-api.md`.
 */

export {
  PluginRegistry,
  globalPluginRegistry,
  definePlugin,
} from "./registry";

export type {
  Plugin,
  PluginApi,
  PluginCategory,
  PluginMeta,
  PluginHooks,
  GuardPresetPlugin,
  GuardRule,
  GuardRuleContext,
  PluginGuardViolation,
  LayerDefinition,
  ImportInfo,
  ExportInfo,
  BuildPlugin,
  BuildContext,
  BuildResult,
  LoggerTransportPlugin,
  LogEntry,
  McpToolPlugin,
  MiddlewarePlugin,
} from "./types";

export { runHook } from "./hooks";
export type {
  ManduPlugin,
  ManduHooks,
  PluginContext,
  PrerenderContext,
  PrerenderOverride,
  TestTransformContext,
} from "./hooks";

// Phase 18.τ — canonical hook runner + lightweight definePlugin helper.
export {
  runOnRouteRegistered,
  runOnManifestBuilt,
  runOnBundleComplete,
  runDefineBundlerPlugin,
  runDefinePrerenderHook,
  runDefineMiddlewareChain,
  runDefineTestTransform,
  resolvePluginMiddleware,
  formatHookErrors,
  type HookError,
  type HookRunReport,
  type RunnerArgs,
} from "./runner";

// Rename to avoid symbol collision with the legacy `definePlugin` helper
// (which takes the heavier `Plugin` type and is used by the built-in
// registry). `defineManduPlugin` is the go-to helper for the modern
// lightweight `ManduPlugin` shape introduced in Phase 18.τ.
export { definePlugin as defineManduPlugin, isManduPlugin } from "./define";
