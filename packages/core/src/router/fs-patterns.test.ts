/**
 * fs-patterns — pattern detection unit tests (Phase 18.β)
 *
 * Focused counterpart to tests/router/route-conventions.test.ts —
 * co-located with the module so `bun test src/router/` alone exercises
 * all detection paths without needing a tmpdir fixture. Keeps the
 * per-symbol tests cheap enough to be run in watch mode.
 */
import { describe, it, expect } from "bun:test";
import {
  detectFileType,
  parseSegment,
  parseSegments,
  segmentsToPattern,
  isGroupFolder,
  validateSegments,
} from "./fs-patterns";

describe("fs-patterns — convention file detection", () => {
  it("detects loading.tsx / loading.ts / loading.jsx / loading.js", () => {
    expect(detectFileType("loading.tsx")).toBe("loading");
    expect(detectFileType("loading.ts")).toBe("loading");
    expect(detectFileType("loading.jsx")).toBe("loading");
    expect(detectFileType("loading.js")).toBe("loading");
  });

  it("detects error.tsx / error.ts", () => {
    expect(detectFileType("error.tsx")).toBe("error");
    expect(detectFileType("error.ts")).toBe("error");
  });

  it("detects not-found.tsx / not-found.ts", () => {
    expect(detectFileType("not-found.tsx")).toBe("not-found");
    expect(detectFileType("not-found.ts")).toBe("not-found");
  });

  it("does NOT treat notfound.tsx (missing dash) as a convention", () => {
    expect(detectFileType("notfound.tsx")).toBeNull();
    expect(detectFileType("not_found.tsx")).toBeNull();
  });

  it("does NOT confuse loading.island.tsx for a loading convention", () => {
    // Island suffix wins first (detectFileType checks island before loading)
    expect(detectFileType("loading.island.tsx")).toBe("island");
  });
});

describe("fs-patterns — route groups", () => {
  it("identifies (marketing) as a group segment", () => {
    expect(isGroupFolder("(marketing)")).toBe(true);
    expect(isGroupFolder("(auth)")).toBe(true);
    expect(isGroupFolder("marketing")).toBe(false);
    expect(isGroupFolder("(not-matching")).toBe(false);
  });

  it("parses (name) as type=group with no param", () => {
    const seg = parseSegment("(marketing)");
    expect(seg.type).toBe("group");
    expect(seg.paramName).toBeUndefined();
  });

  it("strips group segments from URL patterns", () => {
    expect(segmentsToPattern(parseSegments("(mkt)/pricing/page.tsx"))).toBe("/pricing");
    expect(segmentsToPattern(parseSegments("(a)/(b)/c/page.tsx"))).toBe("/c");
  });
});

describe("fs-patterns — optional catch-all", () => {
  it("parses [[...slug]] as optionalCatchAll with paramName", () => {
    const seg = parseSegment("[[...slug]]");
    expect(seg.type).toBe("optionalCatchAll");
    expect(seg.paramName).toBe("slug");
  });

  it("emits :param*? pattern for optionalCatchAll", () => {
    const pattern = segmentsToPattern(parseSegments("docs/[[...path]]/page.tsx"));
    expect(pattern).toBe("/docs/:path*?");
  });

  it("distinguishes [[...x]] (optional) from [...x] (required)", () => {
    expect(parseSegment("[...x]").type).toBe("catchAll");
    expect(parseSegment("[[...x]]").type).toBe("optionalCatchAll");
  });

  it("rejects catch-all mid-path via validateSegments", () => {
    const segs = parseSegments("[[...any]]/after/page.tsx");
    const r = validateSegments(segs);
    expect(r.valid).toBe(false);
  });

  it("accepts optional catch-all at the end", () => {
    const segs = parseSegments("docs/[[...rest]]/page.tsx");
    const r = validateSegments(segs);
    expect(r.valid).toBe(true);
  });
});
