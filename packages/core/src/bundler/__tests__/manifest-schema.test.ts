/**
 * Phase 7.2 R1 Agent C (H2) — BundleManifest schema validation tests.
 *
 * Covers the primary Medium-severity finding from the Phase 7.1 audit
 * (`docs/security/phase-7-1-audit.md` §M-02): tampered manifest injection
 * via `shared.fastRefresh.{glue,runtime}` URL replacement. The schema
 * now rejects such tampers at load time; the contract asserted below
 * pins the precise shape so regressions fail fast.
 *
 * References:
 *   docs/security/phase-7-1-audit.md §M-02
 *   docs/bun/phase-7-2-team-plan.md §3 Agent C H2
 *   packages/core/src/bundler/manifest-schema.ts
 */

import { describe, expect, test } from "bun:test";
import {
  BundleManifestSchema,
  MAX_MANIFEST_URL_LEN,
  ManifestValidationError,
  SAFE_MANDU_URL_REGEX,
  isSafeManduUrl,
  safeValidateBundleManifest,
  validateBundleManifest,
} from "../manifest-schema";

/** Known-good manifest, used as the basis for mutation tests. */
const VALID_MANIFEST = {
  version: 1,
  buildTime: "2026-04-19T00:00:00.000Z",
  env: "development" as const,
  bundles: {
    page: {
      js: "/.mandu/client/page.js",
      dependencies: [],
      priority: "visible" as const,
    },
  },
  shared: {
    runtime: "/.mandu/client/_runtime.js",
    vendor: "/.mandu/client/_vendor-react.js",
    fastRefresh: {
      runtime: "/.mandu/client/_fast-refresh-runtime.js",
      glue: "/.mandu/client/_vendor-react-refresh.js",
    },
  },
};

// ═══════════════════════════════════════════════════════════════════
// Section A — primitive URL predicate
// ═══════════════════════════════════════════════════════════════════

describe("manifest-schema — isSafeManduUrl", () => {
  test("[A1] accepts bundler-shape URLs", () => {
    expect(isSafeManduUrl("/.mandu/client/page.js")).toBe(true);
    expect(isSafeManduUrl("/.mandu/client/_vendor-react.js")).toBe(true);
    expect(isSafeManduUrl("/.mandu/client/nested/island.js")).toBe(true);
    expect(isSafeManduUrl("/.mandu/client/styles.css")).toBe(true);
  });

  test("[A2] rejects absolute URLs with protocol", () => {
    expect(isSafeManduUrl("https://evil.example.com/steal.js")).toBe(false);
    expect(isSafeManduUrl("http://evil.example.com/x.js")).toBe(false);
    expect(isSafeManduUrl("data:application/javascript,alert(1)")).toBe(false);
    expect(isSafeManduUrl("javascript:alert(1)")).toBe(false);
  });

  test("[A3] rejects path traversal", () => {
    expect(isSafeManduUrl("/.mandu/client/../secret.js")).toBe(false);
    expect(isSafeManduUrl("/.mandu/client/a/../b.js")).toBe(false);
    expect(isSafeManduUrl("/.mandu/..//client/page.js")).toBe(false);
  });

  test("[A4] rejects empty / overlong / wrong-shape", () => {
    expect(isSafeManduUrl("")).toBe(false);
    expect(isSafeManduUrl("x".repeat(MAX_MANIFEST_URL_LEN + 1))).toBe(false);
    expect(isSafeManduUrl("/not-mandu/client/page.js")).toBe(false);
    expect(isSafeManduUrl("/.mandu/client/page.txt")).toBe(false);
    expect(isSafeManduUrl("page.js")).toBe(false); // relative
  });

  test("[A5] rejects control / special characters", () => {
    expect(isSafeManduUrl("/.mandu/client/page\n.js")).toBe(false);
    expect(isSafeManduUrl("/.mandu/client/page<script>.js")).toBe(false);
    expect(isSafeManduUrl('/.mandu/client/page".js')).toBe(false);
    expect(isSafeManduUrl("/.mandu/client/page\\.js")).toBe(false);
  });

  test("[A6] non-string input returns false (Zod pre-check)", () => {
    expect(isSafeManduUrl(123)).toBe(false);
    expect(isSafeManduUrl(null)).toBe(false);
    expect(isSafeManduUrl(undefined)).toBe(false);
    expect(isSafeManduUrl({})).toBe(false);
  });

  test("[A7] SAFE_MANDU_URL_REGEX anchors correctly", () => {
    // Must match start AND end — no embedded matches permitted
    expect(SAFE_MANDU_URL_REGEX.test("/.mandu/client/page.js")).toBe(true);
    expect(SAFE_MANDU_URL_REGEX.test("/prefix/.mandu/client/page.js")).toBe(false);
    expect(SAFE_MANDU_URL_REGEX.test("/.mandu/client/page.js?t=1")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Section B — full manifest validation
// ═══════════════════════════════════════════════════════════════════

describe("manifest-schema — validateBundleManifest", () => {
  test("[B1] accepts a valid dev manifest", () => {
    const ok = validateBundleManifest(VALID_MANIFEST);
    expect(ok.version).toBe(1);
    expect(ok.shared.fastRefresh?.glue).toBe("/.mandu/client/_vendor-react-refresh.js");
  });

  test("[B2] rejects tampered shared.fastRefresh.glue URL (https://evil.example.com)", () => {
    const tampered = {
      ...VALID_MANIFEST,
      shared: {
        ...VALID_MANIFEST.shared,
        fastRefresh: {
          runtime: "/.mandu/client/_fast-refresh-runtime.js",
          glue: "https://evil.example.com/steal.js",
        },
      },
    };
    expect(() => validateBundleManifest(tampered)).toThrow(ManifestValidationError);
  });

  test("[B3] rejects tampered shared.fastRefresh.runtime URL (data: scheme)", () => {
    const tampered = {
      ...VALID_MANIFEST,
      shared: {
        ...VALID_MANIFEST.shared,
        fastRefresh: {
          runtime: "data:application/javascript;base64,YWxlcnQoMSk=",
          glue: "/.mandu/client/_vendor-react-refresh.js",
        },
      },
    };
    expect(() => validateBundleManifest(tampered)).toThrow(ManifestValidationError);
  });

  test("[B4] rejects missing version", () => {
    const invalid = { ...VALID_MANIFEST };
    delete (invalid as Record<string, unknown>).version;
    expect(() => validateBundleManifest(invalid)).toThrow(ManifestValidationError);
  });

  test("[B5] rejects missing shared block", () => {
    const invalid = { ...VALID_MANIFEST };
    delete (invalid as Record<string, unknown>).shared;
    expect(() => validateBundleManifest(invalid)).toThrow(ManifestValidationError);
  });

  test("[B6] rejects unknown top-level keys (strict mode catches schema drift)", () => {
    const withExtra = {
      ...VALID_MANIFEST,
      evilField: { steal: "everything" },
    };
    expect(() => validateBundleManifest(withExtra)).toThrow(ManifestValidationError);
  });

  test("[B7] rejects negative / zero / non-integer version", () => {
    expect(() => validateBundleManifest({ ...VALID_MANIFEST, version: 0 })).toThrow();
    expect(() => validateBundleManifest({ ...VALID_MANIFEST, version: -1 })).toThrow();
    expect(() => validateBundleManifest({ ...VALID_MANIFEST, version: 1.5 })).toThrow();
  });

  test("[B8] rejects traversal in bundles[].js", () => {
    const bad = {
      ...VALID_MANIFEST,
      bundles: {
        page: {
          js: "/.mandu/client/../evil.js",
          dependencies: [],
          priority: "visible" as const,
        },
      },
    };
    expect(() => validateBundleManifest(bad)).toThrow(ManifestValidationError);
  });

  test("[B9] rejects overlong URL in shared.runtime", () => {
    const bad = {
      ...VALID_MANIFEST,
      shared: {
        ...VALID_MANIFEST.shared,
        runtime: "/.mandu/client/" + "a".repeat(MAX_MANIFEST_URL_LEN) + ".js",
      },
    };
    expect(() => validateBundleManifest(bad)).toThrow(ManifestValidationError);
  });

  test("[B10] accepts manifest without optional fastRefresh (prod shape)", () => {
    const prodish = {
      ...VALID_MANIFEST,
      env: "production" as const,
      shared: {
        runtime: VALID_MANIFEST.shared.runtime,
        vendor: VALID_MANIFEST.shared.vendor,
        // no fastRefresh
      },
    };
    const ok = validateBundleManifest(prodish);
    expect(ok.shared.fastRefresh).toBeUndefined();
  });

  test("[B11] ManifestValidationError carries structured issue list", () => {
    const tampered = {
      ...VALID_MANIFEST,
      shared: {
        ...VALID_MANIFEST.shared,
        fastRefresh: {
          runtime: "https://evil.example.com/r.js",
          glue: "https://evil.example.com/g.js",
        },
      },
    };
    try {
      validateBundleManifest(tampered);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestValidationError);
      const verr = err as ManifestValidationError;
      expect(verr.issues.length).toBeGreaterThanOrEqual(2);
      // Both tampered URLs must be reported
      const paths = verr.issues.map((i) => i.path).join(" ");
      expect(paths).toContain("shared.fastRefresh.runtime");
      expect(paths).toContain("shared.fastRefresh.glue");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Section C — safeValidateBundleManifest (non-throwing)
// ═══════════════════════════════════════════════════════════════════

describe("manifest-schema — safeValidateBundleManifest", () => {
  test("[C1] ok:true with a valid manifest", () => {
    const r = safeValidateBundleManifest(VALID_MANIFEST);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.shared.fastRefresh?.glue).toBe(
        "/.mandu/client/_vendor-react-refresh.js",
      );
    }
  });

  test("[C2] ok:false with issues list on invalid manifest", () => {
    const bad = { ...VALID_MANIFEST, version: "not a number" as unknown };
    const r = safeValidateBundleManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.length).toBeGreaterThan(0);
      expect(r.issues[0].path).toBe("version");
    }
  });

  test("[C3] BundleManifestSchema.safeParse matches the public validator", () => {
    // Sanity: both paths agree on accept/reject for the same input
    const rp = BundleManifestSchema.safeParse(VALID_MANIFEST);
    expect(rp.success).toBe(true);
    const rv = safeValidateBundleManifest(VALID_MANIFEST);
    expect(rv.ok).toBe(true);
  });
});
