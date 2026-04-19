/**
 * Phase 7.2.S2 — Tier 2 vendor shim disk cache tests (Agent A).
 *
 * Covers `readVendorCache` / `writeVendorCache` / `restoreVendorCache` —
 * the ~25 KB cache layer that closes ~80-120 ms of cold start on warm
 * restarts by reusing `_vendor-react.js` / `_vendor-react-dom.js` /
 * `_vendor-react-refresh.js` / `_fast-refresh-runtime.js` instead of
 * re-running Bun.build.
 *
 * Test strategy:
 *   - Each case operates on its own tmpdir so cache state is hermetic.
 *   - We write synthetic shim files (tiny JS strings) and an explicit
 *     manifest — we do NOT invoke the real `buildVendorShims` because
 *     that would lock tests to a Bun.build round-trip per case and bloat
 *     runtime to ~15-20 s. Integration with the real shim build is
 *     covered by `buildVendorShims emits fast-refresh shims in dev mode`
 *     in `fast-refresh.test.ts`.
 *   - Hash / size / version checks live in the read layer — we drive
 *     each branch by mutating the manifest on disk between calls.
 *
 * References:
 *   docs/bun/phase-7-2-team-plan.md §2.2, §3 Agent A (S2)
 *   packages/core/src/bundler/vendor-cache.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createHash } from "node:crypto";
import {
  readVendorCache,
  writeVendorCache,
  restoreVendorCache,
  type VendorCacheKeyInput,
  type VendorCacheWriteEntry,
} from "../vendor-cache";
import {
  VENDOR_CACHE_DIR,
  VENDOR_CACHE_FILENAME,
  type VendorCacheManifest,
} from "../vendor-cache-types";

// ============================================
// Helpers
// ============================================

const BASELINE_KEYS: VendorCacheKeyInput = {
  bunVersion: "1.3.12",
  reactVersion: "19.2.0",
  reactDomVersion: "19.2.0",
  reactRefreshVersion: "0.18.0",
  manduCoreVersion: "0.22.0",
};

function makeShim(label: string): string {
  return `/* shim: ${label} */ export default { label: "${label}" };\n`;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function writeShimFile(root: string, relPath: string, contents: string): string {
  const abs = path.join(root, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
  return abs;
}

function writeManifest(rootDir: string, manifest: VendorCacheManifest): string {
  const cacheDir = path.join(rootDir, VENDOR_CACHE_DIR);
  mkdirSync(cacheDir, { recursive: true });
  const p = path.join(cacheDir, VENDOR_CACHE_FILENAME);
  writeFileSync(p, JSON.stringify(manifest, null, 2));
  return p;
}

/**
 * Produce a complete manifest + write every referenced shim file. Returns
 * the manifest (useful for mutating one field between calls).
 */
function seedCache(rootDir: string): VendorCacheManifest {
  const cacheDir = path.join(rootDir, VENDOR_CACHE_DIR);
  mkdirSync(cacheDir, { recursive: true });

  const entries: VendorCacheManifest["entries"] = {};
  const names: Array<[string, string]> = [
    ["react", "_react.js"],
    ["react-dom", "_react-dom.js"],
    ["react-dom-client", "_react-dom-client.js"],
    ["jsx-runtime", "_jsx-runtime.js"],
    ["jsx-dev-runtime", "_jsx-dev-runtime.js"],
    ["react-refresh-runtime", "_vendor-react-refresh.js"],
    ["fast-refresh-glue", "_fast-refresh-runtime.js"],
  ];

  for (const [logicalId, fileName] of names) {
    const contents = makeShim(logicalId);
    writeFileSync(path.join(cacheDir, fileName), contents);
    entries[logicalId] = {
      path: fileName,
      size: Buffer.byteLength(contents, "utf-8"),
      hash: sha256(contents),
    };
  }

  const manifest: VendorCacheManifest = {
    version: 1,
    bunVersion: BASELINE_KEYS.bunVersion,
    reactVersion: BASELINE_KEYS.reactVersion,
    reactDomVersion: BASELINE_KEYS.reactDomVersion,
    reactRefreshVersion: BASELINE_KEYS.reactRefreshVersion,
    manduCoreVersion: BASELINE_KEYS.manduCoreVersion,
    entries,
    generatedAt: new Date().toISOString(),
  };
  writeManifest(rootDir, manifest);
  return manifest;
}

// ============================================
// Tests
// ============================================

describe("vendor-cache — read path", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "mandu-vendor-cache-"));
  });

  afterEach(() => {
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // Windows lock tolerance
    }
  });

  it("no manifest → miss with reason 'no-manifest'", async () => {
    const result = await readVendorCache(rootDir, BASELINE_KEYS);
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.reason).toBe("no-manifest");
    }
  });

  it("corrupt manifest JSON → miss with reason 'no-manifest'", async () => {
    const cacheDir = path.join(rootDir, VENDOR_CACHE_DIR);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(cacheDir, VENDOR_CACHE_FILENAME), "{not json");

    const result = await readVendorCache(rootDir, BASELINE_KEYS);
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.reason).toBe("no-manifest");
    }
  });

  it("happy path: full seeded cache → hit", async () => {
    seedCache(rootDir);
    const result = await readVendorCache(rootDir, BASELINE_KEYS);
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      expect(result.manifest.bunVersion).toBe(BASELINE_KEYS.bunVersion);
      expect(Object.keys(result.manifest.entries).length).toBe(7);
    }
  });

  it("Bun version changed → miss 'version-mismatch' + mismatchedField=bunVersion", async () => {
    seedCache(rootDir);
    const result = await readVendorCache(rootDir, {
      ...BASELINE_KEYS,
      bunVersion: "1.3.9",
    });
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.reason).toBe("version-mismatch");
      expect(result.mismatchedField).toBe("bunVersion");
    }
  });

  it("React version changed → miss 'version-mismatch'", async () => {
    seedCache(rootDir);
    const result = await readVendorCache(rootDir, {
      ...BASELINE_KEYS,
      reactVersion: "18.3.0",
    });
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.reason).toBe("version-mismatch");
      expect(result.mismatchedField).toBe("reactVersion");
    }
  });

  it("@mandujs/core version changed → miss 'version-mismatch'", async () => {
    seedCache(rootDir);
    const result = await readVendorCache(rootDir, {
      ...BASELINE_KEYS,
      manduCoreVersion: "0.99.0",
    });
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.reason).toBe("version-mismatch");
      expect(result.mismatchedField).toBe("manduCoreVersion");
    }
  });

  it("hash mismatch on a cache file → miss 'hash-mismatch'", async () => {
    const manifest = seedCache(rootDir);
    // Overwrite `_react.js` with content that has the SAME size but
    // different bytes — this forces the hash branch (not the size
    // branch).
    const original = makeShim("react");
    const tampered = "/* shim: xxxxx */ export default { label: \"xxxxx\" };\n";
    expect(Buffer.byteLength(tampered, "utf-8")).toBe(
      Buffer.byteLength(original, "utf-8"),
    );

    writeFileSync(
      path.join(rootDir, VENDOR_CACHE_DIR, "_react.js"),
      tampered,
    );

    const result = await readVendorCache(rootDir, BASELINE_KEYS);
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.reason).toBe("hash-mismatch");
    }

    // Sanity — manifest entry still points at the intended file name.
    expect(manifest.entries["react"]!.path).toBe("_react.js");
  });

  it("size mismatch on a cache file → miss 'size-mismatch' (cheap check)", async () => {
    seedCache(rootDir);
    writeFileSync(
      path.join(rootDir, VENDOR_CACHE_DIR, "_react.js"),
      makeShim("react") + "// padding\n",
    );

    const result = await readVendorCache(rootDir, BASELINE_KEYS);
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.reason).toBe("size-mismatch");
    }
  });

  it("manifest references missing file → miss 'missing-entry'", async () => {
    seedCache(rootDir);
    rmSync(path.join(rootDir, VENDOR_CACHE_DIR, "_vendor-react-refresh.js"));

    const result = await readVendorCache(rootDir, BASELINE_KEYS);
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.reason).toBe("missing-entry");
    }
  });

  it("format version != 1 → miss 'format-version'", async () => {
    const manifest = seedCache(rootDir);
    // Write a manifest whose `version` field is unknown (forward-compat hedge).
    const badManifest = { ...manifest, version: 99 } as unknown as VendorCacheManifest;
    writeManifest(rootDir, badManifest);

    const result = await readVendorCache(rootDir, BASELINE_KEYS);
    expect(result.kind).toBe("miss");
    if (result.kind === "miss") {
      expect(result.reason).toBe("format-version");
    }
  });
});

describe("vendor-cache — write path", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "mandu-vendor-cache-w-"));
  });

  afterEach(() => {
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // Windows lock tolerance
    }
  });

  it("writes manifest + copies every shim file", async () => {
    // Seed .mandu/client/ with fresh built shim files (simulate a
    // successful `buildVendorShims` run).
    const outDir = path.join(rootDir, ".mandu", "client");
    mkdirSync(outDir, { recursive: true });
    const reactAbs = writeShimFile(rootDir, ".mandu/client/_react.js", makeShim("react"));
    const refreshAbs = writeShimFile(
      rootDir,
      ".mandu/client/_vendor-react-refresh.js",
      makeShim("refresh"),
    );

    const entries: VendorCacheWriteEntry[] = [
      { logicalId: "react", absPath: reactAbs },
      { logicalId: "react-refresh-runtime", absPath: refreshAbs },
    ];

    const ok = await writeVendorCache(rootDir, BASELINE_KEYS, entries);
    expect(ok).toBe(true);

    // Manifest must exist at the right location.
    const manifestPath = path.join(
      rootDir,
      VENDOR_CACHE_DIR,
      VENDOR_CACHE_FILENAME,
    );
    const { readFileSync, existsSync } = await import("node:fs");
    expect(existsSync(manifestPath)).toBe(true);

    const parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as VendorCacheManifest;
    expect(parsed.version).toBe(1);
    expect(parsed.bunVersion).toBe(BASELINE_KEYS.bunVersion);
    expect(parsed.entries.react).toBeDefined();
    expect(parsed.entries["react-refresh-runtime"]).toBeDefined();

    // Round-trip: re-read should hit.
    const result = await readVendorCache(rootDir, BASELINE_KEYS);
    expect(result.kind).toBe("hit");
  });

  it("skips entries whose source file is missing; still writes if at least one survived", async () => {
    const outDir = path.join(rootDir, ".mandu", "client");
    mkdirSync(outDir, { recursive: true });
    const reactAbs = writeShimFile(rootDir, ".mandu/client/_react.js", makeShim("react"));

    const entries: VendorCacheWriteEntry[] = [
      { logicalId: "react", absPath: reactAbs },
      // The second entry points at a non-existent file — writeVendorCache
      // should skip it and still write the manifest for `react`.
      {
        logicalId: "react-refresh-runtime",
        absPath: path.join(rootDir, ".mandu/client/MISSING.js"),
      },
    ];

    const ok = await writeVendorCache(rootDir, BASELINE_KEYS, entries);
    expect(ok).toBe(true);

    const result = await readVendorCache(rootDir, BASELINE_KEYS);
    expect(result.kind).toBe("hit");
    if (result.kind === "hit") {
      expect(Object.keys(result.manifest.entries)).toContain("react");
      expect(Object.keys(result.manifest.entries)).not.toContain(
        "react-refresh-runtime",
      );
    }
  });

  it("empty entry list → returns false (does not write a stub manifest)", async () => {
    const ok = await writeVendorCache(rootDir, BASELINE_KEYS, []);
    expect(ok).toBe(false);

    // No manifest should exist.
    const { existsSync } = await import("node:fs");
    const manifestPath = path.join(
      rootDir,
      VENDOR_CACHE_DIR,
      VENDOR_CACHE_FILENAME,
    );
    expect(existsSync(manifestPath)).toBe(false);
  });
});

describe("vendor-cache — restore path", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "mandu-vendor-cache-r-"));
  });

  afterEach(() => {
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // Windows lock tolerance
    }
  });

  it("restores every cached shim into outDir and returns the path map", async () => {
    const manifest = seedCache(rootDir);
    const outDir = path.join(rootDir, ".mandu", "client");

    const map = await restoreVendorCache(rootDir, manifest, outDir);
    expect(map).not.toBeNull();
    expect(map!.size).toBe(7);

    for (const logicalId of Object.keys(manifest.entries)) {
      const dst = map!.get(logicalId);
      expect(dst).toBeDefined();
      const { existsSync } = await import("node:fs");
      expect(existsSync(dst!)).toBe(true);
    }
  });

  it("returns null when a cached file is missing mid-restore", async () => {
    const manifest = seedCache(rootDir);
    // Remove one of the source files the manifest still references.
    rmSync(path.join(rootDir, VENDOR_CACHE_DIR, "_jsx-runtime.js"));

    const outDir = path.join(rootDir, ".mandu", "client");
    const map = await restoreVendorCache(rootDir, manifest, outDir);
    expect(map).toBeNull();
  });
});

describe("vendor-cache — key resolution regression", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "mandu-vendor-cache-k-"));
  });

  afterEach(() => {
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // Windows lock tolerance
    }
  });

  it("resolveVendorCacheKeys: returns well-formed keys without throwing", async () => {
    // The resolver walks up from `rootDir` looking for
    // `node_modules/<pkg>/package.json`. Depending on where the
    // tmpdir lives (same drive / filesystem as the monorepo or not)
    // it may either (a) fall back to "unknown" (no node_modules on
    // the way up) or (b) find a hoisted package in a parent. Either
    // outcome is correct — the contract is "no throw, string
    // result". We assert exactly that and nothing more brittle.
    const { resolveVendorCacheKeys } = await import("../vendor-cache");
    const keys = await resolveVendorCacheKeys(rootDir);

    expect(typeof keys.bunVersion).toBe("string");
    expect(keys.bunVersion.length).toBeGreaterThan(0);

    expect(typeof keys.reactVersion).toBe("string");
    expect(typeof keys.reactDomVersion).toBe("string");
    expect(typeof keys.reactRefreshVersion).toBe("string");

    // @mandujs/core: workspace dev resolves via monorepo walk, published
    // install resolves via node_modules. Either way it should be
    // non-empty — this project lives in the monorepo so we expect a
    // semver-ish version from packages/core/package.json.
    expect(keys.manduCoreVersion.length).toBeGreaterThan(0);
    expect(keys.manduCoreVersion).not.toBe("unknown");
  });
});
