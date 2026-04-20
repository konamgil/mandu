/**
 * Mandu Diagnose — individual check implementations.
 *
 * Each check is an independent async function that accepts a project root
 * and returns a `DiagnoseCheckResult`. Checks NEVER throw — they catch
 * their own I/O errors and surface them as `severity: 'error'` results
 * with a helpful `suggestion`.
 *
 * Issue #215 motivation: the previous diagnose surface only ran four
 * structural checks (kitchen_errors, guard_check, contract_validation,
 * manifest_validation) and returned `healthy: true` in environments where
 * #211 / #212 / #213 / #214 were actively breaking production. These new
 * checks close the false-signal gap.
 */

import path from "path";
import fs from "fs/promises";
import type { Dirent } from "fs";
import type { DiagnoseCheckResult } from "./types";

// ────────────────────────────────────────────────────────────────────────
// 1. manifest_freshness
// ────────────────────────────────────────────────────────────────────────

/**
 * #215 check 1: bundle manifest freshness.
 *
 * Reads `.mandu/manifest.json` (the bundle manifest, NOT the FS-routes
 * manifest) and flags:
 *   - `env === 'development'`  → error (dev-mode manifest shipped to prod)
 *   - `bundles` empty + `islands` non-empty → warning (incomplete build)
 *   - missing file → error (build never ran)
 *
 * Returns `ok: true` when env is `production` AND at least one bundle
 * exists OR no hydrated routes were declared (pure-SSR projects get a
 * stub manifest with empty `bundles` — that's fine).
 */
export async function checkManifestFreshness(rootDir: string): Promise<DiagnoseCheckResult> {
  const manifestPath = path.join(rootDir, ".mandu", "manifest.json");

  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf-8");
  } catch {
    return {
      ok: false,
      rule: "manifest_freshness",
      severity: "error",
      message: "Bundle manifest .mandu/manifest.json is missing. The build has never run.",
      suggestion: "Run `mandu build` before deploying.",
      details: { manifestPath },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      rule: "manifest_freshness",
      severity: "error",
      message: "Bundle manifest .mandu/manifest.json is corrupted (invalid JSON).",
      suggestion: "Run `mandu clean && mandu build` to regenerate.",
      details: { manifestPath, error: err instanceof Error ? err.message : String(err) },
    };
  }

  const env = typeof parsed.env === "string" ? parsed.env : undefined;
  const bundles = (parsed.bundles && typeof parsed.bundles === "object") ? parsed.bundles as Record<string, unknown> : {};
  const islands = (parsed.islands && typeof parsed.islands === "object") ? parsed.islands as Record<string, unknown> : {};
  const bundleCount = Object.keys(bundles).length;
  const islandCount = Object.keys(islands).length;

  if (env === "development") {
    return {
      ok: false,
      rule: "manifest_freshness",
      severity: "error",
      message: `Bundle manifest is dev-mode (env=development). Dev artifacts should never reach prod.`,
      suggestion: "Run `mandu build` to produce a production manifest.",
      details: { env, bundleCount, islandCount, buildTime: parsed.buildTime },
    };
  }

  if (env !== "production") {
    return {
      ok: false,
      rule: "manifest_freshness",
      severity: "error",
      message: `Bundle manifest has unrecognized env value: ${JSON.stringify(env)}. Expected "production".`,
      suggestion: "Run `mandu build` to regenerate the manifest.",
      details: { env, bundleCount, islandCount },
    };
  }

  if (islandCount > 0 && bundleCount === 0) {
    return {
      ok: false,
      rule: "manifest_freshness",
      severity: "warning",
      message: `Manifest declares ${islandCount} island(s) but 0 route bundles. Build may be incomplete.`,
      suggestion: "Run `mandu clean && mandu build` to rebuild from scratch.",
      details: { env, bundleCount, islandCount },
    };
  }

  return {
    ok: true,
    rule: "manifest_freshness",
    message: `Manifest is production-mode with ${bundleCount} bundle(s), ${islandCount} island(s).`,
    details: { env, bundleCount, islandCount, buildTime: parsed.buildTime },
  };
}

// ────────────────────────────────────────────────────────────────────────
// 2. prerender_pollution
// ────────────────────────────────────────────────────────────────────────

const SUSPICIOUS_SEGMENT_PATTERNS: Array<{ match: (segment: string) => boolean; why: string }> = [
  { match: (s) => s.includes("..."), why: "contains literal '...' (likely copy-pasted docs placeholder)" },
  { match: (s) => s === "path", why: "literal 'path' segment (docs placeholder for `/path`)" },
  { match: (s) => s === "route", why: "literal 'route' segment (docs placeholder)" },
  { match: (s) => s === "example", why: "literal 'example' segment (docs placeholder)" },
  { match: (s) => /^[A-Z]/.test(s) && !s.startsWith("[") && s !== s.toLowerCase(), why: "starts with uppercase (not kebab-case)" },
  { match: (s) => s.length === 1 && /[a-z]/i.test(s), why: "single-character segment (likely a typo)" },
];

function classifyRouteSegment(segment: string): string | null {
  for (const { match, why } of SUSPICIOUS_SEGMENT_PATTERNS) {
    if (match(segment)) return why;
  }
  return null;
}

/**
 * Walk a directory tree collecting HTML pathnames (relative, POSIX-joined)
 * that correspond to `index.html` leaves. Max depth is bounded to avoid
 * runaway traversal on misconfigured projects.
 */
async function collectPrerenderedRoutes(baseDir: string, maxDepth = 8): Promise<string[]> {
  const routes: string[] = [];

  async function walk(dir: string, relativeSegments: string[], depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "_manifest.json") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, [...relativeSegments, entry.name], depth + 1);
      } else if (entry.isFile() && entry.name === "index.html") {
        const route = "/" + relativeSegments.join("/");
        routes.push(route === "//" ? "/" : route);
      }
    }
  }

  try {
    const stat = await fs.stat(baseDir);
    if (stat.isDirectory()) await walk(baseDir, [], 0);
  } catch {
    // directory missing is fine — no prerendered output
  }

  return routes;
}

/**
 * #215 check 2 (#213 remediation): scan `.mandu/prerendered/` and
 * `.mandu/static/` for suspicious route shapes that typically come from
 * docs code-block leakage into `generateStaticParams()`.
 */
export async function checkPrerenderPollution(rootDir: string): Promise<DiagnoseCheckResult> {
  const dirs = [
    path.join(rootDir, ".mandu", "prerendered"),
    path.join(rootDir, ".mandu", "static"),
  ];

  const allRoutes: Array<{ dir: string; route: string }> = [];
  for (const dir of dirs) {
    const routes = await collectPrerenderedRoutes(dir);
    for (const route of routes) {
      allRoutes.push({ dir: path.relative(rootDir, dir), route });
    }
  }

  const suspicious: Array<{ route: string; segment: string; reason: string; dir: string }> = [];
  for (const { route, dir } of allRoutes) {
    const segments = route.split("/").filter(Boolean);
    for (const segment of segments) {
      const reason = classifyRouteSegment(segment);
      if (reason) {
        suspicious.push({ route, segment, reason, dir });
        break; // one hit per route is enough
      }
    }
  }

  if (suspicious.length === 0) {
    return {
      ok: true,
      rule: "prerender_pollution",
      message: `Scanned ${allRoutes.length} prerendered route(s). No suspicious shapes detected.`,
      details: { scanned: allRoutes.length },
    };
  }

  const sample = suspicious.slice(0, 5).map((s) => `${s.route} (${s.reason})`);
  return {
    ok: false,
    rule: "prerender_pollution",
    severity: "warning",
    message: `Found ${suspicious.length} suspicious prerendered route(s). Likely doc placeholder leak (#213). First: ${sample[0]}`,
    suggestion: "Check `generateStaticParams()` — often fence-block params escape the MDX extractor.",
    details: { suspiciousCount: suspicious.length, scanned: allRoutes.length, sample: suspicious.slice(0, 10) },
  };
}

// ────────────────────────────────────────────────────────────────────────
// 3. cloneelement_warnings
// ────────────────────────────────────────────────────────────────────────

/**
 * #215 check 3 (#212 remediation): scan recent build output for the
 * React "Each child in a list should have a unique key prop" warning
 * that was caused by pre-0.32 `resolveAsyncElement` cloneElement spread.
 *
 * Log file locations scanned (first existing wins):
 *   - `.mandu/build.log`
 *   - `.mandu/dev-server.stderr.log`
 *   - `.mandu/dev-server.stdout.log`
 */
export async function checkCloneElementWarnings(rootDir: string): Promise<DiagnoseCheckResult> {
  const candidates = [
    path.join(rootDir, ".mandu", "build.log"),
    path.join(rootDir, ".mandu", "dev-server.stderr.log"),
    path.join(rootDir, ".mandu", "dev-server.stdout.log"),
  ];

  let logPath: string | null = null;
  let content = "";
  for (const candidate of candidates) {
    try {
      content = await fs.readFile(candidate, "utf-8");
      logPath = candidate;
      break;
    } catch {
      // try next
    }
  }

  if (!logPath) {
    return {
      ok: true,
      rule: "cloneelement_warnings",
      message: "No build log found — nothing to scan (this is normal for fresh clones).",
      details: { scanned: candidates.map((c) => path.relative(rootDir, c)) },
    };
  }

  // Match the React key-warning signature. Two common phrasings are in the
  // wild since React 18/19 reworded the message; both matter for #212.
  const pattern = /Each child in a list should have a unique ["“]key["”] prop/g;
  const matches = content.match(pattern) ?? [];
  const count = matches.length;

  if (count === 0) {
    return {
      ok: true,
      rule: "cloneelement_warnings",
      message: `No cloneElement key warnings in ${path.relative(rootDir, logPath)}.`,
      details: { logPath: path.relative(rootDir, logPath), count: 0 },
    };
  }

  if (count <= 10) {
    return {
      ok: false,
      rule: "cloneelement_warnings",
      severity: "info",
      message: `Found ${count} "unique key prop" warning(s) in ${path.relative(rootDir, logPath)}.`,
      suggestion: "Upgrade @mandujs/core to >= 0.32.0 (resolveAsyncElement cloneElement fix, #212).",
      details: { logPath: path.relative(rootDir, logPath), count },
    };
  }

  return {
    ok: false,
    rule: "cloneelement_warnings",
    severity: "warning",
    message: `Found ${count} "unique key prop" warning(s) in ${path.relative(rootDir, logPath)} (threshold: 10).`,
    suggestion: "Upgrade @mandujs/core to >= 0.32.0 (resolveAsyncElement cloneElement fix, #212).",
    details: { logPath: path.relative(rootDir, logPath), count },
  };
}

// ────────────────────────────────────────────────────────────────────────
// 4. dev_artifacts_in_prod
// ────────────────────────────────────────────────────────────────────────

/**
 * Read `mandu.config.ts|js|json` best-effort to check the `dev.devtools`
 * flag. Returns `null` when config is missing / unreadable (fall back to
 * "devtools is on by default in dev").
 *
 * NOTE: We deliberately do NOT import the config module here — we want
 * the diagnose bundle to stay side-effect free. Parsing as text and
 * looking for the `devtools: false` pattern is sufficient for this
 * check (false-positives are acceptable; false-negatives are not).
 */
async function readDevtoolsFlag(rootDir: string): Promise<boolean | null> {
  for (const name of ["mandu.config.ts", "mandu.config.js", "mandu.config.json"]) {
    const p = path.join(rootDir, name);
    try {
      const raw = await fs.readFile(p, "utf-8");
      if (name.endsWith(".json")) {
        try {
          const parsed = JSON.parse(raw) as { dev?: { devtools?: boolean } };
          return parsed.dev?.devtools ?? null;
        } catch {
          return null;
        }
      }
      // TS/JS: look for `devtools: false` inside a `dev:` block (cheap
      // heuristic, full AST parse is overkill for a flag lookup).
      const devBlock = raw.match(/dev\s*:\s*\{[\s\S]*?\}/);
      if (devBlock) {
        if (/devtools\s*:\s*false/.test(devBlock[0])) return false;
        if (/devtools\s*:\s*true/.test(devBlock[0])) return true;
      }
      return null;
    } catch {
      // next candidate
    }
  }
  return null;
}

/**
 * #215 check 4: detect `_devtools.js` shipping to prod.
 *
 * Flags both the filesystem artifact (`.mandu/client/_devtools.js` present
 * when manifest env=production OR when user explicitly disabled devtools)
 * AND HTML pollution (prerendered HTML referencing a devtools script).
 */
export async function checkDevArtifactsInProd(rootDir: string): Promise<DiagnoseCheckResult> {
  const devtoolsPath = path.join(rootDir, ".mandu", "client", "_devtools.js");
  let devtoolsPresent = false;
  try {
    await fs.access(devtoolsPath);
    devtoolsPresent = true;
  } catch {
    devtoolsPresent = false;
  }

  // Load manifest env
  const manifestPath = path.join(rootDir, ".mandu", "manifest.json");
  let manifestEnv: string | null = null;
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as { env?: string };
    manifestEnv = parsed.env ?? null;
  } catch {
    manifestEnv = null;
  }

  const configDevtools = await readDevtoolsFlag(rootDir);

  // Scan prerendered HTML for devtools <script>
  const prerenderDirs = [
    path.join(rootDir, ".mandu", "prerendered"),
    path.join(rootDir, ".mandu", "static"),
  ];
  const pollutedHtml: string[] = [];
  async function scanHtml(dir: string, depth = 0): Promise<void> {
    if (depth > 8) return;
    let entries: Dirent[];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanHtml(full, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        try {
          const html = await fs.readFile(full, "utf-8");
          if (/<script[^>]*(src|href)=["'][^"']*_?devtools[^"']*["']/i.test(html)) {
            pollutedHtml.push(path.relative(rootDir, full));
          }
        } catch {
          // ignore unreadable
        }
      }
    }
  }
  for (const dir of prerenderDirs) await scanHtml(dir);

  // Decide severity
  const explicitlyDisabled = configDevtools === false;
  const isProduction = manifestEnv === "production";

  const problems: string[] = [];
  if (devtoolsPresent && explicitlyDisabled) {
    problems.push("_devtools.js present despite dev.devtools: false in mandu.config");
  }
  if (devtoolsPresent && isProduction) {
    problems.push("_devtools.js present in a production build (manifest env=production)");
  }
  if (pollutedHtml.length > 0) {
    problems.push(`${pollutedHtml.length} prerendered HTML file(s) reference a devtools script`);
  }

  if (problems.length === 0) {
    return {
      ok: true,
      rule: "dev_artifacts_in_prod",
      message: devtoolsPresent
        ? "_devtools.js present — expected for dev builds."
        : "No _devtools.js artifact detected.",
      details: { devtoolsPresent, manifestEnv, configDevtools, pollutedHtml: pollutedHtml.length },
    };
  }

  return {
    ok: false,
    rule: "dev_artifacts_in_prod",
    severity: "error",
    message: problems.join("; "),
    suggestion: "Run `mandu clean && mandu build` to produce a dev-artifact-free production bundle.",
    details: { devtoolsPresent, manifestEnv, configDevtools, pollutedHtml },
  };
}

// ────────────────────────────────────────────────────────────────────────
// 5. package_export_gaps
// ────────────────────────────────────────────────────────────────────────

/**
 * Walk a directory and collect `.ts/.tsx/.js/.jsx/.mts/.cts` source files.
 * `node_modules`, `.mandu`, and dot-directories are skipped.
 */
async function collectSourceFiles(rootDir: string, maxDepth = 10): Promise<string[]> {
  const found: string[] = [];
  const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })) as Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".mandu" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
        found.push(full);
      }
    }
  }
  await walk(rootDir, 0);
  return found;
}

/**
 * Parse an import specifier starting with `@mandujs/core` into a subpath.
 * Returns `"."` for bare `@mandujs/core`, `"./client"` for
 * `@mandujs/core/client`, etc. Normalizes backslashes for Windows sources.
 */
function extractCoreSubpath(specifier: string): string | null {
  const normalized = specifier.replace(/\\/g, "/");
  if (normalized === "@mandujs/core") return ".";
  if (normalized.startsWith("@mandujs/core/")) return "./" + normalized.slice("@mandujs/core/".length);
  return null;
}

/**
 * Resolve the `@mandujs/core` package export map. Tries, in order:
 *   1. `<rootDir>/node_modules/@mandujs/core/package.json`
 *   2. walk up one level to the monorepo root and retry
 *
 * Returns the parsed `exports` map (or `null` when the package is not
 * resolvable — e.g. pure-fixture test directories).
 */
async function resolveCoreExports(rootDir: string): Promise<Record<string, unknown> | null> {
  const candidates = [
    path.join(rootDir, "node_modules", "@mandujs", "core", "package.json"),
    path.join(rootDir, "..", "node_modules", "@mandujs", "core", "package.json"),
    path.join(rootDir, "..", "..", "node_modules", "@mandujs", "core", "package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf-8");
      const parsed = JSON.parse(raw) as { exports?: Record<string, unknown> };
      if (parsed.exports && typeof parsed.exports === "object") {
        return parsed.exports;
      }
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Match a user subpath against the exports map. The map supports exact
 * keys plus `./*` wildcard fallback. We accept either.
 */
function subpathIsExported(subpath: string, exports: Record<string, unknown>): boolean {
  if (subpath in exports) return true;
  // Wildcard — `"./*": "./src/*"`
  if ("./*" in exports) return true;
  // Pattern export — `"./foo/*": "./src/foo/*.ts"` (less common but valid).
  for (const key of Object.keys(exports)) {
    if (!key.endsWith("/*")) continue;
    const prefix = key.slice(0, -1); // strip trailing `*`, keep `/`
    if (subpath.startsWith(prefix) && subpath.length > prefix.length) return true;
  }
  return false;
}

/**
 * #215 check 5: detect user imports of `@mandujs/core/<subpath>` that are
 * not declared in the installed core's `exports` map. This catches the
 * #194/#202/#210 pattern where example code in docs or agent-generated
 * code imports a subpath that was renamed or never shipped.
 */
export async function checkPackageExportGaps(rootDir: string): Promise<DiagnoseCheckResult> {
  const exportsMap = await resolveCoreExports(rootDir);
  if (!exportsMap) {
    return {
      ok: true,
      rule: "package_export_gaps",
      message: "@mandujs/core package.json not resolvable from this project — skipping (OK for fixture/test roots).",
      details: { skipped: true },
    };
  }

  const files = await collectSourceFiles(rootDir);
  // Match both `from "@mandujs/core/..."` and `require("@mandujs/core/...")` forms.
  const importRegex = /(?:from|require\()\s*["']([^"']+)["']/g;
  const userSubpaths = new Map<string, string[]>();

  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch {
      continue;
    }
    let match: RegExpExecArray | null;
    importRegex.lastIndex = 0;
    while ((match = importRegex.exec(content)) !== null) {
      const specifier = match[1];
      const subpath = extractCoreSubpath(specifier);
      if (!subpath) continue;
      if (!userSubpaths.has(subpath)) userSubpaths.set(subpath, []);
      userSubpaths.get(subpath)!.push(path.relative(rootDir, file));
    }
  }

  const gaps: Array<{ subpath: string; files: string[] }> = [];
  for (const [subpath, filesUsingIt] of userSubpaths.entries()) {
    if (!subpathIsExported(subpath, exportsMap)) {
      gaps.push({ subpath: `@mandujs/core${subpath === "." ? "" : subpath.replace(/^\./, "")}`, files: filesUsingIt.slice(0, 5) });
    }
  }

  if (gaps.length === 0) {
    return {
      ok: true,
      rule: "package_export_gaps",
      message: `Scanned ${files.length} source file(s) using ${userSubpaths.size} unique @mandujs/core subpath(s). All declared in exports map.`,
      details: { scanned: files.length, uniqueSubpaths: userSubpaths.size },
    };
  }

  const first = gaps[0];
  return {
    ok: false,
    rule: "package_export_gaps",
    severity: "error",
    message: `${gaps.length} @mandujs/core subpath(s) imported but not in exports map. First: ${first.subpath} (used by ${first.files[0]}).`,
    suggestion: "Verify the subpath exists in the installed core version, or upgrade @mandujs/core.",
    details: { gapCount: gaps.length, gaps },
  };
}
