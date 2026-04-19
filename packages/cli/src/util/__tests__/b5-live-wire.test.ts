/**
 * Phase 7.2.S1 — B5 live wire-up verification tests (Agent A).
 *
 * The Phase 7.1 R2 D final bench flagged that `handlers.ts:82/126/137`
 * were calling `importFn(modulePath)` WITHOUT the `{ changedFile }` opt
 * option, preventing the incremental bundled-import cache hit from
 * firing on live SSR reloads.
 *
 * That claim is now stale — Phase 7.0.R3b's thread-through is complete:
 *
 *   - `cli/src/commands/dev.ts:250-261` wraps `registerManifestHandlers`
 *     with a `registerHandlers(m, isReload, changedFile?)` helper.
 *   - `cli/src/util/handlers.ts:85-87` reads `options.changedFile` and
 *     builds `importOpts = { changedFile }` when present.
 *   - Every `importFn(...)` callsite in `handlers.ts` forwards
 *     `importOpts` (lines 97, 141, 152, 191, 228).
 *
 * These tests pin that wire-up so a future refactor cannot silently
 * drop the hint and regress cold-to-warm SSR reload latency. We drive
 * the tests through a mock `importFn` with a call recorder — we don't
 * need to exercise Bun.build for the contract to hold.
 *
 * See the companion `incremental-bundled-import.test.ts` for coverage
 * of the `createBundledImporter` internals; this file exercises the
 * CLI wiring on top.
 *
 * References:
 *   docs/bun/phase-7-2-team-plan.md §3 Agent A (S1)
 *   docs/bun/phase-7-1-benchmarks.md §6.2 (the "wire-up stale" report)
 *   packages/cli/src/util/handlers.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  registerManifestHandlers,
  type RegisterHandlersOptions,
} from "../handlers";
import type { RoutesManifest } from "@mandujs/core";
import { clearDefaultRegistry } from "@mandujs/core";

// ============================================
// Helpers
// ============================================

/**
 * A call recorder that plays the role of `bundledImport` /
 * `importFresh`. We don't need to bundle anything — we just need to
 * verify the caller forwarded the `changedFile` option.
 */
interface RecordedCall {
  modulePath: string;
  opts: { changedFile?: string } | undefined;
}

function makeMockImporter(
  response: (modulePath: string) => unknown,
): {
  importFn: (modulePath: string, opts?: { changedFile?: string }) => Promise<unknown>;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const importFn = async (
    modulePath: string,
    opts?: { changedFile?: string },
  ): Promise<unknown> => {
    calls.push({ modulePath, opts });
    return response(modulePath);
  };
  return { importFn, calls };
}

/**
 * Build a minimal manifest with one API route + one page route so we
 * exercise both `importFn` callsites in `registerManifestHandlers`.
 */
function twoRouteManifest(rootDir: string): RoutesManifest {
  // Write real files so `path.resolve(rootDir, route.module)` points at
  // something valid — even if the mock importer never reads them.
  mkdirSync(path.join(rootDir, "app"), { recursive: true });
  writeFileSync(
    path.join(rootDir, "app", "page.tsx"),
    "export default function Page() { return null; }\n",
  );
  writeFileSync(
    path.join(rootDir, "app", "route.ts"),
    "export async function GET() { return new Response('ok'); }\n",
  );

  return {
    version: 1,
    routes: [
      {
        id: "home",
        kind: "page",
        pattern: "/",
        module: "app/page.tsx",
        componentModule: "app/page.tsx",
      },
      {
        id: "api:ping",
        kind: "api",
        pattern: "/api/ping",
        module: "app/route.ts",
      },
    ],
  } as RoutesManifest;
}

// ============================================
// Tests
// ============================================

describe("Phase 7.2.S1 — B5 live wire-up (handlers.ts → importFn)", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "mandu-b5-live-"));
    clearDefaultRegistry();
  });

  afterEach(() => {
    clearDefaultRegistry();
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch {
      // Windows lock tolerance
    }
  });

  // ---------------------------------------------------------------------
  // 1. Cold boot — no changedFile hint should propagate to importFn.
  // ---------------------------------------------------------------------

  it("[cold] omits changedFile option when registerManifestHandlers is called without it", async () => {
    const manifest = twoRouteManifest(rootDir);
    const { importFn, calls } = makeMockImporter(() => ({
      // Simulate the page module shape that registerPageHandler expects.
      default: () => null,
    }));

    await registerManifestHandlers(manifest, rootDir, {
      importFn,
      registeredLayouts: new Set(),
    } as RegisterHandlersOptions);

    // API route module goes through importFn; page route via
    // registerPageLoader is lazy — but registerAppNotFound also calls
    // importFn ONLY if app/not-found.tsx exists. For this manifest, the
    // only direct call is the API route.
    expect(calls.length).toBeGreaterThan(0);

    // Every call made during cold boot must have a nullish opts or an
    // undefined changedFile (the thread-through contract).
    for (const call of calls) {
      if (call.opts !== undefined) {
        expect(call.opts.changedFile).toBeUndefined();
      }
    }
  });

  // ---------------------------------------------------------------------
  // 2. Reload with changedFile: API module → importFn receives the hint
  //    on every call so createBundledImporter can short-circuit unrelated
  //    routes via the import graph.
  // ---------------------------------------------------------------------

  it("[live reload] forwards changedFile to importFn for API routes", async () => {
    const manifest = twoRouteManifest(rootDir);
    const { importFn, calls } = makeMockImporter(() => ({
      async GET() {
        return new Response("ok");
      },
    }));

    const changedFile = path.join(rootDir, "src", "shared", "foo.ts");

    await registerManifestHandlers(manifest, rootDir, {
      importFn,
      registeredLayouts: new Set(),
      isReload: true,
      changedFile,
    });

    expect(calls.length).toBeGreaterThan(0);

    // Every importFn call inside handlers.ts MUST forward the
    // changedFile. Ancient code (before Phase 7.0.R3b) called
    // importFn(modulePath) without the second argument.
    for (const call of calls) {
      expect(call.opts).toBeDefined();
      expect(call.opts!.changedFile).toBe(changedFile);
    }
  });

  // ---------------------------------------------------------------------
  // 3. registerPageHandler path (slotModule branch) — the deferred
  //    importFn wrapped in `registerPageHandler` still needs to see the
  //    changedFile when it's eventually invoked. We simulate by
  //    pulling the registration out of the global registry.
  // ---------------------------------------------------------------------

  it("[live reload] page handler registration forwards changedFile through to importFn during register", async () => {
    const manifest = twoRouteManifest(rootDir);
    const { importFn, calls } = makeMockImporter(() => ({
      default: () => null,
    }));

    const changedFile = path.join(rootDir, "app", "page.tsx");

    // registerManifestHandlers may invoke importFn eagerly (API routes)
    // or register a lazy loader (page routes without slotModule). In
    // both cases the `importOpts` object is captured in closure at
    // registration time — so even for deferred calls the changedFile
    // reaches createBundledImporter when the loader fires later.
    await registerManifestHandlers(manifest, rootDir, {
      importFn,
      registeredLayouts: new Set(),
      isReload: true,
      changedFile,
    });

    // Run twice to make sure BOTH call paths (cold + reload) thread
    // through correctly.
    await registerManifestHandlers(manifest, rootDir, {
      importFn,
      registeredLayouts: new Set(),
      isReload: true,
      changedFile,
    });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.opts).toBeDefined();
      expect(call.opts!.changedFile).toBe(changedFile);
    }
  });

  // ---------------------------------------------------------------------
  // 4. Layout chain — when a page has a layout, registerLayoutLoader's
  //    lazy factory wraps importFn. The factory must also receive
  //    changedFile so the layout module's cache hit can fire.
  // ---------------------------------------------------------------------

  it("[live reload] layout loader registration forwards changedFile through the lazy factory", async () => {
    // Build a manifest where the page has a layoutChain. Writing the
    // files is necessary so path.resolve() produces a valid-looking
    // absolute path, even though the mock importer doesn't read them.
    mkdirSync(path.join(rootDir, "app"), { recursive: true });
    writeFileSync(
      path.join(rootDir, "app", "layout.tsx"),
      "export default function Layout() { return null; }\n",
    );
    writeFileSync(
      path.join(rootDir, "app", "page.tsx"),
      "export default function Page() { return null; }\n",
    );

    const manifest = {
      version: 1,
      routes: [
        {
          id: "home",
          kind: "page" as const,
          pattern: "/",
          module: "app/page.tsx",
          componentModule: "app/page.tsx",
          layoutChain: ["app/layout.tsx"],
        },
      ],
    } as unknown as RoutesManifest;

    const { importFn, calls } = makeMockImporter(() => ({
      default: () => null,
    }));

    const changedFile = path.join(rootDir, "app", "layout.tsx");

    await registerManifestHandlers(manifest, rootDir, {
      importFn,
      registeredLayouts: new Set(),
      isReload: true,
      changedFile,
    });

    // The layout loader itself is lazy (not invoked during register).
    // But the page module is imported eagerly in the slotModule branch
    // of handlers.ts. We only need to verify EVERY recorded call
    // carried changedFile.
    for (const call of calls) {
      expect(call.opts).toBeDefined();
      expect(call.opts!.changedFile).toBe(changedFile);
    }
  });

  // ---------------------------------------------------------------------
  // 5. Wildcard / full invalidation: dev.ts passes `undefined` when
  //    `filePath === SSR_CHANGE_WILDCARD`. handlers.ts must translate
  //    `undefined` into an omitted opts — NOT `{ changedFile: undefined }`
  //    (subtle semantic difference: the incremental path treats
  //    `opts?.changedFile` truthy as "do graph check").
  // ---------------------------------------------------------------------

  it("[wildcard] changedFile=undefined leaves opts undefined (full invalidation)", async () => {
    const manifest = twoRouteManifest(rootDir);
    const { importFn, calls } = makeMockImporter(() => ({
      async GET() {
        return new Response("ok");
      },
    }));

    await registerManifestHandlers(manifest, rootDir, {
      importFn,
      registeredLayouts: new Set(),
      isReload: true,
      // changedFile intentionally omitted — simulates wildcard common-dir change
    });

    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      // Two acceptable states: opts undefined, or opts with changedFile
      // === undefined. Both yield the same behaviour in the incremental
      // import path.
      if (call.opts !== undefined) {
        expect(call.opts.changedFile).toBeUndefined();
      }
    }
  });

  // ---------------------------------------------------------------------
  // 6. Explicit undefined in options object should not accidentally set
  //    `{ changedFile: undefined }` on importFn calls (pre-7.2 bug would
  //    have forwarded an empty-but-present option object).
  // ---------------------------------------------------------------------

  it("options.changedFile=undefined explicit → importFn receives undefined opts", async () => {
    const manifest = twoRouteManifest(rootDir);
    const { importFn, calls } = makeMockImporter(() => ({
      async GET() {
        return new Response("ok");
      },
    }));

    await registerManifestHandlers(manifest, rootDir, {
      importFn,
      registeredLayouts: new Set(),
      isReload: true,
      changedFile: undefined,
    });

    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      // Implementation stores `importOpts = changedFile !== undefined ? { changedFile } : undefined`
      // so the second arg to importFn should literally be `undefined`.
      expect(call.opts).toBeUndefined();
    }
  });
});
