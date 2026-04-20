/**
 * Bun bundler plugin — hard-fail on direct `__generated__/` imports.
 *
 * Background
 * ──────────
 * The Guard rule `INVALID_GENERATED_IMPORT` (see `guard/check.ts`) already
 * scans source files for literal `import … from '…generated…'` statements,
 * but it only runs when the user (or CI) invokes `mandu guard check`.
 * Autonomous coding agents routinely bypass that step. This plugin closes
 * the gap at the bundler level: every `mandu dev` / `mandu build` pass
 * installs it by default, and any import whose specifier contains
 * `__generated__` fails the build with a structured, actionable error.
 *
 * Design
 * ──────
 * - `onResolve({ filter: /__generated__/ })` — Bun hands us every import
 *   whose *specifier* matches the regex, along with the importer's path
 *   (`args.importer`). We never return a result; we always throw.
 * - The error is `ForbiddenGeneratedImportError`, a named subclass of
 *   `Error`. Tests can `instanceof`-check; Bun surfaces `error.message` in
 *   its `result.logs` output for CLI display.
 * - The message is built via the shared Guard helper
 *   (`buildForbiddenGeneratedImportMessage`) so the bundler path and the
 *   static Guard pass cannot drift out of sync.
 *
 * Legitimate escape hatches
 * ─────────────────────────
 * 1. `getGenerated()` / `tryGetGenerated()` from `@mandujs/core/runtime`
 *    read through a global manifest slot (`__MANDU_MANIFEST__`). They do
 *    NOT trigger an ESM import for the generated artifact, so they never
 *    hit this plugin. That is the officially supported API.
 * 2. `import type` statements are allowed by the rule — TS erases them
 *    before emit, so they never become runtime imports. However, a
 *    bundler `onResolve` hook cannot distinguish `import type` from a
 *    value import because Bun strips the `type` keyword before plugin
 *    dispatch. For this reason the plugin exposes an `allowImporter`
 *    option (defaulted to recognise `@mandujs/core/runtime` internals)
 *    but deliberately does NOT try to parse the source for `type`-only
 *    imports. User type imports go through the type-checker, not the
 *    bundler, so they remain unaffected in practice.
 * 3. The per-project opt-out lives in `ManduConfig.guard.blockGeneratedImport
 *    = false`. The plugin is simply not installed when the flag is off.
 */

import type { BunPlugin } from "bun";
import {
  buildForbiddenGeneratedImportMessage,
  FORBIDDEN_GENERATED_IMPORT_SUGGESTION,
  GENERATED_IMPORT_DOCS_URL,
} from "../../guard/check";

/**
 * Raised by the plugin's `onResolve` hook. Named so tests can
 * `instanceof`-check, and so Bun's log output clearly attributes the
 * failure to the plugin.
 */
export class ForbiddenGeneratedImportError extends Error {
  /** The literal `from "…"` specifier that tripped the guard. */
  readonly specifier: string;
  /** Absolute path of the file that issued the import (best-effort). */
  readonly importer: string;
  /** Docs URL that explains the official replacement. */
  readonly docsUrl: string;
  /** Short, one-line remediation hint. */
  readonly suggestion: string;

  constructor(specifier: string, importer: string) {
    const message =
      `${buildForbiddenGeneratedImportMessage(specifier)}\n` +
      `  Importer: ${importer || "<unknown>"}\n` +
      `  Replacement: import { getGenerated } from "@mandujs/core/runtime";\n` +
      `  Then: const data = getGenerated(<key>);\n` +
      `  Docs: ${GENERATED_IMPORT_DOCS_URL}`;
    super(message);
    this.name = "ForbiddenGeneratedImportError";
    this.specifier = specifier;
    this.importer = importer;
    this.docsUrl = GENERATED_IMPORT_DOCS_URL;
    this.suggestion = FORBIDDEN_GENERATED_IMPORT_SUGGESTION;
  }
}

export interface BlockGeneratedImportsOptions {
  /**
   * Predicate that returns `true` when the importer should be exempted
   * from the rule. Default exempts `@mandujs/core/runtime` (which in
   * principle never imports `__generated__`, but is listed here so
   * framework boot code cannot trip over itself during upgrades).
   */
  allowImporter?: (importerPath: string) => boolean;
  /**
   * Custom filter regex applied to the import specifier. Defaults to
   * `/__generated__/`. Mandu ships a single default — exposing this for
   * test harnesses that want to narrow or broaden the filter.
   */
  filter?: RegExp;
}

/**
 * Default exempt predicate — matches `@mandujs/core/runtime` internals.
 * The runtime package reads generated artifacts via the global registry,
 * so in practice it never imports `__generated__/*`. Kept as a belt-and-
 * suspenders guard against self-inflicted regressions.
 */
export function defaultAllowImporter(importerPath: string): boolean {
  if (!importerPath) return false;
  // Normalize Windows backslashes so a single check covers both platforms.
  const norm = importerPath.replace(/\\/g, "/");
  return (
    norm.includes("/@mandujs/core/runtime/") ||
    norm.includes("/packages/core/src/runtime/") ||
    norm.includes("packages/core/src/runtime/")
  );
}

/**
 * Build a `BunPlugin` that blocks direct `__generated__/` imports.
 *
 * Usage — call from `defaultBundlerPlugins(config)` (see `./index.ts`).
 * Every `safeBuild` / `Bun.build` invocation in Mandu funnels through
 * that helper, so a single install point enforces the rule everywhere.
 */
export function blockGeneratedImports(
  options: BlockGeneratedImportsOptions = {},
): BunPlugin {
  const filter = options.filter ?? /__generated__/;
  const allowImporter = options.allowImporter ?? defaultAllowImporter;

  return {
    name: "mandu:block-generated-imports",
    setup(build) {
      build.onResolve({ filter }, (args) => {
        // Normalise the specifier so a Windows-style import (which would
        // be exotic but technically legal in some toolchains) is still
        // caught.
        const specifier = args.path;
        const importer = args.importer ?? "";

        if (allowImporter(importer)) {
          // Internal runtime code gets a pass. Return `undefined` so
          // Bun resolves the path through its normal pipeline.
          return undefined;
        }

        // Throw a structured error. Bun surfaces `error.message` in
        // `BuildResult.logs` (non-success) or re-throws on an exception
        // path; either way the message reaches the developer.
        throw new ForbiddenGeneratedImportError(specifier, importer);
      });
    },
  };
}

/** Exported for unit-test convenience — keep the filter text assertable. */
export const DEFAULT_BLOCK_FILTER = /__generated__/;
