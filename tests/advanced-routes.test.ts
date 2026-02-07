/**
 * Advanced Routes Tests
 *
 * Catch-all, Optional catch-all, Loading/Error 기능 테스트
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Router, createRouter } from "../packages/core/src/runtime/router";
import type { RouteSpec } from "../packages/core/src/spec/schema";
import { parseSegment, segmentsToPattern, pathToPattern } from "../packages/core/src/router/fs-patterns";

// ═══════════════════════════════════════════════════════════════════════════
// Catch-all Pattern Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Catch-all Patterns", () => {
  describe("parseSegment", () => {
    it("should parse catch-all segment [...path]", () => {
      const segment = parseSegment("[...path]");
      expect(segment.type).toBe("catchAll");
      expect(segment.paramName).toBe("path");
    });

    it("should parse optional catch-all [[...path]]", () => {
      const segment = parseSegment("[[...path]]");
      expect(segment.type).toBe("optionalCatchAll");
      expect(segment.paramName).toBe("path");
    });
  });

  describe("segmentsToPattern", () => {
    it("should convert catch-all to :param*", () => {
      expect(segmentsToPattern([
        { raw: "docs", type: "static" },
        { raw: "[...slug]", type: "catchAll", paramName: "slug" },
      ])).toBe("/docs/:slug*");
    });

    it("should convert optional catch-all to :param*?", () => {
      expect(segmentsToPattern([
        { raw: "docs", type: "static" },
        { raw: "[[...slug]]", type: "optionalCatchAll", paramName: "slug" },
      ])).toBe("/docs/:slug*?");
    });
  });

  describe("pathToPattern", () => {
    it("should convert catch-all file path", () => {
      expect(pathToPattern("docs/[...slug]/page.tsx")).toBe("/docs/:slug*");
    });

    it("should convert optional catch-all file path", () => {
      expect(pathToPattern("docs/[[...slug]]/page.tsx")).toBe("/docs/:slug*?");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Router Catch-all Matching Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Router Catch-all Matching", () => {
  describe("Catch-all (:param*)", () => {
    let router: Router;

    beforeEach(() => {
      const routes: RouteSpec[] = [
        {
          id: "docs-catch-all",
          pattern: "/docs/:path*",
          kind: "page",
          module: "app/docs/[...path]/page.tsx",
          componentModule: "app/docs/[...path]/page.tsx",
        },
        {
          id: "docs-index",
          pattern: "/docs",
          kind: "page",
          module: "app/docs/page.tsx",
          componentModule: "app/docs/page.tsx",
        },
      ];
      router = createRouter(routes);
    });

    it("should match /docs/intro", () => {
      const result = router.match("/docs/intro");
      expect(result).not.toBeNull();
      expect(result!.route.id).toBe("docs-catch-all");
      expect(result!.params.path).toBe("intro");
    });

    it("should match /docs/guide/getting-started", () => {
      const result = router.match("/docs/guide/getting-started");
      expect(result).not.toBeNull();
      expect(result!.route.id).toBe("docs-catch-all");
      expect(result!.params.path).toBe("guide/getting-started");
    });

    it("should NOT match /docs (no path)", () => {
      const result = router.match("/docs");
      expect(result).not.toBeNull();
      expect(result!.route.id).toBe("docs-index"); // 별도 라우트 매칭
    });
  });

  describe("Optional Catch-all (:param*?)", () => {
    let router: Router;

    beforeEach(() => {
      const routes: RouteSpec[] = [
        {
          id: "docs-optional",
          pattern: "/docs/:path*?",
          kind: "page",
          module: "app/docs/[[...path]]/page.tsx",
          componentModule: "app/docs/[[...path]]/page.tsx",
        },
      ];
      router = createRouter(routes);
    });

    it("should match /docs (empty path)", () => {
      const result = router.match("/docs");
      expect(result).not.toBeNull();
      expect(result!.route.id).toBe("docs-optional");
      // Optional catch-all at root: params.path is undefined (not set)
      expect(result!.params.path).toBeUndefined();
    });

    it("should match /docs/intro", () => {
      const result = router.match("/docs/intro");
      expect(result).not.toBeNull();
      expect(result!.route.id).toBe("docs-optional");
      expect(result!.params.path).toBe("intro");
    });

    it("should match /docs/guide/advanced/topics", () => {
      const result = router.match("/docs/guide/advanced/topics");
      expect(result).not.toBeNull();
      expect(result!.route.id).toBe("docs-optional");
      expect(result!.params.path).toBe("guide/advanced/topics");
    });
  });

  describe("Mixed Routes Priority", () => {
    let router: Router;

    beforeEach(() => {
      const routes: RouteSpec[] = [
        // Static route - highest priority
        {
          id: "docs-api",
          pattern: "/docs/api",
          kind: "page",
          module: "app/docs/api/page.tsx",
          componentModule: "app/docs/api/page.tsx",
        },
        // Dynamic route - medium priority
        {
          id: "docs-single",
          pattern: "/docs/:slug",
          kind: "page",
          module: "app/docs/[slug]/page.tsx",
          componentModule: "app/docs/[slug]/page.tsx",
        },
        // Catch-all - lowest priority
        {
          id: "docs-catch-all",
          pattern: "/docs/:path*",
          kind: "page",
          module: "app/docs/[...path]/page.tsx",
          componentModule: "app/docs/[...path]/page.tsx",
        },
      ];
      router = createRouter(routes);
    });

    it("should prefer static route over catch-all", () => {
      const result = router.match("/docs/api");
      expect(result).not.toBeNull();
      expect(result!.route.id).toBe("docs-api");
    });

    it("should prefer dynamic route over catch-all for single segment", () => {
      const result = router.match("/docs/intro");
      expect(result).not.toBeNull();
      expect(result!.route.id).toBe("docs-single");
      expect(result!.params.slug).toBe("intro");
    });

    it("should use catch-all for multi-segment paths", () => {
      const result = router.match("/docs/guide/setup");
      expect(result).not.toBeNull();
      expect(result!.route.id).toBe("docs-catch-all");
      expect(result!.params.path).toBe("guide/setup");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Boundary Components Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Boundary Components", () => {
  it("should import PageBoundary", async () => {
    const { PageBoundary, LoadingBoundary, ErrorBoundary } = await import(
      "../packages/core/src/runtime/boundary"
    );

    expect(PageBoundary).toBeDefined();
    expect(LoadingBoundary).toBeDefined();
    expect(ErrorBoundary).toBeDefined();
  });

  it("should import default fallback components", async () => {
    const { DefaultLoading, DefaultError } = await import(
      "../packages/core/src/runtime/boundary"
    );

    expect(DefaultLoading).toBeDefined();
    expect(DefaultError).toBeDefined();
  });
});
