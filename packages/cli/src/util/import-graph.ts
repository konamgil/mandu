/**
 * ImportGraph — Phase 7.0 B5 (Agent B)
 *
 * Tracks which source files each bundled root depends on, so that
 * `createBundledImporter` can skip a rebuild when the file that changed
 * is unreachable from the root.
 *
 * # Why this exists
 *
 * `createBundledImporter` previously ran `Bun.build` on every SSR change
 * for every route handler — 100+ routes × 1.5-2 s wall-clock. The real
 * target for Phase 7.0 is ≤200 ms P95 SSR rebuild; the only way to get
 * there is to rebuild only the roots whose dependency graph actually
 * contains the changed file. See:
 *   docs/bun/phase-7-diagnostics/performance-reliability.md §2 B5
 *   docs/bun/phase-7-team-plan.md §4 Agent B
 *
 * # How it's populated
 *
 * Bun.build's `BuildArtifact` does not expose an `imports` field on its
 * public prototype (confirmed empirically against Bun 1.3.12: the only
 * public properties are `hash`, `kind`, `path`, `size`, `sourcemap`,
 * `loader`, `type`). The dependency information IS available through
 * the bundle's inline/external sourcemap `sources[]` array, which lists
 * every first-party file that was inlined into the bundle.
 *
 * `createBundledImporter` parses the sourcemap after each build and
 * calls `updateFromSources(rootPath, sourcePaths)` to record the full
 * transitive closure in one step — we don't need a separate adjacency
 * list because Bun already did the DFS for us during bundling.
 *
 * # Design
 *
 * - `descendants: Map<root → Set<absolute source path>>` — single flat
 *   set per root because Bun gives us the whole transitive closure up
 *   front.
 * - `rootsUsingFile: Map<file → Set<root>>` — reverse index for fast
 *   `invalidateByFile(filePath)` without scanning every root.
 * - All paths normalized to OS-native absolute form via `path.resolve`,
 *   then lowercased on win32 so Windows case-insensitive fs events
 *   match regardless of the drive-letter casing the watcher emitted.
 *
 * # Path behavior and boundaries
 *
 * - Does not compute adjacency from source — pure consumer of the
 *   sourcemap output.
 * - Canonicalizes filesystem aliases through the nearest existing ancestor,
 *   so watcher paths and Bun.build paths remain equivalent even after a file
 *   is deleted. This is required on macOS where `/var` aliases `/private/var`.
 * - Does not persist across dev-server restarts. In-memory only.
 */

import path from "path";
import { realpathSync } from "fs";

/**
 * Resolve filesystem aliases (for example macOS `/var` -> `/private/var`).
 *
 * Watchers can report a path after the file was deleted, so resolving only the
 * complete path is not enough. Walk upward to the nearest existing ancestor,
 * canonicalize that ancestor, then append the missing suffix again.
 */
export function canonicalizeFsPath(p: string): string {
  const abs = path.resolve(p);
  const suffix: string[] = [];
  let candidate = abs;

  while (true) {
    try {
      const canonicalParent = realpathSync.native(candidate);
      if (suffix.length === 0) return canonicalParent;

      const orderedSuffix: string[] = [];
      for (let index = suffix.length - 1; index >= 0; index--) {
        orderedSuffix.push(suffix[index]);
      }
      return path.join(canonicalParent, ...orderedSuffix);
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) return abs;
      suffix.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

/** Normalize a path the way fs.watch emits on this OS. */
function normalize(p: string): string {
  const abs = canonicalizeFsPath(p);
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

/**
 * Import-graph tracker for bundled roots. See module doc for rationale.
 *
 * The API is intentionally small — this is consumed exclusively by
 * `createBundledImporter` and the tests that cover it.
 */
export class ImportGraph {
  /** rootPath → every first-party source that was inlined into the bundle. */
  private readonly descendants = new Map<string, Set<string>>();
  /** Reverse index: file → set of roots whose bundle contains this file. */
  private readonly rootsUsingFile = new Map<string, Set<string>>();

  /**
   * Record the bundle-time dependency set for `rootPath`. Replaces any
   * prior record for the same root (Bun rebuilds are total, not partial).
   */
  updateFromSources(rootPath: string, sourcePaths: Iterable<string>): void {
    const root = normalize(rootPath);
    // First, tear down the previous reverse index entries for this root,
    // otherwise `rootsUsingFile` accumulates stale pointers to files the
    // root no longer depends on.
    const prev = this.descendants.get(root);
    if (prev) {
      for (const file of prev) {
        const owners = this.rootsUsingFile.get(file);
        if (!owners) continue;
        owners.delete(root);
        if (owners.size === 0) this.rootsUsingFile.delete(file);
      }
    }

    const next = new Set<string>();
    for (const src of sourcePaths) {
      const abs = normalize(src);
      next.add(abs);
      let owners = this.rootsUsingFile.get(abs);
      if (!owners) {
        owners = new Set<string>();
        this.rootsUsingFile.set(abs, owners);
      }
      owners.add(root);
    }
    // Ensure the root itself is always a descendant of itself; a
    // subsequent `import(root, { changedFile: root })` must count as a
    // cache-miss even if the sourcemap forgot to mention the entry.
    next.add(root);
    const selfOwners = this.rootsUsingFile.get(root) ?? new Set<string>();
    selfOwners.add(root);
    this.rootsUsingFile.set(root, selfOwners);

    this.descendants.set(root, next);
  }

  /** True if `candidate` is in the import graph of `rootPath`. */
  hasDescendant(rootPath: string, candidate: string): boolean {
    const root = normalize(rootPath);
    const file = normalize(candidate);
    const set = this.descendants.get(root);
    if (!set) return false;
    return set.has(file);
  }

  /** Accessor used by tests and by the importer for diagnostic logging. */
  getDescendants(rootPath: string): ReadonlySet<string> {
    const set = this.descendants.get(normalize(rootPath));
    return set ?? new Set<string>();
  }

  /**
   * Return all roots whose bundle currently contains `filePath`. The
   * importer uses this to implement `invalidate(file)` — every root
   * that consumed the file must drop its cached bundle so the next
   * `import(root)` triggers a rebuild.
   */
  rootsContaining(filePath: string): ReadonlySet<string> {
    const file = normalize(filePath);
    const set = this.rootsUsingFile.get(file);
    return set ?? new Set<string>();
  }

  /** Forget everything we knew about `rootPath` (used by `dispose` / GC). */
  remove(rootPath: string): void {
    const root = normalize(rootPath);
    const descs = this.descendants.get(root);
    if (!descs) return;
    for (const file of descs) {
      const owners = this.rootsUsingFile.get(file);
      if (!owners) continue;
      owners.delete(root);
      if (owners.size === 0) this.rootsUsingFile.delete(file);
    }
    this.descendants.delete(root);
  }

  /** Every root currently tracked. */
  roots(): string[] {
    return Array.from(this.descendants.keys());
  }

  /** Current number of tracked roots (test-friendly accessor). */
  get size(): number {
    return this.descendants.size;
  }

  /** Drop all tracking state. */
  clear(): void {
    this.descendants.clear();
    this.rootsUsingFile.clear();
  }
}

/**
 * Extract the `sources[]` array from a bundle that was produced with
 * `sourcemap: "inline"`. Returns absolute paths (resolved against the
 * bundle output's directory, because Bun emits relative paths there).
 *
 * Returns an empty array if no sourcemap comment is present — callers
 * should treat an empty result as "unknown graph" and fall back to the
 * pessimistic no-cache path.
 */
export function extractSourcesFromInlineSourcemap(
  bundleFilePath: string,
  bundleContents: string,
): string[] {
  // Bun appends: //# sourceMappingURL=data:application/json;base64,<...>
  const match = bundleContents.match(
    /\/\/#\s*sourceMappingURL=data:application\/json(?:;charset=[^;]*)?;base64,([A-Za-z0-9+/=]+)/,
  );
  if (!match) return [];
  let json: { sources?: unknown; sourceRoot?: unknown };
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf-8");
    json = JSON.parse(decoded) as { sources?: unknown; sourceRoot?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(json.sources)) return [];

  const bundleDir = path.dirname(bundleFilePath);
  const rootPrefix = typeof json.sourceRoot === "string" ? json.sourceRoot : "";
  const out: string[] = [];
  for (const entry of json.sources) {
    if (typeof entry !== "string") continue;
    // Bun emits paths like "..\\src\\foo.ts" on win32, "../src/foo.ts"
    // on posix. `path.resolve` handles both separators correctly.
    const combined = rootPrefix ? path.join(rootPrefix, entry) : entry;
    out.push(canonicalizeFsPath(path.resolve(bundleDir, combined)));
  }
  return out;
}
