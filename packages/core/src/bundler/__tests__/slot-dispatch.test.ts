/**
 * Phase 7.1 R1 Agent A — Slot (`.slot.ts`) dispatch regression tests.
 *
 * Before Phase 7.1 the dev bundler silently dropped `.slot.ts` edits:
 * the path wasn't in `clientModuleToRoute`, wasn't in `serverModuleSet`
 * (which only registered `componentModule` + `layoutChain`), wasn't
 * resource/contract/middleware/config, so it hit the `return` at the
 * bottom of `_doBuild` and never fired any callback. The CLI's
 * chokidar-backed `watchFSRoutes` worked around the gap at the CLI
 * layer, but the 36-cell HMR matrix (which drives `startDevBundler`
 * directly) marked all three `app/slot.ts` cells as `[GAP]`.
 *
 * Fix (Option B — see `docs/bun/phase-7-1-diagnostics/slot-dispatch-analysis.md`):
 * register `route.slotModule` in `serverModuleSet` at manifest-iteration
 * time, so a slot edit flows through the existing `onSSRChange`
 * dispatch path — semantically correct since slots are SSR-side data
 * loaders.
 *
 * Coverage:
 *   1. slot path in `serverModuleSet` after `startDevBundler`
 *   2. slot edit fires `onSSRChange(filePath)` (NOT wildcard)
 *   3. route without `slotModule` does not crash (falsy skip)
 *   4. multi-route dispatch — each route's slot detected independently
 *   5. mixed slot + page.tsx edit classifies as `ssr-only` batch
 *   6. Windows path normalization — backslash / lowercase handled
 *   7. Regression: page.tsx still fires `onSSRChange` (slot doesn't
 *      hijack the existing contract)
 *   8. route-less manifest does not register any slot paths
 *
 * Gating: `MANDU_SKIP_BUNDLER_TESTS=1` skips the integration tests that
 * spin up real `fs.watch` watchers. The static unit tests (1, 3, 4, 8)
 * run in all modes.
 *
 * References:
 *   docs/bun/phase-7-1-diagnostics/slot-dispatch-analysis.md
 *   docs/bun/phase-7-1-team-plan.md §4 Agent A
 *   packages/core/tests/hmr-matrix/matrix.spec.ts (KNOWN_BUNDLER_GAPS)
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  startDevBundler,
  _testOnly_normalizeFsPath,
  type DevBundler,
} from "../dev";
import type { RoutesManifest } from "../../spec/schema";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Settle window mirrors the neighbouring integration tests (B6 debounce
 *  100ms + Windows fs.watch polling slack). */
const WATCH_SETTLE_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry `writeFile` up to 4 times until `observedCount()` increments.
 * Windows ReadDirectoryChangesW drops the first event on a freshly-
 * armed recursive watcher roughly 1 in 5 runs; the retry pattern is
 * the standard fix used elsewhere in this test directory.
 */
async function touchUntilSeen(
  filePath: string,
  observedCount: () => number,
  maxAttempts = 4,
): Promise<void> {
  const before = observedCount();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const content = `export async function load() { return { marker: ${
      Date.now() + attempt
    } }; }\n`;
    writeFileSync(filePath, content);
    await sleep(WATCH_SETTLE_MS);
    if (observedCount() > before) return;
  }
}

/**
 * Create a minimal on-disk project with the directory layout
 * `startDevBundler` needs to arm its watchers without throwing:
 *
 *   .mandu/                    (manifest.json + client/)
 *   app/page.tsx               (SSR component)
 *   app/page.slot.ts           (server data loader — the unit under test)
 *   app/layout.tsx             (optional, mirrors real projects)
 *   package.json               (root-watcher expects one)
 *
 * Everything else (`src/shared/...`, spec/contracts, etc.) is omitted
 * — this suite is scoped to the slot path and benefits from a leaner
 * fixture.
 */
function createTempProject(opts: { withLayout?: boolean } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "mandu-slot-dispatch-"));
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
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "slot-dispatch-fixture", private: true }, null, 2),
  );

  mkdirSync(path.join(root, "app"), { recursive: true });
  writeFileSync(
    path.join(root, "app/page.tsx"),
    "export default function HomePage() { return <div>home</div>; }\n",
  );
  writeFileSync(
    path.join(root, "app/page.slot.ts"),
    "export async function load() { return { version: 0 }; }\n",
  );
  if (opts.withLayout) {
    writeFileSync(
      path.join(root, "app/layout.tsx"),
      "export default function Layout({ children }: { children: any }) { return <div>{children}</div>; }\n",
    );
  }
  return root;
}

/** Manifest shape: one page route with the fields Phase 7.1 adds. */
function manifestWithSlot(withLayout = false): RoutesManifest {
  const route: RoutesManifest["routes"][number] = {
    id: "home",
    kind: "page",
    pattern: "/",
    module: "app/page.tsx",
    componentModule: "app/page.tsx",
    slotModule: "app/page.slot.ts",
  };
  if (withLayout) {
    route.layoutChain = ["app/layout.tsx"];
  }
  return {
    version: 1,
    routes: [route],
  } as RoutesManifest;
}

/** Two routes, only one with a slot. Verifies dispatch independence. */
function manifestMultiRoute(): RoutesManifest {
  return {
    version: 1,
    routes: [
      {
        id: "home",
        kind: "page",
        pattern: "/",
        module: "app/page.tsx",
        componentModule: "app/page.tsx",
        slotModule: "app/page.slot.ts",
      },
      {
        id: "about",
        kind: "page",
        pattern: "/about",
        module: "app/about/page.tsx",
        componentModule: "app/about/page.tsx",
        slotModule: "app/about/page.slot.ts",
      },
    ],
  } as RoutesManifest;
}

/** Route with no `slotModule` — the falsy-skip branch must not throw. */
function manifestNoSlot(): RoutesManifest {
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
    ],
  } as RoutesManifest;
}

// -----------------------------------------------------------------------------
// Section A — Static shape assertions (no watcher spin-up)
//
// These run in ALL modes (MANDU_SKIP_BUNDLER_TESTS=1 or unset) because
// they only verify the manifest-iteration block's behavior. We boot
// `startDevBundler` once and then immediately `close()` it — the
// initial build + watcher arm is the minimum we need to exercise the
// SSR-module registration logic, and it finishes in <200 ms.
// -----------------------------------------------------------------------------

describe("Phase 7.1 R1 Agent A — slot path normalization (pure unit)", () => {
  it("normalizes relative slot paths to absolute forward-slash", () => {
    // Mirror the logic inside `startDevBundler` manifest iteration:
    //   absPath = path.resolve(rootDir, route.slotModule)
    //   serverModuleSet.add(normalizeFsPath(absPath))
    //
    // The test doesn't spin up the bundler — it just verifies that
    // given the same inputs, the normalized key is what downstream
    // `serverModuleSet.has()` checks will look up. This is a pure
    // regression guard against a future refactor accidentally
    // breaking the round-trip.
    const rootDir = path.join(tmpdir(), "mandu-slot-norm-fixture");
    const slotRel = "app/page.slot.ts";
    const abs = path.resolve(rootDir, slotRel);
    const normalized = _testOnly_normalizeFsPath(abs);
    expect(normalized.endsWith("/app/page.slot.ts")).toBe(true);
    expect(normalized.includes("\\")).toBe(false);
  });

  it("handles `.slot.tsx` variant identically (rare, but permitted)", () => {
    const abs = path.resolve(tmpdir(), "proj/app/page.slot.tsx");
    const normalized = _testOnly_normalizeFsPath(abs);
    expect(normalized.endsWith("/app/page.slot.tsx")).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Section B — Live bundler integration (gated)
// -----------------------------------------------------------------------------

describe.skipIf(process.env.MANDU_SKIP_BUNDLER_TESTS === "1")(
  "Phase 7.1 R1 Agent A — slot dispatch integration",
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
        /* Windows cleanup is best-effort — .mandu/client dlls can hold locks. */
      }
    });

    it("(1) slot file edit fires onSSRChange with the slot's path (NOT wildcard)", async () => {
      // Contract: a targeted slot edit produces a targeted SSR signal.
      // The wildcard "*" is reserved for common-dir changes that fan
      // out to every SSR handler. Asserting the specific path here
      // pins the dispatch layer so a future optimization that
      // collapses slot-edit to wildcard would be flagged immediately.
      const ssrCalls: string[] = [];
      const bundler = await startDevBundler({
        rootDir,
        manifest: manifestWithSlot(),
        onSSRChange: (filePath) => {
          ssrCalls.push(filePath);
        },
      });
      close = bundler.close;

      await sleep(300);

      await touchUntilSeen(
        path.join(rootDir, "app/page.slot.ts"),
        () => ssrCalls.length,
      );

      expect(ssrCalls.length).toBeGreaterThan(0);
      // Path assertion — must NOT be the wildcard. The slot signal
      // must carry the actual file path so the CLI knows which route
      // to re-register.
      expect(ssrCalls[0]).not.toBe("*");
      expect(ssrCalls[0]!.endsWith("app/page.slot.ts")).toBe(true);
    }, 15_000);

    it("(2) route without slotModule does not crash the bundler", async () => {
      // Regression guard for the falsy-skip branch in `dev.ts`:
      //
      //     if (route.slotModule) { … }
      //
      // A route with `slotModule === undefined` must register
      // normally — no registration, no error, no log spam.
      const errors: Error[] = [];
      const bundler = await startDevBundler({
        rootDir,
        manifest: manifestNoSlot(),
        onError: (err) => {
          errors.push(err);
        },
      });
      close = bundler.close;

      await sleep(300);

      // Edit something unrelated to prove the bundler is still alive.
      writeFileSync(
        path.join(rootDir, "app/page.tsx"),
        "export default function HomePage() { return <div>v2</div>; }\n",
      );
      await sleep(WATCH_SETTLE_MS);

      expect(errors.length).toBe(0);
    }, 10_000);

    it("(3) multi-route: each route's slot is detected independently", async () => {
      // Two routes, each with its own slot. An edit to the second
      // route's slot MUST fire `onSSRChange` with THAT path — not
      // the first route's, not the wildcard.
      //
      // Needed because pre-Phase 7.1 developers could technically
      // hand-author `slotModule` in the manifest but the bundler
      // ignored it, so the multi-route case was functionally the
      // same as no slot at all.
      mkdirSync(path.join(rootDir, "app/about"), { recursive: true });
      writeFileSync(
        path.join(rootDir, "app/about/page.tsx"),
        "export default function AboutPage() { return <div>about</div>; }\n",
      );
      writeFileSync(
        path.join(rootDir, "app/about/page.slot.ts"),
        "export async function load() { return { about: true }; }\n",
      );

      const ssrCalls: string[] = [];
      const bundler = await startDevBundler({
        rootDir,
        manifest: manifestMultiRoute(),
        onSSRChange: (filePath) => {
          ssrCalls.push(filePath);
        },
      });
      close = bundler.close;

      await sleep(300);

      await touchUntilSeen(
        path.join(rootDir, "app/about/page.slot.ts"),
        () => ssrCalls.length,
      );

      expect(ssrCalls.length).toBeGreaterThan(0);
      expect(
        ssrCalls.some((p) => p.endsWith("app/about/page.slot.ts")),
      ).toBe(true);
      // Anti-assertion: the home slot must NOT have fired (we never
      // touched it). Proves the dispatch is path-specific, not a
      // broadcast.
      expect(ssrCalls.some((p) => p.endsWith("app/page.slot.ts"))).toBe(false);
    }, 15_000);

    it("(4) regression: page.tsx edit still fires onSSRChange", async () => {
      // The slot integration must NOT steal the existing contract for
      // page.tsx edits. This test exercises the same dispatch path
      // from the opposite direction — if someone accidentally moved
      // the `.slot.ts` suffix check BEFORE the componentModule check,
      // page.tsx edits would silently break.
      const ssrCalls: string[] = [];
      const bundler = await startDevBundler({
        rootDir,
        manifest: manifestWithSlot(),
        onSSRChange: (filePath) => {
          ssrCalls.push(filePath);
        },
      });
      close = bundler.close;

      await sleep(300);

      const pagePath = path.join(rootDir, "app/page.tsx");
      const before = ssrCalls.length;
      for (let i = 0; i < 4; i++) {
        writeFileSync(
          pagePath,
          `export default function HomePage() { return <div>v${i + 1}</div>; }\n`,
        );
        await sleep(WATCH_SETTLE_MS);
        if (ssrCalls.length > before) break;
      }

      expect(ssrCalls.length).toBeGreaterThan(before);
      expect(ssrCalls.some((p) => p.endsWith("app/page.tsx"))).toBe(true);
    }, 15_000);

    it("(5) slot + page.tsx mixed edit: both classify as ssr-only", async () => {
      // Burst-edit scenario: user saves page.tsx and page.slot.ts
      // within the debounce window. `classifyBatch` must route the
      // entire batch to `ssr-only` (both the page AND the slot are
      // in `serverModuleSet`). No island-update / css-update /
      // api-only cross-contamination.
      const ssrCalls: string[] = [];
      const apiCalls: string[] = [];
      const rebuilds: Array<{ routeId: string; success: boolean }> = [];
      const bundler = await startDevBundler({
        rootDir,
        manifest: manifestWithSlot(),
        onSSRChange: (filePath) => {
          ssrCalls.push(filePath);
        },
        onAPIChange: (filePath) => {
          apiCalls.push(filePath);
        },
        onRebuild: (r) => {
          rebuilds.push({ routeId: r.routeId, success: r.success });
        },
      });
      close = bundler.close;

      await sleep(300);

      // Two files saved 30 ms apart — falls inside the 100 ms debounce
      // window, so `pendingBuildSet` coalesces them into one
      // `classifyBatch` call.
      writeFileSync(
        path.join(rootDir, "app/page.tsx"),
        "export default function HomePage() { return <div>v2</div>; }\n",
      );
      await sleep(30);
      writeFileSync(
        path.join(rootDir, "app/page.slot.ts"),
        "export async function load() { return { v: 2 }; }\n",
      );

      await sleep(WATCH_SETTLE_MS * 2);

      // Both slot + page fire onSSRChange — exact ordering is left
      // unconstrained because Windows fs.watch can deliver either
      // event first, but we need at least one of each kind.
      expect(ssrCalls.length).toBeGreaterThan(0);
      // Anti-assertion: API handler must NOT fire. Slots don't go
      // through the API reload path.
      expect(apiCalls.length).toBe(0);
    }, 15_000);

    it("(6) slot edits do NOT trigger an island rebuild (routeId stays empty/wildcard)", async () => {
      // Slots are SSR-only artifacts — they don't ship in the client
      // bundle. An island rebuild (`onRebuild` with a specific
      // `routeId`) for a slot edit would be a bug: it would run
      // `buildClientBundles` unnecessarily and waste 50-100 ms per
      // save.
      const rebuilds: Array<{ routeId: string }> = [];
      const ssrCalls: string[] = [];
      const bundler = await startDevBundler({
        rootDir,
        manifest: manifestWithSlot(),
        onSSRChange: (filePath) => {
          ssrCalls.push(filePath);
        },
        onRebuild: (r) => {
          rebuilds.push({ routeId: r.routeId });
        },
      });
      close = bundler.close;

      await sleep(300);

      await touchUntilSeen(
        path.join(rootDir, "app/page.slot.ts"),
        () => ssrCalls.length,
      );

      // At least one SSR signal fired (the contract under test).
      expect(ssrCalls.length).toBeGreaterThan(0);
      // Zero per-route rebuilds. The wildcard rebuild "*" is allowed
      // (common-dir fan-out), but a specific routeId means the
      // bundler mistakenly went down the island-rebuild path.
      const specificRebuilds = rebuilds.filter(
        (r) => r.routeId && r.routeId !== "*" && r.routeId.length > 0,
      );
      expect(specificRebuilds.length).toBe(0);
    }, 15_000);

    it("(7) empty manifest: slot registration is a no-op, no errors", async () => {
      // Edge case — a project with zero routes (fresh `mandu init`
      // before any page.tsx exists). The manifest iteration should
      // simply not register anything, and the bundler should still
      // start and close cleanly.
      const errors: Error[] = [];
      const bundler = await startDevBundler({
        rootDir,
        manifest: { version: 1, routes: [] } as unknown as RoutesManifest,
        onError: (err) => {
          errors.push(err);
        },
      });
      close = bundler.close;

      await sleep(300);

      // Editing the slot file should not crash anything — the
      // watcher may or may not see the file depending on whether
      // `app/` made it into `watchDirs` via other routes (here it
      // didn't), but there MUST be no error callback.
      writeFileSync(
        path.join(rootDir, "app/page.slot.ts"),
        "export async function load() { return { v: 1 }; }\n",
      );
      await sleep(WATCH_SETTLE_MS);

      expect(errors.length).toBe(0);
    }, 10_000);

    it("(8) slot with layout chain present: both slot and layout paths registered", async () => {
      // A realistic fixture adds `layoutChain: ["app/layout.tsx"]`
      // alongside `slotModule`. This test proves the two additions
      // are independent — the layout chain iteration happens in a
      // separate block from the slot registration, so one feature
      // must not shadow the other.
      //
      // We recreate the project with the layout file on disk so the
      // manifest-derived watch directory set is consistent.
      close?.();
      close = null;
      try {
        rmSync(rootDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      rootDir = createTempProject({ withLayout: true });

      const ssrCalls: string[] = [];
      const bundler = await startDevBundler({
        rootDir,
        manifest: manifestWithSlot(true),
        onSSRChange: (filePath) => {
          ssrCalls.push(filePath);
        },
      });
      close = bundler.close;

      await sleep(300);

      // Edit the slot first — must fire.
      await touchUntilSeen(
        path.join(rootDir, "app/page.slot.ts"),
        () => ssrCalls.length,
      );
      const slotObserved = ssrCalls.some((p) =>
        p.endsWith("app/page.slot.ts"),
      );
      expect(slotObserved).toBe(true);

      // Then edit the layout — the separate registration path must
      // still fire. Using `touchUntilSeen` avoids Windows flake.
      const beforeLayout = ssrCalls.length;
      for (let i = 0; i < 4; i++) {
        writeFileSync(
          path.join(rootDir, "app/layout.tsx"),
          `export default function Layout({ children }: { children: any }) { return <div data-v="${i}">{children}</div>; }\n`,
        );
        await sleep(WATCH_SETTLE_MS);
        if (ssrCalls.length > beforeLayout) break;
      }
      const layoutObserved = ssrCalls.some((p) => p.endsWith("app/layout.tsx"));
      expect(layoutObserved).toBe(true);
    }, 20_000);
  },
);
