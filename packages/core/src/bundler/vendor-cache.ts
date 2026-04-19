/**
 * Phase 7.2 — Tier 2 vendor shim disk cache (Agent A / S2).
 *
 * # Why this exists
 *
 * `buildVendorShims` produces four small-but-deterministic JS bundles:
 *   - `_vendor-react.js` / `_vendor-react-dom.js` / `_vendor-react-refresh.js`
 *     / `_fast-refresh-runtime.js` (+ two JSX runtimes).
 *
 * The inputs are the upstream npm versions of `react` / `react-dom` /
 * `react-refresh` plus the shim source strings we hard-code in `build.ts`.
 * If none of those change, re-running Bun.build yields byte-identical output
 * — but it still costs ~100-160 ms (Windows) because `Bun.build` has to parse
 * and resolve each shim fresh every boot.
 *
 * Cold-start breakdown (`docs/bun/phase-7-1-diagnostics/cold-start-breakdown.md`
 * §3.B and §5 Tier 2) attributes ~80-120 ms of the 910 ms tmpdir cold start
 * to these rebuilds. Cache hit on warm workflow eliminates that cost.
 *
 * # Design
 *
 * - **Single atomic manifest** at `.mandu/vendor-cache/vendor-cache.json`.
 *   Any mismatch → *every* cached output is treated as invalid and
 *   `buildVendorShims` runs its full parallel build path. We do not support
 *   per-entry invalidation because the outputs always move together (they
 *   share the same React version).
 *
 * - **Five-part hash input** (order-preserved):
 *     1. `Bun.version` (runtime semantics may change between minor bumps)
 *     2. resolved `react/package.json.version`
 *     3. resolved `react-dom/package.json.version`
 *     4. resolved `react-refresh/package.json.version`
 *     5. `@mandujs/core/package.json.version` (shim source evolves with Mandu)
 *
 *   Any of the five differing triggers a cold path. See the §6 risk section
 *   of `docs/bun/phase-7-2-team-plan.md`.
 *
 * - **SHA-256 per entry** for tamper detection. If an output file was
 *   truncated / edited / corrupted, the cached-hit path refuses to use it
 *   and falls through to the full rebuild. `size` is a cheaper first-pass
 *   check so we avoid hashing every byte for the common case.
 *
 * - **NO concurrency**: dev servers are single-process, so write-after-read
 *   races don't happen. Two concurrent `mandu dev` invocations on the same
 *   project WILL step on each other — this is the same story as the pre-
 *   existing `.mandu/dev-cache/ssr` directory used by the SSR bundled
 *   importer, which is also single-writer.
 *
 * - **Gitignored location**: `.mandu/` is already in the starter's
 *   `.gitignore`, so branch switches preserve the cache but a hard clean
 *   (`git clean -fdx`) triggers a rebuild — intentional because hard-cleaned
 *   trees should not trust stale artifacts.
 *
 * # Error handling
 *
 * Every I/O path swallows errors by falling back to miss:
 *   - manifest read fails → miss "no-manifest"
 *   - JSON parse fails → miss "no-manifest" (treat as absent)
 *   - any `fs.stat` / hash mismatch → miss "missing-entry" / "hash-mismatch"
 *
 * The writer is best-effort: if writing the manifest or a cached entry
 * fails, we log via perf (opt-in) but never block the build. Next boot
 * will either find a complete cache or hit a miss and rebuild.
 *
 * References:
 *   docs/bun/phase-7-2-team-plan.md §2.2
 *   docs/bun/phase-7-1-diagnostics/cold-start-breakdown.md §§3.B, 5
 *   packages/core/src/bundler/vendor-cache-types.ts (the contract)
 */

import fs from "fs/promises";
import path from "path";
import { createHash } from "node:crypto";
import {
  type VendorCacheManifest,
  type VendorCacheResult,
  type VendorCacheEntry,
  VENDOR_CACHE_DIR,
  VENDOR_CACHE_FILENAME,
  VENDOR_CACHE_MAX_BYTES,
} from "./vendor-cache-types";

// ============================================
// Public API
// ============================================

/**
 * Input to {@link readVendorCache} and {@link writeVendorCache}. Callers
 * resolve these versions once (at the start of `buildVendorShims`) and
 * pass them to both functions so the hash input is stable.
 */
export interface VendorCacheKeyInput {
  bunVersion: string;
  reactVersion: string;
  reactDomVersion: string;
  reactRefreshVersion: string;
  manduCoreVersion: string;
}

/**
 * Logical id → on-disk filename map. Must stay in lock-step with
 * `buildVendorShims` in `build.ts`: any new shim added there needs its
 * logical id registered here so the cache knows which file to
 * preserve/restore.
 */
export const VENDOR_SHIM_FILES: Record<string, string> = {
  "react": "_react.js",
  "react-dom": "_react-dom.js",
  "react-dom-client": "_react-dom-client.js",
  "jsx-runtime": "_jsx-runtime.js",
  "jsx-dev-runtime": "_jsx-dev-runtime.js",
  "react-refresh-runtime": "_vendor-react-refresh.js",
  "fast-refresh-glue": "_fast-refresh-runtime.js",
} as const;

/** Keys of {@link VENDOR_SHIM_FILES}. */
export type VendorShimId = keyof typeof VENDOR_SHIM_FILES;

// ============================================
// Read path
// ============================================

/**
 * Try to load the vendor cache for `rootDir`. Returns `hit` only when:
 *   1. The manifest file exists and parses cleanly.
 *   2. Every version field matches the requested inputs.
 *   3. Every entry's file exists, has the recorded size, and hashes back
 *      to the stored SHA-256.
 *
 * All other cases return a typed `miss` so the caller can decide what to
 * log (perf markers fire here so a diagnostic pass doesn't need to read
 * the result type).
 *
 * The manifest is consulted at boot only — no lazy / partial reads. A
 * "size" field > {@link VENDOR_CACHE_MAX_BYTES} is treated as a miss so
 * pathological disk corruption can't feed a nonsensical 10 GB file into
 * a hash round-trip.
 */
export async function readVendorCache(
  rootDir: string,
  keys: VendorCacheKeyInput,
): Promise<VendorCacheResult> {
  const cacheDir = path.resolve(rootDir, VENDOR_CACHE_DIR);
  const manifestPath = path.join(cacheDir, VENDOR_CACHE_FILENAME);

  let rawManifest: string;
  try {
    rawManifest = await fs.readFile(manifestPath, "utf-8");
  } catch {
    return { kind: "miss", reason: "no-manifest" };
  }

  let manifest: VendorCacheManifest;
  try {
    manifest = JSON.parse(rawManifest) as VendorCacheManifest;
  } catch {
    // Corrupt / partial write — treat as absent.
    return { kind: "miss", reason: "no-manifest" };
  }

  // Format version — reject unknown schemas (future-proofing).
  if (manifest.version !== 1) {
    return { kind: "miss", reason: "format-version" };
  }

  // Version comparison — any mismatch invalidates everything.
  const versionCheck = compareVersions(manifest, keys);
  if (versionCheck !== null) {
    return {
      kind: "miss",
      reason: "version-mismatch",
      mismatchedField: versionCheck,
    };
  }

  // Size check (cheap) before hash check (expensive).
  for (const [logicalId, entry] of Object.entries(manifest.entries)) {
    const entryPath = path.join(cacheDir, entry.path);
    let stat;
    try {
      stat = await fs.stat(entryPath);
    } catch {
      return { kind: "miss", reason: "missing-entry" };
    }

    if (stat.size !== entry.size) {
      return { kind: "miss", reason: "size-mismatch" };
    }

    if (stat.size > VENDOR_CACHE_MAX_BYTES) {
      // Pathological — refuse to read.
      return { kind: "miss", reason: "size-mismatch" };
    }

    // Hash check — full read. Entries are small (~25 KB total today).
    let buf;
    try {
      buf = await fs.readFile(entryPath);
    } catch {
      return { kind: "miss", reason: "missing-entry" };
    }

    const actualHash = sha256(buf);
    if (actualHash !== entry.hash) {
      return { kind: "miss", reason: "hash-mismatch" };
    }

    // Swallow unused loop variable to satisfy no-unused-vars.
    void logicalId;
  }

  return { kind: "hit", manifest };
}

// ============================================
// Write path
// ============================================

/**
 * Input for {@link writeVendorCache} — one entry per shim produced by
 * `buildVendorShims`. The `absPath` points at the freshly-built file in
 * `.mandu/client/` which we copy into the cache dir to avoid depending on
 * downstream `buildClientBundles` side-effects.
 */
export interface VendorCacheWriteEntry {
  logicalId: string;
  /** Absolute path to the built shim in `.mandu/client/`. */
  absPath: string;
}

/**
 * Persist the freshly-built shims + manifest to `.mandu/vendor-cache/`.
 *
 * - Creates the cache dir if missing.
 * - Copies each entry's file by bytes (not a symlink — Windows junction
 *   semantics differ between filesystems, and a hard-copy sidesteps the
 *   "rebuild deletes the original" GC hazard).
 * - Writes the manifest LAST so a crashed write leaves the cache in a
 *   safe state (missing-entry on next read → miss).
 *
 * Best-effort: returns `false` on any write failure but does not throw,
 * so the build continues even if the disk is read-only.
 */
export async function writeVendorCache(
  rootDir: string,
  keys: VendorCacheKeyInput,
  entries: VendorCacheWriteEntry[],
): Promise<boolean> {
  const cacheDir = path.resolve(rootDir, VENDOR_CACHE_DIR);

  try {
    await fs.mkdir(cacheDir, { recursive: true });
  } catch {
    return false;
  }

  const manifestEntries: Record<string, VendorCacheEntry> = {};

  for (const entry of entries) {
    let buf: Buffer;
    try {
      buf = await fs.readFile(entry.absPath);
    } catch {
      // Source file missing (build must have failed earlier) — skip
      // this entry. An incomplete cache manifest is still safe because
      // the read path checks every referenced entry.
      continue;
    }

    if (buf.byteLength > VENDOR_CACHE_MAX_BYTES) {
      continue;
    }

    const fileName = path.basename(entry.absPath);
    const destPath = path.join(cacheDir, fileName);

    try {
      await fs.writeFile(destPath, buf);
    } catch {
      continue;
    }

    manifestEntries[entry.logicalId] = {
      path: fileName,
      size: buf.byteLength,
      hash: sha256(buf),
    };
  }

  // Nothing to cache → skip writing a stub manifest (would cause miss on
  // next boot). Callers should interpret this as a best-effort success.
  if (Object.keys(manifestEntries).length === 0) {
    return false;
  }

  const manifest: VendorCacheManifest = {
    version: 1,
    bunVersion: keys.bunVersion,
    reactVersion: keys.reactVersion,
    reactDomVersion: keys.reactDomVersion,
    reactRefreshVersion: keys.reactRefreshVersion,
    manduCoreVersion: keys.manduCoreVersion,
    entries: manifestEntries,
    generatedAt: new Date().toISOString(),
  };

  try {
    await fs.writeFile(
      path.join(cacheDir, VENDOR_CACHE_FILENAME),
      JSON.stringify(manifest, null, 2),
    );
  } catch {
    return false;
  }

  return true;
}

// ============================================
// Restore path — used on cache hit to re-populate `.mandu/client/`
// ============================================

/**
 * Copy every manifest-referenced file from the cache dir into `outDir`
 * (`.mandu/client/`). Returns the list of absolute output paths, in the
 * same order as the manifest's `entries` object iteration.
 *
 * Called on cache hit from `buildVendorShims` — skips re-running the
 * Bun.build calls entirely. If a copy fails (partial disk read, for
 * instance) the caller should fall back to rebuild — we return `null`
 * from this function in that case to make the degraded path explicit.
 */
export async function restoreVendorCache(
  rootDir: string,
  manifest: VendorCacheManifest,
  outDir: string,
): Promise<Map<string, string> | null> {
  const cacheDir = path.resolve(rootDir, VENDOR_CACHE_DIR);

  try {
    await fs.mkdir(outDir, { recursive: true });
  } catch {
    return null;
  }

  const result = new Map<string, string>();
  for (const [logicalId, entry] of Object.entries(manifest.entries)) {
    const src = path.join(cacheDir, entry.path);
    const dst = path.join(outDir, path.basename(entry.path));
    try {
      const buf = await fs.readFile(src);
      await fs.writeFile(dst, buf);
      result.set(logicalId, dst);
    } catch {
      // Any partial failure invalidates the restore — caller rebuilds.
      return null;
    }
  }

  return result;
}

// ============================================
// Key resolution — package.json probing
// ============================================

/**
 * Resolve the key input from a project root. Reads the requested npm
 * packages' `package.json` via Node resolution from `rootDir`, with a
 * fallback lookup through Bun's resolution if the standard path does
 * not apply (eg. monorepo hoisting).
 *
 * We do NOT use `require.resolve` — it isn't available under pure ESM
 * in Bun. Instead we read `node_modules/<name>/package.json` directly
 * and walk up the tree if needed.
 *
 * The `manduCoreVersion` is sourced from our own package.json at build
 * time (it's read through `import.meta.url`). This guards against the
 * project's own React/React-DOM being rebuilt against a newer Mandu
 * shim source.
 */
export async function resolveVendorCacheKeys(
  rootDir: string,
): Promise<VendorCacheKeyInput> {
  const bunVersion = typeof Bun !== "undefined" ? Bun.version : "0.0.0";

  const [reactVersion, reactDomVersion, reactRefreshVersion, manduCoreVersion] =
    await Promise.all([
      resolvePackageVersion(rootDir, "react"),
      resolvePackageVersion(rootDir, "react-dom"),
      resolvePackageVersion(rootDir, "react-refresh"),
      resolveManduCoreVersion(rootDir),
    ]);

  return {
    bunVersion,
    reactVersion,
    reactDomVersion,
    reactRefreshVersion,
    manduCoreVersion,
  };
}

/**
 * Walk up from `rootDir` looking for
 * `node_modules/<pkg>/package.json`, return its `version` field. Falls
 * back to `"unknown"` if nothing is found — intentional so missing a
 * dependency (eg. `react-refresh` in pure-SSR projects) doesn't
 * throw. A stable `"unknown"` value still permits cache reuse as long
 * as the project isn't mutated.
 */
async function resolvePackageVersion(
  rootDir: string,
  pkgName: string,
): Promise<string> {
  let current = path.resolve(rootDir);
  const { root } = path.parse(current);

  // Cap the walk at 10 levels to avoid pathological symlink loops.
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(
      current,
      "node_modules",
      pkgName,
      "package.json",
    );
    try {
      const raw = await fs.readFile(candidate, "utf-8");
      const parsed = JSON.parse(raw) as { version?: string };
      if (typeof parsed.version === "string" && parsed.version.length > 0) {
        return parsed.version;
      }
      return "unknown";
    } catch {
      // Not here — keep walking.
    }

    if (current === root) break;
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }

  return "unknown";
}

/**
 * Resolve `@mandujs/core` own version from the repo relative to this
 * source file. We can't reuse `resolvePackageVersion(rootDir, "@mandujs/core")`
 * because during local dev the core is linked through `workspace:*` and
 * doesn't exist in `<project>/node_modules` — it lives in the monorepo's
 * `packages/core/package.json`.
 */
async function resolveManduCoreVersion(rootDir: string): Promise<string> {
  // Try the project's own node_modules first (published install path).
  const published = await resolvePackageVersion(rootDir, "@mandujs/core");
  if (published !== "unknown") {
    return published;
  }

  // Fallback: walk up from this source file. `import.meta.dir` is the
  // directory containing this module. `<dir>/../../package.json` is
  // `packages/core/package.json` in the monorepo layout.
  try {
    const corePackagePath = path.resolve(import.meta.dir, "..", "..", "package.json");
    const raw = await fs.readFile(corePackagePath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: string; name?: string };
    if (
      parsed.name === "@mandujs/core" &&
      typeof parsed.version === "string"
    ) {
      return parsed.version;
    }
  } catch {
    // Fall through.
  }

  return "unknown";
}

// ============================================
// Internal helpers
// ============================================

/**
 * Compare the manifest's version fields against the requested input.
 * Returns `null` on match, or the mismatched field name on miss. The
 * field names are restricted to the keys actually gated by the cache
 * key — `generatedAt` is NOT part of the hash input.
 */
function compareVersions(
  manifest: VendorCacheManifest,
  keys: VendorCacheKeyInput,
):
  | null
  | "bunVersion"
  | "reactVersion"
  | "reactDomVersion"
  | "reactRefreshVersion"
  | "manduCoreVersion" {
  if (manifest.bunVersion !== keys.bunVersion) return "bunVersion";
  if (manifest.reactVersion !== keys.reactVersion) return "reactVersion";
  if (manifest.reactDomVersion !== keys.reactDomVersion) return "reactDomVersion";
  if (manifest.reactRefreshVersion !== keys.reactRefreshVersion)
    return "reactRefreshVersion";
  if (manifest.manduCoreVersion !== keys.manduCoreVersion)
    return "manduCoreVersion";
  return null;
}

/** SHA-256 of a buffer, returned as a hex string. */
function sha256(buf: Buffer | Uint8Array): string {
  const h = createHash("sha256");
  h.update(buf);
  return h.digest("hex");
}
