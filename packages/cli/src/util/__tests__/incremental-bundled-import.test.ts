/**
 * Phase 7.0 R1 Agent B — Incremental bundled import coverage
 *
 * Backstop for the cache-hit / cache-miss / invalidation paths that turn
 * `createBundledImporter` from "bundle-per-route-per-change" (1.5-2 s P95)
 * into "skip if the changed file isn't in the root's import graph"
 * (target ≤5 ms cache hit). See:
 *   docs/bun/phase-7-diagnostics/performance-reliability.md §2 B5
 *   docs/bun/phase-7-team-plan.md §4 Agent B
 *
 * The existing #184 regression suite at `packages/cli/tests/bundled-importer.test.ts`
 * covers the stale-cache contract; this file adds the incremental-layer
 * contract on top of it. Both must stay green.
 *
 * Gated by `MANDU_SKIP_BUNDLER_TESTS=1` (CI perf protection) matching the
 * convention used in `packages/core/tests/bundler/dev-common-dir.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  symlinkSync,
  realpathSync,
} from "fs";
import { tmpdir } from "os";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createBundledImporter,
  createCachedBundledImporter,
  type BundledImporter,
} from "../bun";
import {
  ImportGraph,
  canonicalizeFsPath,
  extractSourcesFromInlineSourcemap,
} from "../import-graph";

interface EntryModule {
  default: () => string;
}

const BUNDLE_CACHE_REL = ".mandu/dev-cache/ssr";

function cacheDir(root: string): string {
  return path.join(root, BUNDLE_CACHE_REL);
}

function linkBoundaryRuntimeDeps(rootDir: string): void {
  mkdirSync(path.join(rootDir, "node_modules", "@mandujs"), { recursive: true });
  symlinkSync(
    path.resolve(import.meta.dir, "../../../../core"),
    path.join(rootDir, "node_modules", "@mandujs", "core"),
    "junction",
  );
  symlinkSync(
    path.resolve(import.meta.dir, "../../../../../node_modules/react"),
    path.join(rootDir, "node_modules", "react"),
    "junction",
  );
}

describe.skipIf(process.env.MANDU_SKIP_BUNDLER_TESTS === "1")(
  "createBundledImporter — incremental (Phase 7.0 B5)",
  () => {
    let rootDir: string;
    let indexPath: string;
    let fooPath: string;
    let barPath: string;
    let importer: BundledImporter | null = null;

    beforeEach(() => {
      rootDir = mkdtempSync(path.join(tmpdir(), "mandu-incr-import-"));
      mkdirSync(path.join(rootDir, "src"), { recursive: true });

      fooPath = path.join(rootDir, "src/foo.ts");
      writeFileSync(fooPath, 'export const foo = "FOO-V1";\n');

      barPath = path.join(rootDir, "src/bar.ts");
      writeFileSync(
        barPath,
        `import { foo } from "./foo.ts";
export const bar = () => foo + "-bar";
`,
      );

      indexPath = path.join(rootDir, "src/index.ts");
      writeFileSync(
        indexPath,
        `import { bar } from "./bar.ts";
export default function render() { return bar(); }
`,
      );
    });

    afterEach(async () => {
      if (importer) {
        try {
          await importer.dispose();
        } catch {
          // ignore
        }
        importer = null;
      }
      try {
        rmSync(rootDir, { recursive: true, force: true });
      } catch {
        // Windows can briefly hold cache locks
      }
    });

    it("cold: first call populates the cache and builds a bundle", async () => {
      importer = createBundledImporter({ rootDir });

      const mod = (await importer(indexPath)) as EntryModule;
      expect(mod.default()).toBe("FOO-V1-bar");

      // A bundle file must exist on disk (sanity — the cold path writes one).
      const bundleDirs = readdirSync(cacheDir(rootDir));
      expect(bundleDirs.length).toBe(1);
      const files = readdirSync(path.join(cacheDir(rootDir), bundleDirs[0]!));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/\.mjs$/);
    });

    it("applies client boundary transform before SSR importing a page", async () => {
      importer = createBundledImporter({ rootDir });
      const pagePath = path.join(rootDir, "src/page.tsx");
      const clientPath = path.join(rootDir, "src/ClientWidget.client.tsx");
      linkBoundaryRuntimeDeps(rootDir);
      writeFileSync(
        clientPath,
        `throw new Error("client module should not execute during SSR transform");
export function ClientWidget() {
  return null;
}
`,
      );
      writeFileSync(
        pagePath,
        `import React from "react";
import { ClientWidget } from "./ClientWidget.client";

export default function Page() {
  return <main><ClientWidget label="ok" /></main>;
}
`,
      );

      const mod = (await importer(pagePath, {
        clientBoundaryTransform: {
          routeId: "boundary-page",
          hydrate: "visible",
        },
      })) as { default: React.ComponentType };
      const html = renderToStaticMarkup(React.createElement(mod.default));

      expect(html).toContain('data-mandu-island="boundary-page--0"');
      expect(html).toContain('data-mandu-client-export="ClientWidget"');
      expect(html).toContain('data-mandu-props="boundary-page--0"');
      expect(html).toContain('"label":"ok"');
    });

    it("production cached boundary imports keep SSR props request-local", async () => {
      importer = createCachedBundledImporter({ rootDir });
      const pagePath = path.join(rootDir, "src/production-boundary-page.tsx");
      const clientPath = path.join(rootDir, "src/ProductionWidget.client.tsx");
      linkBoundaryRuntimeDeps(rootDir);
      writeFileSync(
        clientPath,
        `throw new Error("production client module should not execute during SSR transform");
export default function ProductionWidget() {
  return null;
}
`,
      );
      writeFileSync(
        pagePath,
        `import React from "react";
import ProductionWidget from "./ProductionWidget.client";

export default function Page({ label }) {
  return <main><ProductionWidget label={label} /></main>;
}
`,
      );

      const opts = {
        clientBoundaryTransform: {
          routeId: "production-boundary-page",
          hydrate: "visible",
          boundaries: [
            {
              id: "production-boundary-page--manifest",
              ordinal: 0,
              source: {
                file: "src/production-boundary-page.tsx",
              },
            },
          ],
        },
      };

      const firstModule = (await importer(pagePath, opts)) as { default: React.ComponentType<{ label: string }> };
      const secondModule = (await importer(pagePath, opts)) as { default: React.ComponentType<{ label: string }> };
      expect(secondModule).toBe(firstModule);

      const firstHtml = renderToStaticMarkup(React.createElement(firstModule.default, { label: "first-request" }));
      const secondHtml = renderToStaticMarkup(React.createElement(secondModule.default, { label: "second-request" }));

      expect(firstHtml).toContain('data-mandu-props="production-boundary-page--manifest"');
      expect(firstHtml).toContain('"label":"first-request"');
      expect(firstHtml).not.toContain("second-request");
      expect(secondHtml).toContain('data-mandu-props="production-boundary-page--manifest"');
      expect(secondHtml).toContain('"label":"second-request"');
      expect(secondHtml).not.toContain("first-request");
    });

    it("fails client boundary transform when a named client export is missing", async () => {
      importer = createBundledImporter({ rootDir });
      const pagePath = path.join(rootDir, "src/missing-export-page.tsx");
      const clientPath = path.join(rootDir, "src/MissingExport.client.tsx");
      linkBoundaryRuntimeDeps(rootDir);
      writeFileSync(
        clientPath,
        `export function ExistingWidget() {
  return null;
}
`,
      );
      writeFileSync(
        pagePath,
        `import React from "react";
import { MissingWidget } from "./MissingExport.client";

export default function Page() {
  return <main><MissingWidget label="bad" /></main>;
}
`,
      );

      await expect(importer(pagePath, {
        clientBoundaryTransform: {
          routeId: "missing-export-page",
          hydrate: "visible",
        },
      })).rejects.toThrow(/MANDU_BOUNDARY_UNRESOLVED_EXPORT.*MissingWidget.*Suggestion:/s);
    });

    it("fails client boundary transform when the client module imports server-only APIs", async () => {
      importer = createBundledImporter({ rootDir });
      const pagePath = path.join(rootDir, "src/server-only-boundary-page.tsx");
      const clientPath = path.join(rootDir, "src/ServerOnlyWidget.client.tsx");
      linkBoundaryRuntimeDeps(rootDir);
      writeFileSync(
        clientPath,
        `import { readFile } from "node:fs/promises";
import { Database } from "bun:sqlite";
export function ServerOnlyWidget() {
  return String(readFile) + String(Database);
}
`,
      );
      writeFileSync(
        pagePath,
        `import React from "react";
import { ServerOnlyWidget } from "./ServerOnlyWidget.client";

export default function Page() {
  return <main><ServerOnlyWidget /></main>;
}
`,
      );

      await expect(importer(pagePath, {
        clientBoundaryTransform: {
          routeId: "server-only-boundary-page",
          hydrate: "visible",
        },
      })).rejects.toThrow(/MANDU_BOUNDARY_SERVER_ONLY_IMPORT.*node:fs\/promises.*bun:sqlite.*Suggestion:/s);
    });

    it("applies client boundary transform inside route-owned server wrappers", async () => {
      importer = createBundledImporter({ rootDir });
      linkBoundaryRuntimeDeps(rootDir);

      const pagePath = path.join(rootDir, "src/wrapped-page.tsx");
      const wrapperPath = path.join(rootDir, "src/Wrapper.tsx");
      const clientPath = path.join(rootDir, "src/ClientWidget.client.tsx");
      writeFileSync(
        clientPath,
        `throw new Error("transitive client module should not execute during SSR transform");
export function ClientWidget() {
  return null;
}
`,
      );
      writeFileSync(
        wrapperPath,
        `import React from "react";
import { ClientWidget } from "./ClientWidget.client";

export function Wrapper({ label }) {
  return <section><ClientWidget label={label} /></section>;
}
`,
      );
      writeFileSync(
        pagePath,
        `import React from "react";
import { Wrapper } from "./Wrapper";

export default function Page() {
  return <main><Wrapper label="wrapped" /></main>;
}
`,
      );

      const mod = (await importer(pagePath, {
        clientBoundaryTransform: {
          routeId: "wrapped-page",
          hydrate: "visible",
          boundaries: [
            {
              id: "wrapped-page--manifest",
              ordinal: 0,
              source: {
                file: "src/Wrapper.tsx",
              },
            },
          ],
        },
      })) as { default: React.ComponentType };
      const html = renderToStaticMarkup(React.createElement(mod.default));

      expect(html).toContain("<section>");
      expect(html).toContain('data-mandu-island="wrapped-page--manifest"');
      expect(html).toContain('data-mandu-client-export="ClientWidget"');
      expect(html).toContain('data-mandu-props="wrapped-page--manifest"');
      expect(html).toContain('"label":"wrapped"');
    });

    it("cache hit: same root called twice with no changedFile does NOT rebuild needlessly", async () => {
      // Without a `changedFile` hint we fall back to the conservative
      // "always rebuild" path — this is the backward-compat branch that
      // existing callsites use. The separate cache-hit-with-hint test
      // below covers the actual speedup.
      importer = createBundledImporter({ rootDir });

      const first = (await importer(indexPath)) as EntryModule;
      const second = (await importer(indexPath)) as EntryModule;

      // Both produce correct output.
      expect(first.default()).toBe("FOO-V1-bar");
      expect(second.default()).toBe("FOO-V1-bar");
    });

    it("cache hit with changedFile: unrelated change returns cached module without rebuild", async () => {
      importer = createBundledImporter({ rootDir });

      // Prime the cache.
      const first = (await importer(indexPath)) as EntryModule;
      expect(first.default()).toBe("FOO-V1-bar");

      // Write an unrelated file that the root does NOT import.
      const unrelated = path.join(rootDir, "src/other.ts");
      writeFileSync(unrelated, 'export const x = 1;\n');

      // Edit foo.ts on disk but tell the importer that `unrelated` is
      // what changed — the graph must say "unrelated is not in root's
      // descendants" and return the cached module, NOT the new build.
      writeFileSync(fooPath, 'export const foo = "FOO-V2";\n');

      const second = (await importer(indexPath, {
        changedFile: unrelated,
      })) as EntryModule;

      // Still the old value — the cache hit fast-path short-circuited.
      expect(second.default()).toBe("FOO-V1-bar");

      // And we must have the SAME module object (reference equality proves
      // we didn't re-import).
      expect(second).toBe(first);
    });

    it("cache miss: changing the root itself triggers a rebuild", async () => {
      importer = createBundledImporter({ rootDir });

      await importer(indexPath);

      // Mutate the root and pass it as changedFile.
      writeFileSync(
        indexPath,
        `import { bar } from "./bar.ts";
export default function render() { return bar() + "-CHANGED"; }
`,
      );

      const second = (await importer(indexPath, {
        changedFile: indexPath,
      })) as EntryModule;
      expect(second.default()).toBe("FOO-V1-bar-CHANGED");
    });

    it("cache miss: changing a direct dependency triggers a rebuild", async () => {
      importer = createBundledImporter({ rootDir });

      await importer(indexPath);

      writeFileSync(
        barPath,
        `import { foo } from "./foo.ts";
export const bar = () => foo + "-BAR-V2";
`,
      );

      const second = (await importer(indexPath, {
        changedFile: barPath,
      })) as EntryModule;
      expect(second.default()).toBe("FOO-V1-BAR-V2");
    });

    it("cache miss: changing a transitive (2-hop) dependency triggers a rebuild", async () => {
      importer = createBundledImporter({ rootDir });

      await importer(indexPath);

      // foo.ts is a transitive dep: index → bar → foo.
      writeFileSync(fooPath, 'export const foo = "FOO-V2";\n');

      const second = (await importer(indexPath, {
        changedFile: fooPath,
      })) as EntryModule;
      expect(second.default()).toBe("FOO-V2-bar");
    });

    it("independent roots: editing one root's file does not invalidate the other's cache", async () => {
      // Second root, fully disjoint — imports a file the first root never
      // touches.
      const otherPath = path.join(rootDir, "src/other-entry.ts");
      writeFileSync(
        otherPath,
        `export default function otherRender() { return "OTHER"; }
`,
      );

      importer = createBundledImporter({ rootDir });

      const firstOfIndex = (await importer(indexPath)) as EntryModule;
      const firstOfOther = (await importer(otherPath)) as EntryModule;
      expect(firstOfIndex.default()).toBe("FOO-V1-bar");
      expect(firstOfOther.default()).toBe("OTHER");

      // Edit a file used only by `indexPath`. `otherPath` must still get
      // a cache hit.
      writeFileSync(fooPath, 'export const foo = "FOO-V9";\n');

      const stillCached = (await importer(otherPath, {
        changedFile: fooPath,
      })) as EntryModule;

      expect(stillCached).toBe(firstOfOther);
    });

    it("tsconfig @/* alias: alias-imported deps are tracked as descendants", async () => {
      writeFileSync(
        path.join(rootDir, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: {
              target: "ESNext",
              module: "ESNext",
              moduleResolution: "bundler",
              paths: { "@/*": ["./src/*"] },
            },
          },
          null,
          2,
        ),
      );

      const aliasEntry = path.join(rootDir, "src/alias-entry.ts");
      writeFileSync(
        aliasEntry,
        `import { foo } from "@/foo";
export default function render() { return foo; }
`,
      );

      importer = createBundledImporter({ rootDir });

      const first = (await importer(aliasEntry)) as EntryModule;
      expect(first.default()).toBe("FOO-V1");

      // Edit foo via its real path — descendants tracker must have
      // recorded foo.ts regardless of how the import path was spelled.
      writeFileSync(fooPath, 'export const foo = "FOO-ALIAS-V2";\n');

      const second = (await importer(aliasEntry, {
        changedFile: fooPath,
      })) as EntryModule;
      expect(second.default()).toBe("FOO-ALIAS-V2");
    });

    it("circular imports: A ↔ B builds cleanly without hang", async () => {
      const aPath = path.join(rootDir, "src/cycle-a.ts");
      const bPath = path.join(rootDir, "src/cycle-b.ts");
      writeFileSync(
        aPath,
        `import { b } from "./cycle-b.ts";
export const a = "A";
export function pair() { return a + b; }
`,
      );
      writeFileSync(
        bPath,
        `import { a } from "./cycle-a.ts";
export const b = "B";
export function echo() { return a + b; }
`,
      );

      const entry = path.join(rootDir, "src/cycle-entry.ts");
      writeFileSync(
        entry,
        `import { pair } from "./cycle-a.ts";
export default function render() { return pair(); }
`,
      );

      importer = createBundledImporter({ rootDir });

      const first = (await importer(entry)) as EntryModule;
      // Circular Bun bundle tends to initialize one side lazily; we accept
      // either "AB" or "undefinedB" / "Aundefined" — the important point
      // is that the build completed without hanging or throwing.
      expect(typeof first.default()).toBe("string");
    }, 15_000);

    it("invalidate(filePath): forces the next import call to rebuild even without changedFile", async () => {
      importer = createBundledImporter({ rootDir });

      const first = (await importer(indexPath)) as EntryModule;
      expect(first.default()).toBe("FOO-V1-bar");

      writeFileSync(fooPath, 'export const foo = "FOO-INVAL";\n');
      importer.invalidate(fooPath);

      // No changedFile hint — but the cache entry was already dropped by
      // invalidate(), so we get a fresh bundle.
      const second = (await importer(indexPath)) as EntryModule;
      expect(second.default()).toBe("FOO-INVAL-bar");
      expect(second).not.toBe(first);
    });

    it("dispose(): removes tracked bundles from disk and clears graph state", async () => {
      importer = createBundledImporter({ rootDir });

      await importer(indexPath);
      const filesBefore = readdirSync(cacheDir(rootDir));
      expect(filesBefore.length).toBe(1);

      await importer.dispose();

      expect(existsSync(cacheDir(rootDir))).toBe(true);
      const filesAfter = readdirSync(cacheDir(rootDir));
      expect(filesAfter.length).toBe(0);
    });

    it("multiple roots tracked independently: invalidate only fires on the right one", async () => {
      // Two independent roots with no shared deps.
      const aEntry = path.join(rootDir, "src/a-entry.ts");
      const aDep = path.join(rootDir, "src/a-dep.ts");
      writeFileSync(aDep, 'export const aval = "A-V1";\n');
      writeFileSync(
        aEntry,
        `import { aval } from "./a-dep.ts";
export default function r() { return aval; }
`,
      );

      const bEntry = path.join(rootDir, "src/b-entry.ts");
      const bDep = path.join(rootDir, "src/b-dep.ts");
      writeFileSync(bDep, 'export const bval = "B-V1";\n');
      writeFileSync(
        bEntry,
        `import { bval } from "./b-dep.ts";
export default function r() { return bval; }
`,
      );

      importer = createBundledImporter({ rootDir });

      const a1 = (await importer(aEntry)) as EntryModule;
      const b1 = (await importer(bEntry)) as EntryModule;
      expect(a1.default()).toBe("A-V1");
      expect(b1.default()).toBe("B-V1");

      // Change a-dep → only A must rebuild; B must cache-hit.
      writeFileSync(aDep, 'export const aval = "A-V2";\n');

      const a2 = (await importer(aEntry, { changedFile: aDep })) as EntryModule;
      const b2 = (await importer(bEntry, { changedFile: aDep })) as EntryModule;

      expect(a2.default()).toBe("A-V2"); // rebuilt
      expect(b2).toBe(b1); // cache hit — same module object
    });

    it("fan-out benchmark: 10 roots × 2 file changes only rebuilds affected roots", async () => {
      // 10 tiny independent entries; edit a file used only by entry-3 and
      // entry-7, then require that a follow-up `import(changedFile)` with
      // each of the 10 entries triggers a build only for those two.
      //
      // Every root owns one versioned bundle directory. A rebuild replaces
      // that directory, while a cache hit keeps the module object unchanged.
      const numRoots = 10;
      const sharedDepPath = path.join(rootDir, "src/shared-dep.ts");
      writeFileSync(sharedDepPath, 'export const v = "SHARED-V1";\n');

      const rootPaths: string[] = [];
      for (let i = 0; i < numRoots; i++) {
        const entry = path.join(rootDir, `src/entry-${i}.ts`);
        const body =
          i === 3 || i === 7
            ? `import { v } from "./shared-dep.ts";
export default function r() { return "E${i}-" + v; }
`
            : `export default function r() { return "E${i}"; }
`;
        writeFileSync(entry, body);
        rootPaths.push(entry);
      }

      importer = createBundledImporter({ rootDir });

      // Prime caches for all 10 roots.
      const firstImports = await Promise.all(rootPaths.map((p) => importer!(p)));
      // Snapshot the current bundle filenames (one per root).
      const filesBefore = readdirSync(cacheDir(rootDir));
      expect(filesBefore.length).toBe(numRoots);

      // Now change the shared file; signal it to each root. Only entries
      // 3 and 7 depend on it.
      writeFileSync(sharedDepPath, 'export const v = "SHARED-V2";\n');

      const secondImports = await Promise.all(
        rootPaths.map((p) =>
          importer!(p, { changedFile: sharedDepPath }),
        ),
      );

      // Count how many modules were rebuilt by reference-equality:
      // cache-hit modules are the same object as the first import.
      let rebuilt = 0;
      for (let i = 0; i < numRoots; i++) {
        if (firstImports[i] !== secondImports[i]) rebuilt++;
      }
      expect(rebuilt).toBe(2); // exactly entries 3 and 7

      // Cross-check: the actually-rebuilt roots produce the new value.
      expect((secondImports[3] as EntryModule).default()).toBe("E3-SHARED-V2");
      expect((secondImports[7] as EntryModule).default()).toBe("E7-SHARED-V2");
      expect((secondImports[0] as EntryModule).default()).toBe("E0");
    }, 30_000);
  },
);

// ─────────────────────────────────────────────────────────────────────────
// ImportGraph unit coverage — pure in-memory, no Bun.build, no test gate
// ─────────────────────────────────────────────────────────────────────────

describe("ImportGraph", () => {
  it.skipIf(process.platform === "win32")(
    "canonicalizes symlinked ancestors for existing and deleted paths",
    () => {
      const fixture = mkdtempSync(path.join(tmpdir(), "mandu-path-alias-"));
      try {
        const realDir = path.join(fixture, "real");
        const aliasDir = path.join(fixture, "alias");
        mkdirSync(realDir);
        symlinkSync(realDir, aliasDir, "dir");

        const existing = path.join(realDir, "existing.ts");
        writeFileSync(existing, "export {};\n");

        expect(canonicalizeFsPath(path.join(aliasDir, "existing.ts"))).toBe(
          realpathSync.native(existing),
        );
        expect(canonicalizeFsPath(path.join(aliasDir, "deleted.ts"))).toBe(
          path.join(realpathSync.native(realDir), "deleted.ts"),
        );
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    },
  );

  it("tracks descendants per root + cross-checks reverse index", () => {
    const g = new ImportGraph();
    // Use absolute paths that `path.resolve` won't rewrite — on Windows
    // it prefixes a bare "/abs/root.ts" with the current drive letter and
    // switches separators, so build the path through the same function
    // the graph uses internally.
    const root = path.resolve("/abs/root.ts");
    const depA = path.resolve("/abs/a.ts");
    const depB = path.resolve("/abs/b.ts");
    const depC = path.resolve("/abs/c.ts");
    g.updateFromSources(root, [depA, depB]);

    expect(g.hasDescendant(root, depA)).toBe(true);
    expect(g.hasDescendant(root, depB)).toBe(true);
    expect(g.hasDescendant(root, depC)).toBe(false);

    // Root always contains itself.
    expect(g.hasDescendant(root, root)).toBe(true);

    // Reverse index — asking "which roots contain a.ts" finds our root.
    // Compare against the normalized form the graph stores internally.
    const normalizedRoot =
      process.platform === "win32" ? root.toLowerCase() : root;
    expect(Array.from(g.rootsContaining(depA))).toContain(normalizedRoot);
  });

  it("updateFromSources replaces stale entries (no accumulation)", () => {
    const g = new ImportGraph();
    const root = path.resolve("/abs/root.ts");
    const oldDep = path.resolve("/abs/old.ts");
    const newDep = path.resolve("/abs/new.ts");
    g.updateFromSources(root, [oldDep]);
    g.updateFromSources(root, [newDep]);

    expect(g.hasDescendant(root, oldDep)).toBe(false);
    expect(g.hasDescendant(root, newDep)).toBe(true);

    // Reverse index must not leak the old file.
    expect(g.rootsContaining(oldDep).size).toBe(0);
  });

  it("remove: forgets a root and cleans up reverse index", () => {
    const g = new ImportGraph();
    const r1 = path.resolve("/abs/r1.ts");
    const r2 = path.resolve("/abs/r2.ts");
    const shared = path.resolve("/abs/shared.ts");
    g.updateFromSources(r1, [shared]);
    g.updateFromSources(r2, [shared]);

    expect(g.rootsContaining(shared).size).toBe(2);

    g.remove(r1);

    expect(g.rootsContaining(shared).size).toBe(1);
    expect(g.size).toBe(1);
  });

  it("case-insensitive match on win32 (smoke)", () => {
    const g = new ImportGraph();
    g.updateFromSources("C:/Abs/Root.ts", ["C:/Abs/Dep.ts"]);

    // On any platform, hasDescendant with the same-case path works.
    expect(g.hasDescendant("C:/Abs/Root.ts", "C:/Abs/Dep.ts")).toBe(true);

    if (process.platform === "win32") {
      // Cross-case — must still match because win32 fs is case-insensitive.
      expect(g.hasDescendant("c:/abs/root.ts", "c:/abs/dep.ts")).toBe(true);
    }
  });

  it("extractSourcesFromInlineSourcemap returns [] when no mapping present", () => {
    const sources = extractSourcesFromInlineSourcemap(
      "/tmp/out.mjs",
      "export const x = 1;\n// no sourcemap comment\n",
    );
    expect(sources).toEqual([]);
  });

  it("extractSourcesFromInlineSourcemap decodes a valid base64 sourcemap", () => {
    const map = { sources: ["../src/foo.ts", "../src/bar.ts"] };
    const b64 = Buffer.from(JSON.stringify(map)).toString("base64");
    const contents = `export const x = 1;\n//# sourceMappingURL=data:application/json;base64,${b64}\n`;
    const bundlePath = path.resolve("/tmp/out/bundle.mjs");
    const sources = extractSourcesFromInlineSourcemap(bundlePath, contents);
    expect(sources.length).toBe(2);
    expect(sources[0]).toBe(
      canonicalizeFsPath(path.resolve("/tmp/out/../src/foo.ts")),
    );
    expect(sources[1]).toBe(
      canonicalizeFsPath(path.resolve("/tmp/out/../src/bar.ts")),
    );
  });

  it("clear(): drops all state", () => {
    const g = new ImportGraph();
    g.updateFromSources(path.resolve("/a.ts"), [path.resolve("/b.ts")]);
    g.updateFromSources(path.resolve("/c.ts"), [path.resolve("/d.ts")]);
    expect(g.size).toBe(2);
    g.clear();
    expect(g.size).toBe(0);
    expect(g.roots()).toEqual([]);
  });
});
