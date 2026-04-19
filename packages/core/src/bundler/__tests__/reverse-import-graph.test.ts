/**
 * #189 — Unit coverage for the reverse import-graph invalidation.
 *
 * Three classes of tests:
 *   1. Pure in-memory graph (BFS closure, cycles, diamond, depth cap).
 *   2. Import scanner (regex over ESM import patterns, dynamic imports,
 *      barrel re-exports).
 *   3. Integration — `startDevBundler` dispatches an unknown-file change
 *      through the transitive-importer path so a deep leaf edit shows up
 *      as an `onSSRChange` call for its ancestor root.
 *
 * Category 1 is pure and runs unconditionally. Category 3 shares the
 * bundler-startup gate with `dev-reliability.test.ts` to avoid the
 * `Bun.build` cross-worker race pattern.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  ReverseImportGraph,
  scanFileImports,
  DEFAULT_MAX_CLOSURE_DEPTH,
  extractImportSpecifiers,
  resolveRelativeImport,
} from "../reverse-import-graph";
import { startDevBundler, SSR_CHANGE_WILDCARD } from "../dev";
import type { RoutesManifest } from "../../spec/schema";

// -----------------------------------------------------------------------------
// Pure graph coverage — no fs, no bundler startup
// -----------------------------------------------------------------------------

describe("ReverseImportGraph — pure graph operations", () => {
  // Reproduce the exact normalization `ReverseImportGraph` applies so
  // tests can assert against the stored key shape (forward slashes,
  // lowercased on win32).
  const normalizedKey = (p: string): string => {
    const abs = path.resolve(p).replace(/\\/g, "/");
    return process.platform === "win32" ? abs.toLowerCase() : abs;
  };

  it("records a single edge and exposes it via directImporters", () => {
    const g = new ReverseImportGraph();
    const barrel = path.resolve("/abs/barrel.ts");
    const leaf = path.resolve("/abs/leaf.ts");
    g.update(barrel, [leaf]);

    const direct = g.directImporters(leaf);
    expect(direct.has(normalizedKey(barrel))).toBe(true);
  });

  it("transitiveImporters walks a diamond without duplicates", () => {
    const g = new ReverseImportGraph();
    const leaf = path.resolve("/abs/leaf.ts");
    const left = path.resolve("/abs/left.ts");
    const right = path.resolve("/abs/right.ts");
    const top = path.resolve("/abs/top.ts");

    // top -> left -> leaf
    // top -> right -> leaf
    g.update(left, [leaf]);
    g.update(right, [leaf]);
    g.update(top, [left, right]);

    const closure = g.transitiveImporters(leaf);
    expect(closure.has(normalizedKey(left))).toBe(true);
    expect(closure.has(normalizedKey(right))).toBe(true);
    expect(closure.has(normalizedKey(top))).toBe(true);
    // The target itself is never in its own closure.
    expect(closure.has(normalizedKey(leaf))).toBe(false);
    expect(closure.size).toBe(3);
  });

  it("transitiveImporters handles simple cycles without looping", () => {
    const g = new ReverseImportGraph();
    const a = path.resolve("/abs/a.ts");
    const b = path.resolve("/abs/b.ts");
    const c = path.resolve("/abs/c.ts");

    // a -> b -> c -> a (cycle). Ask: who imports c?
    g.update(a, [b]);
    g.update(b, [c]);
    g.update(c, [a]);

    const closure = g.transitiveImporters(c);
    // Every node except c itself reaches c transitively.
    expect(closure.size).toBe(2);
  });

  it("honors maxDepth cap — depth 1 returns only direct importers", () => {
    const g = new ReverseImportGraph();
    const leaf = path.resolve("/abs/leaf.ts");
    const lvl1 = path.resolve("/abs/lvl1.ts");
    const lvl2 = path.resolve("/abs/lvl2.ts");
    const lvl3 = path.resolve("/abs/lvl3.ts");
    g.update(lvl1, [leaf]);
    g.update(lvl2, [lvl1]);
    g.update(lvl3, [lvl2]);

    const direct = g.transitiveImporters(leaf, 1);
    expect(direct.size).toBe(1);

    const twoHop = g.transitiveImporters(leaf, 2);
    expect(twoHop.size).toBe(2);

    // Default depth suffices for 3 hops.
    const full = g.transitiveImporters(leaf, DEFAULT_MAX_CLOSURE_DEPTH);
    expect(full.size).toBe(3);
  });

  it("treats depth 0 / negative as a no-op", () => {
    const g = new ReverseImportGraph();
    const leaf = path.resolve("/abs/leaf.ts");
    const top = path.resolve("/abs/top.ts");
    g.update(top, [leaf]);
    expect(g.transitiveImporters(leaf, 0).size).toBe(0);
    expect(g.transitiveImporters(leaf, -1).size).toBe(0);
  });

  it("update replaces stale outgoing edges without leaking", () => {
    const g = new ReverseImportGraph();
    const importer = path.resolve("/abs/i.ts");
    const oldDep = path.resolve("/abs/old.ts");
    const newDep = path.resolve("/abs/new.ts");

    g.update(importer, [oldDep]);
    g.update(importer, [newDep]);

    // Stale entry must not resurface in the reverse index.
    expect(g.directImporters(oldDep).size).toBe(0);
    expect(g.directImporters(newDep).size).toBe(1);
  });

  it("remove drops a single importer and its reverse edges", () => {
    const g = new ReverseImportGraph();
    const leaf = path.resolve("/abs/leaf.ts");
    const a = path.resolve("/abs/a.ts");
    const b = path.resolve("/abs/b.ts");
    g.update(a, [leaf]);
    g.update(b, [leaf]);

    expect(g.directImporters(leaf).size).toBe(2);
    g.remove(a);
    expect(g.directImporters(leaf).size).toBe(1);
  });

  it("drops a self-import without creating a trivial cycle", () => {
    const g = new ReverseImportGraph();
    const self = path.resolve("/abs/self.ts");
    g.update(self, [self]);
    // Self-edge rejected at insert time → no importer recorded.
    expect(g.directImporters(self).size).toBe(0);
    expect(g.transitiveImporters(self).size).toBe(0);
  });

  it("clear() drops every tracked edge", () => {
    const g = new ReverseImportGraph();
    g.update(path.resolve("/a.ts"), [path.resolve("/b.ts")]);
    g.update(path.resolve("/c.ts"), [path.resolve("/d.ts")]);
    expect(g.size).toBe(2);
    g.clear();
    expect(g.size).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// Import scanner coverage
// -----------------------------------------------------------------------------

describe("extractImportSpecifiers — regex scanner", () => {
  it("matches plain `import from` statements", () => {
    const src = `import foo from "./a";\nimport { b } from "./b";\n`;
    const specs = extractImportSpecifiers(src);
    expect(specs).toContain("./a");
    expect(specs).toContain("./b");
  });

  it("matches side-effect-only imports", () => {
    const src = `import "./side-effects";\n`;
    const specs = extractImportSpecifiers(src);
    expect(specs).toContain("./side-effects");
  });

  it("matches type-only imports", () => {
    const src = `import type { Foo } from "./types";\n`;
    const specs = extractImportSpecifiers(src);
    expect(specs).toContain("./types");
  });

  it("matches `export from` re-exports (barrel pattern)", () => {
    const src = `export * from "./en";\nexport { greet } from "./ko";\n`;
    const specs = extractImportSpecifiers(src);
    expect(specs).toContain("./en");
    expect(specs).toContain("./ko");
  });

  it("matches dynamic import calls with string literals", () => {
    const src = `const m = await import("./lazy");\n`;
    const specs = extractImportSpecifiers(src);
    expect(specs).toContain("./lazy");
  });

  it("deduplicates repeated specifiers in a single file", () => {
    const src = `import a from "./dup";\nimport b from "./dup";\n`;
    const specs = extractImportSpecifiers(src);
    expect(specs.filter((s) => s === "./dup").length).toBe(1);
  });

  it("ignores bare specifiers at extraction time (filtered at resolve)", () => {
    // extractImportSpecifiers returns raw specifiers. Filtering of
    // bare packages happens inside resolveRelativeImport.
    const src = `import React from "react";\nimport { Core } from "@mandujs/core";\n`;
    const specs = extractImportSpecifiers(src);
    // We expect them present in raw form; the scanner does not judge
    // first-party vs bare.
    expect(specs).toContain("react");
  });
});

describe("resolveRelativeImport — first-party filter + extension search", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "mandu-resolve-"));
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Windows may hold the handle.
    }
  });

  it("rejects bare module specifiers", () => {
    const from = path.join(tmpRoot, "a.ts");
    writeFileSync(from, "");
    expect(resolveRelativeImport(from, "react")).toBeNull();
    expect(resolveRelativeImport(from, "@mandujs/core")).toBeNull();
  });

  it("resolves a sibling .ts file", () => {
    const from = path.join(tmpRoot, "a.ts");
    const sib = path.join(tmpRoot, "b.ts");
    writeFileSync(from, "");
    writeFileSync(sib, "");
    const resolved = resolveRelativeImport(from, "./b");
    expect(resolved).not.toBeNull();
    expect(path.resolve(resolved!)).toBe(path.resolve(sib));
  });

  it("resolves a sibling .tsx file when .ts does not exist", () => {
    const from = path.join(tmpRoot, "a.ts");
    const sib = path.join(tmpRoot, "b.tsx");
    writeFileSync(from, "");
    writeFileSync(sib, "");
    const resolved = resolveRelativeImport(from, "./b");
    expect(resolved).not.toBeNull();
    expect(path.resolve(resolved!)).toBe(path.resolve(sib));
  });

  it("resolves a barrel directory via index.ts", () => {
    const from = path.join(tmpRoot, "a.ts");
    mkdirSync(path.join(tmpRoot, "pkg"));
    const index = path.join(tmpRoot, "pkg/index.ts");
    writeFileSync(from, "");
    writeFileSync(index, "");
    const resolved = resolveRelativeImport(from, "./pkg");
    expect(resolved).not.toBeNull();
    expect(path.resolve(resolved!)).toBe(path.resolve(index));
  });

  it("returns null when the target file does not exist", () => {
    const from = path.join(tmpRoot, "a.ts");
    writeFileSync(from, "");
    expect(resolveRelativeImport(from, "./nonexistent")).toBeNull();
  });
});

describe("scanFileImports — end-to-end", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "mandu-scan-"));
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Windows may hold the handle.
    }
  });

  it("returns absolute paths for resolvable first-party imports only", async () => {
    const a = path.join(tmpRoot, "a.ts");
    const b = path.join(tmpRoot, "b.ts");
    writeFileSync(
      a,
      `import React from "react";\nimport { x } from "./b";\nimport "./missing";\n`,
    );
    writeFileSync(b, "export const x = 1;\n");

    const imports = await scanFileImports(a);
    expect(imports.length).toBe(1);
    expect(path.resolve(imports[0])).toBe(path.resolve(b));
  });

  it("returns [] for an unreadable / missing file", async () => {
    const missing = path.join(tmpRoot, "does-not-exist.ts");
    const imports = await scanFileImports(missing);
    expect(imports).toEqual([]);
  });

  it("captures a 3-deep chain (barrel -> module -> leaf)", async () => {
    const leaf = path.join(tmpRoot, "leaf.ts");
    const middle = path.join(tmpRoot, "middle.ts");
    const barrel = path.join(tmpRoot, "barrel.ts");
    writeFileSync(leaf, "export const v = 1;\n");
    writeFileSync(middle, `export { v } from "./leaf";\n`);
    writeFileSync(barrel, `import { v } from "./middle";\nexport { v };\n`);

    // Each hop should scan to exactly one outgoing edge.
    const barrelImports = await scanFileImports(barrel);
    expect(barrelImports.length).toBe(1);
    expect(path.resolve(barrelImports[0])).toBe(path.resolve(middle));

    const middleImports = await scanFileImports(middle);
    expect(middleImports.length).toBe(1);
    expect(path.resolve(middleImports[0])).toBe(path.resolve(leaf));
  });
});

// -----------------------------------------------------------------------------
// Integration — transitive dispatch through startDevBundler
// -----------------------------------------------------------------------------

/**
 * Minimum time (ms) to wait after a writeFile for fs.watch + debounce
 * to flush. Mirrors `dev-reliability.test.ts`'s WATCH_SETTLE_MS so
 * Windows polling latency is tolerated.
 */
const WATCH_SETTLE_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTempProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "mandu-189-"));
  mkdirSync(path.join(root, ".mandu"), { recursive: true });
  mkdirSync(path.join(root, ".mandu/client"), { recursive: true });
  writeFileSync(
    path.join(root, ".mandu/manifest.json"),
    JSON.stringify(
      {
        version: 1,
        buildTime: new Date().toISOString(),
        env: "development",
        bundles: {},
        shared: {
          runtime: "/.mandu/client/runtime.js",
          vendor: "/.mandu/client/vendor.js",
        },
      },
      null,
      2,
    ),
  );
  mkdirSync(path.join(root, "app"), { recursive: true });
  // Barrel + leaf pattern — the canonical #189 scenario. The leaf lives
  // OUTSIDE any default common-dir so the pre-#189 watcher would not
  // have dispatched it.
  mkdirSync(path.join(root, "app/_utils/translations"), { recursive: true });
  writeFileSync(
    path.join(root, "app/_utils/translations/ko.ts"),
    'export const greeting = "안녕";\n',
  );
  writeFileSync(
    path.join(root, "app/_utils/translations/en.ts"),
    'export const greeting = "Hello";\n',
  );
  writeFileSync(
    path.join(root, "app/_utils/translations/index.ts"),
    `import { greeting as ko } from "./ko";\nimport { greeting as en } from "./en";\nexport const translations = { ko, en };\n`,
  );
  writeFileSync(
    path.join(root, "app/page.tsx"),
    `import { translations } from "./_utils/translations";\nexport default function Page() { return null; }\n`,
  );
  return root;
}

describe.skipIf(process.env.MANDU_SKIP_BUNDLER_TESTS === "1")(
  "#189 — reverse import-graph invalidation (integration)",
  () => {
    let rootDir: string;
    let close: (() => void) | null = null;

    beforeEach(() => {
      rootDir = createTempProject();
    });

    afterEach(() => {
      close?.();
      close = null;
      try {
        rmSync(rootDir, { recursive: true, force: true });
      } catch {
        // Windows may hold handles.
      }
    });

    it("leaf edit outside common-dir still invalidates the SSR root (barrel + static map)", async () => {
      const ssrCalls: string[] = [];

      const manifest: RoutesManifest = {
        version: 1,
        routes: [
          {
            id: "page",
            kind: "page",
            pattern: "/",
            module: "app/page.tsx",
            componentModule: "app/page.tsx",
          },
        ],
      } as unknown as RoutesManifest;

      const bundler = await startDevBundler({
        rootDir,
        manifest,
        onSSRChange: (filePath) => {
          ssrCalls.push(filePath);
        },
      });
      close = bundler.close;

      // Give the seedReverseGraph fire-and-forget a chance to finish.
      // The seed is O(|routes| * fs.readFile) which on a 2-route
      // manifest completes in <50 ms on any dev machine.
      await sleep(100);

      // Deep leaf edit — NOT in any known root set, NOT in a default
      // common dir (`app/` isn't a common dir by default).
      writeFileSync(
        path.join(rootDir, "app/_utils/translations/ko.ts"),
        'export const greeting = "안녕하세요";\n',
      );

      await sleep(WATCH_SETTLE_MS);

      // The leaf change should reach onSSRChange via the
      // barrel -> page.tsx transitive chain. The callback is
      // invoked with the normalized absolute path of page.tsx
      // (the SSR root that imports the barrel).
      const normalizedPage =
        process.platform === "win32"
          ? path
              .resolve(rootDir, "app/page.tsx")
              .replace(/\\/g, "/")
              .toLowerCase()
          : path.resolve(rootDir, "app/page.tsx").replace(/\\/g, "/");

      expect(ssrCalls.length).toBeGreaterThanOrEqual(1);
      // Exact path match — defensive so a future refactor that loses
      // the normalization surfaces here, not in production.
      expect(ssrCalls).toContain(normalizedPage);
    });

    it("emits no transitive dispatch for a genuinely unrelated file", async () => {
      const ssrCalls: string[] = [];

      const manifest: RoutesManifest = {
        version: 1,
        routes: [
          {
            id: "page",
            kind: "page",
            pattern: "/",
            module: "app/page.tsx",
            componentModule: "app/page.tsx",
          },
        ],
      } as unknown as RoutesManifest;

      const bundler = await startDevBundler({
        rootDir,
        manifest,
        onSSRChange: (filePath) => {
          // Wildcard common-dir fires too — we only care about the
          // specific-path dispatch here.
          if (filePath !== SSR_CHANGE_WILDCARD) ssrCalls.push(filePath);
        },
      });
      close = bundler.close;
      await sleep(100);

      // Write a brand-new file that nothing imports. Has to live
      // UNDER a watched directory for the watcher to see it at all;
      // `app/` is covered because `page.tsx` itself is there.
      const orphan = path.join(rootDir, "app/orphan.ts");
      writeFileSync(orphan, "export const NOTHING = 1;\n");

      await sleep(WATCH_SETTLE_MS);

      // No known importer → legacy silent-drop → zero SSR calls with
      // the orphan's path. (Some platforms may emit spurious
      // wildcard fires for unrelated file-system noise; we already
      // filtered those.)
      const normalizedOrphan =
        process.platform === "win32"
          ? orphan.replace(/\\/g, "/").toLowerCase()
          : orphan.replace(/\\/g, "/");
      expect(ssrCalls).not.toContain(normalizedOrphan);
    });
  },
);
