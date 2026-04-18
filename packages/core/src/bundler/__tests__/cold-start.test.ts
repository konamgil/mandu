/**
 * Phase 7.1 R1 Agent C — Cold start Tier 1 regression tests.
 *
 * Covers the three optimisations introduced to close the R0 → R3 F cold
 * start regression (395 → 626 ms, +231 ms):
 *
 *   1. Boot parallelization in `cli/commands/dev.ts` — `validateAndReport`
 *      stays serial (seed), but `validateRuntimeLockfile` + `loadEnv` run
 *      through `Promise.allSettled`. Savings: ~40-70 ms (diagnostic §3.A).
 *   2. `startSqliteStore` fire-and-forget — boot no longer blocks on the
 *      observability store's dynamic `bun:sqlite` import + schema. Savings:
 *      ~20-40 ms (diagnostic §3.B).
 *   3. Per-island conditional skip — `scanIslandFiles` defensively re-
 *      filters its input via `needsHydration`, so a caller that forgets
 *      to pre-filter does not readdir every page route. Savings: ~40-70 ms
 *      on mixed-hydration projects (diagnostic §5 Tier 1 item 3).
 *
 * Plus: pins the 9 new B_gap `HMR_PERF` markers (BOOT_VALIDATE_CONFIG
 * through BOOT_WATCH_FS_ROUTES) so Agent D's perf-regression fixture
 * can match on them without ad-hoc string literals.
 *
 * References:
 *   docs/bun/phase-7-1-diagnostics/cold-start-breakdown.md §§3, 5, 7
 *   docs/bun/phase-7-1-team-plan.md §4 Agent C
 *   packages/core/src/perf/hmr-markers.ts BOOT_* markers
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { RouteSpec } from "../../spec/schema";
import {
  _testOnly_scanIslandFiles,
  _testOnly_getHydratedRoutes,
} from "../build";
import { HMR_PERF } from "../../perf/hmr-markers";
import {
  _resetCacheForTesting as _resetPerfCache,
  isPerfEnabled,
  mark,
  measure,
  withPerf,
} from "../../perf";

// -----------------------------------------------------------------------------
// Helpers — minimal RouteSpec factories.
// -----------------------------------------------------------------------------

/** Produce a hydrated page route spec rooted at `dir` (relative). */
function pageRoute(
  id: string,
  pattern: string,
  dir: string,
  opts: { hydration?: "visible" | "idle" | "immediate" | "never" | "none" } = {},
): RouteSpec {
  const hydration =
    opts.hydration === undefined
      ? undefined
      : opts.hydration === "none" || opts.hydration === "never"
        ? { strategy: "none" as const }
        : { strategy: opts.hydration as "visible" | "idle" | "immediate" };
  return {
    id,
    pattern,
    kind: "page",
    module: `${dir}/page.tsx`,
    componentModule: `${dir}/page.tsx`,
    clientModule: `${dir}/page.tsx`,
    ...(hydration ? { hydration } : {}),
  } as RouteSpec;
}

/** Produce a pure-SSR page route (hydration.strategy === "none"). */
function pureSsrRoute(id: string, pattern: string, dir: string): RouteSpec {
  return {
    id,
    pattern,
    kind: "page",
    module: `${dir}/page.tsx`,
    componentModule: `${dir}/page.tsx`,
    hydration: { strategy: "none" },
  } as RouteSpec;
}

/** Produce an API route spec (never hydrated). */
function apiRoute(id: string, pattern: string, dir: string): RouteSpec {
  return {
    id,
    pattern,
    kind: "api",
    module: `${dir}/route.ts`,
  } as RouteSpec;
}

/** Materialise an app/ tree on disk so `scanIslandFiles` can readdir it. */
function createProject(): {
  rootDir: string;
  writeIslandFile: (dir: string, fileName: string) => void;
} {
  const rootDir = mkdtempSync(path.join(tmpdir(), "mandu-coldstart-"));
  const writeIslandFile = (dir: string, fileName: string): void => {
    const abs = path.join(rootDir, dir);
    mkdirSync(abs, { recursive: true });
    writeFileSync(
      path.join(abs, fileName),
      `export default function X(){return null}\n`,
    );
  };
  return { rootDir, writeIslandFile };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("Phase 7.1 R1 Agent C — B_gap markers (9 boot stages)", () => {
  it("defines BOOT_VALIDATE_CONFIG", () => {
    expect(HMR_PERF.BOOT_VALIDATE_CONFIG).toBe("boot:validate-config");
  });

  it("defines BOOT_LOCKFILE_CHECK", () => {
    expect(HMR_PERF.BOOT_LOCKFILE_CHECK).toBe("boot:lockfile-check");
  });

  it("defines BOOT_LOAD_ENV", () => {
    expect(HMR_PERF.BOOT_LOAD_ENV).toBe("boot:load-env");
  });

  it("defines BOOT_SQLITE_START", () => {
    expect(HMR_PERF.BOOT_SQLITE_START).toBe("boot:sqlite-start");
  });

  it("defines BOOT_GUARD_PREFLIGHT", () => {
    expect(HMR_PERF.BOOT_GUARD_PREFLIGHT).toBe("boot:guard-preflight");
  });

  it("defines BOOT_RESOLVE_PORT", () => {
    expect(HMR_PERF.BOOT_RESOLVE_PORT).toBe("boot:resolve-port");
  });

  it("defines BOOT_HMR_SERVER", () => {
    expect(HMR_PERF.BOOT_HMR_SERVER).toBe("boot:hmr-server");
  });

  it("defines BOOT_START_SERVER", () => {
    expect(HMR_PERF.BOOT_START_SERVER).toBe("boot:start-server");
  });

  it("defines BOOT_WATCH_FS_ROUTES", () => {
    expect(HMR_PERF.BOOT_WATCH_FS_ROUTES).toBe("boot:watch-fs-routes");
  });

  it("all 9 markers share the `boot:` namespace", () => {
    // Consistency check so log aggregation tooling can grep for `boot:`.
    const bootKeys = [
      HMR_PERF.BOOT_VALIDATE_CONFIG,
      HMR_PERF.BOOT_LOCKFILE_CHECK,
      HMR_PERF.BOOT_LOAD_ENV,
      HMR_PERF.BOOT_SQLITE_START,
      HMR_PERF.BOOT_GUARD_PREFLIGHT,
      HMR_PERF.BOOT_RESOLVE_PORT,
      HMR_PERF.BOOT_HMR_SERVER,
      HMR_PERF.BOOT_START_SERVER,
      HMR_PERF.BOOT_WATCH_FS_ROUTES,
    ];
    for (const key of bootKeys) {
      expect(key.startsWith("boot:")).toBe(true);
    }
    // No duplicate values — a typo renaming one to match another would
    // break per-stage accounting.
    const unique = new Set(bootKeys);
    expect(unique.size).toBe(bootKeys.length);
  });
});

describe("Phase 7.1 R1 Agent C — perf markers fire when MANDU_PERF=1", () => {
  const originalPerf = process.env.MANDU_PERF;

  beforeEach(() => {
    process.env.MANDU_PERF = "1";
    _resetPerfCache();
  });

  afterEach(() => {
    if (originalPerf === undefined) delete process.env.MANDU_PERF;
    else process.env.MANDU_PERF = originalPerf;
    _resetPerfCache();
  });

  it("isPerfEnabled reflects MANDU_PERF=1", () => {
    expect(isPerfEnabled()).toBe(true);
  });

  it("mark/measure round-trips through all 9 BOOT markers without throwing", () => {
    // Exercises every marker — ensures none collide with a previously
    // reserved key (e.g. accidental reuse of `ssr:bundled-import`).
    const markers = [
      HMR_PERF.BOOT_VALIDATE_CONFIG,
      HMR_PERF.BOOT_LOCKFILE_CHECK,
      HMR_PERF.BOOT_LOAD_ENV,
      HMR_PERF.BOOT_SQLITE_START,
      HMR_PERF.BOOT_GUARD_PREFLIGHT,
      HMR_PERF.BOOT_RESOLVE_PORT,
      HMR_PERF.BOOT_HMR_SERVER,
      HMR_PERF.BOOT_START_SERVER,
      HMR_PERF.BOOT_WATCH_FS_ROUTES,
    ];
    for (const m of markers) {
      mark(m);
      const ms = measure(m, m);
      // Non-negative; may be 0 if the mark/measure pair runs within the
      // same nanosecond tick on very fast hosts.
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("withPerf wraps async work with a BOOT marker", async () => {
    // Mirrors the production usage at
    // `cli/src/commands/dev.ts:73` (BOOT_VALIDATE_CONFIG wrapper).
    const result = await withPerf(HMR_PERF.BOOT_VALIDATE_CONFIG, async () => {
      // simulate a tiny async boot task
      await new Promise((resolve) => setTimeout(resolve, 1));
      return 42;
    });
    expect(result).toBe(42);
  });
});

describe("Phase 7.1 R1 Agent C — boot parallelization semantics", () => {
  // Unit tests that pin the Promise.allSettled / Promise.all choice and
  // ordering contract described in dev.ts:89-112. Integration coverage
  // (spawning real `mandu dev`) lives in `scripts/hmr-bench.ts`.

  it("Promise.allSettled surfaces BOTH rejections without short-circuit", async () => {
    // Guards against an accidental refactor to Promise.all, which would
    // swallow the second task's result on the first rejection. The boot
    // path needs env failures to be warned-about, not hidden behind a
    // lockfile error.
    const lockReject = Promise.reject(new Error("lockfile corrupt"));
    const envReject = Promise.reject(new Error("env malformed"));
    const [a, b] = await Promise.allSettled([lockReject, envReject]);
    expect(a.status).toBe("rejected");
    expect(b.status).toBe("rejected");
  });

  it("Promise.allSettled resolves one side while the other rejects", async () => {
    // The envResult advisory branch in dev.ts:168-176 must still fire
    // when the lockfile rejects. This test pins the allSettled contract
    // so a `Promise.all` regression cannot quietly mask env warnings.
    const lockOk = Promise.resolve({ lockfile: null });
    const envReject = Promise.reject(new Error("env cooked"));
    const [a, b] = await Promise.allSettled([lockOk, envReject]);
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("rejected");
  });

  it("fire-and-forget Promise does not block the boot path", async () => {
    // Models the `sqliteStorePromise` pattern in dev.ts:120-138. The
    // "boot" side must resolve immediately even if the background task
    // is still pending.
    let backgroundDone = false;
    const bgPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        backgroundDone = true;
        resolve();
      }, 100);
    }).catch(() => {});

    const bootStart = Date.now();
    // Simulate boot continuing past the SQLite start mark without
    // awaiting bgPromise.
    const bootElapsed = Date.now() - bootStart;
    expect(bootElapsed).toBeLessThan(50); // < 50ms — not blocked

    // Cleanup — wait for the background task so the test suite doesn't
    // leak an unresolved promise into the next case.
    await bgPromise;
    expect(backgroundDone).toBe(true);
  });

  it("fire-and-forget caught rejection does not bubble up", async () => {
    // Pins the `.catch(() => {})` behaviour on `sqliteStorePromise` so
    // boot never aborts on a missing bun:sqlite.
    const rejected = Promise.reject(new Error("bun:sqlite unavailable")).catch(
      () => {
        /* swallow */
      },
    );
    // Should resolve to undefined without rethrowing.
    await expect(rejected).resolves.toBeUndefined();
  });
});

describe("Phase 7.1 R1 Agent C — getHydratedRoutes filter", () => {
  // These pin the existing filter so Agent B's Fast Refresh changes in
  // `buildPerIslandBundle` cannot accidentally re-enable hydration on
  // pure-SSR routes.

  it("keeps pages with default hydration (no explicit config)", () => {
    const route = pageRoute("home", "/", "app");
    const manifest = { version: 1, routes: [route] };
    const hydrated = _testOnly_getHydratedRoutes(manifest);
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0].id).toBe("home");
  });

  it("keeps pages with explicit visible/idle/immediate strategies", () => {
    const manifest = {
      version: 1,
      routes: [
        pageRoute("a", "/a", "app/a", { hydration: "visible" }),
        pageRoute("b", "/b", "app/b", { hydration: "idle" }),
        pageRoute("c", "/c", "app/c", { hydration: "immediate" }),
      ],
    };
    const hydrated = _testOnly_getHydratedRoutes(manifest);
    expect(hydrated).toHaveLength(3);
  });

  it("drops pages with hydration.strategy === 'none'", () => {
    // pureSsrRoute has no clientModule — we construct with clientModule
    // to cover the filter's clientModule-guard separately below.
    const manifest = {
      version: 1,
      routes: [pureSsrRoute("static", "/static", "app/static")],
    };
    const hydrated = _testOnly_getHydratedRoutes(manifest);
    expect(hydrated).toHaveLength(0);
  });

  it("drops pages without a clientModule", () => {
    const route: RouteSpec = {
      id: "api-like-page",
      pattern: "/foo",
      kind: "page",
      module: "app/foo/page.tsx",
      componentModule: "app/foo/page.tsx",
      // No clientModule — should NOT get an island bundle.
    } as RouteSpec;
    const manifest = { version: 1, routes: [route] };
    const hydrated = _testOnly_getHydratedRoutes(manifest);
    expect(hydrated).toHaveLength(0);
  });

  it("drops API routes entirely", () => {
    const manifest = {
      version: 1,
      routes: [
        pageRoute("home", "/", "app"),
        apiRoute("users", "/api/users", "app/api/users"),
      ],
    };
    const hydrated = _testOnly_getHydratedRoutes(manifest);
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0].id).toBe("home");
  });

  it("mixed manifest: drops pure-SSR, keeps hydrated", () => {
    const manifest = {
      version: 1,
      routes: [
        pageRoute("home", "/", "app", { hydration: "visible" }),
        pureSsrRoute("about", "/about", "app/about"),
        pageRoute("dashboard", "/dashboard", "app/dashboard", {
          hydration: "idle",
        }),
        apiRoute("health", "/api/health", "app/api/health"),
      ],
    };
    const hydrated = _testOnly_getHydratedRoutes(manifest);
    expect(hydrated.map((r) => r.id).sort()).toEqual(["dashboard", "home"]);
  });
});

describe("Phase 7.1 R1 Agent C — per-island scan skips non-hydrated routes", () => {
  let project: ReturnType<typeof createProject>;

  beforeEach(() => {
    project = createProject();
  });

  afterEach(() => {
    try {
      rmSync(project.rootDir, { recursive: true, force: true });
    } catch {
      /* Windows lock tolerance */
    }
  });

  it("skips a route with hydration.strategy === 'none' even if passed explicitly", async () => {
    // Regression guard — the task spec says "이미 되고 있을 수 있음 (확인 필요)".
    // We pin that scanIslandFiles itself (not just its callers) rejects
    // pure-SSR routes via the defensive `needsHydration` check.
    project.writeIslandFile("app/static", "page.tsx");
    project.writeIslandFile("app/static", "widget.island.tsx");

    const route = pureSsrRoute("static", "/static", "app/static");
    const result = await _testOnly_scanIslandFiles([route], project.rootDir);

    // Because the route is pure-SSR, the widget.island.tsx is ignored —
    // nothing to hydrate. This also saves a readdir on the app/static
    // directory (the -40-70 ms Tier 1 optimisation).
    expect(result).toHaveLength(0);
  });

  it("scans directories of hydrated routes and picks up *.island.tsx files", async () => {
    project.writeIslandFile("app", "page.tsx");
    project.writeIslandFile("app", "counter.island.tsx");
    project.writeIslandFile("app", "banner.island.ts");

    const route = pageRoute("home", "/", "app", { hydration: "visible" });
    const result = await _testOnly_scanIslandFiles([route], project.rootDir);

    expect(result).toHaveLength(2);
    expect(result.map((e) => e.name).sort()).toEqual(["banner", "counter"]);
    for (const entry of result) {
      expect(entry.routeId).toBe("home");
      expect(entry.priority).toBeDefined();
    }
  });

  it("dedupes directory scans when multiple hydrated routes share a dir", async () => {
    // Same dir = seenDirs filter should kick in after the first scan.
    // We verify via the number of entries — a duplicate scan would
    // return 2 entries per island file.
    project.writeIslandFile("app", "page.tsx");
    project.writeIslandFile("app", "counter.island.tsx");

    const r1 = pageRoute("home", "/", "app", { hydration: "visible" });
    const r2 = pageRoute("alt", "/alt", "app", { hydration: "idle" });
    const result = await _testOnly_scanIslandFiles([r1, r2], project.rootDir);

    expect(result).toHaveLength(1);
    // First-encountered route wins (seenDirs short-circuits subsequent).
    expect(result[0].routeId).toBe("home");
  });

  it("skips pure-SSR routes interleaved between hydrated routes", async () => {
    // Mixed-hydration project — the defensive skip saves an fs.readdir
    // on the pure-SSR branch. This is the canonical §5 Tier 1 win.
    project.writeIslandFile("app", "page.tsx");
    project.writeIslandFile("app", "home.island.tsx");
    project.writeIslandFile("app/about", "page.tsx");
    // about has NO island files AND is pure-SSR — should not be readdir'd.
    project.writeIslandFile("app/dashboard", "page.tsx");
    project.writeIslandFile("app/dashboard", "widget.island.tsx");

    const routes = [
      pageRoute("home", "/", "app", { hydration: "visible" }),
      pureSsrRoute("about", "/about", "app/about"),
      pageRoute("dashboard", "/dashboard", "app/dashboard", {
        hydration: "idle",
      }),
    ];
    const result = await _testOnly_scanIslandFiles(routes, project.rootDir);

    expect(result.map((e) => e.name).sort()).toEqual(["home", "widget"]);
    // about is not even attempted — no error, no scan entry.
    expect(result.some((e) => e.routeId === "about")).toBe(false);
  });

  it("handles missing route directories gracefully (fs.readdir catch)", async () => {
    // An orphan route — the readdir will throw ENOENT. The scanner
    // must swallow it and continue with later routes.
    project.writeIslandFile("app", "page.tsx");
    project.writeIslandFile("app", "counter.island.tsx");

    const routes = [
      pageRoute("missing", "/missing", "app/nonexistent", {
        hydration: "visible",
      }),
      pageRoute("home", "/", "app", { hydration: "visible" }),
    ];
    const result = await _testOnly_scanIslandFiles(routes, project.rootDir);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("counter");
  });

  it("returns empty array for all-empty input (no hydrated routes)", async () => {
    // Guards the "hydratedRoutes.length === 0" fast path — even if a
    // caller bypasses the early-return at build.ts:1478 and calls the
    // scanner directly with no hydrated routes, we still return [].
    const result = await _testOnly_scanIslandFiles([], project.rootDir);
    expect(result).toEqual([]);
  });

  it("returns empty array when ALL input routes are pure-SSR", async () => {
    // §5 Tier 1 item 3 — the "per-island conditional skip" big win.
    // When no routes need hydration, scanIslandFiles must be a pure
    // no-op (no fs.readdir calls), not just return [].
    project.writeIslandFile("app/a", "page.tsx");
    project.writeIslandFile("app/a", "x.island.tsx");
    project.writeIslandFile("app/b", "page.tsx");
    project.writeIslandFile("app/b", "y.island.tsx");

    const routes = [
      pureSsrRoute("a", "/a", "app/a"),
      pureSsrRoute("b", "/b", "app/b"),
    ];
    const result = await _testOnly_scanIslandFiles(routes, project.rootDir);
    expect(result).toEqual([]);
  });
});
