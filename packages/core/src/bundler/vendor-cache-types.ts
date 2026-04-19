/**
 * Phase 7.2 — Tier 2 vendor shim disk cache contract.
 *
 * Cold start breakdown (R0.3 diagnostic): the largest remaining cost is
 * `buildVendorShims` rebuilding `_vendor-react.js`, `_vendor-react-dom.js`,
 * `_vendor-react-refresh.js`, and `_fast-refresh-runtime.js` on every
 * `mandu dev` invocation. These outputs are **deterministic per React /
 * React-DOM / react-refresh / Bun version combination**, so Agent A's
 * Phase 7.2.S2 caches them on disk and reuses them across boots.
 *
 * This file is the CONTRACT between the cache writer (Agent A in
 * `bundler/vendor-cache.ts`) and any reader (bench scripts, audit
 * tools). Do NOT add logic here — pure types only.
 *
 * Cache key composition (hash input, order-preserved):
 *   1. Bun runtime version (`Bun.version`)
 *   2. React package version (from the project's resolved `react/package.json`)
 *   3. React-DOM package version
 *   4. react-refresh package version
 *   5. Mandu version (`@mandujs/core/package.json`) — shim source evolves
 *
 * Any miss invalidates every entry — we do not support per-entry
 * invalidation to keep the manifest trivial (N=4 shims isn't worth it).
 *
 * References:
 *   docs/bun/phase-7-2-team-plan.md §2.2
 *   docs/bun/phase-7-1-diagnostics/cold-start-breakdown.md (source of the ~150ms target)
 */

// ============================================
// Manifest shape
// ============================================

/**
 * Single cache entry — one `_vendor-*.js` output.
 */
export interface VendorCacheEntry {
  /** Relative path inside `VENDOR_CACHE_DIR`. No leading slash. */
  path: string;
  /** Bytes on disk. Verification hint — mismatch → invalidate. */
  size: number;
  /** SHA-256 of the cached content. Tamper detection. */
  hash: string;
}

/**
 * `.mandu/vendor-cache/vendor-cache.json` — loaded at boot to decide
 * cache hit vs miss.
 */
export interface VendorCacheManifest {
  /** Format version. Bump on breaking manifest changes. */
  version: 1;

  /** `Bun.version` at write time. Any mismatch → wholesale miss. */
  bunVersion: string;

  /**
   * Resolved versions of the four npm packages that feed the shims.
   * Order matches the hash input above.
   */
  reactVersion: string;
  reactDomVersion: string;
  reactRefreshVersion: string;

  /** `@mandujs/core` version — shim source code evolves with Mandu. */
  manduCoreVersion: string;

  /**
   * Map from shim logical id (e.g. `"react"`, `"react-dom"`,
   * `"react-refresh-runtime"`, `"fast-refresh-glue"`) to on-disk entry.
   * Writer is expected to include exactly the four keys above.
   */
  entries: Record<string, VendorCacheEntry>;

  /** ISO 8601 timestamp. Provenance only — not used by hit/miss logic. */
  generatedAt: string;
}

// ============================================
// Constants — location + filename
// ============================================

/**
 * Relative to project root. All cache files go here.
 *
 * Kept inside `.mandu/` (already gitignored) so cache survives branch
 * switches but not `git clean -fdx`. Intentional: heavy operations
 * re-run on hard clean, routine workflow stays warm.
 */
export const VENDOR_CACHE_DIR = ".mandu/vendor-cache";

/** Filename of the manifest inside `VENDOR_CACHE_DIR`. */
export const VENDOR_CACHE_FILENAME = "vendor-cache.json";

/**
 * Safety limit — if the cache grows past this, invalidate and rebuild.
 * The four shims total ~25 KB today; 10 MB is overly generous but
 * catches pathological disk corruption.
 */
export const VENDOR_CACHE_MAX_BYTES = 10 * 1024 * 1024;

// ============================================
// Hit/miss result — returned by the cache reader
// ============================================

/**
 * Branded result so callers (build.ts) don't need to re-read the
 * manifest to know why.
 */
export type VendorCacheResult =
  | { kind: "hit"; manifest: VendorCacheManifest }
  | {
      kind: "miss";
      reason:
        | "no-manifest"       // first boot
        | "version-mismatch"  // any of the 5 version fields changed
        | "missing-entry"     // manifest references a file that doesn't exist
        | "hash-mismatch"     // tamper / partial write
        | "size-mismatch"     // same as above, cheaper first-pass check
        | "format-version";   // manifest.version !== 1
      /** Populated when reason === "version-mismatch" — which field. */
      mismatchedField?: keyof Pick<
        VendorCacheManifest,
        | "bunVersion"
        | "reactVersion"
        | "reactDomVersion"
        | "reactRefreshVersion"
        | "manduCoreVersion"
      >;
    };
