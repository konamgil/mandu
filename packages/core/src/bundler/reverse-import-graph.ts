/**
 * ReverseImportGraph — #189
 *
 * Tracks `importee -> Set<importer>` edges so the dev watcher can answer
 * "which user modules transitively import this file?" when a file change
 * misses every known root set (SSR / API / client / common-dir).
 *
 * # Why this exists
 *
 * Bun caches ES modules at the process level. When a common/shared file
 * changes, `dev.ts` re-imports that file fresh, but intermediate modules
 * that reference it transitively may retain their cached form. The three
 * real-world patterns flagged in #189:
 *
 *   1. Barrel + static map — `index.ts` builds a lookup at module load,
 *      so a new entry in a leaf `translations/ko.ts` never shows up until
 *      the intermediate barrel is re-evaluated.
 *   2. Deep re-export chain — `A -> B -> C -> D`. A single edit to `D`
 *      requires every ancestor to be refreshed.
 *   3. Module-level singletons / registries whose state is captured at
 *      import time.
 *
 * The existing watcher dispatches only when the changed path itself is in
 * `serverModuleSet` / `apiModuleSet` / `clientModuleToRoute` / a common
 * dir. For files that live elsewhere — `app/lib/helper.ts`,
 * `app/_utils/translations/ko.ts`, etc. — the event falls through and
 * the user sees stale output until a manual restart.
 *
 * # Design
 *
 * - `edges: Map<importee -> Set<importer>>` — reverse index.
 * - `forward: Map<importer -> Set<importee>>` — kept so that a
 *   subsequent `update(importer, newImports)` can tear down stale edges
 *   without iterating the full reverse map.
 * - BFS closure for `transitiveImporters(file, maxDepth)` with an
 *   explicit visited set and a defensive depth cap (default 10) to
 *   prevent pathological full-graph walks on projects with dense
 *   cyclic imports. Every node visited at depth d+1 is checked against
 *   `visited` BEFORE enqueue so cycles terminate.
 * - All keys are normalized OS-native absolute paths, lowercased on win32
 *   so fs.watch events match regardless of drive-letter casing.
 * - The scanner is a conservative regex over `import ... from "…"`,
 *   `export ... from "…"`, and dynamic `import("…")`. We intentionally
 *   skip a full AST parse — the goal is "catch the common case cheaply"
 *   and the static table never drives code generation, only invalidation
 *   routing. A false-negative means the change falls through the existing
 *   silent-drop path (unchanged behavior); a false-positive triggers an
 *   extra rebuild (acceptable cost).
 * - Only first-party (relative / alias-resolvable) imports are recorded.
 *   Bare `react`, `@mandujs/core`, etc. are skipped so the graph never
 *   tracks node_modules.
 *
 * # What this does NOT do
 *
 * - Does not resolve TypeScript path aliases from `tsconfig.json`. A
 *   future pass can wire the `compilerOptions.paths` map in, but the
 *   relative-import case covers the scenarios in the issue.
 * - Does not track CSS `@import` — the CSS-update path already has its
 *   own mechanism in `dev.ts`.
 * - Does not persist. In-memory only; rebuilt from scratch on dev-server
 *   start.
 */

import fs from "fs";
import path from "path";

/**
 * Default safety cap for `transitiveImporters` BFS. 10 hops is deep
 * enough for any realistic barrel chain while stopping cold on
 * degenerate graphs (e.g. a project with everything re-exporting
 * everything).
 */
export const DEFAULT_MAX_CLOSURE_DEPTH = 10;

/** Normalize an fs path to the form the watcher emits (forward slash, lowercase on win32). */
function normalize(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, "/");
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

/**
 * Return true for a specifier that points at a first-party module we
 * can resolve on disk. Bare specifiers (`react`, `@scope/pkg`) are
 * filtered out so the graph never grows with node_modules edges.
 */
function isFirstPartySpecifier(spec: string): boolean {
  if (spec.length === 0) return false;
  // `./foo`, `../bar`, `/abs/path` — first-party for sure.
  if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/")) {
    return true;
  }
  // Windows absolute path. `fs.watch` never emits this shape, but a
  // user file could in theory reference one — reject for the same
  // reason we reject node_modules: the file isn't in the reactive tree.
  if (/^[A-Za-z]:[\\/]/.test(spec)) return false;
  // Everything else — bare module — is external.
  return false;
}

/**
 * Extensions we try (in order) when a specifier has no explicit
 * extension. Mirrors the set Bun itself would walk for a relative
 * import inside the monorepo.
 */
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as const;

/**
 * Resolve a relative specifier from `fromFile`'s directory to an
 * absolute on-disk path. Returns `null` when the target cannot be
 * found (e.g. a typed-only stub, a file the user has not yet
 * written). Callers treat `null` as "skip this edge".
 *
 * Exported for tests; production code uses it via `scanFileImports`.
 */
export function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  if (!isFirstPartySpecifier(specifier)) return null;
  const fromDir = path.dirname(fromFile);
  const base = path.resolve(fromDir, specifier);
  // If the path already has a recognized extension, test it directly.
  if (RESOLVE_EXTENSIONS.some((e) => base.endsWith(e))) {
    return fs.existsSync(base) ? base : null;
  }
  // Try each extension + `/index.<ext>` so barrel directories resolve.
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate)) return candidate;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = path.join(base, "index" + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Static-import, export-from, and dynamic import patterns. Written
// conservatively: each regex consumes a single pair of matching quotes,
// never spans newlines, and does not attempt to handle template literals
// (dynamic `import(\`…\`)` with interpolation is inherently unresolvable
// statically).
const IMPORT_PATTERNS: readonly RegExp[] = [
  // `import foo from "…"` / `import { x } from "…"` / `import "…"` / `import type { x } from "…"`
  /\bimport\s+(?:type\s+)?(?:[^'"\n;]*?\bfrom\s+)?['"]([^'"\n]+)['"]/g,
  // `export { x } from "…"` / `export * from "…"`
  /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"\n]+)['"]/g,
  // `import("…")` — dynamic. Template literals (`) intentionally excluded.
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

/**
 * Scan a file's source text for first-party import specifiers. Returns
 * the raw specifiers (not resolved). Callers usually pair this with
 * `resolveRelativeImport` to get absolute paths.
 *
 * The parser is intentionally regex-based — we do not want to pay the
 * cost of a full AST traverse on every file change. See the module
 * header for the false-positive/negative trade-off.
 */
export function extractImportSpecifiers(source: string): string[] {
  const out = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    // Reset lastIndex — the regex has `/g` so reuse across calls would
    // otherwise skip matches in later invocations.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const spec = match[1];
      if (typeof spec === "string" && spec.length > 0) out.add(spec);
    }
  }
  return Array.from(out);
}

/**
 * Read a file from disk and return the absolute paths of every
 * resolvable first-party import it contains. Non-existent files and
 * unreadable files both return an empty array (treated as "no edges
 * to record"). Async so the dev server can batch this work off the
 * main event loop.
 */
export async function scanFileImports(filePath: string): Promise<string[]> {
  let source: string;
  try {
    source = await fs.promises.readFile(filePath, "utf-8");
  } catch {
    return [];
  }
  const specifiers = extractImportSpecifiers(source);
  const out: string[] = [];
  for (const spec of specifiers) {
    const resolved = resolveRelativeImport(filePath, spec);
    if (resolved) out.push(resolved);
  }
  return out;
}

/**
 * Reverse-import graph with a bounded BFS closure API. All public
 * methods accept raw paths; normalization is applied internally.
 */
export class ReverseImportGraph {
  /** importee -> set of direct importers. */
  private readonly edges = new Map<string, Set<string>>();
  /** importer -> set of direct importees. Kept so `update` is O(|old imports|). */
  private readonly forward = new Map<string, Set<string>>();

  /**
   * Replace the outgoing edges for `importerFile`. Any prior importees
   * that no longer appear drop the importer from their reverse set so
   * the graph doesn't accumulate stale pointers.
   */
  update(importerFile: string, importeePaths: Iterable<string>): void {
    const importer = normalize(importerFile);

    // Tear down the previous forward entries.
    const prev = this.forward.get(importer);
    if (prev) {
      for (const importee of prev) {
        const back = this.edges.get(importee);
        if (!back) continue;
        back.delete(importer);
        if (back.size === 0) this.edges.delete(importee);
      }
    }

    // Build the new forward entry + reverse edges. We normalize inside
    // the loop so the caller can pass unnormalized paths.
    const next = new Set<string>();
    for (const raw of importeePaths) {
      const importee = normalize(raw);
      // Self-edges would create a trivial cycle the BFS has to skip.
      // Drop them at insert time so the visited-check is the only
      // cycle defense we need downstream.
      if (importee === importer) continue;
      next.add(importee);
      let back = this.edges.get(importee);
      if (!back) {
        back = new Set<string>();
        this.edges.set(importee, back);
      }
      back.add(importer);
    }
    if (next.size === 0) {
      this.forward.delete(importer);
    } else {
      this.forward.set(importer, next);
    }
  }

  /** Forget a single importer. Reverse edges pointing at its importees are cleaned up. */
  remove(importerFile: string): void {
    const importer = normalize(importerFile);
    const prev = this.forward.get(importer);
    if (!prev) return;
    for (const importee of prev) {
      const back = this.edges.get(importee);
      if (!back) continue;
      back.delete(importer);
      if (back.size === 0) this.edges.delete(importee);
    }
    this.forward.delete(importer);
  }

  /** Direct importers of `file` — the single-hop reverse lookup. */
  directImporters(file: string): ReadonlySet<string> {
    const set = this.edges.get(normalize(file));
    return set ?? new Set<string>();
  }

  /**
   * Transitive importers of `file`. Returns the normalized set
   * excluding `file` itself. BFS with cycle detection; every node is
   * visited at most once. Capped at `maxDepth` hops so a pathological
   * graph cannot degrade a single file change into a full-project walk.
   *
   * Depth 0 is the changed file itself (not included in the result).
   * Depth 1 is the set returned by `directImporters`. Depth N is the
   * set of modules whose shortest path to `file` is exactly N hops.
   */
  transitiveImporters(
    file: string,
    maxDepth: number = DEFAULT_MAX_CLOSURE_DEPTH,
  ): Set<string> {
    const target = normalize(file);
    const result = new Set<string>();
    // Guard against 0 / negative depth — those are no-ops.
    if (!Number.isFinite(maxDepth) || maxDepth <= 0) return result;

    let frontier = new Set<string>([target]);
    const visited = new Set<string>([target]);

    for (let depth = 0; depth < maxDepth && frontier.size > 0; depth++) {
      const next = new Set<string>();
      for (const node of frontier) {
        const directs = this.edges.get(node);
        if (!directs) continue;
        for (const importer of directs) {
          if (visited.has(importer)) continue;
          visited.add(importer);
          result.add(importer);
          next.add(importer);
        }
      }
      frontier = next;
    }
    return result;
  }

  /** True if any edge points at `file`. Useful for fast "do we know this file?" checks. */
  knows(file: string): boolean {
    const key = normalize(file);
    return this.edges.has(key) || this.forward.has(key);
  }

  /** Drop everything (dev-server restart). */
  clear(): void {
    this.edges.clear();
    this.forward.clear();
  }

  /** Total number of tracked importer modules (for diagnostics). */
  get size(): number {
    return this.forward.size;
  }

  /**
   * Dump the current state as plain JSON. Intended for debug
   * assertions in unit tests, not for production hot paths.
   */
  _inspect(): {
    forward: Record<string, string[]>;
    reverse: Record<string, string[]>;
  } {
    const forward: Record<string, string[]> = {};
    for (const [k, v] of this.forward) forward[k] = Array.from(v);
    const reverse: Record<string, string[]> = {};
    for (const [k, v] of this.edges) reverse[k] = Array.from(v);
    return { forward, reverse };
  }
}
