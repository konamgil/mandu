/**
 * Module import helpers for the dev server.
 *
 * # Why these exist
 *
 * Bun's ESM module cache is process-level and keyed by canonical URL. Once a
 * module is imported, subsequent `import("file://path")` calls return the
 * cached version forever — there's no userland API to invalidate it.
 *
 * Adding a `?t=NOW` query string busts the cache for the *entry* module, but
 * its transitive imports still resolve to canonical URLs that stay cached.
 * That's the root cause of issue #184: editing `src/shared/foo.ts` doesn't
 * propagate into SSR pages that import it through any number of hops.
 *
 * # The two strategies
 *
 * - **`importFresh`**: cache-busts only the entry module via `?t=NOW`. Useful
 *   when you only care about the entry file's own contents (e.g. simple
 *   single-file modules). Does NOT pick up transitive changes.
 *
 * - **`createBundledImporter`** (#184/#187): bundles the entry module + all of
 *   its first-party transitive imports into a single file via `Bun.build`,
 *   then imports the bundled output. Each rebuild produces a new file at a
 *   new path, so Bun treats it as a brand-new module — every transitive
 *   user-code change is picked up because they're now inlined into one entry.
 *   `node_modules` are kept external (`packages: "external"`) so framework
 *   modules like `react` and `@mandujs/core` are not duplicated into every
 *   bundle.
 *
 * # Phase 7.0 (B5): Incremental bundled import
 *
 * Previously every SSR file change triggered a fresh `Bun.build` for every
 * route handler (`registerManifestHandlers` calls `bundledImport` per
 * route). 100+ routes × 1.5-2 s bundle time produced the 1.5-2 s P95 SSR
 * rebuild observed in `docs/bun/phase-7-diagnostics/performance-reliability.md
 * §1`. Target is 200 ms P95.
 *
 * The fix: after each successful build, we parse the bundle's inline
 * sourcemap for its `sources[]` array and record the full transitive
 * dependency set in an `ImportGraph`. On subsequent calls with a
 * `changedFile` hint, we check the graph — if `changedFile` is NOT in
 * the root's dependency set we return the cached module (~sub-1 ms),
 * otherwise we rebuild (keeping the old behavior unchanged).
 *
 * The signature stays backward-compatible: calls without `changedFile`
 * fall back to the pre-incremental full-rebuild path, so existing
 * callsites in `registerManifestHandlers` keep working. Future PRs in
 * the Phase 7.0 rollout will wire `changedFile` through from the file
 * watcher.
 *
 * Production (`mandu start`) uses standard `import` because no invalidation
 * is needed there.
 */

import path from "path";
import { mkdir, readdir, unlink, readFile } from "fs/promises";
import { statSync } from "fs";
import type { BunPlugin } from "bun";
import { safeBuild } from "@mandujs/core/bundler/safe-build";
import { defaultBundlerPlugins } from "@mandujs/core/bundler/plugins";
import { HMR_PERF } from "@mandujs/core/perf/hmr-markers";
import { isPerfEnabled, mark, measure } from "@mandujs/core/perf";
import {
  ImportGraph,
  extractSourcesFromInlineSourcemap,
} from "./import-graph";

export function importFresh<T = unknown>(modulePath: string): Promise<T> {
  const url = Bun.pathToFileURL(modulePath);
  const cacheBusted = new URL(url.href);
  cacheBusted.searchParams.set("t", Date.now().toString());
  return import(cacheBusted.href) as Promise<T>;
}

const SSR_BUNDLE_DIR = ".mandu/dev-cache/ssr";

/**
 * Read package.json and return all dependency names (deps + devDeps + peerDeps).
 * Used to build the explicit Bun.build `external` list so npm packages stay
 * external while user code (including `@/*` TypeScript path aliases) is inlined
 * into the bundle.
 *
 * We can't use `packages: "external"` because that flag treats every `@/foo`
 * style alias as a scoped-package name and externalizes it, defeating the
 * whole point of the bundled importer. Bun.build's `onResolve` plugin hook
 * panics in 1.3.10 on Windows, so we can't use a custom resolver either.
 * The `external` array with wildcards is the only workable option.
 */
async function readPackageDepNames(rootDir: string): Promise<string[]> {
  try {
    const raw = await readFile(path.join(rootDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    const all = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    return Object.keys(all);
  } catch {
    return [];
  }
}

/**
 * Build the `external` list for Bun.build. Includes every npm dependency name
 * from package.json (with subpath wildcard variants), node built-ins, and
 * `bun:*`. User code — including TypeScript path-aliased imports like `@/foo`
 * — is NOT in this list, so it gets inlined into the bundle.
 *
 * Always-external defaults are included even if the user's package.json is
 * missing or unreadable, so the framework's own runtime never gets bundled.
 */
const FRAMEWORK_EXTERNAL = [
  "react",
  "react/*",
  "react-dom",
  "react-dom/*",
  "react-dom/server",
  "react-dom/client",
  "@mandujs/core",
  "@mandujs/core/*",
  "@mandujs/cli",
  "@mandujs/cli/*",
  "@mandujs/mcp",
  "@mandujs/mcp/*",
  "@mandujs/ate",
  "@mandujs/ate/*",
  "@mandujs/skills",
  "@mandujs/skills/*",
  "bun",
  "bun:*",
  "node:*",
];

function buildFrameworkExternalList(): string[] {
  return [...FRAMEWORK_EXTERNAL];
}

function buildExternalList(depNames: string[]): string[] {
  const fromPkg: string[] = [];
  for (const name of depNames) {
    fromPkg.push(name);
    fromPkg.push(`${name}/*`);
  }
  // Dedupe (Set preserves insertion order)
  return Array.from(new Set([...FRAMEWORK_EXTERNAL, ...fromPkg]));
}

interface TsconfigPathAlias {
  findPrefix: string;
  findSuffix: string;
  replacements: string[];
}

async function readTsconfigPathAliases(rootDir: string): Promise<TsconfigPathAlias[]> {
  try {
    const raw = await readFile(path.join(rootDir, "tsconfig.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      compilerOptions?: {
        baseUrl?: string;
        paths?: Record<string, string[]>;
      };
    };
    const compilerOptions = parsed.compilerOptions ?? {};
    const baseUrl = path.resolve(rootDir, compilerOptions.baseUrl ?? ".");
    const paths = compilerOptions.paths ?? {};
    const aliases: TsconfigPathAlias[] = [];

    for (const [find, targets] of Object.entries(paths)) {
      if (!Array.isArray(targets) || targets.length === 0) continue;
      const starIndex = find.indexOf("*");
      const findPrefix = starIndex === -1 ? find : find.slice(0, starIndex);
      const findSuffix = starIndex === -1 ? "" : find.slice(starIndex + 1);
      aliases.push({
        findPrefix,
        findSuffix,
        replacements: targets.map((target) => path.resolve(baseUrl, target)),
      });
    }

    aliases.sort((a, b) => b.findPrefix.length - a.findPrefix.length);
    return aliases;
  } catch {
    return [];
  }
}

function matchTsconfigAlias(specifier: string, alias: TsconfigPathAlias): string | null {
  if (!specifier.startsWith(alias.findPrefix)) return null;
  if (alias.findSuffix && !specifier.endsWith(alias.findSuffix)) return null;
  return specifier.slice(
    alias.findPrefix.length,
    alias.findSuffix ? specifier.length - alias.findSuffix.length : specifier.length,
  );
}

function resolveExistingModule(candidate: string): string | null {
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
  for (const ext of extensions) {
    const filePath = `${candidate}${ext}`;
    try {
      if (statSync(filePath).isFile()) return filePath;
    } catch {
      // Try the next extension.
    }
  }

  for (const ext of extensions.slice(1)) {
    const indexPath = path.join(candidate, `index${ext}`);
    try {
      if (statSync(indexPath).isFile()) return indexPath;
    } catch {
      // Try the next index extension.
    }
  }

  return null;
}

interface BuildArtifactLike {
  path: string;
  text: () => Promise<string>;
}

interface SSRBuildOutputLike {
  success: boolean;
  logs: unknown[];
  outputs: BuildArtifactLike[];
}

async function readBuildArtifactContents(output: BuildArtifactLike): Promise<string> {
  try {
    return await readFile(output.path, "utf-8");
  } catch {
    return output.text();
  }
}

function isBunExecutable(executablePath: string | undefined): boolean {
  if (!executablePath) return false;
  const base = path.basename(executablePath).toLowerCase();
  return base === "bun" || base === "bun.exe";
}

function resolveBunExecutable(): string {
  if (isBunExecutable(process.execPath)) return process.execPath;
  return Bun.which("bun") ?? (process.platform === "win32" ? "bun.exe" : "bun");
}

function isSSRImportDebugEnabled(): boolean {
  return process.env.MANDU_DEBUG_SSR_IMPORT === "1";
}

function debugSSRImport(message: string): void {
  if (isSSRImportDebugEnabled()) {
    console.error(`[mandu:ssr-import] ${message}`);
  }
}

async function runExternalBunBuild(options: {
  rootDir: string;
  rootPathAbs: string;
  cacheDir: string;
  naming: string;
  externalList: string[];
}): Promise<SSRBuildOutputLike> {
  const outfile = path.join(options.cacheDir, options.naming);
  const args = [
    "build",
    options.rootPathAbs,
    "--target=bun",
    "--format=esm",
    "--sourcemap=inline",
    "--outfile",
    outfile,
  ];
  for (const external of options.externalList) {
    args.push("--external", external);
  }

  const bunExecutable = resolveBunExecutable();
  debugSSRImport(
    `external build via ${bunExecutable}; entry=${options.rootPathAbs}; outfile=${outfile}`,
  );

  const proc = Bun.spawn([bunExecutable, ...args], {
    cwd: options.rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(
      [
        `bun build exited with code ${exitCode}`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join("\n"),
    );
  }

  try {
    const outputStat = statSync(outfile);
    debugSSRImport(
      `external build output exists: ${outfile} (${outputStat.size} bytes)`,
    );
  } catch {
    throw new Error(
      [
        `bun build completed but did not write SSR bundle: ${outfile}`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join("\n"),
    );
  }

  return {
    success: true,
    logs: [],
    outputs: [
      {
        path: outfile,
        text: () => readFile(outfile, "utf-8"),
      },
    ],
  };
}

function createTsconfigPathsPlugin(aliases: TsconfigPathAlias[]): BunPlugin | null {
  if (aliases.length === 0) return null;

  return {
    name: "mandu:tsconfig-paths",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        for (const alias of aliases) {
          const matched = matchTsconfigAlias(args.path, alias);
          if (matched === null) continue;

          for (const replacement of alias.replacements) {
            const candidate = replacement.includes("*")
              ? replacement.replace(/\*/g, matched)
              : replacement;
            const resolved = resolveExistingModule(candidate);
            if (resolved) {
              return { path: resolved };
            }
          }
        }

        return undefined;
      });
    },
  };
}

const installedTsconfigPathPluginRoots = new Set<string>();

export async function installTsconfigPathsPlugin(rootDir: string): Promise<void> {
  const resolvedRoot = path.resolve(rootDir);
  if (installedTsconfigPathPluginRoots.has(resolvedRoot)) return;

  const plugin = createTsconfigPathsPlugin(
    await readTsconfigPathAliases(resolvedRoot),
  );
  if (!plugin) {
    installedTsconfigPathPluginRoots.add(resolvedRoot);
    return;
  }

  Bun.plugin(plugin);
  installedTsconfigPathPluginRoots.add(resolvedRoot);
}

function formatBuildDiagnostic(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value !== "object") return String(value);

  const message = "message" in value ? String((value as { message?: unknown }).message ?? "") : "";
  const name = "name" in value ? String((value as { name?: unknown }).name ?? "") : "";
  const location =
    "location" in value && (value as { location?: unknown }).location
      ? ` ${JSON.stringify((value as { location?: unknown }).location)}`
      : "";
  const prefix = name && message && name !== "Error" ? `${name}: ` : "";
  return message ? `${prefix}${message}${location}` : null;
}

function formatBuildFailure(error: unknown): string {
  const messages: string[] = [];
  const primary = formatBuildDiagnostic(error);
  if (primary) messages.push(primary);

  const maybeStructured = error as {
    errors?: unknown[];
    logs?: unknown[];
    cause?: unknown;
  };
  for (const item of [...(maybeStructured.errors ?? []), ...(maybeStructured.logs ?? [])]) {
    const message = formatBuildDiagnostic(item);
    if (message) messages.push(message);
  }
  const cause = formatBuildDiagnostic(maybeStructured.cause);
  if (cause) messages.push(`cause: ${cause}`);

  return Array.from(new Set(messages)).join("\n") || String(error);
}

export interface BundledImporterOptions {
  /** Project root — bundles are written under `${rootDir}/${SSR_BUNDLE_DIR}`. */
  rootDir: string;
  /**
   * Optional callback for build failures. If omitted, errors are thrown.
   * Useful for surfacing build errors into a Mandu DevTools overlay later.
   */
  onError?: (modulePath: string, error: Error) => void;
}

/**
 * Optional hint for incremental invalidation.
 *
 * - `changedFile` omitted → cold / full invalidation. Always rebuilds.
 * - `changedFile` present → cache hit if the file isn't in the root's
 *   import graph (returns the previously-imported module). Otherwise
 *   rebuilds and re-imports.
 *
 * Callers that don't yet pipe through watcher events simply omit this
 * parameter and get the pre-incremental behavior.
 */
export interface BundledImportOptions {
  changedFile?: string;
}

/**
 * Callable importer with lifecycle helpers. Invoked directly as a function
 * (same shape as before) for backward compatibility with existing
 * `registerManifestHandlers` callsites; the attached methods are opt-in and
 * let the eventual dev-watch wiring drive incremental invalidation.
 */
export interface BundledImporter {
  <T = unknown>(
    modulePath: string,
    options?: BundledImportOptions,
  ): Promise<T>;

  /**
   * Drop the cached bundle for every root whose import graph contains
   * `filePath`. The next `import(root)` call will rebuild. Safe to call
   * with files that aren't tracked (no-op).
   */
  invalidate(filePath: string): void;

  /**
   * Release every bundle file from disk and clear in-memory state.
   * Called on dev-server shutdown and by tests that want hermetic
   * isolation between cases.
   */
  dispose(): Promise<void>;
}

/**
 * Internal cache entry — the last successful import for a root plus the
 * bundle file that backed it, so `dispose` can clean up reliably and
 * the invalidation path can decide whether to unlink eagerly.
 */
interface CachedImport {
  bundlePath: string;
  /** The resolved module (what a caller gets on a cache hit). */
  module: unknown;
}

/**
 * Create a module importer that bundles each entry via `Bun.build` before
 * importing it. See the file header for the rationale.
 *
 * Bundles accumulate under `.mandu/dev-cache/ssr/`. The directory is wiped
 * on importer creation (i.e., once per dev-server start) to avoid leaking
 * old bundles across sessions; bundles created during a single session
 * intentionally persist so that in-flight requests can still resolve their
 * module by URL after a reload has already produced a newer bundle.
 */
export function createBundledImporter(
  options: BundledImporterOptions,
): BundledImporter {
  const { rootDir, onError } = options;
  const cacheDir = path.resolve(rootDir, SSR_BUNDLE_DIR);
  let counter = 0;
  let cleanupPromise: Promise<void> | null = null;
  let externalListPromise: Promise<string[]> | null = null;
  let tsconfigPathAliasesPromise: Promise<TsconfigPathAlias[]> | null = null;

  // Per-source import state: the most recent bundle path (for GC) +
  // resolved module (for cache-hit fast path) for each entry.
  const cacheByRoot = new Map<string, CachedImport>();
  const graph = new ImportGraph();

  // Lazily read package.json deps once and build the external list.
  const ensureExternalList = async (): Promise<string[]> => {
    if (externalListPromise) return externalListPromise;
    externalListPromise = (async () => {
      const depNames = await readPackageDepNames(rootDir);
      return buildExternalList(depNames);
    })();
    return externalListPromise;
  };

  const ensureTsconfigPathAliases = async (): Promise<TsconfigPathAlias[]> => {
    if (tsconfigPathAliasesPromise) return tsconfigPathAliasesPromise;
    tsconfigPathAliasesPromise = readTsconfigPathAliases(rootDir);
    return tsconfigPathAliasesPromise;
  };

  // Wipe stale bundles from prior dev sessions on first use.
  // We intentionally do NOT await this in the importer; first import will await
  // alongside its own mkdir/build.
  const ensureCleanCacheDir = async (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      try {
        const entries = await readdir(cacheDir);
        await Promise.all(
          entries.map((entry) =>
            unlink(path.join(cacheDir, entry)).catch(() => {}),
          ),
        );
      } catch {
        // Directory doesn't exist yet — fine, mkdir will create it.
      }
      await mkdir(cacheDir, { recursive: true });
    })();
    return cleanupPromise;
  };

  /**
   * The core "do a fresh Bun.build and import the output" path. Mutates
   * `cacheByRoot` and `graph` on success. Shared between the
   * cache-miss branch of `importBundled` and the explicit-invalidation
   * path (no cached entry).
   */
  const rebuildAndImport = async <T>(
    rootPathAbs: string,
    perfEnabled: boolean,
  ): Promise<T> => {
    await ensureCleanCacheDir();

    const seq = ++counter;
    const ts = Date.now();
    const stem = path.basename(rootPathAbs).replace(/[^a-zA-Z0-9._-]/g, "_");
    const naming = `${stem}-${ts}-${seq}.mjs`;

    const externalList = await ensureExternalList();

    let result: SSRBuildOutputLike;
    try {
      // Issue #207 — install Mandu's default block-generated-imports plugin
      // on the SSR bundler path too, so pure-SSR pages/slots that never
      // go through the client bundler still cannot smuggle in a direct
      // `__generated__/` import. The historical Bun 1.3.10 Windows
      // `onResolve` panic is fixed in 1.3.12 (our pinned engine). If a
      // downstream project hits a regression on a newer Bun patch, the
      // `MANDU_DISABLE_BUNDLER_PLUGINS=1` env var provides an emergency
      // escape hatch without requiring a config change.
      const tsconfigPathsPlugin = createTsconfigPathsPlugin(
        await ensureTsconfigPathAliases(),
      );
      const ssrPlugins =
        process.env.MANDU_DISABLE_BUNDLER_PLUGINS === "1"
          ? []
          : defaultBundlerPlugins();
      debugSSRImport(
        `bundling entry=${rootPathAbs}; process.execPath=${process.execPath}; in-bun=${isBunExecutable(process.execPath)}`,
      );
      if (isBunExecutable(process.execPath)) {
        result = await safeBuild({
          entrypoints: [rootPathAbs],
          outdir: cacheDir,
          naming,
          target: "bun",
          format: "esm",
          // Inline source so (a) error stacks point at the original sources
          // and (b) we can parse the `sources[]` array for import-graph
          // tracking without writing a separate .map file.
          sourcemap: "inline",
          // Explicit external list (built from package.json deps + framework
          // defaults). User code — including TypeScript path aliases like `@/*`
          // — is NOT here, so it gets inlined into the bundle. We deliberately
          // avoid `packages: "external"` (treats `@/foo` as a scoped npm
          // package). The bundler-plugin caveat that previously lived here
          // was tied to Bun 1.3.10; see the plugin-install block above.
          external: externalList,
          plugins: tsconfigPathsPlugin
            ? [tsconfigPathsPlugin, ...ssrPlugins]
            : ssrPlugins,
        });
      } else {
        result = await runExternalBunBuild({
          rootDir,
          rootPathAbs,
          cacheDir,
          naming,
          externalList: buildFrameworkExternalList(),
        });
      }
    } catch (err) {
      const inner = formatBuildFailure(err);
      const error = new Error(`[Mandu] Failed to bundle ${rootPathAbs} for SSR: ${inner}`);
      if (onError) {
        onError(rootPathAbs, error);
      }
      throw error;
    }

    if (!result.success) {
      const messages = result.logs
        .map((log) => (log && typeof log === "object" && "message" in log ? (log as { message?: string }).message : String(log)))
        .filter(Boolean)
        .join("\n");
      const error = new Error(
        `[Mandu] Failed to bundle ${rootPathAbs} for SSR:\n${messages || "(no error details)"}`,
      );
      if (onError) {
        onError(rootPathAbs, error);
      }
      throw error;
    }

    const output = result.outputs[0];
    if (!output) {
      throw new Error(`[Mandu] Bundle produced no output for ${rootPathAbs}`);
    }

    // Parse the inline sourcemap to recover the transitive dependency set
    // and update the graph before we unlink the previous bundle, so that
    // invalidate() has a consistent view even if a concurrent call lands
    // mid-rebuild.
    if (perfEnabled) mark(HMR_PERF.INCR_GRAPH_UPDATE);
    const bundleContents = await readBuildArtifactContents(output as BuildArtifactLike);
    try {
      const sources = extractSourcesFromInlineSourcemap(output.path, bundleContents);
      // Bun may report the entry under a relative-rewritten form that no
      // longer matches `rootPathAbs` exactly — `updateFromSources` always
      // adds the root itself so this is safe.
      graph.updateFromSources(rootPathAbs, sources);
    } catch {
      // Sourcemap parse failure isn't fatal — we just lose the ability
      // to do cache-hit skipping for this root. Next rebuild will retry.
      graph.updateFromSources(rootPathAbs, []);
    }
    if (perfEnabled) measure(HMR_PERF.INCR_GRAPH_UPDATE, HMR_PERF.INCR_GRAPH_UPDATE);

    // Per-source GC: drop the previous bundle file for this entry. This caps
    // disk usage at one bundle per source module instead of growing
    // unbounded across a long dev session. The Bun ESM cache still keeps the
    // old bundle's compiled module alive for any in-flight import that is
    // still resolving — file deletion only removes the on-disk artifact.
    const previous = cacheByRoot.get(rootPathAbs);
    if (previous && previous.bundlePath !== output.path) {
      unlink(previous.bundlePath).catch(() => {});
    }

    await Bun.write(output.path, bundleContents);

    const fileUrl = Bun.pathToFileURL(output.path);
    fileUrl.searchParams.set("t", `${ts}-${seq}`);
    debugSSRImport(`importing SSR bundle ${fileUrl.href}`);
    const imported = (await import(fileUrl.href)) as T;

    cacheByRoot.set(rootPathAbs, {
      bundlePath: output.path,
      module: imported,
    });

    return imported;
  };

  const importBundled = async <T = unknown>(
    modulePath: string,
    opts?: BundledImportOptions,
  ): Promise<T> => {
    const perfEnabled = isPerfEnabled();
    if (perfEnabled) mark(HMR_PERF.SSR_BUNDLED_IMPORT);

    const absPath = path.resolve(modulePath);
    const cached = cacheByRoot.get(absPath);

    // Cache-hit fast path: we have a cached import AND the caller told us
    // which file changed AND that file is NOT in our transitive deps.
    if (cached && opts?.changedFile) {
      if (perfEnabled) mark(HMR_PERF.INCR_GRAPH_LOOKUP);
      const inGraph = graph.hasDescendant(absPath, opts.changedFile);
      if (perfEnabled) measure(HMR_PERF.INCR_GRAPH_LOOKUP, HMR_PERF.INCR_GRAPH_LOOKUP);

      if (!inGraph) {
        if (perfEnabled) {
          mark(HMR_PERF.INCR_CACHE_HIT);
          measure(HMR_PERF.INCR_CACHE_HIT, HMR_PERF.INCR_CACHE_HIT);
          measure(HMR_PERF.SSR_BUNDLED_IMPORT, HMR_PERF.SSR_BUNDLED_IMPORT);
        }
        return cached.module as T;
      }

      if (perfEnabled) {
        mark(HMR_PERF.INCR_CACHE_MISS);
        measure(HMR_PERF.INCR_CACHE_MISS, HMR_PERF.INCR_CACHE_MISS);
      }
    }

    // Cache miss (or no changedFile hint / no prior entry) — full rebuild.
    const result = await rebuildAndImport<T>(absPath, perfEnabled);
    if (perfEnabled) measure(HMR_PERF.SSR_BUNDLED_IMPORT, HMR_PERF.SSR_BUNDLED_IMPORT);
    return result;
  };

  const invalidate = (filePath: string): void => {
    // Every root that consumed `filePath` drops its cached entry so the
    // next `import(root)` triggers a rebuild. We also unlink the old
    // bundle file eagerly — there can't be an in-flight importer for a
    // cache entry we're explicitly invalidating.
    const affected = graph.rootsContaining(filePath);
    for (const rootAbs of affected) {
      const cached = cacheByRoot.get(rootAbs);
      if (cached) {
        unlink(cached.bundlePath).catch(() => {});
        cacheByRoot.delete(rootAbs);
      }
      graph.remove(rootAbs);
    }
  };

  const dispose = async (): Promise<void> => {
    if (process.env.MANDU_KEEP_SSR_BUNDLES === "1") {
      debugSSRImport(`keeping SSR bundles in ${cacheDir}`);
      return;
    }

    // Unlink every tracked bundle + drop graph state. `cleanupPromise`
    // is left non-null so any post-dispose `importBundled` calls still
    // start from a clean directory.
    const pending: Array<Promise<unknown>> = [];
    for (const [, cached] of cacheByRoot) {
      pending.push(unlink(cached.bundlePath).catch(() => {}));
    }
    await Promise.all(pending);
    cacheByRoot.clear();
    graph.clear();

    // Also wipe anything else that happens to be in the cache dir —
    // safety net for stale bundles from a prior process we never
    // imported here.
    try {
      const entries = await readdir(cacheDir);
      await Promise.all(
        entries.map((entry) =>
          unlink(path.join(cacheDir, entry)).catch(() => {}),
        ),
      );
    } catch {
      // Directory may not exist yet — fine.
    }
  };

  const importer = importBundled as BundledImporter;
  importer.invalidate = invalidate;
  importer.dispose = dispose;
  return importer;
}
