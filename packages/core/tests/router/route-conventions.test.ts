/**
 * Route Conventions Tests — Phase 18.β
 *
 * Next.js App Router-style per-route conventions:
 *   loading.tsx, error.tsx, not-found.tsx, (group)/, [[...slug]]
 *
 * All tests use a single fixture tree under a tmpdir so layout
 * inheritance, group skip, and optional catch-all are all verified
 * against one scan. FSScanner sorts routes by priority, so the fixture
 * is intentionally dense — if a regression breaks nearest-ancestor
 * resolution, multiple assertions below will flip at once.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { scanRoutes, fsRouteToRouteSpec } from "../../src/router";
import { Router } from "../../src/runtime/router";

// ─── Fixture ────────────────────────────────────────────────────────────────
// app/
//   layout.tsx
//   loading.tsx                          ← root loading
//   error.tsx                            ← root error boundary
//   not-found.tsx                        ← root 404
//   page.tsx
//   (marketing)/                         ← group — skipped from URL
//     pricing/
//       page.tsx                         ← URL: /pricing, inherits root layout
//   docs/
//     loading.tsx                        ← nested loading
//     error.tsx                          ← nested error
//     [[...slug]]/                       ← optional catch-all
//       page.tsx                         ← URL: /docs and /docs/a/b/c
//   dashboard/
//     not-found.tsx                      ← scoped 404 overrides root
//     [id]/
//       page.tsx                         ← inherits dashboard/not-found.tsx
//   raw/
//     page.tsx                           ← has no loading/error/not-found → root not-found only

let TEST_DIR = "";

describe("Route Conventions (Phase 18.β)", () => {
  beforeAll(async () => {
    TEST_DIR = await mkdtemp(join(tmpdir(), "mandu-route-conventions-"));

    await mkdir(join(TEST_DIR, "app/(marketing)/pricing"), { recursive: true });
    await mkdir(join(TEST_DIR, "app/docs/[[...slug]]"), { recursive: true });
    await mkdir(join(TEST_DIR, "app/dashboard/[id]"), { recursive: true });
    await mkdir(join(TEST_DIR, "app/raw"), { recursive: true });

    const stub = (body: string) => `export default function X() { return ${body}; }`;

    // Root
    await writeFile(join(TEST_DIR, "app/layout.tsx"), stub("<div>{children}</div>"));
    await writeFile(join(TEST_DIR, "app/loading.tsx"), stub("<p>root-loading</p>"));
    await writeFile(join(TEST_DIR, "app/error.tsx"), stub("<p>root-error</p>"));
    await writeFile(join(TEST_DIR, "app/not-found.tsx"), stub("<p>root-not-found</p>"));
    await writeFile(join(TEST_DIR, "app/page.tsx"), stub("<p>home</p>"));

    // Group
    await writeFile(
      join(TEST_DIR, "app/(marketing)/pricing/page.tsx"),
      stub("<p>pricing</p>"),
    );

    // docs — optional catch-all + nested loading/error
    await writeFile(join(TEST_DIR, "app/docs/loading.tsx"), stub("<p>docs-loading</p>"));
    await writeFile(join(TEST_DIR, "app/docs/error.tsx"), stub("<p>docs-error</p>"));
    await writeFile(
      join(TEST_DIR, "app/docs/[[...slug]]/page.tsx"),
      stub("<p>docs</p>"),
    );

    // dashboard — scoped not-found
    await writeFile(
      join(TEST_DIR, "app/dashboard/not-found.tsx"),
      stub("<p>dashboard-not-found</p>"),
    );
    await writeFile(
      join(TEST_DIR, "app/dashboard/[id]/page.tsx"),
      stub("<p>dashboard item</p>"),
    );

    // raw — inherits root conventions
    await writeFile(join(TEST_DIR, "app/raw/page.tsx"), stub("<p>raw</p>"));
  });

  afterAll(async () => {
    if (TEST_DIR) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  async function scan() {
    const result = await scanRoutes(TEST_DIR);
    expect(result.errors).toEqual([]);
    return result;
  }

  function byId(routes: ReturnType<typeof Array.prototype.find> extends infer _ ? any : never, id: string) {
    return routes.find((r: any) => r.id === id);
  }

  it("[1] detects root loading.tsx / error.tsx / not-found.tsx on the home route", async () => {
    const { routes } = await scan();
    const home = byId(routes, "index");
    expect(home).toBeDefined();
    expect(home.loadingModule).toMatch(/app[\\/]loading\.tsx$/);
    expect(home.errorModule).toMatch(/app[\\/]error\.tsx$/);
    expect(home.notFoundModule).toMatch(/app[\\/]not-found\.tsx$/);
  });

  it("[2] (marketing) route group is stripped from URL but keeps root layout", async () => {
    const { routes } = await scan();
    const pricing = routes.find((r) => r.pattern === "/pricing");
    expect(pricing).toBeDefined();
    // `id` omits the group segment (generateRouteId filters groups)
    expect(pricing!.id).toBe("pricing");
    expect(pricing!.layoutChain.length).toBeGreaterThan(0);
    expect(pricing!.layoutChain[0]).toMatch(/app[\\/]layout\.tsx$/);
  });

  it("[3] nested docs route inherits docs/loading + docs/error, not root ones", async () => {
    const { routes } = await scan();
    const docs = routes.find((r) => r.id.startsWith("docs"));
    expect(docs).toBeDefined();
    expect(docs!.loadingModule).toMatch(/docs[\\/]loading\.tsx$/);
    expect(docs!.errorModule).toMatch(/docs[\\/]error\.tsx$/);
    // docs has no its own not-found → falls back to root
    expect(docs!.notFoundModule).toMatch(/app[\\/]not-found\.tsx$/);
    expect(docs!.notFoundModule).not.toMatch(/docs[\\/]not-found\.tsx$/);
  });

  it("[4] dashboard/[id] inherits dashboard/not-found.tsx (scoped override)", async () => {
    const { routes } = await scan();
    const dash = routes.find((r) => r.pattern === "/dashboard/:id");
    expect(dash).toBeDefined();
    expect(dash!.notFoundModule).toMatch(/dashboard[\\/]not-found\.tsx$/);
    // dashboard has no loading/error → falls back to root
    expect(dash!.loadingModule).toMatch(/app[\\/]loading\.tsx$/);
    expect(dash!.errorModule).toMatch(/app[\\/]error\.tsx$/);
  });

  it("[5] raw/ with no local conventions inherits all three from root", async () => {
    const { routes } = await scan();
    const raw = routes.find((r) => r.pattern === "/raw");
    expect(raw).toBeDefined();
    expect(raw!.loadingModule).toMatch(/app[\\/]loading\.tsx$/);
    expect(raw!.errorModule).toMatch(/app[\\/]error\.tsx$/);
    expect(raw!.notFoundModule).toMatch(/app[\\/]not-found\.tsx$/);
  });

  it("[6] optional catch-all [[...slug]] produces /docs/:slug*? URL shape", async () => {
    const { routes } = await scan();
    const docs = routes.find((r) => r.id.startsWith("docs"));
    expect(docs).toBeDefined();
    expect(docs!.pattern).toBe("/docs/:slug*?");
    // last segment must be optionalCatchAll
    const last = docs!.segments[docs!.segments.length - 1];
    expect(last.type).toBe("optionalCatchAll");
    expect(last.paramName).toBe("slug");
  });

  it("[7] optional catch-all matches both bare and deep paths via Router", async () => {
    const { routes } = await scan();
    const specs = routes.map(fsRouteToRouteSpec);
    const router = new Router(specs);

    const bare = router.match("/docs");
    expect(bare).not.toBeNull();
    expect(bare!.route.id).toMatch(/^docs/);

    const deep = router.match("/docs/intro/getting-started");
    expect(deep).not.toBeNull();
    expect(deep!.route.id).toMatch(/^docs/);
    expect(deep!.params.slug).toBe("intro/getting-started");
  });

  it("[8] RouteSpec emission carries loadingModule/errorModule/notFoundModule", async () => {
    const { routes } = await scan();
    const raw = routes.find((r) => r.pattern === "/raw")!;
    const spec = fsRouteToRouteSpec(raw);
    expect(spec.kind).toBe("page");
    // only page-kind emissions carry the three conventions
    expect((spec as any).loadingModule).toMatch(/app\/loading\.tsx$/);
    expect((spec as any).errorModule).toMatch(/app\/error\.tsx$/);
    expect((spec as any).notFoundModule).toMatch(/app\/not-found\.tsx$/);
    // forward-slash normalization applied
    expect((spec as any).notFoundModule).not.toContain("\\");
  });

  it("[9] backward compat — a tree without any convention files emits no convention fields", async () => {
    const TMP = await mkdtemp(join(tmpdir(), "mandu-rc-min-"));
    try {
      await mkdir(join(TMP, "app/solo"), { recursive: true });
      await writeFile(
        join(TMP, "app/solo/page.tsx"),
        "export default function S() { return null; }",
      );
      const r = await scanRoutes(TMP);
      expect(r.errors).toEqual([]);
      const solo = r.routes.find((x) => x.pattern === "/solo")!;
      expect(solo).toBeDefined();
      expect(solo.loadingModule).toBeUndefined();
      expect(solo.errorModule).toBeUndefined();
      expect(solo.notFoundModule).toBeUndefined();

      // RouteSpec emission stays clean — no empty keys leak into JSON
      const spec: any = fsRouteToRouteSpec(solo);
      expect("loadingModule" in spec).toBe(false);
      expect("errorModule" in spec).toBe(false);
      expect("notFoundModule" in spec).toBe(false);
    } finally {
      await rm(TMP, { recursive: true, force: true });
    }
  });

  it("[10] group segments do NOT inject their own URL segment even when nested", async () => {
    const TMP = await mkdtemp(join(tmpdir(), "mandu-rc-group-"));
    try {
      await mkdir(join(TMP, "app/(auth)/(internal)/sign-in"), { recursive: true });
      await writeFile(
        join(TMP, "app/(auth)/(internal)/sign-in/page.tsx"),
        "export default function S() { return null; }",
      );
      const r = await scanRoutes(TMP);
      expect(r.errors).toEqual([]);
      const signIn = r.routes[0]!;
      expect(signIn.pattern).toBe("/sign-in");
      expect(signIn.id).toBe("sign-in");
    } finally {
      await rm(TMP, { recursive: true, force: true });
    }
  });

  it("[11] catch-all required form [...slug] still works alongside optional form", async () => {
    const TMP = await mkdtemp(join(tmpdir(), "mandu-rc-ca-"));
    try {
      await mkdir(join(TMP, "app/files/[...path]"), { recursive: true });
      await writeFile(
        join(TMP, "app/files/[...path]/page.tsx"),
        "export default function F() { return null; }",
      );
      const r = await scanRoutes(TMP);
      expect(r.errors).toEqual([]);
      const files = r.routes[0]!;
      expect(files.pattern).toBe("/files/:path*");
      const router = new Router([fsRouteToRouteSpec(files)]);
      // required catch-all MUST NOT match `/files` (no remainder)
      expect(router.match("/files")).toBeNull();
      // but does match a deeper path
      const deep = router.match("/files/a/b.txt");
      expect(deep).not.toBeNull();
      expect(deep!.params.path).toBe("a/b.txt");
    } finally {
      await rm(TMP, { recursive: true, force: true });
    }
  });

  it("[12] mixed conventions: scoped loading + root error + scoped not-found all land on the same route", async () => {
    const TMP = await mkdtemp(join(tmpdir(), "mandu-rc-mix-"));
    try {
      await mkdir(join(TMP, "app/shop/[sku]"), { recursive: true });
      await writeFile(join(TMP, "app/error.tsx"), "export default function E() { return null; }");
      await writeFile(
        join(TMP, "app/shop/loading.tsx"),
        "export default function L() { return null; }",
      );
      await writeFile(
        join(TMP, "app/shop/not-found.tsx"),
        "export default function N() { return null; }",
      );
      await writeFile(
        join(TMP, "app/shop/[sku]/page.tsx"),
        "export default function P() { return null; }",
      );
      const r = await scanRoutes(TMP);
      expect(r.errors).toEqual([]);
      const route = r.routes.find((x) => x.pattern === "/shop/:sku")!;
      expect(route).toBeDefined();
      expect(route.loadingModule).toMatch(/shop[\\/]loading\.tsx$/);
      expect(route.errorModule).toMatch(/app[\\/]error\.tsx$/);
      expect(route.notFoundModule).toMatch(/shop[\\/]not-found\.tsx$/);
    } finally {
      await rm(TMP, { recursive: true, force: true });
    }
  });
});
