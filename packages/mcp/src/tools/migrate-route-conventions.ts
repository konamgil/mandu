/**
 * MCP tool — `mandu.refactor.migrate_route_conventions`
 *
 * Detects Next.js-style inline patterns in user code and migrates them to
 * Mandu's file-system route conventions:
 *
 *   • Inline `<Suspense fallback={…}>…</Suspense>` → extract to `loading.tsx`
 *   • Inline `<ErrorBoundary fallback={…}>…</ErrorBoundary>` → `error.tsx`
 *   • Inline `if (!x) return <NotFound />` / `notFound()` call → `not-found.tsx`
 *
 * Scope:
 *   • We only act on files under the `app/` tree (Mandu's routes dir).
 *   • We never overwrite an existing convention file — if `loading.tsx`
 *     already exists, we report the route as already-migrated.
 *   • We do not parse TSX with a real parser — detection uses conservative
 *     regex markers. False positives are acceptable; false file writes are
 *     not, so we bail out of extraction on any ambiguity.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { readdir } from "fs/promises";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export type RouteConvention = "loading" | "error" | "not-found";

export interface MigrateRouteConventionsInput {
  dryRun?: boolean;
  routes?: string[];
}

export interface MigrateExtractionEntry {
  route: string;
  convention: RouteConvention;
  extractedPath: string;
  sourceFile: string;
  note?: string;
}

export interface MigrateRouteConventionsResult {
  routes: string[];
  extracted: MigrateExtractionEntry[];
  skipped: Array<{ route: string; reason: string }>;
  dryRun: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

function validateInput(
  raw: Record<string, unknown>,
):
  | { ok: true; value: { dryRun: boolean; routes?: string[] } }
  | { ok: false; error: string; field: string; hint: string } {
  const dryRun = raw.dryRun;
  if (dryRun !== undefined && typeof dryRun !== "boolean") {
    return {
      ok: false,
      error: "'dryRun' must be a boolean",
      field: "dryRun",
      hint: "Omit to default to true, pass false to actually write files",
    };
  }
  const routes = raw.routes;
  if (routes !== undefined) {
    if (!Array.isArray(routes) || !routes.every((r) => typeof r === "string")) {
      return {
        ok: false,
        error: "'routes' must be an array of strings",
        field: "routes",
        hint: "E.g. ['app/dashboard', 'app/users/[id]']",
      };
    }
  }
  return {
    ok: true,
    value: {
      dryRun: dryRun === undefined ? true : dryRun,
      ...(Array.isArray(routes) ? { routes: routes as string[] } : {}),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Route discovery — a lightweight replacement for fs-scanner that keeps
// this tool self-contained. We look for `page.ts(x)` files under `app/`.
// ─────────────────────────────────────────────────────────────────────────

async function collectRoutes(
  projectRoot: string,
  filter?: string[],
): Promise<string[]> {
  const appDir = path.join(projectRoot, "app");
  const found: string[] = [];
  await walkPages(appDir, found);
  const rels = found.map((p) => path.relative(projectRoot, path.dirname(p)));
  if (!filter || filter.length === 0) return rels.sort();
  const set = new Set(filter.map((f) => f.replace(/\\/g, "/")));
  return rels.filter((r) => set.has(r.replace(/\\/g, "/"))).sort();
}

async function walkPages(dir: string, out: string[]): Promise<void> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith("_") || e.name === "node_modules") continue;
      await walkPages(full, out);
    } else if (
      e.isFile() &&
      /^page\.(?:tsx|ts|jsx|js)$/.test(e.name)
    ) {
      out.push(full);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────────────────────────────────

export interface DetectionHit {
  convention: RouteConvention;
  fallbackSnippet: string;
}

/**
 * Scan a single page source for inline Suspense / ErrorBoundary / NotFound
 * patterns. Exported for regression tests.
 */
export function detectConventions(source: string): DetectionHit[] {
  const hits: DetectionHit[] = [];

  // `<Suspense fallback={<Loading />}>`
  const suspense = /<Suspense\s+fallback\s*=\s*\{([^}]*)\}\s*>/.exec(source);
  if (suspense) {
    hits.push({
      convention: "loading",
      fallbackSnippet: suspense[1].trim(),
    });
  }

  // `<ErrorBoundary fallback={…}>`
  const errBoundary = /<ErrorBoundary\s+fallback\s*=\s*\{([^}]*)\}\s*>/.exec(source);
  if (errBoundary) {
    hits.push({
      convention: "error",
      fallbackSnippet: errBoundary[1].trim(),
    });
  }

  // `if (…) return <NotFound />` — lenient single-line match
  const inlineNotFound =
    /return\s*<NotFound\s*\/?\s*>|notFound\s*\(\s*\)/.exec(source);
  if (inlineNotFound) {
    hits.push({
      convention: "not-found",
      fallbackSnippet: "<div>Not found</div>",
    });
  }

  return hits;
}

function conventionFilename(c: RouteConvention): string {
  return `${c}.tsx`;
}

function renderConventionFile(
  convention: RouteConvention,
  fallback: string,
): string {
  const header =
    `/**\n` +
    ` * Auto-generated by mandu.refactor.migrate_route_conventions.\n` +
    ` * Review and hand-tune as needed.\n` +
    ` */\n`;

  switch (convention) {
    case "loading":
      return `${header}\nexport default function Loading() {\n  return ${fallback};\n}\n`;
    case "error":
      return (
        `${header}\n` +
        `export default function Error({ error, reset }: { error: Error; reset: () => void }) {\n` +
        `  return ${fallback};\n` +
        `}\n`
      );
    case "not-found":
      return `${header}\nexport default function NotFound() {\n  return ${fallback};\n}\n`;
  }
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    const f = Bun.file(absPath);
    return await f.exists();
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public handler
// ─────────────────────────────────────────────────────────────────────────

async function runMigrate(
  projectRoot: string,
  input: MigrateRouteConventionsInput,
): Promise<
  | MigrateRouteConventionsResult
  | { error: string; field?: string; hint?: string }
> {
  const validated = validateInput(input as Record<string, unknown>);
  if (!validated.ok) {
    return { error: validated.error, field: validated.field, hint: validated.hint };
  }
  const { dryRun, routes: filter } = validated.value;

  const routes = await collectRoutes(projectRoot, filter);
  const extracted: MigrateExtractionEntry[] = [];
  const skipped: Array<{ route: string; reason: string }> = [];

  for (const route of routes) {
    const routeDir = path.join(projectRoot, route);

    // Find the page file (tsx > ts > jsx > js)
    let pageFile: string | null = null;
    for (const ext of ["tsx", "ts", "jsx", "js"]) {
      const cand = path.join(routeDir, `page.${ext}`);
      if (await fileExists(cand)) {
        pageFile = cand;
        break;
      }
    }
    if (!pageFile) {
      skipped.push({ route, reason: "no page file" });
      continue;
    }

    let source: string;
    try {
      source = await Bun.file(pageFile).text();
    } catch (err) {
      skipped.push({
        route,
        reason: `read failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    const hits = detectConventions(source);
    if (hits.length === 0) continue;

    for (const hit of hits) {
      const target = path.join(routeDir, conventionFilename(hit.convention));
      const relTarget = path.relative(projectRoot, target);

      if (await fileExists(target)) {
        extracted.push({
          route,
          convention: hit.convention,
          extractedPath: relTarget,
          sourceFile: path.relative(projectRoot, pageFile),
          note: "already exists — skipped write",
        });
        continue;
      }

      const content = renderConventionFile(hit.convention, hit.fallbackSnippet);

      if (!dryRun) {
        try {
          await Bun.write(target, content);
        } catch (err) {
          skipped.push({
            route,
            reason: `write ${hit.convention}: ${err instanceof Error ? err.message : String(err)}`,
          });
          continue;
        }
      }

      extracted.push({
        route,
        convention: hit.convention,
        extractedPath: relTarget,
        sourceFile: path.relative(projectRoot, pageFile),
      });
    }
  }

  return { routes, extracted, skipped, dryRun };
}

// ─────────────────────────────────────────────────────────────────────────
// MCP tool definition + handler map
// ─────────────────────────────────────────────────────────────────────────

export const migrateRouteConventionsToolDefinitions: Tool[] = [
  {
    name: "mandu.refactor.migrate_route_conventions",
    description:
      "Detect Next.js-style inline patterns in `app/**/page.*` files (Suspense fallback, ErrorBoundary, inline NotFound) and extract them to Mandu's file-system route conventions (`loading.tsx`, `error.tsx`, `not-found.tsx`). Never overwrites an existing convention file. Dry-run by default.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        dryRun: {
          type: "boolean",
          description:
            "When true (default), return the plan without writing files. When false, create the convention files.",
        },
        routes: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of route directories to restrict the scan to. Paths are relative to the project root (e.g. 'app/dashboard').",
        },
      },
      required: [],
    },
  },
];

export function migrateRouteConventionsTools(projectRoot: string) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> =
    {
      "mandu.refactor.migrate_route_conventions": async (args) =>
        runMigrate(projectRoot, args as MigrateRouteConventionsInput),
    };
  return handlers;
}
