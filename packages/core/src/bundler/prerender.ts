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

/** Default cache policy stamped on runtime prerender responses. */
export const DEFAULT_PRERENDER_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

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
    writeIndex = false,
    importModule,
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
  const renderedPaths = new Set<string>();
  const pageIndex: Record<string, string> = {};

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

    let mod: PageModuleWithStaticParams;
    try {
      mod = await loadPageModule(rootDir, route, resolveModule);
    } catch {
      // Module failed to load entirely. Silent skip — the page may
      // simply not opt into static params; SSR can still serve it.
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
      // Not opted-in for this route — perfectly fine.
      continue;
    }

    try {
      const {
        paths,
        errors: paramErrors,
        paramSets,
      } = await collectStaticPaths(route.pattern, mod);
      for (const p of paths) pathsToRender.add(p);
      for (const e of paramErrors) errors.push(`[${route.pattern}] ${e}`);

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
      // User code threw. Surface the error but keep going — other
      // routes should not be blocked by one buggy generator.
      errors.push(
        `[${route.pattern}] generateStaticParams threw: ${describeError(error)}`
      );
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
        const links = extractInternalLinks(html);
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

/** Extract absolute internal `<a href>` paths (same-origin only). */
function extractInternalLinks(html: string): string[] {
  const links: string[] = [];
  const hrefRegex = /href=["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    if (href.startsWith("/") && !href.startsWith("//")) {
      const cleanPath = href.split("?")[0].split("#")[0];
      if (!cleanPath.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/)) {
        links.push(cleanPath);
      }
    }
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
