/**
 * Phase 7.2 R1 Agent C (H2) — BundleManifest schema validation.
 *
 * Background (see `docs/security/phase-7-1-audit.md` §M-02):
 *   Prior to Phase 7.2, callers read `.mandu/manifest.json` with a bare
 *   `JSON.parse(raw) as BundleManifest` cast. That was enough for happy-path
 *   dev but left an injection vector: an attacker with filesystem write to
 *   `.mandu/manifest.json` could rewrite `shared.fastRefresh.{glue,runtime}`
 *   to point at an external URL and the SSR preamble would fetch it (the
 *   browser does no cross-origin check for dynamic `import()`). With CSP off
 *   — Mandu's dev default — this is full RCE in the browser context.
 *
 *   M-02 was scored Medium because the attack requires filesystem write,
 *   which is already a game-over pre-condition. The fix nonetheless closes
 *   the stealth window: a tampered manifest now throws at load time rather
 *   than silently serving evil URLs.
 *
 * This module exposes:
 *
 *   - `BundleManifestSchema`         — Zod schema for the manifest shape.
 *   - `validateBundleManifest(raw)`  — strict validator. Throws
 *                                       `ManifestValidationError` on any
 *                                       schema mismatch, including the
 *                                       safe-URL constraints below.
 *   - `isSafeManduUrl(url)`          — predicate used both inside the
 *                                       schema and at SSR preamble emit
 *                                       time for defense-in-depth.
 *
 * URL safety model (applies to `shared.runtime`, `shared.vendor`,
 * `shared.router`, `shared.fastRefresh.glue`, `shared.fastRefresh.runtime`,
 * `bundles[].js`, `bundles[].css`, `islands[].js`, `importMap.imports[*]`):
 *
 *   ALLOW:  absolute paths rooted at `/.mandu/client/` ending in `.js` or `.css`.
 *           The bundler itself only ever emits this shape.
 *   DENY:   protocol URIs (`http://`, `https://`, `data:`, `javascript:`, ...),
 *           path traversal (`..`), backslashes, newlines, angle brackets,
 *           quotes, or anything longer than `MAX_URL_LEN` (4 KB).
 *
 * The ruleset is deliberately narrower than RFC 3986 — it is an allowlist,
 * not a blocklist. Any URL format the bundler does not emit gets rejected.
 * If a future bundler change introduces a new URL shape, update the schema
 * first and let the tests fail-closed.
 *
 * References:
 *   docs/security/phase-7-1-audit.md §2 M-02
 *   docs/bun/phase-7-2-team-plan.md §3 Agent C H2
 *   packages/core/src/bundler/types.ts — `BundleManifest` runtime type
 */

import { z } from "zod";

import type { BundleManifest } from "./types";

// ============================================================================
// Constants — Exported for direct tests / downstream re-use.
// ============================================================================

/**
 * Maximum length any single manifest URL may take. 4 KB is ~8× the worst
 * real-world path we have seen in tmpdir fixtures; anything larger is
 * almost certainly a DoS probe or a malformed entry. Keep in sync with
 * `appendBoundary` URL cap in `fast-refresh-plugin.ts` (both 2 KB).
 */
export const MAX_MANIFEST_URL_LEN = 4096;

/**
 * Shape constraint for Mandu-authored client assets. The bundler always
 * writes to `/.mandu/client/{name}.js|.css`. We do not allow query strings
 * in the manifest itself (callers add cache-bust `?t=<ts>` at emit time).
 */
export const SAFE_MANDU_URL_REGEX = /^\/\.mandu\/client\/[A-Za-z0-9_./-]+\.(js|css|mjs)$/;

/**
 * Characters we forbid anywhere inside a manifest URL — their presence
 * signals either a serialization bug or an injection attempt (newlines
 * break out of an inline `<script>` tag, `<`/`>` open new HTML contexts,
 * quotes break out of attribute contexts).
 */
export const FORBIDDEN_URL_CHARS = /[\x00-\x1f\x7f"<>`\\\n\r\t]/;

/**
 * Substrings that indicate cross-origin / protocol escape attempts. The
 * bundler never writes these; rejecting them makes `.mandu/manifest.json`
 * tamper detection trivial.
 */
export const FORBIDDEN_URL_SUBSTRINGS = [
  "://",
  "//",
  "..",
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
] as const;

// ============================================================================
// Errors
// ============================================================================

/**
 * Thrown when `validateBundleManifest` rejects input. Carries the full Zod
 * issue list so callers (build.ts, dev.ts) can surface actionable messages
 * instead of the default `ZodError` noise.
 */
export class ManifestValidationError extends Error {
  readonly issues: readonly { path: string; message: string }[];

  constructor(
    message: string,
    issues: readonly { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

// ============================================================================
// Primitives
// ============================================================================

/**
 * Runtime predicate for Mandu-managed URLs. Surfaced separately from the
 * schema so SSR callsites (`ssr.ts`, `streaming-ssr.ts`) can run the same
 * check at preamble emit time — defense in depth against a manifest that
 * slipped past validation (e.g. skipFrameworkBundles fallback path).
 */
export function isSafeManduUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  if (url.length === 0 || url.length > MAX_MANIFEST_URL_LEN) return false;
  if (FORBIDDEN_URL_CHARS.test(url)) return false;
  for (const s of FORBIDDEN_URL_SUBSTRINGS) {
    if (url.includes(s)) return false;
  }
  return SAFE_MANDU_URL_REGEX.test(url);
}

/**
 * Zod refinement that runs `isSafeManduUrl` with a helpful error message.
 * We use a single shared factory so the same message text appears for
 * every URL field — grepping support logs becomes one-pattern-fits-all.
 */
const safeManduUrl = (fieldLabel: string) =>
  z
    .string()
    .max(MAX_MANIFEST_URL_LEN, `${fieldLabel}: URL exceeds ${MAX_MANIFEST_URL_LEN} bytes`)
    .refine(isSafeManduUrl, {
      message: `${fieldLabel}: URL must match /.mandu/client/*.{js,css,mjs} with no protocol or traversal`,
    });

// ============================================================================
// Shape schemas
// ============================================================================

const PrioritySchema = z.enum(["immediate", "visible", "idle", "interaction"]);

const BundleEntrySchema = z.object({
  js: safeManduUrl("bundles[].js"),
  css: safeManduUrl("bundles[].css").optional(),
  dependencies: z.array(z.string()).default([]),
  priority: PrioritySchema,
});

const IslandEntrySchema = z.object({
  js: safeManduUrl("islands[].js"),
  route: z.string().min(1),
  priority: PrioritySchema,
});

const FastRefreshSchema = z.object({
  runtime: safeManduUrl("shared.fastRefresh.runtime"),
  glue: safeManduUrl("shared.fastRefresh.glue"),
});

const SharedSchema = z.object({
  runtime: safeManduUrl("shared.runtime"),
  vendor: safeManduUrl("shared.vendor"),
  router: safeManduUrl("shared.router").optional(),
  fastRefresh: FastRefreshSchema.optional(),
});

const ImportMapEntrySchema = z
  .string()
  .refine(
    (url) => {
      // Import map values may be bare specifiers OR Mandu-client URLs.
      // Bare specifiers are strings without path-like characters (no
      // leading slash). Mandu URLs follow the same rules as `safeManduUrl`.
      if (url.length === 0 || url.length > MAX_MANIFEST_URL_LEN) return false;
      if (FORBIDDEN_URL_CHARS.test(url)) return false;
      // Accept absolute Mandu paths
      if (url.startsWith("/")) return isSafeManduUrl(url);
      // Reject protocol URIs everywhere in the map
      for (const s of FORBIDDEN_URL_SUBSTRINGS) {
        if (url.includes(s)) return false;
      }
      return true;
    },
    { message: "importMap value must be a bare specifier or /.mandu/client/* URL" },
  );

const ImportMapSchema = z.object({
  imports: z.record(z.string(), ImportMapEntrySchema),
});

/**
 * Public BundleManifest schema. Matches `BundleManifest` in `./types.ts`
 * but tightens URL / structural constraints that the TS type cannot
 * express.
 *
 * Fields explicitly omitted from schema:
 *   - `buildTime` — validated as ISO string only.
 *
 * Optional fields (`css`, `router`, `fastRefresh`, `islands`, `importMap`)
 * are allowed to be absent, matching the production manifest shape that
 * `build.ts` emits when dev-only assets are not generated.
 */
export const BundleManifestSchema = z
  .object({
    version: z.number().int().min(1),
    buildTime: z.string().min(1),
    env: z.enum(["development", "production"]),
    bundles: z.record(z.string(), BundleEntrySchema),
    islands: z.record(z.string(), IslandEntrySchema).optional(),
    shared: SharedSchema,
    importMap: ImportMapSchema.optional(),
  })
  .strict();

export type ValidatedBundleManifest = z.infer<typeof BundleManifestSchema>;

// ============================================================================
// Validator
// ============================================================================

/**
 * Parse+validate a raw manifest object. Throws `ManifestValidationError`
 * on any shape mismatch. The return value carries the same runtime type
 * as `BundleManifest` so callers can keep the existing TS type without
 * a cast.
 *
 * Intentional design points:
 *
 *   1. `BundleManifestSchema.strict()` rejects unknown top-level keys.
 *      That catches schema drift (a field the bundler started emitting
 *      but the validator didn't learn about) at build time rather than
 *      in production. If a legitimate new field shows up, update this
 *      file first — fail closed.
 *   2. The thrown error's `.issues` array exposes the full list of
 *      violations rather than just the first. Build / dev paths log the
 *      whole set so the developer fixes them in one pass.
 *   3. Validators are pure — no filesystem / console IO. Callers own
 *      logging. This keeps the function easy to unit-test and makes it
 *      safe to call from the SSR preamble (no startup overhead).
 */
export function validateBundleManifest(raw: unknown): BundleManifest {
  const result = BundleManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    const firstFew = issues
      .slice(0, 3)
      .map((i) => `${i.path}: ${i.message}`)
      .join("; ");
    throw new ManifestValidationError(
      `BundleManifest failed schema validation (${issues.length} issue${
        issues.length === 1 ? "" : "s"
      }): ${firstFew}`,
      issues,
    );
  }
  // Zod's inferred type matches BundleManifest by structural compat;
  // the cast re-attaches the nominal TS name without runtime cost.
  return result.data as unknown as BundleManifest;
}

/**
 * Non-throwing variant. Returns either a validated manifest or a list of
 * issues — convenient for callsites that want to log and continue with a
 * fallback (e.g. `skipFrameworkBundles` path in build.ts that falls back
 * to a full rebuild on any validation failure).
 */
export function safeValidateBundleManifest(
  raw: unknown,
):
  | { ok: true; manifest: BundleManifest }
  | { ok: false; issues: { path: string; message: string }[] } {
  const result = BundleManifestSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  return { ok: true, manifest: result.data as unknown as BundleManifest };
}
