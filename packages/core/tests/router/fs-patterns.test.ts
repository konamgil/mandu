/**
 * FS Patterns Tests
 */
import { describe, it, expect } from "bun:test";
import {
  parseSegment,
  parseSegments,
  segmentsToPattern,
  pathToPattern,
  detectFileType,
  isPrivateFolder,
  isGroupFolder,
  generateRouteId,
  validateSegments,
  patternsConflict,
} from "../../src/router/fs-patterns";

describe("parseSegment", () => {
  it("should parse static segment", () => {
    const result = parseSegment("blog");
    expect(result).toEqual({
      raw: "blog",
      type: "static",
    });
  });

  it("should parse dynamic segment", () => {
    const result = parseSegment("[slug]");
    expect(result).toEqual({
      raw: "[slug]",
      type: "dynamic",
      paramName: "slug",
    });
  });

  it("should parse catch-all segment", () => {
    const result = parseSegment("[...path]");
    expect(result).toEqual({
      raw: "[...path]",
      type: "catchAll",
      paramName: "path",
    });
  });

  it("should parse optional catch-all segment", () => {
    const result = parseSegment("[[...path]]");
    expect(result).toEqual({
      raw: "[[...path]]",
      type: "optionalCatchAll",
      paramName: "path",
    });
  });

  it("should parse group segment", () => {
    const result = parseSegment("(marketing)");
    expect(result).toEqual({
      raw: "(marketing)",
      type: "group",
    });
  });
});

describe("parseSegments", () => {
  it("should parse path with multiple segments", () => {
    const result = parseSegments("blog/[slug]/comments/page.tsx");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ raw: "blog", type: "static" });
    expect(result[1]).toEqual({ raw: "[slug]", type: "dynamic", paramName: "slug" });
    expect(result[2]).toEqual({ raw: "comments", type: "static" });
  });

  it("should return empty array for root", () => {
    const result = parseSegments("page.tsx");
    expect(result).toEqual([]);
  });

  it("should handle group folders", () => {
    const result = parseSegments("(marketing)/pricing/page.tsx");
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("group");
    expect(result[1].raw).toBe("pricing");
  });
});

describe("segmentsToPattern", () => {
  it("should convert static segments", () => {
    const segments = [
      { raw: "blog", type: "static" as const },
      { raw: "posts", type: "static" as const },
    ];
    expect(segmentsToPattern(segments)).toBe("/blog/posts");
  });

  it("should convert dynamic segments", () => {
    const segments = [
      { raw: "blog", type: "static" as const },
      { raw: "[slug]", type: "dynamic" as const, paramName: "slug" },
    ];
    expect(segmentsToPattern(segments)).toBe("/blog/:slug");
  });

  it("should convert catch-all segments", () => {
    const segments = [
      { raw: "docs", type: "static" as const },
      { raw: "[...path]", type: "catchAll" as const, paramName: "path" },
    ];
    expect(segmentsToPattern(segments)).toBe("/docs/:path*");
  });

  it("should convert optional catch-all segments", () => {
    const segments = [
      { raw: "docs", type: "static" as const },
      { raw: "[[...path]]", type: "optionalCatchAll" as const, paramName: "path" },
    ];
    expect(segmentsToPattern(segments)).toBe("/docs/:path*?");
  });

  it("should exclude group segments from URL", () => {
    const segments = [
      { raw: "(marketing)", type: "group" as const },
      { raw: "pricing", type: "static" as const },
    ];
    expect(segmentsToPattern(segments)).toBe("/pricing");
  });

  it("should return / for empty segments", () => {
    expect(segmentsToPattern([])).toBe("/");
  });
});

describe("pathToPattern", () => {
  it("should convert file path to URL pattern", () => {
    expect(pathToPattern("blog/[slug]/page.tsx")).toBe("/blog/:slug");
    expect(pathToPattern("page.tsx")).toBe("/");
    expect(pathToPattern("api/users/route.ts")).toBe("/api/users");
    expect(pathToPattern("(marketing)/pricing/page.tsx")).toBe("/pricing");
  });
});

describe("detectFileType", () => {
  it("should detect page files", () => {
    expect(detectFileType("page.tsx")).toBe("page");
    expect(detectFileType("page.ts")).toBe("page");
    expect(detectFileType("page.jsx")).toBe("page");
  });

  it("should detect route files", () => {
    expect(detectFileType("route.ts")).toBe("route");
    expect(detectFileType("route.js")).toBe("route");
  });

  it("should detect layout files", () => {
    expect(detectFileType("layout.tsx")).toBe("layout");
  });

  it("should detect island files", () => {
    expect(detectFileType("comments.island.tsx")).toBe("island");
    expect(detectFileType("counter.island.ts")).toBe("island");
  });

  it("should detect special files", () => {
    expect(detectFileType("loading.tsx")).toBe("loading");
    expect(detectFileType("error.tsx")).toBe("error");
    expect(detectFileType("not-found.tsx")).toBe("not-found");
  });

  it("should return null for unknown files", () => {
    expect(detectFileType("utils.ts")).toBeNull();
    expect(detectFileType("Component.tsx")).toBeNull();
  });
});

describe("isPrivateFolder", () => {
  it("should identify private folders", () => {
    expect(isPrivateFolder("_components")).toBe(true);
    expect(isPrivateFolder("_utils")).toBe(true);
    expect(isPrivateFolder("components")).toBe(false);
  });
});

describe("isGroupFolder", () => {
  it("should identify group folders", () => {
    expect(isGroupFolder("(marketing)")).toBe(true);
    expect(isGroupFolder("(auth)")).toBe(true);
    expect(isGroupFolder("marketing")).toBe(false);
    expect(isGroupFolder("[slug]")).toBe(false);
  });
});

describe("generateRouteId", () => {
  it("should generate route ID from path", () => {
    expect(generateRouteId("page.tsx")).toBe("index");
    expect(generateRouteId("blog/page.tsx")).toBe("blog");
    expect(generateRouteId("blog/[slug]/page.tsx")).toBe("blog-$slug");
    expect(generateRouteId("api/users/route.ts")).toBe("api-users");
  });

  it("should handle catch-all", () => {
    expect(generateRouteId("docs/[...path]/page.tsx")).toBe("docs-$path");
  });

  it("should exclude groups from ID", () => {
    expect(generateRouteId("(marketing)/pricing/page.tsx")).toBe("pricing");
  });
});

describe("validateSegments", () => {
  it("should validate valid segments", () => {
    const segments = [
      { raw: "blog", type: "static" as const },
      { raw: "[slug]", type: "dynamic" as const, paramName: "slug" },
    ];
    expect(validateSegments(segments)).toEqual({ valid: true });
  });

  it("should reject catch-all not at end", () => {
    const segments = [
      { raw: "[...path]", type: "catchAll" as const, paramName: "path" },
      { raw: "extra", type: "static" as const },
    ];
    const result = validateSegments(segments);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("last segment");
  });
});

describe("patternsConflict", () => {
  it("should detect identical patterns", () => {
    expect(patternsConflict("/blog/:slug", "/blog/:slug")).toBe(true);
  });

  it("should detect patterns with different param names", () => {
    expect(patternsConflict("/blog/:slug", "/blog/:id")).toBe(true);
  });

  it("should not conflict different patterns", () => {
    expect(patternsConflict("/blog/:slug", "/posts/:id")).toBe(false);
  });

  it("should handle trailing slashes", () => {
    expect(patternsConflict("/blog/", "/blog")).toBe(true);
  });
});
