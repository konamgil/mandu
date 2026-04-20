/**
 * Phase 18.μ — synthesizeLocaleRoutes regression tests.
 *
 * Verifies that path-prefix synthesis produces correct route variants
 * without mutating the source routes, preserves the default-locale's
 * unprefixed form (SEO parity), and does not duplicate metadata routes.
 */
import { describe, it, expect } from "bun:test";
import { synthesizeLocaleRoutes } from "../../src/router";
import type { FSRouteConfig } from "../../src/router";

function mkPage(id: string, pattern: string): FSRouteConfig {
  return {
    id,
    segments: pattern === "/" ? [] : pattern
      .split("/")
      .filter(Boolean)
      .map((raw) => ({ raw, type: "static" as const })),
    pattern,
    kind: "page",
    module: `app${pattern}/page.tsx`,
    componentModule: `app${pattern}/page.tsx`,
    layoutChain: [],
    sourceFile: `/abs/app${pattern}/page.tsx`,
  };
}

function mkApi(id: string, pattern: string): FSRouteConfig {
  return {
    ...mkPage(id, pattern),
    kind: "api",
    methods: ["GET"],
  };
}

function mkMetadata(kind: "sitemap" | "robots"): FSRouteConfig {
  return {
    id: `metadata-${kind}`,
    segments: [],
    pattern: kind === "sitemap" ? "/sitemap.xml" : "/robots.txt",
    kind: "metadata",
    module: `app/${kind}.ts`,
    layoutChain: [],
    sourceFile: `/abs/app/${kind}.ts`,
    metadataKind: kind === "sitemap" ? "sitemap" : "robots",
    contentType: kind === "sitemap" ? "application/xml" : "text/plain",
  };
}

describe("synthesizeLocaleRoutes", () => {
  it("is a no-op when no locales provided", () => {
    const routes = [mkPage("home", "/"), mkPage("about", "/about")];
    const out = synthesizeLocaleRoutes(routes, { locales: [], defaultLocale: "en" });
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.pattern)).toEqual(["/", "/about"]);
  });

  it("synthesizes a locale prefix for each non-default locale", () => {
    const routes = [mkPage("home", "/"), mkPage("about", "/about")];
    const out = synthesizeLocaleRoutes(routes, {
      locales: ["en", "ko"],
      defaultLocale: "en",
    });
    const patterns = out.map((r) => r.pattern).sort();
    expect(patterns).toEqual(["/", "/about", "/ko", "/ko/about"]);
  });

  it("preserves the default locale's unprefixed copy (SEO parity)", () => {
    const routes = [mkPage("home", "/"), mkPage("docs", "/docs")];
    const out = synthesizeLocaleRoutes(routes, {
      locales: ["en", "ko", "ja"],
      defaultLocale: "en",
    });
    // 2 original + 4 synthesized (2 locales × 2 routes) = 6
    expect(out).toHaveLength(6);
    expect(out.some((r) => r.pattern === "/" && r.id === "home")).toBe(true);
    expect(out.some((r) => r.pattern === "/ko/docs")).toBe(true);
    expect(out.some((r) => r.pattern === "/ja/docs")).toBe(true);
  });

  it("assigns unique IDs via <locale>::<id> prefix", () => {
    const routes = [mkPage("home", "/")];
    const out = synthesizeLocaleRoutes(routes, {
      locales: ["en", "ko"],
      defaultLocale: "en",
    });
    const ids = out.map((r) => r.id).sort();
    expect(ids).toEqual(["home", "ko::home"]);
  });

  it("preserves module paths (same loader on disk)", () => {
    const routes = [mkPage("docs", "/docs")];
    const out = synthesizeLocaleRoutes(routes, {
      locales: ["en", "ko"],
      defaultLocale: "en",
    });
    for (const r of out) {
      expect(r.module).toBe("app/docs/page.tsx");
    }
  });

  it("prepends the locale as a static segment for priority ordering", () => {
    const routes = [mkPage("users", "/users/:id")];
    const out = synthesizeLocaleRoutes(routes, {
      locales: ["en", "ko"],
      defaultLocale: "en",
    });
    const ko = out.find((r) => r.id === "ko::users")!;
    expect(ko.segments[0]).toEqual({ raw: "ko", type: "static" });
  });

  it("does NOT duplicate metadata routes (sitemap/robots stay root)", () => {
    const routes = [mkPage("home", "/"), mkMetadata("sitemap"), mkMetadata("robots")];
    const out = synthesizeLocaleRoutes(routes, {
      locales: ["en", "ko"],
      defaultLocale: "en",
    });
    const metadata = out.filter((r) => r.kind === "metadata");
    expect(metadata).toHaveLength(2);
    expect(metadata.some((r) => r.pattern === "/sitemap.xml")).toBe(true);
    expect(metadata.some((r) => r.pattern === "/ko/sitemap.xml")).toBe(false);
  });

  it("synthesizes API routes alongside pages", () => {
    const routes = [mkApi("api-users", "/api/users")];
    const out = synthesizeLocaleRoutes(routes, {
      locales: ["en", "ko"],
      defaultLocale: "en",
    });
    expect(out).toHaveLength(2);
    expect(out.some((r) => r.pattern === "/api/users" && r.kind === "api")).toBe(true);
    expect(out.some((r) => r.pattern === "/ko/api/users" && r.kind === "api")).toBe(true);
  });

  it("throws when defaultLocale is not in locales", () => {
    expect(() =>
      synthesizeLocaleRoutes([mkPage("home", "/")], {
        locales: ["en", "ko"],
        defaultLocale: "ja",
      })
    ).toThrow(/defaultLocale/);
  });

  it("does not mutate the source routes array or items", () => {
    const routes = [mkPage("home", "/")];
    const originalPattern = routes[0]!.pattern;
    const originalId = routes[0]!.id;
    synthesizeLocaleRoutes(routes, { locales: ["en", "ko"], defaultLocale: "en" });
    expect(routes[0]!.pattern).toBe(originalPattern);
    expect(routes[0]!.id).toBe(originalId);
    expect(routes).toHaveLength(1);
  });
});
