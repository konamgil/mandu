/**
 * Deploy inference context — the bundle of facts an inferer (heuristic
 * or brain) consumes when deciding a route's `DeployIntent`.
 *
 * Issue #250 — Phase 1.
 *
 * The context is intentionally narrow. Anything that's not statically
 * derivable from the route source and manifest entry stays out — we
 * want inference to be deterministic enough that two identical inputs
 * always yield the same intent.
 */

import { promises as fs } from "fs";
import { createHash } from "crypto";
import path from "path";
import type { RouteSpec } from "../../spec/schema";

/**
 * The dependency import classes the heuristic recognises. Mapped from
 * raw import specifiers in `extractImports()` below. The key is the
 * coarsest signal a route exposes about whether it can run at the
 * edge — DB drivers and file IO push the route to `node`/`bun`, while
 * stateless `fetch`/transform code happily runs at the edge.
 */
export type DependencyClass =
  | "db"          // bun:sqlite, postgres, drizzle, prisma, mongodb, etc.
  | "node-fs"    // node:fs, fs/promises, fs
  | "node-net"   // node:net, http, dgram
  | "node-child" // node:child_process, worker_threads
  | "bun-native" // bun:sqlite, bun:ffi, Bun.s3, Bun.serve
  | "ai-sdk"     // @anthropic-ai/sdk, openai, ai (long latency)
  | "heavy"      // sharp, playwright, puppeteer, large native deps
  | "fetch-only" // only http fetch / minor transforms
  | "unknown";

export interface DeployInferenceContext {
  /** Stable id from the manifest entry. */
  routeId: string;
  /** URL pattern (`/api/embed`, `/[lang]/page`). */
  pattern: string;
  /** `page` | `api` | `metadata`. */
  kind: RouteSpec["kind"];
  /** Pattern contains `[param]` or `[...rest]`. */
  isDynamic: boolean;
  /**
   * Page route exports `generateStaticParams` AND has at least one
   * static-param entry in the manifest. Adapters use this with
   * `runtime: "static"` to know the route is genuinely prerenderable.
   */
  hasGenerateStaticParams: boolean;
  /** Top-level imports from the handler module (deduped, sorted). */
  imports: string[];
  /** Coarse classification derived from `imports`. */
  dependencyClasses: ReadonlySet<DependencyClass>;
  /** Whether the handler exports a `default` Mandu.filling() instance. */
  exportsFilling: boolean;
  /**
   * SHA-256 of the route source. Used by the cache to skip re-
   * inference when nothing relevant changed.
   */
  sourceHash: string;
}

/**
 * Build the inference context for a single route. `rootDir` is the
 * project root; `route.module` is resolved relative to it.
 */
export async function buildDeployInferenceContext(
  rootDir: string,
  route: RouteSpec,
): Promise<DeployInferenceContext> {
  const modulePath = path.resolve(rootDir, route.module);
  let source = "";
  try {
    source = await fs.readFile(modulePath, "utf8");
  } catch {
    // A missing module file is unusual but not fatal — the inferer
    // still gets the manifest metadata and falls back to defaults.
  }

  const imports = extractImports(source);
  const dependencyClasses = classifySourceDependencies(source, imports);
  // Mandu's manifest patterns use `:param` / `*` (path-pattern style),
  // not bracket-form. Detect both shapes so the heuristic doesn't
  // misclassify dynamic routes as prerenderable. Examples:
  //   "/blog/:slug"   → dynamic
  //   "/docs/*"       → dynamic
  //   "/[lang]/blog"  → dynamic (legacy / hand-written)
  const isDynamic =
    /\[(\.\.\.)?[^\]]+\]/.test(route.pattern) ||
    /\/:[^/]+/.test(route.pattern) ||
    /\*/.test(route.pattern);
  const hasGenerateStaticParams =
    route.kind === "page" &&
    Array.isArray(route.staticParams) &&
    route.staticParams.length > 0;
  const exportsFilling = /\bMandu\.filling\b|\bfilling\(\)/m.test(source);

  return {
    routeId: route.id,
    pattern: route.pattern,
    kind: route.kind,
    isDynamic,
    hasGenerateStaticParams,
    imports,
    dependencyClasses,
    exportsFilling,
    sourceHash: hashSource(source),
  };
}

// ─── Internals ────────────────────────────────────────────────────────

/** SHA-256 hex digest. Empty input still produces a stable hash. */
export function hashSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

/**
 * Extract bare import specifiers (`from "..."` / `import("...")`).
 *
 * Best-effort — a TS AST would be more precise but pulling in a parser
 * just for this is heavy. False positives (matches in comments or
 * strings) only mis-classify the route in the heuristic, never break
 * deploys, and the brain inferer can override.
 */
export function extractImports(source: string): string[] {
  const out = new Set<string>();
  const staticImport = /^\s*import\b[^"']*?["']([^"']+)["']/gm;
  const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticImport, dynamicImport]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const spec = m[1]!;
      if (!spec.startsWith(".")) out.add(spec);
    }
  }
  return [...out].sort();
}

/** Map import specifiers to coarse dependency classes. */
export function classifyImports(imports: string[]): ReadonlySet<DependencyClass> {
  const classes = new Set<DependencyClass>();
  for (const spec of imports) {
    const cls = classifyOne(spec);
    if (cls) classes.add(cls);
  }
  if (classes.size === 0) classes.add("fetch-only");
  return classes;
}

/**
 * Classify dependency signals that do not always appear as bare imports.
 *
 * Dogfooding surfaced Mandu API routes importing project-local
 * `src/server/infra/db` helpers and using `db` tagged templates. Those
 * are server-only even when the bare imports look edge-safe.
 */
export function classifySourceDependencies(
  source: string,
  imports: string[] = extractImports(source),
): ReadonlySet<DependencyClass> {
  const classes = new Set<DependencyClass>(classifyImports(imports));
  if (classes.size === 1 && classes.has("fetch-only")) {
    classes.delete("fetch-only");
  }

  const allImports = extractAllImportSpecifiers(source);
  if (allImports.some(isServerInfraImport)) {
    classes.add("db");
  }

  if (/\bBun\.SQL\b|\bBun\.sqlite\b/i.test(source)) {
    classes.add("bun-native");
  }

  if (
    /(?:^|[^\w$])db\s*`/.test(source) ||
    /\bctx\.deps\.db\b/.test(source) ||
    /\bdb\.(?:query|execute|select|insert|update|delete)\b/.test(source)
  ) {
    classes.add("db");
  }

  if (classes.size === 0) {
    classes.add("fetch-only");
  }
  return classes;
}

function extractAllImportSpecifiers(source: string): string[] {
  const out = new Set<string>();
  const staticImport = /^\s*import\b[^"']*?["']([^"']+)["']/gm;
  const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticImport, dynamicImport]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      out.add(m[1]!);
    }
  }
  return [...out].sort();
}

function isServerInfraImport(specifier: string): boolean {
  const s = specifier.replace(/\\/g, "/").toLowerCase();
  return (
    s === "@/server/infra" ||
    s.startsWith("@/server/infra/") ||
    s === "src/server/infra" ||
    s.startsWith("src/server/infra/") ||
    s.endsWith("/server/infra") ||
    s.includes("/server/infra/")
  );
}

function classifyOne(spec: string): DependencyClass | null {
  const s = spec.toLowerCase();
  if (
    s === "bun:sqlite" ||
    s === "bun:ffi" ||
    s.startsWith("bun:")
  ) {
    return "bun-native";
  }
  if (s === "fs" || s === "fs/promises" || s === "node:fs" || s === "node:fs/promises" || s === "node:path") {
    return "node-fs";
  }
  if (s === "net" || s === "node:net" || s === "node:dgram" || s === "node:tls") {
    return "node-net";
  }
  if (s === "node:child_process" || s === "child_process" || s === "node:worker_threads" || s === "worker_threads") {
    return "node-child";
  }
  if (
    /^(postgres|pg|mysql2?|drizzle-orm(\/.*)?|@prisma\/client|prisma|mongodb|mongoose|@neondatabase\/.+|kysely|sqlite3|better-sqlite3|@planetscale\/.+)$/.test(s)
  ) {
    return "db";
  }
  if (s === "@mandujs/core/db" || s.startsWith("@mandujs/core/db/")) {
    return "db";
  }
  if (/^(@anthropic-ai\/sdk|openai|ai|@ai-sdk\/.+|@google\/generative-ai|cohere-ai)$/.test(s)) {
    return "ai-sdk";
  }
  if (/^(sharp|playwright|playwright-core|puppeteer|@sparticuz\/.+|canvas|jimp)$/.test(s)) {
    return "heavy";
  }
  return null;
}
