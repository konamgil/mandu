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
 * Production (`mandu start`) uses standard `import` because no invalidation
 * is needed there.
 */

import path from "path";
import { pathToFileURL } from "url";
import { mkdir, readdir, unlink, readFile } from "fs/promises";
import { safeBuild } from "@mandujs/core/bundler/safe-build";

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
 * Create a module importer that bundles each entry via `Bun.build` before
 * importing it. See the file header for the rationale.
 *
 * The returned function has the same shape as `importFresh` —
 * `(modulePath: string) => Promise<unknown>` — so it's a drop-in replacement
 * inside `registerManifestHandlers`.
 *
 * Bundles accumulate under `.mandu/dev-cache/ssr/`. The directory is wiped
 * on importer creation (i.e., once per dev-server start) to avoid leaking
 * old bundles across sessions; bundles created during a single session
 * intentionally persist so that in-flight requests can still resolve their
 * module by URL after a reload has already produced a newer bundle.
 */
export function createBundledImporter(
  options: BundledImporterOptions,
): <T = unknown>(modulePath: string) => Promise<T> {
  const { rootDir, onError } = options;
  const cacheDir = path.resolve(rootDir, SSR_BUNDLE_DIR);
  let counter = 0;
  let cleanupPromise: Promise<void> | null = null;
  let externalListPromise: Promise<string[]> | null = null;
  // Per-source-module GC: remember the most recent bundle path for each entry
  // and unlink the previous one whenever a new bundle for the same entry is
  // produced. Bundles that have already been `import()`-ed are held in Bun's
  // ESM module cache by URL, so removing the underlying file doesn't break
  // requests that are already mid-flight.
  const previousBundleFor = new Map<string, string>();

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

  return async function importBundled<T = unknown>(
    modulePath: string,
  ): Promise<T> {
    await ensureCleanCacheDir();

    const absPath = path.resolve(modulePath);
    const seq = ++counter;
    const ts = Date.now();
    // sanitize basename for filesystem and ensure uniqueness across rapid calls
    const stem = path.basename(absPath).replace(/[^a-zA-Z0-9._-]/g, "_");
    const naming = `${stem}-${ts}-${seq}.mjs`;

    const externalList = await ensureExternalList();

    let result;
    try {
      result = await safeBuild({
        entrypoints: [absPath],
        outdir: cacheDir,
        naming,
        target: "bun",
        format: "esm",
        // Inline source so error stacks point at the original sources.
        sourcemap: "inline",
        // Explicit external list (built from package.json deps + framework
        // defaults). User code — including TypeScript path aliases like `@/*`
        // — is NOT here, so it gets inlined into the bundle. We deliberately
        // avoid `packages: "external"` (treats `@/foo` as a scoped npm
        // package) and Bun.build plugins (`onResolve` panics on Windows in
        // Bun 1.3.10).
        external: externalList,
      });
    } catch (err) {
      const inner = err instanceof Error ? err.message : String(err);
      const error = new Error(`[Mandu] Failed to bundle ${absPath} for SSR: ${inner}`);
      if (onError) {
        onError(absPath, error);
      }
      throw error;
    }

    if (!result.success) {
      const messages = result.logs
        .map((log) => (log && typeof log === "object" && "message" in log ? (log as { message?: string }).message : String(log)))
        .filter(Boolean)
        .join("\n");
      const error = new Error(
        `[Mandu] Failed to bundle ${absPath} for SSR:\n${messages || "(no error details)"}`,
      );
      if (onError) {
        onError(absPath, error);
      }
      throw error;
    }

    const output = result.outputs[0];
    if (!output) {
      throw new Error(`[Mandu] Bundle produced no output for ${absPath}`);
    }

    // Per-source GC: drop the previous bundle file for this entry. This caps
    // disk usage at one bundle per source module instead of growing
    // unbounded across a long dev session. The Bun ESM cache still keeps the
    // old bundle's compiled module alive for any in-flight import that is
    // still resolving — file deletion only removes the on-disk artifact.
    const prev = previousBundleFor.get(absPath);
    if (prev && prev !== output.path) {
      // Best-effort; failures (e.g., Windows EBUSY) are non-fatal.
      unlink(prev).catch(() => {});
    }
    previousBundleFor.set(absPath, output.path);

    const url = pathToFileURL(output.path).href;
    return (await import(url)) as T;
  };
}
