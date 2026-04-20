/**
 * Issue #216 — prerender error distinguishability regression tests.
 *
 * Previously `prerenderRoutes` wrapped the dynamic-import + user
 * `generateStaticParams()` call in a single bare `try/catch {}`, so
 * three very different failure modes were indistinguishable:
 *
 *   - Page module doesn't exist (compile error, missing file)
 *   - Page module loads but `generateStaticParams` export is missing
 *   - Page module loads, function exists, function throws
 *
 * Only the second case is legitimate — the other two are real bugs and
 * should surface loudly.
 *
 * Fix: narrow catch blocks, collect per-route errors, throw a
 * `PrerenderError` aggregate at the end unless `skipErrors: true`.
 */

import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  PrerenderError,
  prerenderRoutes,
} from "../../src/bundler/prerender";
import type { RoutesManifest } from "../../src/spec/schema";

let tmpDir: string | undefined;

async function makeTmpDir(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-prerender-errors-"));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    tmpDir = undefined;
  }
});

const staticOnlyHandler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  return new Response(`<!doctype html><p>${url.pathname}</p>`, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
};

function manifestWith(routes: RoutesManifest["routes"]): RoutesManifest {
  return { version: 1, routes };
}

describe("prerenderRoutes error distinguishability — Issue #216", () => {
  it("treats missing `generateStaticParams` export as legitimate silent skip", async () => {
    const root = await makeTmpDir();
    const manifest = manifestWith([
      {
        kind: "page",
        id: "blog-slug",
        pattern: "/blog/:slug",
        module: "app/blog/[slug]/page.tsx",
        componentModule: "app/blog/[slug]/page.tsx",
      },
    ]);
    const result = await prerenderRoutes(manifest, staticOnlyHandler, {
      rootDir: root,
      outDir: path.join(root, "static"),
      // Module loads but has no `generateStaticParams` export — valid.
      importModule: async () => ({
        /* no generateStaticParams */
      }),
    });
    expect(result.errors).toHaveLength(0);
    expect(result.generated).toBe(0); // no paths emitted, but build fine
  });

  it("surfaces module-load failure with route + cause context", async () => {
    const root = await makeTmpDir();
    const manifest = manifestWith([
      {
        kind: "page",
        id: "blog-slug",
        pattern: "/blog/:slug",
        module: "app/blog/[slug]/page.tsx",
        componentModule: "app/blog/[slug]/page.tsx",
      },
    ]);
    let caught: unknown;
    try {
      await prerenderRoutes(manifest, staticOnlyHandler, {
        rootDir: root,
        outDir: path.join(root, "static"),
        importModule: async () => {
          throw new Error("Cannot find module '~/cms'");
        },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PrerenderError);
    const err = caught as PrerenderError;
    expect(err.errors).toHaveLength(1);
    expect(err.errors[0].pattern).toBe("/blog/:slug");
    expect(err.errors[0].message).toContain("Failed to load page module");
    expect(err.errors[0].message).toContain("Cannot find module");
    expect(err.errors[0].cause).toBeInstanceOf(Error);
  });

  it("surfaces user-thrown `generateStaticParams` error with cause chain", async () => {
    const root = await makeTmpDir();
    const manifest = manifestWith([
      {
        kind: "page",
        id: "blog-slug",
        pattern: "/blog/:slug",
        module: "app/blog/[slug]/page.tsx",
        componentModule: "app/blog/[slug]/page.tsx",
      },
    ]);
    const boom = new Error("CMS connection refused");
    let caught: unknown;
    try {
      await prerenderRoutes(manifest, staticOnlyHandler, {
        rootDir: root,
        outDir: path.join(root, "static"),
        importModule: async () => ({
          generateStaticParams: async () => {
            throw boom;
          },
        }),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PrerenderError);
    const err = caught as PrerenderError;
    expect(err.errors).toHaveLength(1);
    expect(err.errors[0].message).toContain("generateStaticParams threw");
    expect(err.errors[0].cause).toBe(boom);
  });

  it("surfaces non-array return from `generateStaticParams` as clear error", async () => {
    const root = await makeTmpDir();
    const manifest = manifestWith([
      {
        kind: "page",
        id: "blog-slug",
        pattern: "/blog/:slug",
        module: "app/blog/[slug]/page.tsx",
        componentModule: "app/blog/[slug]/page.tsx",
      },
    ]);
    let caught: unknown;
    try {
      await prerenderRoutes(manifest, staticOnlyHandler, {
        rootDir: root,
        outDir: path.join(root, "static"),
        importModule: async () => ({
          // Naughty: returns a bare object instead of an array.
          generateStaticParams: async () =>
            ({ slug: "intro" }) as unknown as { slug: string }[],
        }),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PrerenderError);
    const err = caught as PrerenderError;
    // The validation error comes from collectStaticPaths, promoted to
    // a route-level error by the orchestrator.
    expect(err.errors[0].message).toMatch(
      /expected an array of param objects|returned/i
    );
  });

  it("still renders when `generateStaticParams` returns a valid array", async () => {
    const root = await makeTmpDir();
    const manifest = manifestWith([
      {
        kind: "page",
        id: "blog-slug",
        pattern: "/blog/:slug",
        module: "app/blog/[slug]/page.tsx",
        componentModule: "app/blog/[slug]/page.tsx",
      },
    ]);
    const result = await prerenderRoutes(manifest, staticOnlyHandler, {
      rootDir: root,
      outDir: path.join(root, "static"),
      importModule: async () => ({
        generateStaticParams: async () => [{ slug: "a" }, { slug: "b" }],
      }),
    });
    expect(result.errors).toHaveLength(0);
    expect(result.generated).toBe(2);
    expect(result.paths.sort()).toEqual(["/blog/a", "/blog/b"]);
  });

  it("aggregates errors across multiple routes", async () => {
    const root = await makeTmpDir();
    const manifest = manifestWith([
      {
        kind: "page",
        id: "a",
        pattern: "/a/:slug",
        module: "app/a/[slug]/page.tsx",
        componentModule: "app/a/[slug]/page.tsx",
      },
      {
        kind: "page",
        id: "b",
        pattern: "/b/:slug",
        module: "app/b/[slug]/page.tsx",
        componentModule: "app/b/[slug]/page.tsx",
      },
    ]);
    let caught: unknown;
    try {
      await prerenderRoutes(manifest, staticOnlyHandler, {
        rootDir: root,
        outDir: path.join(root, "static"),
        importModule: async (specifier: string) => {
          if (specifier.includes("/a/")) {
            throw new Error("A is broken");
          }
          return {
            generateStaticParams: async () => {
              throw new Error("B is also broken");
            },
          };
        },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PrerenderError);
    const err = caught as PrerenderError;
    expect(err.errors).toHaveLength(2);
    const patterns = err.errors.map((e) => e.pattern).sort();
    expect(patterns).toEqual(["/a/:slug", "/b/:slug"]);
  });

  it("mixes good + bad routes: good route renders, bad route fails build", async () => {
    const root = await makeTmpDir();
    const manifest = manifestWith([
      {
        kind: "page",
        id: "good",
        pattern: "/good/:slug",
        module: "app/good/[slug]/page.tsx",
        componentModule: "app/good/[slug]/page.tsx",
      },
      {
        kind: "page",
        id: "bad",
        pattern: "/bad/:slug",
        module: "app/bad/[slug]/page.tsx",
        componentModule: "app/bad/[slug]/page.tsx",
      },
    ]);
    let caught: unknown;
    try {
      await prerenderRoutes(manifest, staticOnlyHandler, {
        rootDir: root,
        outDir: path.join(root, "static"),
        importModule: async (specifier: string) => {
          if (specifier.includes("/good/")) {
            return {
              generateStaticParams: async () => [{ slug: "ok" }],
            };
          }
          throw new Error("bad module");
        },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PrerenderError);
    const err = caught as PrerenderError;
    // Good route is NOT in the error set.
    expect(err.errors.every((e) => e.pattern === "/bad/:slug")).toBe(true);
  });

  it("skipErrors:true downgrades route errors to warnings (no throw)", async () => {
    const root = await makeTmpDir();
    const manifest = manifestWith([
      {
        kind: "page",
        id: "blog-slug",
        pattern: "/blog/:slug",
        module: "app/blog/[slug]/page.tsx",
        componentModule: "app/blog/[slug]/page.tsx",
      },
    ]);
    const result = await prerenderRoutes(manifest, staticOnlyHandler, {
      rootDir: root,
      outDir: path.join(root, "static"),
      skipErrors: true,
      importModule: async () => {
        throw new Error("compile error");
      },
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("/blog/:slug");
    expect(result.generated).toBe(0);
  });
});
