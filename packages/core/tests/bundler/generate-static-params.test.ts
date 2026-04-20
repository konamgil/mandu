/**
 * Phase 18.γ — generateStaticParams contract + bundler prerender integration.
 *
 * Covers:
 *   1. Simple single-segment dynamic route
 *   2. Nested dynamic segments ([lang]/[slug])
 *   3. Catch-all ([...slug] → string[])
 *   4. Optional catch-all ([[...slug]]) empty array resolves to prefix
 *   5. Empty return array is a no-op (not an error)
 *   6. Thrown error is captured, other routes still render
 *   7. Many params (stress — 50 entries)
 *   8. Non-array return emits an error, no paths rendered
 *   9. Invalid entry shape (array-of-arrays) is skipped with an error
 *  10. Duplicate paths are de-duplicated silently
 *  11. `_manifest.json` index is written when `writeIndex: true`
 *  12. `resolvePrerenderedFile` honors trailing-slash tolerance
 *  13. `resolvePath` round-trip sanity
 *  14. `validateParamSet` rejects `/` in a required segment
 */

import { describe, it, expect, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  prerenderRoutes,
  loadPrerenderIndex,
  resolvePrerenderedFile,
  PRERENDER_INDEX_FILE,
  type PrerenderIndex,
} from "../../src/bundler/prerender";
import {
  collectStaticPaths,
  extractDynamicSegments,
  isDynamicPattern,
  resolvePath,
  validateParamSet,
} from "../../src/bundler/generate-static-params";
import type { RoutesManifest } from "../../src/spec/schema";

let tmpDir: string | undefined;

async function mkTmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-gsp-"));
  tmpDir = dir;
  return dir;
}

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    tmpDir = undefined;
  }
});

/** Build a routes manifest with dynamic page routes. */
function manifestFor(routes: Array<{ pattern: string; id: string }>): RoutesManifest {
  return {
    version: 1,
    routes: routes.map((r) => ({
      kind: "page" as const,
      id: r.id,
      pattern: r.pattern,
      module: `app${r.pattern}/page.tsx`,
      componentModule: `app${r.pattern}/page.tsx`,
    })),
  };
}

/** Stub fetchHandler echoing the request path. */
function htmlHandler(): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    return new Response(
      `<!DOCTYPE html><html><body>PATH:${url.pathname}</body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  };
}

// ---------- Pure helpers (fast, no FS) ----------

describe("extractDynamicSegments", () => {
  it("returns empty for a fully static pattern", () => {
    expect(extractDynamicSegments("/about")).toEqual([]);
    expect(isDynamicPattern("/about")).toBe(false);
  });

  it("parses a single required segment", () => {
    expect(extractDynamicSegments("/docs/:slug")).toEqual([
      { name: "slug", kind: "required" },
    ]);
    expect(isDynamicPattern("/docs/:slug")).toBe(true);
  });

  it("parses multiple required segments (nested)", () => {
    expect(extractDynamicSegments("/:lang/:slug")).toEqual([
      { name: "lang", kind: "required" },
      { name: "slug", kind: "required" },
    ]);
  });

  it("parses catch-all and optional catch-all", () => {
    expect(extractDynamicSegments("/docs/:path*")).toEqual([
      { name: "path", kind: "catchAll" },
    ]);
    expect(extractDynamicSegments("/docs/:path*?")).toEqual([
      { name: "path", kind: "optionalCatchAll" },
    ]);
  });
});

describe("resolvePath", () => {
  it("resolves required segments", () => {
    expect(resolvePath("/docs/:slug", { slug: "intro" })).toBe("/docs/intro");
  });

  it("resolves nested required segments", () => {
    expect(
      resolvePath("/:lang/:slug", { lang: "ko", slug: "intro" })
    ).toBe("/ko/intro");
  });

  it("does not eat longer param names sharing a prefix", () => {
    // :slug must NOT match inside :slugId — we rely on a word-boundary regex.
    expect(
      resolvePath("/:slugId/:slug", { slugId: "a", slug: "b" })
    ).toBe("/a/b");
  });

  it("resolves catch-all to joined encoded segments", () => {
    expect(
      resolvePath("/docs/:path*", { path: ["guide", "advanced"] })
    ).toBe("/docs/guide/advanced");
  });

  it("encodes individual segments safely", () => {
    expect(resolvePath("/docs/:slug", { slug: "hello world" })).toBe(
      "/docs/hello%20world"
    );
  });

  it("elides the optional catch-all slash when empty", () => {
    expect(resolvePath("/docs/:path*?", { path: [] })).toBe("/docs");
    expect(resolvePath("/docs/:path*?", {})).toBe("/docs");
  });

  it("resolves optional catch-all when provided", () => {
    expect(
      resolvePath("/docs/:path*?", { path: ["a", "b"] })
    ).toBe("/docs/a/b");
  });
});

describe("validateParamSet", () => {
  it("rejects missing required key", () => {
    expect(validateParamSet("/docs/:slug", {})).toMatch(/slug/);
  });

  it("rejects `/` in a required segment", () => {
    expect(
      validateParamSet("/docs/:slug", { slug: "a/b" })
    ).toMatch(/must not contain/);
  });

  it("rejects empty required catch-all array", () => {
    expect(
      validateParamSet("/docs/:path*", { path: [] })
    ).toMatch(/must not be empty/);
  });

  it("accepts valid catch-all", () => {
    expect(
      validateParamSet("/docs/:path*", { path: ["a", "b"] })
    ).toBeNull();
  });

  it("accepts empty optional catch-all", () => {
    expect(validateParamSet("/docs/:path*?", {})).toBeNull();
    expect(validateParamSet("/docs/:path*?", { path: [] })).toBeNull();
  });
});

describe("collectStaticPaths", () => {
  it("no-op when module has no generateStaticParams", async () => {
    const result = await collectStaticPaths("/docs/:slug", {});
    expect(result.paths).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("returns error (no throw) for non-array result", async () => {
    const result = await collectStaticPaths("/docs/:slug", {
      generateStaticParams: async () =>
        "nope" as unknown as Array<{ slug: string }>,
    });
    expect(result.paths).toEqual([]);
    expect(result.errors[0]).toMatch(/expected an array/);
  });

  it("skips invalid entries but keeps the good ones", async () => {
    const result = await collectStaticPaths("/docs/:slug", {
      // Cast the mixed array up so TS accepts the deliberate malformed
      // middle entry — runtime behavior is what this case exercises.
      generateStaticParams: async () =>
        [
          { slug: "intro" },
          ["bogus"],
          { slug: "quickstart" },
        ] as unknown as Array<Record<string, string | string[]>>,
    });
    expect(result.paths).toEqual(["/docs/intro", "/docs/quickstart"]);
    expect(result.errors.length).toBe(1);
  });

  it("de-duplicates identical paths", async () => {
    const result = await collectStaticPaths("/docs/:slug", {
      generateStaticParams: async () => [
        { slug: "intro" },
        { slug: "intro" },
      ],
    });
    expect(result.paths).toEqual(["/docs/intro"]);
  });

  it("propagates throws from user code (caller surfaces)", async () => {
    await expect(
      collectStaticPaths("/docs/:slug", {
        generateStaticParams: () => {
          throw new Error("boom");
        },
      })
    ).rejects.toThrow("boom");
  });
});

// ---------- End-to-end prerender ----------

describe("prerenderRoutes + generateStaticParams", () => {
  it("(case 1) simple dynamic segment emits one HTML per param set", async () => {
    const root = await mkTmp();
    const outDir = path.join(root, ".mandu", "prerendered");

    const result = await prerenderRoutes(
      manifestFor([{ id: "docs", pattern: "/docs/:slug" }]),
      htmlHandler(),
      {
        rootDir: root,
        outDir,
        writeIndex: true,
        importModule: async () => ({
          generateStaticParams: async () => [
            { slug: "intro" },
            { slug: "quickstart" },
            { slug: "advanced" },
          ],
        }),
      }
    );

    expect(result.errors).toEqual([]);
    expect(result.generated).toBe(3);
    expect(result.paths.sort()).toEqual(
      ["/docs/advanced", "/docs/intro", "/docs/quickstart"]
    );

    const html = await fs.readFile(
      path.join(outDir, "docs", "intro", "index.html"),
      "utf-8"
    );
    expect(html).toContain("PATH:/docs/intro");
  });

  it("(case 2) nested dynamic segments render correctly", async () => {
    const root = await mkTmp();
    const outDir = path.join(root, ".mandu", "prerendered");

    const result = await prerenderRoutes(
      manifestFor([{ id: "nested", pattern: "/:lang/:slug" }]),
      htmlHandler(),
      {
        rootDir: root,
        outDir,
        writeIndex: true,
        importModule: async () => ({
          generateStaticParams: async () => [
            { lang: "en", slug: "hello" },
            { lang: "ko", slug: "hello" },
          ],
        }),
      }
    );

    expect(result.errors).toEqual([]);
    expect(result.generated).toBe(2);
    const en = await fs.readFile(
      path.join(outDir, "en", "hello", "index.html"),
      "utf-8"
    );
    expect(en).toContain("PATH:/en/hello");
  });

  it("(case 3) catch-all returns an array-valued param", async () => {
    const root = await mkTmp();
    const outDir = path.join(root, ".mandu", "prerendered");

    const result = await prerenderRoutes(
      manifestFor([{ id: "catch", pattern: "/docs/:path*" }]),
      htmlHandler(),
      {
        rootDir: root,
        outDir,
        writeIndex: true,
        importModule: async () => ({
          generateStaticParams: async () => [
            { path: ["guide", "intro"] },
            { path: ["api", "reference", "cookies"] },
          ],
        }),
      }
    );

    expect(result.errors).toEqual([]);
    expect(result.paths.sort()).toEqual(
      ["/docs/api/reference/cookies", "/docs/guide/intro"]
    );
    const deep = await fs.readFile(
      path.join(outDir, "docs", "api", "reference", "cookies", "index.html"),
      "utf-8"
    );
    expect(deep).toContain("PATH:/docs/api/reference/cookies");
  });

  it("(case 4) optional catch-all with empty array resolves to prefix", async () => {
    const root = await mkTmp();
    const outDir = path.join(root, ".mandu", "prerendered");

    const result = await prerenderRoutes(
      manifestFor([{ id: "opt", pattern: "/docs/:path*?" }]),
      htmlHandler(),
      {
        rootDir: root,
        outDir,
        writeIndex: true,
        importModule: async () => ({
          generateStaticParams: async () => [
            { path: [] },
            { path: ["child"] },
          ],
        }),
      }
    );

    expect(result.errors).toEqual([]);
    expect(result.paths.sort()).toEqual(["/docs", "/docs/child"]);
  });

  it("(case 5) empty return is a silent no-op", async () => {
    const root = await mkTmp();
    const result = await prerenderRoutes(
      manifestFor([{ id: "empty", pattern: "/docs/:slug" }]),
      htmlHandler(),
      {
        rootDir: root,
        outDir: path.join(root, ".mandu", "prerendered"),
        importModule: async () => ({
          generateStaticParams: async () => [],
        }),
      }
    );
    expect(result.errors).toEqual([]);
    expect(result.generated).toBe(0);
  });

  it("(case 6) thrown error is captured; sibling routes still render", async () => {
    const root = await mkTmp();
    const outDir = path.join(root, ".mandu", "prerendered");

    const result = await prerenderRoutes(
      manifestFor([
        { id: "good", pattern: "/good/:slug" },
        { id: "bad", pattern: "/bad/:slug" },
      ]),
      htmlHandler(),
      {
        rootDir: root,
        outDir,
        writeIndex: true,
        importModule: async (specifier: string) => {
          if (specifier.includes("/bad/")) {
            return {
              generateStaticParams: () => {
                throw new Error("user-bug");
              },
            };
          }
          return {
            generateStaticParams: async () => [{ slug: "ok" }],
          };
        },
      }
    );

    expect(result.paths).toContain("/good/ok");
    expect(result.errors.some((e) => e.includes("user-bug"))).toBe(true);
  });

  it("(case 7) many params — 50 entries — all render", async () => {
    const root = await mkTmp();
    const outDir = path.join(root, ".mandu", "prerendered");

    const result = await prerenderRoutes(
      manifestFor([{ id: "many", pattern: "/items/:id" }]),
      htmlHandler(),
      {
        rootDir: root,
        outDir,
        writeIndex: true,
        importModule: async () => ({
          generateStaticParams: async () =>
            Array.from({ length: 50 }, (_, i) => ({ id: `item-${i}` })),
        }),
      }
    );

    expect(result.errors).toEqual([]);
    expect(result.generated).toBe(50);
  });

  it("(case 8) non-array return — no paths rendered, error recorded", async () => {
    const root = await mkTmp();
    const result = await prerenderRoutes(
      manifestFor([{ id: "bad-shape", pattern: "/docs/:slug" }]),
      htmlHandler(),
      {
        rootDir: root,
        outDir: path.join(root, ".mandu", "prerendered"),
        importModule: async () => ({
          generateStaticParams: async () =>
            ({ slug: "not-an-array" } as unknown as Array<{ slug: string }>),
        }),
      }
    );
    expect(result.generated).toBe(0);
    expect(result.errors.some((e) => /expected an array/.test(e))).toBe(true);
  });

  it("(case 9) writes _manifest.json index with all pages", async () => {
    const root = await mkTmp();
    const outDir = path.join(root, ".mandu", "prerendered");

    await prerenderRoutes(
      manifestFor([{ id: "docs", pattern: "/docs/:slug" }]),
      htmlHandler(),
      {
        rootDir: root,
        outDir,
        writeIndex: true,
        importModule: async () => ({
          generateStaticParams: async () => [
            { slug: "intro" },
            { slug: "quickstart" },
          ],
        }),
      }
    );

    const raw = await fs.readFile(
      path.join(outDir, PRERENDER_INDEX_FILE),
      "utf-8"
    );
    const parsed = JSON.parse(raw) as PrerenderIndex;
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.pages).sort()).toEqual(
      ["/docs/intro", "/docs/quickstart"]
    );
    // Index values should use posix separators.
    for (const v of Object.values(parsed.pages)) {
      expect(v).not.toContain("\\");
    }
  });

  it("(case 10) loadPrerenderIndex + resolvePrerenderedFile round-trip", async () => {
    const root = await mkTmp();
    const outDir = path.join(root, ".mandu", "prerendered");

    await prerenderRoutes(
      manifestFor([{ id: "docs", pattern: "/docs/:slug" }]),
      htmlHandler(),
      {
        rootDir: root,
        outDir,
        writeIndex: true,
        importModule: async () => ({
          generateStaticParams: async () => [{ slug: "intro" }],
        }),
      }
    );

    const idx = await loadPrerenderIndex(root, outDir);
    expect(idx).not.toBeNull();
    const file = resolvePrerenderedFile(idx!, root, outDir, "/docs/intro");
    expect(file).not.toBeNull();
    expect(file!.endsWith("index.html")).toBe(true);

    // Trailing slash tolerance.
    const withSlash = resolvePrerenderedFile(idx!, root, outDir, "/docs/intro/");
    expect(withSlash).not.toBeNull();

    // Miss.
    const miss = resolvePrerenderedFile(idx!, root, outDir, "/nope");
    expect(miss).toBeNull();
  });

  it("(case 11) path-traversal payload in index does NOT escape outDir", async () => {
    const root = await mkTmp();
    const outDir = path.join(root, ".mandu", "prerendered");
    await fs.mkdir(outDir, { recursive: true });
    // Hand-craft a malicious index.
    const malicious: PrerenderIndex = {
      version: 1,
      generatedAt: new Date().toISOString(),
      pages: {
        "/evil": "../../../../etc/passwd",
      },
    };
    await fs.writeFile(
      path.join(outDir, PRERENDER_INDEX_FILE),
      JSON.stringify(malicious),
      "utf-8"
    );
    const idx = await loadPrerenderIndex(root, outDir);
    expect(idx).not.toBeNull();
    const file = resolvePrerenderedFile(idx!, root, outDir, "/evil");
    expect(file).toBeNull();
  });

  it("(case 12) mixed static + dynamic in one run", async () => {
    const root = await mkTmp();
    const outDir = path.join(root, ".mandu", "prerendered");

    const result = await prerenderRoutes(
      {
        version: 1,
        routes: [
          {
            kind: "page",
            id: "home",
            pattern: "/",
            module: "app/page.tsx",
            componentModule: "app/page.tsx",
          },
          {
            kind: "page",
            id: "about",
            pattern: "/about",
            module: "app/about/page.tsx",
            componentModule: "app/about/page.tsx",
          },
          {
            kind: "page",
            id: "docs",
            pattern: "/docs/:slug",
            module: "app/docs/[slug]/page.tsx",
            componentModule: "app/docs/[slug]/page.tsx",
          },
        ],
      },
      htmlHandler(),
      {
        rootDir: root,
        outDir,
        writeIndex: true,
        importModule: async (specifier: string) => {
          if (specifier.includes("[slug]")) {
            return {
              generateStaticParams: async () => [{ slug: "intro" }],
            };
          }
          return {};
        },
      }
    );

    expect(result.errors).toEqual([]);
    expect(result.paths.sort()).toEqual(
      ["/", "/about", "/docs/intro"]
    );
  });
});
