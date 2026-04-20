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
import { pathToFileURL } from "url";
import { mkdir, readdir, unlink, readFile } from "fs/promises";
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
function buildExternalList(depNames: string[]): string[] {
  const ALWAYS_EXTERNAL = [
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
  const fromPkg: string[] = [];
  for (const name of depNames) {
    fromPkg.push(name);
    fromPkg.push(`${name}/*`);
  }
  // Dedupe (Set preserves insertion order)
  return Array.from(new Set([...ALWAYS_EXTERNAL, ...fromPkg]));
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

    let result;
    try {
      // Issue #207 — install Mandu's default block-generated-imports plugin
      // on the SSR bundler path too, so pure-SSR pages/slots that never
      // go through the client bundler still cannot smuggle in a direct
      // `__generated__/` import. The historical Bun 1.3.10 Windows
      // `onResolve` panic is fixed in 1.3.12 (our pinned engine). If a
      // downstream project hits a regression on a newer Bun patch, the
      // `MANDU_DISABLE_BUNDLER_PLUGINS=1` env var provides an emergency
      // escape hatch without requiring a config change.
      const ssrPlugins =
        process.env.MANDU_DISABLE_BUNDLER_PLUGINS === "1"
          ? []
          : defaultBundlerPlugins();
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
        plugins: ssrPlugins,
      });
    } catch (err) {
      const inner = err instanceof Error ? err.message : String(err);
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
    try {
      const bundleContents = await readFile(output.path, "utf-8");
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

    const url = pathToFileURL(output.path).href;
    const imported = (await import(url)) as T;

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
