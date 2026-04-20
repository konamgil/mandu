/**
 * Mandu — generateStaticParams contract
 *
 * Next.js-style `generateStaticParams` lets page modules enumerate which
 * concrete parameter combinations should be prerendered at build time.
 *
 *   ```ts
 *   // app/docs/[slug]/page.tsx
 *   export async function generateStaticParams(): Promise<{ slug: string }[]> {
 *     return [{ slug: "intro" }, { slug: "quickstart" }];
 *   }
 *   export default function Page({ params }: { params: { slug: string } }) { ... }
 *   ```
 *
 * This module owns the *contract* side of that feature: introspecting a
 * page module to invoke `generateStaticParams`, validating the shape of
 * the returned param sets against the route's dynamic segments, and
 * resolving each param set into a concrete URL path the prerender
 * orchestrator can request.
 *
 * Router pattern → file-system mapping (kept in sync with
 * `packages/core/src/router/fs-patterns.ts`):
 *
 *   - `[slug]`       → `:slug`    (single required segment)
 *   - `[...slug]`    → `:slug*`   (catch-all, param value is `string[]`)
 *   - `[[...slug]]`  → `:slug*?`  (optional catch-all, param value is
 *                                  `string[]` — empty array resolves to
 *                                  the prefix path with no trailing
 *                                  segment)
 *
 * The prerender orchestrator in `prerender.ts` composes these helpers
 * with a user-supplied fetch handler to materialize HTML on disk.
 */

// Using the same loose pattern vocabulary as the rest of the bundler.

/**
 * A single param set as returned from `generateStaticParams`. Scalar
 * params map to a string; catch-all params map to a string array.
 */
export type StaticParamSet = Record<string, string | string[]>;

/**
 * A page module shape we care about. We deliberately avoid importing
 * the full page-module type here — this module is invoked from the
 * build orchestrator where modules are dynamic-imported, and the only
 * thing we need is the optional `generateStaticParams` export.
 */
export interface PageModuleWithStaticParams {
  generateStaticParams?: () => Promise<StaticParamSet[]> | StaticParamSet[];
}

/**
 * Structured description of one dynamic segment extracted from a
 * router pattern. Mirrors the `kind` alphabet we support on disk.
 */
export interface DynamicSegment {
  name: string;
  kind: "required" | "catchAll" | "optionalCatchAll";
}

/**
 * Extract the dynamic segments from a router pattern.
 *
 * @example
 *   extractDynamicSegments("/docs/:slug")        // [{name:"slug", kind:"required"}]
 *   extractDynamicSegments("/[lang]/:slug")      // malformed, see below
 *   extractDynamicSegments("/:lang/:slug")       // two required
 *   extractDynamicSegments("/docs/:slug*")       // one catch-all
 *   extractDynamicSegments("/docs/:slug*?")      // one optional catch-all
 *
 * Only router-style (`:name`, `:name*`, `:name*?`) patterns are
 * recognized — the `[slug]` file-system syntax is normalized to router
 * form at scan time (see `fs-patterns.ts`).
 */
export function extractDynamicSegments(pattern: string): DynamicSegment[] {
  const segments: DynamicSegment[] = [];
  // Match :<name><optional-star><optional-question>
  const re = /:([A-Za-z_][A-Za-z0-9_]*)(\*)?(\?)?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(pattern)) !== null) {
    const [, name, star, question] = match;
    let kind: DynamicSegment["kind"] = "required";
    if (star && question) kind = "optionalCatchAll";
    else if (star) kind = "catchAll";
    segments.push({ name, kind });
  }
  return segments;
}

/** Whether a router pattern has any dynamic segments at all. */
export function isDynamicPattern(pattern: string): boolean {
  return extractDynamicSegments(pattern).length > 0;
}

/**
 * Validate that a param set has the right keys and value kinds for a
 * pattern. Returns a human-readable error message or `null` if OK.
 *
 * Rules:
 *   - Every dynamic segment must have a corresponding key in params.
 *     (Optional catch-all may be omitted or provided as `[]`.)
 *   - `required` segments must map to a non-empty string.
 *   - `catchAll`/`optionalCatchAll` segments must map to a `string[]`
 *     (or, as a convenience, a single string — interpreted as one
 *     segment). Required catch-all must be non-empty.
 */
export function validateParamSet(
  pattern: string,
  params: StaticParamSet
): string | null {
  const segments = extractDynamicSegments(pattern);
  for (const segment of segments) {
    const value = params[segment.name];
    if (segment.kind === "required") {
      if (typeof value !== "string" || value.length === 0) {
        return `expected string for param "${segment.name}" in pattern "${pattern}", got ${describe(value)}`;
      }
      if (value.includes("/")) {
        return `param "${segment.name}" in pattern "${pattern}" must not contain "/"; use a catch-all segment ([...${segment.name}])`;
      }
    } else if (segment.kind === "catchAll") {
      if (value === undefined || value === null) {
        return `param "${segment.name}" is required for catch-all pattern "${pattern}"`;
      }
      if (Array.isArray(value)) {
        if (value.length === 0) {
          return `catch-all param "${segment.name}" in pattern "${pattern}" must not be empty; use [[...${segment.name}]] for optional`;
        }
        if (!value.every((v) => typeof v === "string" && v.length > 0)) {
          return `catch-all param "${segment.name}" must be a non-empty string[] (pattern "${pattern}")`;
        }
      } else if (typeof value !== "string" || value.length === 0) {
        return `catch-all param "${segment.name}" in pattern "${pattern}" must be string[] or non-empty string`;
      }
    } else {
      // optionalCatchAll — may be absent, `[]`, or a populated array.
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          if (!value.every((v) => typeof v === "string")) {
            return `optional catch-all "${segment.name}" must be string[] (pattern "${pattern}")`;
          }
        } else if (typeof value !== "string") {
          return `optional catch-all "${segment.name}" must be string[] or string (pattern "${pattern}")`;
        }
      }
    }
  }
  return null;
}

/**
 * Resolve a router pattern + param set into a concrete URL path.
 *
 * @example
 *   resolvePath("/docs/:slug", { slug: "intro" })
 *     // "/docs/intro"
 *   resolvePath("/:lang/:slug", { lang: "ko", slug: "intro" })
 *     // "/ko/intro"
 *   resolvePath("/docs/:path*", { path: ["guide", "advanced"] })
 *     // "/docs/guide/advanced"
 *   resolvePath("/docs/:path*?", { path: [] })
 *     // "/docs"
 *   resolvePath("/docs/:path*?", {})
 *     // "/docs"
 *
 * Individual segments are URI-encoded, but slashes between catch-all
 * segments are preserved.
 */
export function resolvePath(pattern: string, params: StaticParamSet): string {
  let result = pattern;

  // Resolve catch-all (optional + required) first because their regex
  // (`:name*?`, `:name*`) is a superset of the `:name` pattern. Sort by
  // longest first to be extra safe when names overlap.
  const segments = [...extractDynamicSegments(pattern)].sort(
    (a, b) => b.name.length - a.name.length
  );

  for (const segment of segments) {
    const value = params[segment.name];

    if (segment.kind === "optionalCatchAll") {
      // Pattern is `/prefix/:name*?` — the leading slash belongs to the
      // prefix and must be elided when the param is empty, otherwise
      // we'd emit `/prefix/`.
      const needle = `/:${segment.name}*?`;
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
        result = result.replace(needle, "");
      } else {
        const parts = Array.isArray(value) ? value : [value];
        const encoded = parts.map(encodeURIComponent).join("/");
        result = result.replace(needle, `/${encoded}`);
      }
      continue;
    }

    if (segment.kind === "catchAll") {
      const parts = Array.isArray(value) ? value : [String(value)];
      const encoded = parts.map(encodeURIComponent).join("/");
      result = result.replace(`:${segment.name}*`, encoded);
      continue;
    }

    // required — avoid accidentally matching `:slugs` when we wanted
    // `:slug` by using a word-boundary style regex.
    const requiredRe = new RegExp(`:${escapeRegex(segment.name)}(?![A-Za-z0-9_])`);
    result = result.replace(requiredRe, encodeURIComponent(String(value)));
  }

  // Collapse any accidental double slashes (except the scheme — we have no scheme here).
  result = result.replace(/\/{2,}/g, "/");
  if (result.length > 1 && result.endsWith("/")) result = result.slice(0, -1);
  if (!result.startsWith("/")) result = "/" + result;
  return result;
}

/**
 * Invoke `generateStaticParams` on a page module and return the list
 * of resolved URL paths. Validates the shape of each param set against
 * the pattern; invalid entries are collected in the `errors` array and
 * *not* included in `paths`.
 *
 * The function never throws for contract-level problems (missing
 * export, non-array return, invalid param shapes). It *does* propagate
 * exceptions thrown from inside the user-supplied function, because
 * those indicate a bug in the user code that the caller (the build
 * orchestrator) should surface loudly.
 */
export async function collectStaticPaths(
  pattern: string,
  mod: PageModuleWithStaticParams
): Promise<{ paths: string[]; errors: string[]; paramSets: StaticParamSet[] }> {
  const errors: string[] = [];
  const paths: string[] = [];
  const paramSets: StaticParamSet[] = [];

  if (typeof mod.generateStaticParams !== "function") {
    return { paths, errors, paramSets };
  }

  const result = await mod.generateStaticParams();

  if (!Array.isArray(result)) {
    errors.push(
      `generateStaticParams() for "${pattern}" returned ${describe(result)}; expected an array of param objects`
    );
    return { paths, errors, paramSets };
  }

  const seen = new Set<string>();
  for (let i = 0; i < result.length; i++) {
    const entry = result[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(
        `generateStaticParams()[${i}] for "${pattern}" is not a plain object (${describe(entry)})`
      );
      continue;
    }
    const validationError = validateParamSet(pattern, entry as StaticParamSet);
    if (validationError) {
      errors.push(`generateStaticParams()[${i}] for "${pattern}": ${validationError}`);
      continue;
    }
    const resolved = resolvePath(pattern, entry as StaticParamSet);
    if (seen.has(resolved)) {
      // Duplicates are fine — just silently de-dupe. Users often return
      // the same slug from multiple data sources during migrations.
      continue;
    }
    seen.add(resolved);
    paths.push(resolved);
    paramSets.push(entry as StaticParamSet);
  }

  return { paths, errors, paramSets };
}

// ---------- Internals ----------

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `array (length ${value.length})`;
  return typeof value;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
