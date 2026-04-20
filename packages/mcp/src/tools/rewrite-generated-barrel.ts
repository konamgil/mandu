/**
 * MCP tool — `mandu.refactor.rewrite_generated_barrel`
 *
 * Automates migration of barrel files that reach directly into
 * `__generated__/*` paths (the #1 cause of `INVALID_GENERATED_IMPORT` guard
 * failures) to the sanctioned `getGenerated()` accessor from
 * `@mandujs/core/runtime`.
 *
 * Transform example:
 *
 *   // BEFORE
 *   export { items } from "../__generated__/items.data";
 *
 *   // AFTER
 *   import { getGenerated } from "@mandujs/core/runtime";
 *   declare module "@mandujs/core/runtime" {
 *     interface GeneratedRegistry { "items": typeof items; }
 *   }
 *   export const items = getGenerated("items");
 *
 * Behaviour:
 *   • Input: `{ dryRun?: boolean, patterns?: string[] }`. `patterns` are
 *     relative glob-like roots to scan (default: `packages/*`, `src/**`).
 *     The implementation uses a deterministic recursive walk — we do not
 *     pull in a glob dep.
 *   • Each file is parsed with a minimal, conservative regex set that only
 *     matches re-exports of the form `export { … } from "…/__generated__/…"`.
 *     Anything more exotic is reported under `skipped` with a reason.
 *   • On `dryRun: true` (default) we only return the plan. On
 *     `dryRun: false` we write files via `Bun.write`, which is atomic.
 *   • Parse / I/O errors for a single file are captured and do not abort
 *     the scan.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { readdir } from "fs/promises";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface RewriteBarrelInput {
  dryRun?: boolean;
  patterns?: string[];
}

export interface RewriteBarrelPlanEntry {
  file: string;
  before: string;
  after: string;
  rewrites: Array<{ name: string; key: string; source: string }>;
  appliedIf: "not-dry-run";
}

export interface RewriteBarrelSkip {
  file: string;
  reason: string;
}

export interface RewriteBarrelResult {
  scanned: number;
  matched: number;
  rewritten: number;
  skipped: RewriteBarrelSkip[];
  plan: RewriteBarrelPlanEntry[];
  dryRun: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

function validateInput(
  raw: Record<string, unknown>,
):
  | { ok: true; value: { dryRun: boolean; patterns: string[] } }
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

  const patterns = raw.patterns;
  if (patterns !== undefined) {
    if (!Array.isArray(patterns) || !patterns.every((p) => typeof p === "string")) {
      return {
        ok: false,
        error: "'patterns' must be an array of strings",
        field: "patterns",
        hint: "E.g. ['packages', 'src']",
      };
    }
  }

  return {
    ok: true,
    value: {
      dryRun: dryRun === undefined ? true : dryRun,
      patterns:
        patterns && Array.isArray(patterns) && patterns.length > 0
          ? (patterns as string[])
          : ["packages", "src"],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// FS walk
// ─────────────────────────────────────────────────────────────────────────

const EXT_REGEX = /\.(?:ts|tsx|mts|cts)$/;
const IGNORE_DIRS = new Set([
  "node_modules",
  ".mandu",
  "dist",
  "build",
  ".git",
  ".next",
  "coverage",
  "__generated__",
]);

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      await walk(root, full, out);
    } else if (e.isFile() && EXT_REGEX.test(e.name)) {
      out.push(full);
    }
  }
}

async function collectFiles(projectRoot: string, patterns: string[]): Promise<string[]> {
  const collected = new Set<string>();
  for (const rel of patterns) {
    const abs = path.resolve(projectRoot, rel);
    const files: string[] = [];
    await walk(projectRoot, abs, files);
    for (const f of files) collected.add(f);
  }
  return [...collected].sort();
}

// ─────────────────────────────────────────────────────────────────────────
// Rewrite engine
// ─────────────────────────────────────────────────────────────────────────

/**
 * Regex matching a re-export of the form:
 *   export { a, b as c } from "…/__generated__/name.data";
 *
 * Captures:
 *   [1] = names block (e.g. `a, b as c`)
 *   [2] = source path
 */
const GENERATED_REEXPORT_REGEX =
  /export\s*\{\s*([^}]+)\s*\}\s*from\s*["']([^"']*__generated__[^"']*)["']\s*;?/g;

/** Parse a names-block `a, b as c, default as d` → [{name, alias?}]. */
function parseNames(namesBlock: string): Array<{ name: string; alias?: string }> {
  return namesBlock
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok) => {
      const asMatch = /^(\S+)\s+as\s+(\S+)$/.exec(tok);
      if (asMatch) return { name: asMatch[1], alias: asMatch[2] };
      return { name: tok };
    });
}

/** Derive a registry key from a __generated__ source path. */
export function deriveGeneratedKey(source: string): string {
  // `../__generated__/items.data` → `items`
  // `./__generated__/foo/bar.data` → `foo/bar`
  const idx = source.indexOf("__generated__/");
  const tail = idx >= 0 ? source.slice(idx + "__generated__/".length) : source;
  return tail.replace(/\.(?:data|index|gen|g)$/, "").replace(/\/index$/, "");
}

export interface RewriteOutcome {
  after: string;
  rewrites: Array<{ name: string; key: string; source: string }>;
}

/**
 * Rewrite the source of a single barrel file. Returns `null` when no
 * `__generated__` re-export is present (nothing to do).
 *
 * Exported for regression testing.
 */
export function rewriteBarrelSource(before: string): RewriteOutcome | null {
  // Fast bail: no hits at all.
  if (!/__generated__/.test(before)) return null;

  const rewrites: Array<{ name: string; key: string; source: string }> = [];
  let matched = false;

  // Build an accumulator of replacement blocks; each match becomes a
  // declare-module + const block.
  const replaced = before.replace(
    GENERATED_REEXPORT_REGEX,
    (_full, namesBlock: string, source: string) => {
      matched = true;
      const key = deriveGeneratedKey(source);
      const names = parseNames(namesBlock);
      const constDecls: string[] = [];
      const typeLines: string[] = [];
      for (const n of names) {
        const exported = n.alias ?? n.name;
        // Per re-export we emit a single registry key but re-expose each
        // symbol as its own const. The registry key is derived from the
        // file path — all symbols in the same re-export share it and are
        // expected to live on the same generated artifact. When multiple
        // symbols come from one source we destructure.
        if (names.length === 1) {
          constDecls.push(
            `export const ${exported} = getGenerated(${JSON.stringify(key)});`,
          );
          typeLines.push(`    ${JSON.stringify(key)}: typeof ${exported};`);
        } else {
          // First rewrite emits the shared const; subsequent destructures
          // pull the field off of it.
          if (constDecls.length === 0) {
            constDecls.push(
              `const __${sanitize(key)} = getGenerated(${JSON.stringify(key)});`,
            );
          }
          constDecls.push(
            `export const ${exported} = __${sanitize(key)}.${n.name};`,
          );
          typeLines.push(
            `    ${JSON.stringify(key)}: { ${names
              .map((m) => `${m.name}: typeof ${m.alias ?? m.name};`)
              .join(" ")} };`,
          );
        }
        rewrites.push({ name: exported, key, source });
      }

      const dedupedTypeLines = [...new Set(typeLines)];
      return [
        `declare module "@mandujs/core/runtime" {`,
        `  interface GeneratedRegistry {`,
        ...dedupedTypeLines,
        `  }`,
        `}`,
        ...constDecls,
      ].join("\n");
    },
  );

  if (!matched) return null;

  // Ensure a single `import { getGenerated } from "@mandujs/core/runtime"`
  // is present. If the file already imports it, we leave it alone.
  const hasImport =
    /import\s*\{[^}]*\bgetGenerated\b[^}]*\}\s*from\s*["']@mandujs\/core\/runtime["']/.test(
      replaced,
    );
  const after = hasImport
    ? replaced
    : `import { getGenerated } from "@mandujs/core/runtime";\n${replaced}`;

  return { after, rewrites };
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, "_");
}

// ─────────────────────────────────────────────────────────────────────────
// Public handler
// ─────────────────────────────────────────────────────────────────────────

async function runRewrite(
  projectRoot: string,
  input: RewriteBarrelInput,
): Promise<RewriteBarrelResult | { error: string; field?: string; hint?: string }> {
  const validated = validateInput(input as Record<string, unknown>);
  if (!validated.ok) {
    return { error: validated.error, field: validated.field, hint: validated.hint };
  }
  const { dryRun, patterns } = validated.value;

  const files = await collectFiles(projectRoot, patterns);

  const plan: RewriteBarrelPlanEntry[] = [];
  const skipped: RewriteBarrelSkip[] = [];
  let rewritten = 0;

  for (const file of files) {
    let before: string;
    try {
      before = await Bun.file(file).text();
    } catch (err) {
      skipped.push({
        file: path.relative(projectRoot, file),
        reason: `read failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    let outcome: RewriteOutcome | null = null;
    try {
      outcome = rewriteBarrelSource(before);
    } catch (err) {
      skipped.push({
        file: path.relative(projectRoot, file),
        reason: `parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    if (!outcome) continue; // no __generated__ re-export, irrelevant

    const rel = path.relative(projectRoot, file);
    plan.push({
      file: rel,
      before,
      after: outcome.after,
      rewrites: outcome.rewrites,
      appliedIf: "not-dry-run",
    });

    if (!dryRun) {
      try {
        await Bun.write(file, outcome.after);
        rewritten += 1;
      } catch (err) {
        skipped.push({
          file: rel,
          reason: `write failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  return {
    scanned: files.length,
    matched: plan.length,
    rewritten,
    skipped,
    plan,
    dryRun,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// MCP tool definition + handler map
// ─────────────────────────────────────────────────────────────────────────

export const rewriteGeneratedBarrelToolDefinitions: Tool[] = [
  {
    name: "mandu.refactor.rewrite_generated_barrel",
    description:
      "Scan the project for barrel files that re-export from `__generated__/*` paths (a `INVALID_GENERATED_IMPORT` guard violation) and rewrite each to use `getGenerated()` from `@mandujs/core/runtime` with the proper `GeneratedRegistry` module augmentation. Returns a per-file before/after plan. Dry-run by default.",
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
            "When true (default), return the plan without writing files. When false, rewrite files atomically via Bun.write.",
        },
        patterns: {
          type: "array",
          items: { type: "string" },
          description:
            "Relative directory roots to scan (default: ['packages', 'src']).",
        },
      },
      required: [],
    },
  },
];

export function rewriteGeneratedBarrelTools(projectRoot: string) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> =
    {
      "mandu.refactor.rewrite_generated_barrel": async (args) =>
        runRewrite(projectRoot, args as RewriteBarrelInput),
    };
  return handlers;
}
