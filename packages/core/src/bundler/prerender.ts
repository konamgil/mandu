/**
 * Mandu Prerender Engine
 *
 * Build-time static HTML generation (SSG) driven by two signals:
 *
 *   1. Static page routes (no dynamic segments) in the routes manifest.
 *   2. Dynamic page routes whose module exports `generateStaticParams`
 *      — see `./generate-static-params.ts` for the contract.
 *
 * For each resolved URL the engine invokes the build's fetch handler
 * (a transient server spun up by `mandu build`) and writes the HTML
 * payload under `.mandu/prerendered/` when callers opt into the new
 * runtime-aware layout, or `.mandu/static/` for legacy callers.
 *
 * When `writeIndex: true` the engine also emits `_manifest.json`
 * alongside the HTML — the runtime consults that index to serve
 * prerendered pages directly with `Cache-Control: immutable`, skipping
 * SSR entirely.
 */

import path from "path";
import fs from "fs/promises";
import type { RoutesManifest, RouteSpec } from "../spec/schema";
import {
  collectStaticPaths,
  isDynamicPattern,
  type PageModuleWithStaticParams,
  type StaticParamSet,
} from "./generate-static-params";
import type { ManduPlugin, ManduHooks } from "../plugins/hooks";
import { runDefinePrerenderHook } from "../plugins/runner";

// ========== Types ==========

/**
 * Issue #213 — link-crawler configuration.
 *
 * When the prerender engine crawls rendered HTML for internal links
 * (`crawl: true`) it accidentally picks up `href` attributes embedded
 * inside documentation code examples (`<pre>`, `<code>`, fenced
 * blocks, inline code spans). These are illustrative, not real routes,
 * and trying to prerender them produces spurious `/path/index.html`
 * files or build failures.
 *
 * The crawl options let callers:
 *   1. Trust the default behavior (strip code regions + a small
 *      hard-coded denylist of obvious placeholders).
 *   2. Extend the denylist with project-specific placeholder globs.
 *   3. Replace the denylist entirely for maximum control.
 */
export interface PrerenderCrawlOptions {
  /**
   * Extra pathnames or prefixes to exclude when crawling links. Each
   * entry is matched against the normalized crawl target:
   *   - Exact string (e.g. `"/example"`): matches that pathname only.
   *   - Glob suffix (e.g. `"/your-*"`): uses a simple `*` → `.*` regex
   *     translation to match any pathname with that prefix / pattern.
   *
   * Merged with the default denylist (see
   * {@link DEFAULT_CRAWL_DENYLIST}). Use {@link PrerenderCrawlOptions.exclude}
   * to ADD entries; set {@link PrerenderCrawlOptions.replaceDefaultExclude}
   * to `true` to REPLACE the defaults.
   */
  exclude?: string[];
  /**
   * When `true`, `exclude` replaces the built-in denylist entirely
   * instead of extending it. Default `false` (safe — defaults win).
   */
  replaceDefaultExclude?: boolean;
  /**
   * Issue #219 — file extensions treated as non-HTML assets. When a
   * discovered `<a href>` / `href` value has a pathname ending in one
   * of these extensions, the crawler skips it instead of enqueuing it
   * for prerender. Without this filter, markup like `<picture><source
   * srcset="/hero.avif"><img src="/hero.webp"></picture>` would cause
   * the engine to render the asset as HTML and overwrite it on disk.
   *
   * Matching is case-insensitive and ignores query strings / hash
   * fragments. See {@link DEFAULT_ASSET_EXTENSIONS} for the built-in
   * list.
   *
   * Merged with {@link DEFAULT_ASSET_EXTENSIONS} unless
   * {@link PrerenderCrawlOptions.replaceDefaultAssetExtensions} is
   * `true`. Entries may be given with or without a leading dot
   * (`"webp"` and `".webp"` are equivalent).
   */
  assetExtensions?: string[];
  /**
   * When `true`, `assetExtensions` replaces the built-in asset
   * extension set entirely. Default `false` (safe — defaults win).
   */
  replaceDefaultAssetExtensions?: boolean;
}

export interface PrerenderOptions {
  /** Project root — all relative paths resolve from here. */
  rootDir: string;
  /**
   * Output directory (absolute, or relative to `rootDir`).
   * Defaults to `.mandu/static` to preserve behavior for older
   * callers; `mandu build` opts into `.mandu/prerendered` +
   * `writeIndex: true` to enable runtime pass-through.
   */
  outDir?: string;
  /** Extra URL paths to prerender in addition to the manifest. */
  routes?: string[];
  /** Follow internal `<a href>` links in rendered HTML (default: false). */
  crawl?: boolean;
  /**
   * Issue #213 — link-crawler configuration. Only consulted when
   * `crawl: true`. Omitting the block uses the defaults (strip code
   * regions, apply {@link DEFAULT_CRAWL_DENYLIST}).
   */
  crawlOptions?: PrerenderCrawlOptions;
  /**
   * When true, also write `<outDir>/_manifest.json` listing every
   * prerendered pathname. The runtime uses this index to short-circuit
   * dispatch for matching URLs.
   */
  writeIndex?: boolean;
  /**
   * Optional injected `import` function. Tests pass a stub so we can
   * exercise `generateStaticParams` without touching disk; production
   * callers leave this undefined (the default dynamic import is used).
   */
  importModule?: (specifier: string) => Promise<PageModuleWithStaticParams>;

  /**
   * Phase 18.τ — plugins contributing `definePrerenderHook()`.
   * Each plugin receives a {@link PrerenderContext} with the
   * pathname + HTML and may return a {@link PrerenderOverride} to
   * skip, rewrite, or replace the output. Omitted → zero overhead.
   */
  plugins?: readonly ManduPlugin[];
  configHooks?: Partial<ManduHooks>;

  /**
   * Issue #216 — opt-out from hard-failing on route errors.
   * When `true`, errors from individual routes (module load / throw /
   * non-array return from `generateStaticParams`) are collected in
   * `PrerenderResult.errors` as warnings and the orchestrator returns
   * normally. When `false` (default) the prerender still collects
   * every route's error but throws a `PrerenderError` aggregate at
   * the end so CI can exit non-zero. Set by the CLI's
   * `--prerender-skip-errors` flag.
   */
  skipErrors?: boolean;
}

export interface PrerenderResult {
  /** Number of pages rendered successfully. */
  generated: number;
  /** Per-page telemetry. */
  pages: PrerenderPageResult[];
  /** Errors encountered during the run (non-fatal). */
  errors: string[];
  /** Pathnames that were rendered. */
  paths: string[];
}

export interface PrerenderPageResult {
  path: string;
  size: number;
  duration: number;
}

/** Shape of the index file written to `<outDir>/_manifest.json`. */
export interface PrerenderIndex {
  version: 1;
  generatedAt: string;
  /** Pathname → relative HTML file path (posix separators). */
  pages: Record<string, string>;
}

/** File name used for the runtime index. */
export const PRERENDER_INDEX_FILE = "_manifest.json";

/** Default output directory (runtime-aware location). */
export const DEFAULT_PRERENDER_DIR = ".mandu/prerendered";

/** Default output directory (legacy `prerenderRoutes` callers). */
export const LEGACY_PRERENDER_DIR = ".mandu/static";

/**
 * Default cache policy stamped on runtime prerender responses.
 *
 * Issue #221 — prerendered HTML lives at a **stable URL** (route → file,
 * no content hash in the path). Serving it with `immutable` is the same
 * trap Issue #218 closed for `/.mandu/client/*`: browsers honour
 * `immutable` as a year-long contract and users see stale HTML until a
 * hard refresh, even after a fresh deploy.
 *
 * The runtime default is therefore `public, max-age=0, must-revalidate`,
 * which forces a conditional `If-None-Match` round-trip on every
 * navigation. Because the runtime also emits a strong ETag (`Bun.hash`
 * over the HTML bytes) the steady-state response is a ~300-byte
 * `304 Not Modified` — cheap compared to re-downloading the HTML.
 *
 * Adapters that front the runtime with a CDN capable of per-deploy
 * invalidation can still override this via
 * `PrerenderSettings.cacheControl` at `startServer` call site.
 */
export const DEFAULT_PRERENDER_CACHE_CONTROL =
  "public, max-age=0, must-revalidate";

/**
 * Issue #213 — default denylist for the link crawler.
 *
 * These entries match paths that appear in doc examples (and never
 * correspond to real routes): the classic placeholders (`/path`,
 * `/example`), the `/your-*` and `/my-*` scaffolds people write when
 * illustrating URL shapes, and the `/...` catch-all literal.
 *
 * Exact strings match a full pathname; entries containing `*` are
 * treated as simple globs (`*` → `.*`, anchored).
 */
export const DEFAULT_CRAWL_DENYLIST: readonly string[] = [
  "/path",
  "/...",
  "/example",
  "/your-*",
  "/my-*",
  "/foo",
  "/bar",
  "/baz",
  "/some-path",
];

/**
 * Issue #219 — default non-HTML asset extensions the link crawler
 * refuses to enqueue as prerender targets.
 *
 * Motivation: markup like `<picture><source srcset="/hero.avif"><img
 * src="/hero.webp"></picture>` and `<a href="/whitepaper.pdf">` used
 * to leak the asset URL into the render queue. The engine would then
 * invoke the SSR handler, receive a non-HTML response (or an HTML
 * error page), and write it to `.mandu/prerendered/hero.webp/index.html`
 * — corrupting the static-asset dispatch for that URL on subsequent
 * requests.
 *
 * Each entry is lowercased with a leading dot. Comparison is
 * case-insensitive; the crawler strips query strings and hash
 * fragments before extension testing.
 *
 * Extend or replace via `ManduConfig.build.crawl.assetExtensions` /
 * `replaceDefaultAssetExtensions`.
 */
export const DEFAULT_ASSET_EXTENSIONS: readonly string[] = [
  ".webp",
  ".avif",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".pdf",
  ".zip",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".css",
  ".js",
  ".map",
  ".json",
  ".xml",
  ".txt",
];

/**
 * Issue #216 — aggregate error thrown when one or more routes fail
 * during prerender (and `skipErrors !== true`). Each entry carries the
 * offending route pattern plus the underlying `cause`, so CI logs show
 * both the symptom (the summary line) and the root cause chain.
 */
export class PrerenderError extends Error {
  readonly errors: PrerenderRouteError[];

  constructor(errors: PrerenderRouteError[]) {
    const summary = errors
      .map((e) => `  - [${e.pattern}] ${e.message}`)
      .join("\n");
    super(
      `Prerender failed for ${errors.length} route(s):\n${summary}`,
    );
    this.name = "PrerenderError";
    this.errors = errors;
  }
}

export interface PrerenderRouteError {
  /** The route pattern that failed (e.g. `/docs/:slug`). */
  pattern: string;
  /** Absolute module path that was loaded (or attempted). */
  module: string;
  /** Human-readable description of the failure. */
  message: string;
  /** The underlying error object, preserved for `cause` chaining. */
  cause: unknown;
}

// ========== Implementation ==========

/**
 * Prerender the routes declared in a manifest (plus any extras) to
 * static HTML. See `PrerenderOptions` for the full contract.
 *
 * @example
 * ```typescript
 * const result = await prerenderRoutes(manifest, fetchHandler, {
 *   rootDir: process.cwd(),
 *   outDir: ".mandu/prerendered",
 *   writeIndex: true,
 * });
 * ```
 */
export async function prerenderRoutes(
  manifest: RoutesManifest,
  fetchHandler: (req: Request) => Promise<Response>,
  options: PrerenderOptions
): Promise<PrerenderResult> {
  const {
    rootDir,
    outDir = LEGACY_PRERENDER_DIR,
    crawl = false,
    crawlOptions,
    writeIndex = false,
    importModule,
    skipErrors = false,
  } = options;

  // Phase 18.τ — resolve plugin hook bundle once so the hot render loop
  // can short-circuit with a single falsy check.
  const pluginArgs = {
    plugins: options.plugins ?? [],
    configHooks: options.configHooks,
  };
  const hasPrerenderHook =
    pluginArgs.plugins.some((p) => p.hooks?.definePrerenderHook) ||
    Boolean(pluginArgs.configHooks?.definePrerenderHook);

  const outputDir = path.isAbsolute(outDir) ? outDir : path.join(rootDir, outDir);
  await fs.mkdir(outputDir, { recursive: true });

  const pages: PrerenderPageResult[] = [];
  const errors: string[] = [];
  /**
   * Issue #216 — structured per-route errors used to build the
   * aggregate thrown at the end of the run. `errors` (the flat string
   * array on `PrerenderResult`) is preserved for backward-compat.
   */
  const routeErrors: PrerenderRouteError[] = [];
  const renderedPaths = new Set<string>();
  const pageIndex: Record<string, string> = {};

  // Issue #213 — compile the crawl denylist (defaults ∪ user extras, or
  // user's replacement list) into an array of regexes once. Doing this
  // outside the per-page crawl loop avoids recompiling N times.
  const crawlDenylist = compileCrawlDenylist(crawlOptions);
  // Issue #219 — resolve the non-HTML asset extension set once. Same
  // rationale: the crawl loop runs N times, set lookup is O(1).
  const crawlAssetExtensions = resolveAssetExtensions(crawlOptions);

  // 1. Explicit user-supplied routes.
  const pathsToRender = new Set<string>(options.routes ?? []);

  // 2. Static page routes (no dynamic segments).
  for (const route of manifest.routes) {
    if (route.kind === "page" && !isDynamicPattern(route.pattern)) {
      pathsToRender.add(route.pattern);
    }
  }

  // 3. Dynamic routes that export `generateStaticParams`.
  const resolveModule =
    importModule ?? ((specifier: string) => import(specifier));

  for (const route of manifest.routes) {
    if (route.kind !== "page" || !isDynamicPattern(route.pattern)) continue;

    // ─── Issue #216 ─────────────────────────────────────────────────────────
    // Distinguish the three failure modes that were previously collapsed
    // into a single `try/catch` silent skip:
    //
    //   1. Module export missing (`generateStaticParams` is undefined)
    //      → legitimate "page doesn't opt into static params"; silent skip.
    //   2. Module fails to load (compile error, missing import, etc.)
    //      → real bug, surface with route + cause chain.
    //   3. User's `generateStaticParams` throws or returns non-array
    //      → real bug, surface with route + cause chain.
    //
    // The orchestrator still continues with the remaining routes so one
    // broken page doesn't block the whole build; we just collect each
    // failure in `routeErrors` and re-raise as a `PrerenderError` once
    // the run finishes (unless `skipErrors === true`).
    // ─── End Issue #216 ─────────────────────────────────────────────────────
    let mod: PageModuleWithStaticParams;
    try {
      mod = await loadPageModule(rootDir, route, resolveModule);
    } catch (loadErr) {
      const message = `Failed to load page module for prerender of "${route.pattern}" (${route.module}): ${describeError(loadErr)}`;
      errors.push(`[${route.pattern}] ${message}`);
      routeErrors.push({
        pattern: route.pattern,
        module: route.module,
        message,
        cause: loadErr,
      });
      continue;
    }

    // ─── Issue #214 ─────────────────────────────────────────────────────────
    // Capture `dynamicParams` export from the page module and stamp it onto
    // the route spec so the runtime dispatch guard can consult it. Undefined
    // export → undefined on the spec (default: allow SSR fallback, Next.js
    // parity). Explicit `true` also round-trips for clarity.
    if (typeof mod.dynamicParams === "boolean") {
      (route as { dynamicParams?: boolean }).dynamicParams = mod.dynamicParams;
    }
    // ─── End Issue #214 ─────────────────────────────────────────────────────

    if (typeof mod.generateStaticParams !== "function") {
      // Issue #216 — legitimate "no export" case. This is the only
      // silent skip that survives the hardening: the whole point of
      // the feature is that exporting the function is optional.
      continue;
    }

    try {
      const {
        paths,
        errors: paramErrors,
        paramSets,
      } = await collectStaticPaths(route.pattern, mod);
      for (const p of paths) pathsToRender.add(p);
      for (const e of paramErrors) {
        errors.push(`[${route.pattern}] ${e}`);
        // Validation errors from individual param sets are already
        // fine-grained (`generateStaticParams()[i] for "pattern": ...`);
        // promote them to route-level errors so the aggregate surfaces
        // them too.
        routeErrors.push({
          pattern: route.pattern,
          module: route.module,
          message: e,
          cause: new Error(e),
        });
      }

      // ─── Issue #214 ───────────────────────────────────────────────────────
      // Persist the resolved param sets on the spec. The runtime #214 guard
      // reads this to decide whether an incoming request matches the known
      // set. Empty arrays are preserved (distinct from `undefined`) so users
      // can opt into "no dynamic URLs at all" via `generateStaticParams: []`
      // + `dynamicParams: false`.
      if (paramSets.length > 0 || mod.dynamicParams === false) {
        (route as { staticParams?: StaticParamSet[] }).staticParams = paramSets;
      }
      // ─── End Issue #214 ───────────────────────────────────────────────────
    } catch (error) {
      // Issue #216 — user's `generateStaticParams` threw. Capture with
      // context (pattern + module + cause) so `PrerenderError` can
      // rebuild a proper chain.
      const message = `generateStaticParams threw: ${describeError(error)}`;
      errors.push(`[${route.pattern}] ${message}`);
      routeErrors.push({
        pattern: route.pattern,
        module: route.module,
        message,
        cause: error,
      });
    }
  }

  // 4. Render every queued path.
  for (const pathname of pathsToRender) {
    if (renderedPaths.has(pathname)) continue;
    renderedPaths.add(pathname);

    const start = Date.now();
    try {
      const request = new Request(`http://localhost${pathname}`);
      const response = await fetchHandler(request);

      if (!response.ok) {
        errors.push(`[${pathname}] HTTP ${response.status}`);
        continue;
      }

      let html = await response.text();
      let finalPathname = pathname;

      // Phase 18.τ — let plugins inspect / rewrite / skip the output.
      // Zero-overhead fast-path when no plugin provides the hook.
      if (hasPrerenderHook) {
        const override = await runDefinePrerenderHook(
          {
            rootDir,
            mode: "production",
            logger: {
              debug: (m) => console.debug(`[prerender] ${m}`),
              info: (m) => console.info(`[prerender] ${m}`),
              warn: (m) => console.warn(`[prerender] ${m}`),
              error: (m) => console.error(`[prerender] ${m}`),
            },
            pathname,
            html,
          },
          pluginArgs,
        );
        for (const e of override.errors) {
          errors.push(`definePrerenderHook[${e.source}] ${pathname}: ${e.error.message}`);
        }
        if (override.result.skip === true) {
          continue;
        }
        if (typeof override.result.html === "string") {
          html = override.result.html;
        }
        if (typeof override.result.pathname === "string") {
          finalPathname = override.result.pathname;
        }
      }

      const filePath = getOutputPath(outputDir, finalPathname);

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, html, "utf-8");

      const duration = Date.now() - start;
      pages.push({ path: finalPathname, size: html.length, duration });
      pageIndex[finalPathname] = toPosix(path.relative(outputDir, filePath));

      // 5. Optional crawl — harvest internal links for next pass.
      if (crawl) {
        // Issue #213 — strip code regions + apply denylist before adding
        // discovered paths to the render queue.
        // Issue #219 — also filter out asset URLs (`/hero.webp`, etc.)
        // so the engine doesn't try to render them as HTML.
        const links = extractInternalLinks(html, crawlDenylist, crawlAssetExtensions);
        for (const link of links) {
          if (!renderedPaths.has(link) && !pathsToRender.has(link)) {
            pathsToRender.add(link);
          }
        }
      }
    } catch (error) {
      errors.push(`[${pathname}] ${describeError(error)}`);
    }
  }

  // 6. Emit runtime index.
  if (writeIndex) {
    const indexContents: PrerenderIndex = {
      version: 1,
      generatedAt: new Date().toISOString(),
      pages: pageIndex,
    };
    await fs.writeFile(
      path.join(outputDir, PRERENDER_INDEX_FILE),
      JSON.stringify(indexContents, null, 2),
      "utf-8"
    );
  }

  // 7. Issue #216 — if any route errored, surface as aggregate so CI
  //    can exit non-zero. `skipErrors: true` converts errors to
  //    warnings (collected in `errors` + the returned result).
  if (routeErrors.length > 0 && !skipErrors) {
    throw new PrerenderError(routeErrors);
  }

  return {
    generated: pages.length,
    pages,
    errors,
    paths: pages.map((p) => p.path),
  };
}

/**
 * Load the prerender manifest index emitted under `outDir`. Returns
 * `null` if it doesn't exist or can't be parsed — callers should
 * treat that as "no prerendered content" rather than an error.
 */
export async function loadPrerenderIndex(
  rootDir: string,
  outDir: string = DEFAULT_PRERENDER_DIR
): Promise<PrerenderIndex | null> {
  const dir = path.isAbsolute(outDir) ? outDir : path.join(rootDir, outDir);
  const file = path.join(dir, PRERENDER_INDEX_FILE);
  try {
    const contents = await fs.readFile(file, "utf-8");
    const parsed = JSON.parse(contents) as PrerenderIndex;
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1 || !parsed.pages) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resolve a pathname against a loaded index. Returns the absolute
 * file path of the prerendered HTML, or `null` on miss.
 *
 * Tolerates both `/foo` and `/foo/` forms, and an optional `.html`
 * suffix. Path-traversal in the index value is defensively rejected
 * so a hand-edited / malicious index cannot escape the output root.
 */
export function resolvePrerenderedFile(
  index: PrerenderIndex,
  rootDir: string,
  outDir: string,
  pathname: string
): string | null {
  const dir = path.isAbsolute(outDir) ? outDir : path.join(rootDir, outDir);
  const candidates = [pathname];
  if (pathname.length > 1 && pathname.endsWith("/")) {
    candidates.push(pathname.slice(0, -1));
  } else if (pathname !== "/") {
    candidates.push(pathname + "/");
  }
  if (pathname.endsWith(".html")) {
    candidates.push(pathname.slice(0, -".html".length));
  }
  for (const candidate of candidates) {
    const rel = index.pages[candidate];
    if (rel) {
      const resolved = path.resolve(dir, rel);
      const normalizedDir = path.resolve(dir) + path.sep;
      if (resolved === path.resolve(dir) || resolved.startsWith(normalizedDir)) {
        return resolved;
      }
    }
  }
  return null;
}

// ========== Helpers ==========

/**
 * Dynamic-import a page module given its declared `module` path in
 * the manifest. Normalizes the path for Windows dynamic-import
 * (forward slashes + absolute) before delegating.
 */
async function loadPageModule(
  rootDir: string,
  route: RouteSpec,
  importFn: (specifier: string) => Promise<PageModuleWithStaticParams>
): Promise<PageModuleWithStaticParams> {
  const absolute = path.isAbsolute(route.module)
    ? route.module
    : path.join(rootDir, route.module);
  const specifier = absolute.replace(/\\/g, "/");
  return importFn(specifier);
}

/**
 * URL path → output file path.
 *   /            → <outDir>/index.html
 *   /about       → <outDir>/about/index.html (clean URL)
 *   /blog/a/b    → <outDir>/blog/a/b/index.html
 */
function getOutputPath(outDir: string, pathname: string): string {
  const trimmed = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  if (trimmed === "/") return path.join(outDir, "index.html");
  // Decode percent-encoding so on-disk names are stable across platforms.
  const decoded = trimmed
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
  return path.join(outDir, decoded, "index.html");
}

/**
 * Issue #213 — strip regions of HTML/MDX that only contain illustrative
 * markup (doc code examples) before scanning for crawl targets.
 *
 * The order below is deliberate:
 *   1. HTML comments (`<!-- ... -->`) — may wrap real `<a>` / `<code>`
 *      tags users don't want crawled.
 *   2. Fenced markdown code blocks (``` ... ```), including ~~~-fenced.
 *   3. Block HTML code containers (`<pre>...</pre>`, `<code>...</code>`,
 *      including attributes like `<pre class="language-tsx">`).
 *   4. Inline-code backticks (`` `...` ``).
 *
 * Each strip uses a non-greedy, multiline-aware regex. The replacements
 * are whitespace-only so line-based tools don't get confused, but the
 * string lengths stay similar (we don't need precise positions — we only
 * re-scan for `href` attributes after the strip).
 *
 * Exported for test coverage.
 */
export function stripCodeRegions(html: string): string {
  let out = html;
  // 1. HTML comments — nested and multiline.
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  // 2. Fenced markdown code blocks — both ``` and ~~~ fences.
  //    Allow optional info string on the opening fence.
  out = out.replace(/```[^\n]*\n[\s\S]*?```/g, "");
  out = out.replace(/~~~[^\n]*\n[\s\S]*?~~~/g, "");
  // 3. <pre>...</pre> (case-insensitive, attributes allowed).
  out = out.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, "");
  // 4. <code>...</code> (case-insensitive, attributes allowed).
  out = out.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, "");
  // 5. Inline markdown code spans — single backtick pairs. Avoid
  //    matching stray backticks by limiting to same-line and
  //    disallowing embedded backticks.
  out = out.replace(/`[^`\r\n]+`/g, "");
  return out;
}

/**
 * Issue #213 — compile the crawl denylist from options + defaults into
 * an array of regexes once. Accepts exact strings and simple globs where
 * `*` translates to `.*` (anchored).
 */
export function compileCrawlDenylist(
  options: PrerenderCrawlOptions | undefined,
): RegExp[] {
  const defaults = options?.replaceDefaultExclude
    ? []
    : DEFAULT_CRAWL_DENYLIST;
  const extras = options?.exclude ?? [];
  const combined = Array.from(new Set([...defaults, ...extras]));
  return combined.map((entry) => denylistEntryToRegex(entry));
}

function denylistEntryToRegex(entry: string): RegExp {
  // Escape everything except `*`, then translate `*` → `.*`.
  const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${pattern}$`);
}

/**
 * Issue #219 — resolve the effective asset extension set from options.
 *
 * Normalizes every entry to `.lowercase` with a leading dot (so users
 * can write `"webp"` or `".WEBP"`), merges with
 * {@link DEFAULT_ASSET_EXTENSIONS} unless `replaceDefaultAssetExtensions`
 * is `true`, and returns a `Set<string>` for O(1) lookup in the crawl
 * loop.
 *
 * Exported for test coverage.
 */
export function resolveAssetExtensions(
  options: PrerenderCrawlOptions | undefined,
): Set<string> {
  const defaults = options?.replaceDefaultAssetExtensions
    ? []
    : DEFAULT_ASSET_EXTENSIONS;
  const extras = options?.assetExtensions ?? [];
  const out = new Set<string>();
  for (const ext of [...defaults, ...extras]) {
    out.add(normalizeAssetExtension(ext));
  }
  return out;
}

function normalizeAssetExtension(ext: string): string {
  const lower = ext.toLowerCase();
  return lower.startsWith(".") ? lower : `.${lower}`;
}

/**
 * Issue #219 — does the given pathname end with a known asset
 * extension? Extracts the basename's extension (case-insensitive) and
 * tests it against the resolved set.
 *
 * `pathname` is the normalized crawl path (query + hash already
 * stripped by {@link normalizeCrawlPath}) — we still defend in depth
 * by splitting on `?` / `#` in case a caller passes a raw href.
 *
 * Exported for test coverage.
 */
export function isAssetPathname(
  pathname: string,
  assetExtensions: Set<string>,
): boolean {
  if (assetExtensions.size === 0) return false;
  const clean = pathname.split("?")[0].split("#")[0];
  const lastSlash = clean.lastIndexOf("/");
  const basename = lastSlash === -1 ? clean : clean.slice(lastSlash + 1);
  const dot = basename.lastIndexOf(".");
  if (dot === -1 || dot === 0) return false;
  const ext = basename.slice(dot).toLowerCase();
  return assetExtensions.has(ext);
}

/**
 * Normalize a discovered pathname for de-duplication + matching.
 * Lowercases (HTML href matching is case-insensitive) and strips a
 * trailing slash except for the root.
 */
function normalizeCrawlPath(href: string): string {
  const clean = href.split("?")[0].split("#")[0];
  let norm = clean.toLowerCase();
  if (norm.length > 1 && norm.endsWith("/")) {
    norm = norm.slice(0, -1);
  }
  return norm;
}

/**
 * Extract absolute internal `<a href>` paths (same-origin only).
 *
 * Issue #213 — strips HTML/MDX code regions before scanning so `href`
 * attributes inside doc examples (e.g. `<pre><code>&lt;Link
 * href="/example"&gt;</code></pre>` or fenced markdown) don't leak
 * into the crawl queue. Also applies the configurable denylist so
 * placeholder paths like `/path` or `/your-route` are filtered out.
 *
 * Issue #219 — filters out URLs whose pathname ends with a known
 * non-HTML asset extension (`.webp`, `.avif`, `.pdf`, `.css`, …). This
 * prevents the prerender engine from rendering `<img src>` / `<source
 * srcset>` / `<a href="/whitepaper.pdf">` values as HTML and
 * overwriting the real asset on disk. Pass a custom `Set` (e.g. built
 * by {@link resolveAssetExtensions}) to extend or replace the default
 * list; callers that want to disable the filter entirely may pass an
 * empty `Set`.
 *
 * Ordering rationale: `stripCodeRegions` runs first so doc examples
 * never reach the regex. The asset-extension filter runs AFTER the
 * strip (so `<pre>` code doesn't contribute asset URLs) but BEFORE
 * the denylist (Set.has is cheaper than an `Array.some` regex scan,
 * and asset URLs are strictly orthogonal to placeholder denylist
 * entries — see #213 vs #219).
 *
 * Exported for test coverage.
 */
export function extractInternalLinks(
  html: string,
  denylist: RegExp[] = [],
  assetExtensions: Set<string> = resolveAssetExtensions(undefined),
): string[] {
  const stripped = stripCodeRegions(html);
  const links: string[] = [];
  const hrefRegex = /href=["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(stripped)) !== null) {
    const href = match[1];
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    const normalized = normalizeCrawlPath(href);
    if (!normalized) continue;
    // Issue #219 — asset URLs (`.webp`, `.pdf`, `.css`, …) never get
    // prerendered. This supersedes the old hard-coded regex.
    if (isAssetPathname(normalized, assetExtensions)) continue;
    if (denylist.some((re) => re.test(normalized))) continue;
    links.push(normalized);
  }
  return [...new Set(links)];
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
