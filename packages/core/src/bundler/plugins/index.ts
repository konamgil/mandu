/**
 * Bundler-plugin barrel.
 *
 * `defaultBundlerPlugins()` is the single choke point for the plugin
 * set that Mandu installs on every `Bun.build` invocation. Adding a new
 * default-on plugin means adding it here — every call-site in
 * `bundler/build.ts` and `cli/src/util/bun.ts` composes the result of
 * this helper with any build-specific plugins.
 */

import type { BunPlugin } from "bun";
import {
  blockGeneratedImports,
  type BlockGeneratedImportsOptions,
} from "./block-generated-imports";

export {
  blockGeneratedImports,
  ForbiddenGeneratedImportError,
  defaultAllowImporter,
  DEFAULT_BLOCK_FILTER,
  type BlockGeneratedImportsOptions,
} from "./block-generated-imports";

export {
  reactCompiler,
  type ReactCompilerPluginOptions,
} from "./react-compiler";

export {
  runReactCompilerLint,
  formatCompilerReport,
  type ReactCompilerDiagnostic,
  type RunReactCompilerLintOptions,
  type RunReactCompilerLintResult,
  type FormatCompilerReportOptions,
} from "./react-compiler-lint";

/**
 * Subset of `ManduConfig.guard` consumed by `defaultBundlerPlugins()`.
 * We deliberately don't import the full `ManduConfig` type to keep the
 * plugins module cycle-free.
 */
export interface DefaultBundlerPluginsConfig {
  guard?: {
    blockGeneratedImport?: boolean;
  };
}

export interface DefaultBundlerPluginsOptions {
  /** Mandu config (only `guard.blockGeneratedImport` is consulted). */
  config?: DefaultBundlerPluginsConfig;
  /** Override options for the block-generated-imports plugin. */
  blockGeneratedImports?: BlockGeneratedImportsOptions;
}

/**
 * Compose Mandu's default plugin list. Current contents:
 *
 *   - `mandu:block-generated-imports` — hard-fail on direct
 *     `__generated__/` imports. Opt-out via
 *     `config.guard.blockGeneratedImport = false`.
 *
 * Always returns a fresh array; callers are free to concat build-local
 * plugins (e.g. `fastRefreshPlugin()` in dev) without mutating the
 * default set.
 */
export function defaultBundlerPlugins(
  options: DefaultBundlerPluginsOptions = {},
): BunPlugin[] {
  const plugins: BunPlugin[] = [];
  const blockEnabled = options.config?.guard?.blockGeneratedImport !== false;
  if (blockEnabled) {
    plugins.push(blockGeneratedImports(options.blockGeneratedImports));
  }
  return plugins;
}
