/**
 * Issue #214 — `dynamicParams` + `staticParams` unit tests.
 *
 * Covers the bundler/prerender side of the contract:
 *   - `collectStaticPaths` round-trips `paramSets` alongside resolved paths.
 *   - `prerenderRoutes` captures `dynamicParams` export onto the route spec.
 *   - `prerenderRoutes` persists `staticParams` onto the route spec.
 *   - Default-behavior (no export / `dynamicParams: true`) is a no-op.
 *   - Works across dynamic kinds: required, catch-all, optional catch-all.
 *   - Works across nested dynamic patterns (`/[lang]/[slug]`).
 */

import { describe, it, expect, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { prerenderRoutes } from "../../src/bundler/prerender";
import {
  collectStaticPaths,
  type PageModuleWithStaticParams,
} from "../../src/bundler/generate-static-params";
import type { RoutesManifest, RouteSpec } from "../../src/spec/schema";

// ---------- Fixtures ----------

let tmpDir: string;

async function makeTmpDir(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-dp-"));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

function fetchHandler(): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const url = new URL(req.url);
    const html = `<!DOCTYPE html><html><body>Page: ${url.pathname}</body></html>`;
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };
}

// Build a resolver that serves per-pattern fake modules.
function moduleResolver(
  byPattern: Record<string, PageModuleWithStaticParams>
): (specifier: string) => Promise<PageModuleWithStaticParams> {
  return async (specifier: string) => {
    for (const [pattern, mod] of Object.entries(byPattern)) {
      if (specifier.endsWith(pattern)) return mod;
    }
    return {};
  };
}

// ---------- collectStaticPaths round-trip ----------

describe("collectStaticPaths — paramSets round-trip", () => {
  it("returns paramSets alongside paths for required dynamic", async () => {
    const mod: PageModuleWithStaticParams = {
      generateStaticParams: async () => [
        { lang: "en" },
        { lang: "ko" },
      ],
    };
    const result = await collectStaticPaths("/:lang", mod);
    expect(result.paths).toEqual(["/en", "/ko"]);
    expect(result.paramSets).toEqual([{ lang: "en" }, { lang: "ko" }]);
    expect(result.errors).toHaveLength(0);
  });

  it("returns paramSets for catch-all", async () => {
    const mod: PageModuleWithStaticParams = {
      generateStaticParams: async () => [
        { slug: ["guide", "basics"] },
        { slug: ["guide", "advanced"] },
      ],
    };
    const result = await collectStaticPaths("/docs/:slug*", mod);
    expect(result.paths).toEqual(["/docs/guide/basics", "/docs/guide/advanced"]);
    expect(result.paramSets).toHaveLength(2);
    expect(result.paramSets[0]).toEqual({ slug: ["guide", "basics"] });
  });

  it("returns empty paramSets when generator returns []", async () => {
    const mod: PageModuleWithStaticParams = {
      generateStaticParams: () => [],
    };
    const result = await collectStaticPaths("/:slug", mod);
    expect(result.paths).toHaveLength(0);
    expect(result.paramSets).toHaveLength(0);
  });

  it("skips invalid entries but keeps valid ones", async () => {
    const mod: PageModuleWithStaticParams = {
      generateStaticParams: () => [
        { lang: "en" },
        { lang: "" }, // invalid: empty required
        { lang: "ko" },
      ],
    };
    const result = await collectStaticPaths("/:lang", mod);
    expect(result.paths).toEqual(["/en", "/ko"]);
    expect(result.paramSets).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
  });
});

// ---------- prerenderRoutes stamps route spec ----------

describe("prerenderRoutes — route spec mutation (Issue #214)", () => {
  const baseManifest = (): RoutesManifest => ({
    version: 1,
    routes: [
      {
        kind: "page",
        id: "lang-page",
        pattern: "/:lang",
        module: "app/[lang]/page.tsx",
        componentModule: "app/[lang]/page.tsx",
      } as RouteSpec,
    ],
  });

  it("stamps dynamicParams=false + staticParams when module opts in", async () => {
    const root = await makeTmpDir();
    const manifest = baseManifest();

    await prerenderRoutes(manifest, fetchHandler(), {
      rootDir: root,
      outDir: path.join(root, "pre"),
      importModule: moduleResolver({
        "app/[lang]/page.tsx": {
          dynamicParams: false,
          generateStaticParams: () => [{ lang: "en" }, { lang: "ko" }],
        },
      }),
    });

    const page = manifest.routes[0] as RouteSpec & {
      dynamicParams?: boolean;
      staticParams?: Record<string, string | string[]>[];
    };
    expect(page.dynamicParams).toBe(false);
    expect(page.staticParams).toEqual([{ lang: "en" }, { lang: "ko" }]);
  });

  it("stamps dynamicParams=true (round-trip) when module sets it explicitly", async () => {
    const root = await makeTmpDir();
    const manifest = baseManifest();

    await prerenderRoutes(manifest, fetchHandler(), {
      rootDir: root,
      outDir: path.join(root, "pre"),
      importModule: moduleResolver({
        "app/[lang]/page.tsx": {
          dynamicParams: true,
          generateStaticParams: () => [{ lang: "en" }],
        },
      }),
    });

    const page = manifest.routes[0] as RouteSpec & {
      dynamicParams?: boolean;
      staticParams?: unknown[];
    };
    expect(page.dynamicParams).toBe(true);
    // staticParams still populated for caching hints
    expect(page.staticParams).toBeDefined();
  });

  it("leaves dynamicParams undefined when module omits the export (default behavior)", async () => {
    const root = await makeTmpDir();
    const manifest = baseManifest();

    await prerenderRoutes(manifest, fetchHandler(), {
      rootDir: root,
      outDir: path.join(root, "pre"),
      importModule: moduleResolver({
        "app/[lang]/page.tsx": {
          generateStaticParams: () => [{ lang: "en" }],
        },
      }),
    });

    const page = manifest.routes[0] as RouteSpec & {
      dynamicParams?: boolean;
      staticParams?: unknown[];
    };
    expect(page.dynamicParams).toBeUndefined();
    // staticParams populated since generateStaticParams returned entries
    expect(page.staticParams).toBeDefined();
  });

  it("preserves empty staticParams when dynamicParams=false + generator returns []", async () => {
    const root = await makeTmpDir();
    const manifest = baseManifest();

    await prerenderRoutes(manifest, fetchHandler(), {
      rootDir: root,
      outDir: path.join(root, "pre"),
      importModule: moduleResolver({
        "app/[lang]/page.tsx": {
          dynamicParams: false,
          generateStaticParams: () => [],
        },
      }),
    });

    const page = manifest.routes[0] as RouteSpec & {
      dynamicParams?: boolean;
      staticParams?: unknown[];
    };
    expect(page.dynamicParams).toBe(false);
    // Explicit [] preserved — means "no URLs at all"
    expect(page.staticParams).toEqual([]);
  });

  it("handles nested dynamic pattern /[lang]/[slug]", async () => {
    const root = await makeTmpDir();
    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          kind: "page",
          id: "lang-slug",
          pattern: "/:lang/:slug",
          module: "app/[lang]/[slug]/page.tsx",
          componentModule: "app/[lang]/[slug]/page.tsx",
        } as RouteSpec,
      ],
    };

    await prerenderRoutes(manifest, fetchHandler(), {
      rootDir: root,
      outDir: path.join(root, "pre"),
      importModule: moduleResolver({
        "app/[lang]/[slug]/page.tsx": {
          dynamicParams: false,
          generateStaticParams: () => [
            { lang: "en", slug: "intro" },
            { lang: "ko", slug: "intro" },
            { lang: "en", slug: "guide" },
          ],
        },
      }),
    });

    const page = manifest.routes[0] as RouteSpec & {
      dynamicParams?: boolean;
      staticParams?: Array<Record<string, string>>;
    };
    expect(page.dynamicParams).toBe(false);
    expect(page.staticParams).toHaveLength(3);
    expect(page.staticParams).toEqual(
      expect.arrayContaining([
        { lang: "en", slug: "intro" },
        { lang: "ko", slug: "intro" },
        { lang: "en", slug: "guide" },
      ])
    );
  });

  it("handles catch-all pattern with string[] params", async () => {
    const root = await makeTmpDir();
    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          kind: "page",
          id: "docs-slug",
          pattern: "/docs/:slug*",
          module: "app/docs/[...slug]/page.tsx",
          componentModule: "app/docs/[...slug]/page.tsx",
        } as RouteSpec,
      ],
    };

    await prerenderRoutes(manifest, fetchHandler(), {
      rootDir: root,
      outDir: path.join(root, "pre"),
      importModule: moduleResolver({
        "app/docs/[...slug]/page.tsx": {
          dynamicParams: false,
          generateStaticParams: () => [
            { slug: ["getting-started"] },
            { slug: ["advanced", "hooks"] },
          ],
        },
      }),
    });

    const page = manifest.routes[0] as RouteSpec & {
      dynamicParams?: boolean;
      staticParams?: Array<Record<string, string | string[]>>;
    };
    expect(page.dynamicParams).toBe(false);
    expect(page.staticParams).toEqual([
      { slug: ["getting-started"] },
      { slug: ["advanced", "hooks"] },
    ]);
  });

  it("handles optional catch-all pattern (may omit the param)", async () => {
    const root = await makeTmpDir();
    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          kind: "page",
          id: "docs-opt",
          pattern: "/docs/:slug*?",
          module: "app/docs/[[...slug]]/page.tsx",
          componentModule: "app/docs/[[...slug]]/page.tsx",
        } as RouteSpec,
      ],
    };

    await prerenderRoutes(manifest, fetchHandler(), {
      rootDir: root,
      outDir: path.join(root, "pre"),
      importModule: moduleResolver({
        "app/docs/[[...slug]]/page.tsx": {
          dynamicParams: false,
          generateStaticParams: () =>
            [{}, { slug: ["intro"] }] as Array<{ slug?: string[] }>,
        } as PageModuleWithStaticParams,
      }),
    });

    const page = manifest.routes[0] as RouteSpec & {
      dynamicParams?: boolean;
      staticParams?: Array<Record<string, unknown>>;
    };
    expect(page.dynamicParams).toBe(false);
    expect(page.staticParams).toHaveLength(2);
  });

  it("is a no-op for static routes (no dynamic segment)", async () => {
    const root = await makeTmpDir();
    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          kind: "page",
          id: "about",
          pattern: "/about",
          module: "app/about/page.tsx",
          componentModule: "app/about/page.tsx",
        } as RouteSpec,
      ],
    };

    await prerenderRoutes(manifest, fetchHandler(), {
      rootDir: root,
      outDir: path.join(root, "pre"),
      importModule: moduleResolver({}),
    });

    const page = manifest.routes[0] as RouteSpec & {
      dynamicParams?: boolean;
      staticParams?: unknown[];
    };
    expect(page.dynamicParams).toBeUndefined();
    expect(page.staticParams).toBeUndefined();
  });

  it("is a no-op for API routes (dynamicParams is page-only)", async () => {
    const root = await makeTmpDir();
    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          kind: "api",
          id: "api-users-id",
          pattern: "/api/users/:id",
          module: "app/api/users/[id]/route.ts",
        } as RouteSpec,
      ],
    };

    await prerenderRoutes(manifest, fetchHandler(), {
      rootDir: root,
      outDir: path.join(root, "pre"),
      importModule: moduleResolver({
        "app/api/users/[id]/route.ts": {
          // This would be incorrect user code — API modules don't support
          // dynamicParams. We just verify we don't crash and don't stamp.
          dynamicParams: false,
        } as PageModuleWithStaticParams,
      }),
    });

    // The route spec for API routes doesn't carry these fields at all.
    const route = manifest.routes[0] as RouteSpec & {
      dynamicParams?: boolean;
      staticParams?: unknown[];
    };
    expect(route.dynamicParams).toBeUndefined();
    expect(route.staticParams).toBeUndefined();
  });

  it("survives user generator exceptions without breaking sibling routes", async () => {
    const root = await makeTmpDir();
    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          kind: "page",
          id: "lang-page",
          pattern: "/:lang",
          module: "app/[lang]/page.tsx",
          componentModule: "app/[lang]/page.tsx",
        } as RouteSpec,
        {
          kind: "page",
          id: "docs-slug",
          pattern: "/docs/:slug",
          module: "app/docs/[slug]/page.tsx",
          componentModule: "app/docs/[slug]/page.tsx",
        } as RouteSpec,
      ],
    };

    const result = await prerenderRoutes(manifest, fetchHandler(), {
      rootDir: root,
      outDir: path.join(root, "pre"),
      importModule: moduleResolver({
        "app/[lang]/page.tsx": {
          dynamicParams: false,
          generateStaticParams: () => {
            throw new Error("boom in user code");
          },
        },
        "app/docs/[slug]/page.tsx": {
          dynamicParams: false,
          generateStaticParams: () => [{ slug: "intro" }],
        },
      }),
    });

    // The errored route still got dynamicParams stamped (from the module
    // export), even though generateStaticParams threw.
    const langPage = manifest.routes[0] as RouteSpec & {
      dynamicParams?: boolean;
    };
    expect(langPage.dynamicParams).toBe(false);

    // Sibling route succeeded.
    const docsPage = manifest.routes[1] as RouteSpec & {
      staticParams?: Array<Record<string, string>>;
    };
    expect(docsPage.staticParams).toEqual([{ slug: "intro" }]);

    // Error was recorded.
    expect(result.errors.some((e) => e.includes("boom"))).toBe(true);
  });
});
