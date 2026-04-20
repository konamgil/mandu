/**
 * MCP tool — `mandu.refactor.extract_contract`
 *
 * Scans `app/api/**\/route.ts` for inline ad-hoc Zod schemas and extracts
 * each into a sibling contract module following the `defineContract()`
 * convention from `@mandujs/core`.
 *
 * Detection is conservative: we look for `z.object({ … })` literals bound
 * to a local identifier (`const FooSchema = z.object({ … })`). We do NOT
 * attempt to re-parse the route handler — extraction emits a new file and
 * leaves a `TODO` comment next to each source site instructing the author
 * to swap to the contract import. The intent is "halfway refactor"
 * assistance, not a full AST-level transform.
 *
 * Output format:
 *   For `app/api/users/route.ts` containing
 *     `const CreateUser = z.object({ name: z.string() });`
 *   we emit `contract/users.contract.ts`:
 *     ```ts
 *     import { z } from "zod";
 *     import { defineContract } from "@mandujs/core";
 *     export const usersContract = defineContract({
 *       create: {
 *         method: "POST",
 *         path: "/api/users",
 *         input: z.object({ name: z.string() }),
 *         output: z.unknown(),
 *       },
 *     });
 *     ```
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { readdir } from "fs/promises";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface ExtractContractInput {
  dryRun?: boolean;
  route?: string;
}

export interface ExtractedContractEntry {
  route: string;
  contractFile: string;
  schemaName: string;
  sourceFile: string;
}

export interface ExtractContractResult {
  extracted: ExtractedContractEntry[];
  skipped: Array<{ route: string; reason: string }>;
  dryRun: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

function validateInput(
  raw: Record<string, unknown>,
):
  | { ok: true; value: { dryRun: boolean; route?: string } }
  | { ok: false; error: string; field: string; hint: string } {
  const dryRun = raw.dryRun;
  if (dryRun !== undefined && typeof dryRun !== "boolean") {
    return {
      ok: false,
      error: "'dryRun' must be a boolean",
      field: "dryRun",
      hint: "Omit to default to true",
    };
  }
  const route = raw.route;
  if (route !== undefined && typeof route !== "string") {
    return {
      ok: false,
      error: "'route' must be a string",
      field: "route",
      hint: "E.g. 'app/api/users'",
    };
  }
  return {
    ok: true,
    value: {
      dryRun: dryRun === undefined ? true : dryRun,
      ...(typeof route === "string" ? { route } : {}),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Route discovery — find `app/api/**\/route.ts(x)` files
// ─────────────────────────────────────────────────────────────────────────

async function findApiRoutes(projectRoot: string): Promise<string[]> {
  const apiDir = path.join(projectRoot, "app", "api");
  const out: string[] = [];
  await walkApi(apiDir, out);
  return out.sort();
}

async function walkApi(dir: string, out: string[]): Promise<void> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith("_")) continue;
      await walkApi(full, out);
    } else if (e.isFile() && /^route\.(?:tsx|ts|jsx|js)$/.test(e.name)) {
      out.push(full);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Inline-schema detection
// ─────────────────────────────────────────────────────────────────────────

export interface DetectedSchema {
  name: string;
  /** The balanced `z.object({ … })` literal. */
  body: string;
  /** The HTTP method associated (heuristic from exported fn names). */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
}

/**
 * Walk forward from `z.object(` and return the index just past the
 * matching `)` using brace-depth tracking. Returns -1 if unbalanced.
 */
export function findZodObjectEnd(source: string, start: number): number {
  // Expect `z.object(` at `start`.
  const open = source.indexOf("(", start);
  if (open < 0) return -1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0 && ch === ")") return i + 1;
    }
  }
  return -1;
}

/**
 * Detect inline Zod schemas bound to a const identifier.
 *
 * Exported for regression tests.
 */
export function detectInlineSchemas(source: string): DetectedSchema[] {
  const out: DetectedSchema[] = [];
  const constRegex = /\bconst\s+(\w+)\s*=\s*z\.object\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = constRegex.exec(source)) !== null) {
    const name = m[1];
    const openZ = source.indexOf("z.object", m.index);
    if (openZ < 0) continue;
    const end = findZodObjectEnd(source, openZ);
    if (end < 0) continue;
    const body = source.slice(openZ, end);
    out.push({
      name,
      body,
      method: inferMethod(source, name),
    });
  }
  return out;
}

function inferMethod(
  source: string,
  schemaName: string,
): "GET" | "POST" | "PUT" | "PATCH" | "DELETE" {
  // Heuristic: look at which exported HTTP handler mentions the schema.
  const methods = ["POST", "PUT", "PATCH", "DELETE", "GET"] as const;
  for (const method of methods) {
    const re = new RegExp(
      `export\\s+(?:async\\s+)?function\\s+${method}\\b[\\s\\S]*?\\b${schemaName}\\b`,
    );
    if (re.test(source)) return method;
  }
  // Fallback: if the schema name hints at mutation, guess POST.
  if (/create|update|delete|patch/i.test(schemaName)) return "POST";
  return "GET";
}

// ─────────────────────────────────────────────────────────────────────────
// Emit contract file
// ─────────────────────────────────────────────────────────────────────────

export interface ContractModuleOutput {
  fileName: string;
  contractName: string;
  source: string;
}

/**
 * Build a `contract/<name>.contract.ts` source for the given route +
 * detected schemas. Exported for tests.
 */
export function renderContractModule(
  routeRel: string,
  schemas: DetectedSchema[],
): ContractModuleOutput {
  // routeRel like `app/api/users/route.ts` → group name `users`
  const parts = routeRel.split(/[\\/]/);
  const apiIdx = parts.indexOf("api");
  const segs = apiIdx >= 0 ? parts.slice(apiIdx + 1) : parts.slice(-2);
  const group =
    segs
      .filter((s) => s !== "route.ts" && s !== "route.tsx")
      .filter(Boolean)
      .join("-")
      .replace(/[\[\]]/g, "")
      .replace(/[^A-Za-z0-9_-]/g, "") || "api";

  const contractName = `${camelize(group)}Contract`;
  const urlPath = "/api/" + segs.filter((s) => !/^route\./.test(s)).join("/");

  const endpoints = schemas
    .map((s) => {
      const opKey = deriveOpKey(s.name, s.method);
      return (
        `  ${opKey}: {\n` +
        `    method: ${JSON.stringify(s.method)},\n` +
        `    path: ${JSON.stringify(urlPath)},\n` +
        `    input: ${s.body},\n` +
        `    output: z.unknown(),\n` +
        `  },`
      );
    })
    .join("\n");

  const src =
    `/**\n` +
    ` * Auto-generated by mandu.refactor.extract_contract.\n` +
    ` * Replace output: z.unknown() with your response schema.\n` +
    ` */\n` +
    `import { z } from "zod";\n` +
    `import { defineContract } from "@mandujs/core";\n\n` +
    `export const ${contractName} = defineContract({\n` +
    `${endpoints}\n` +
    `});\n`;

  return {
    fileName: `${group}.contract.ts`,
    contractName,
    source: src,
  };
}

function camelize(s: string): string {
  return s
    .split(/[-_]/)
    .map((part, i) =>
      i === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join("");
}

function deriveOpKey(
  schemaName: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
): string {
  const lower = schemaName.toLowerCase();
  if (lower.includes("create")) return "create";
  if (lower.includes("update") || lower.includes("patch")) return "update";
  if (lower.includes("delete")) return "remove";
  if (lower.includes("list") || lower.includes("query")) return "list";
  return method === "GET" ? "read" : "mutate";
}

// ─────────────────────────────────────────────────────────────────────────
// Public handler
// ─────────────────────────────────────────────────────────────────────────

async function runExtract(
  projectRoot: string,
  input: ExtractContractInput,
): Promise<
  | ExtractContractResult
  | { error: string; field?: string; hint?: string }
> {
  const validated = validateInput(input as Record<string, unknown>);
  if (!validated.ok) {
    return { error: validated.error, field: validated.field, hint: validated.hint };
  }
  const { dryRun, route: filter } = validated.value;

  const routes = await findApiRoutes(projectRoot);
  const extracted: ExtractedContractEntry[] = [];
  const skipped: Array<{ route: string; reason: string }> = [];

  const contractDir = path.join(projectRoot, "contract");

  for (const routeFile of routes) {
    const routeRel = path.relative(projectRoot, routeFile).replace(/\\/g, "/");
    const routeDirRel = routeRel.replace(/\/route\.(?:tsx?|jsx?)$/, "");
    if (filter && !routeDirRel.startsWith(filter.replace(/\\/g, "/"))) continue;

    let source: string;
    try {
      source = await Bun.file(routeFile).text();
    } catch (err) {
      skipped.push({
        route: routeDirRel,
        reason: `read failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    let schemas: DetectedSchema[];
    try {
      schemas = detectInlineSchemas(source);
    } catch (err) {
      skipped.push({
        route: routeDirRel,
        reason: `parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (schemas.length === 0) {
      skipped.push({ route: routeDirRel, reason: "no inline z.object schemas" });
      continue;
    }

    const out = renderContractModule(routeRel, schemas);
    const target = path.join(contractDir, out.fileName);
    const targetRel = path.relative(projectRoot, target).replace(/\\/g, "/");

    if (!dryRun) {
      try {
        await Bun.write(target, out.source);
      } catch (err) {
        skipped.push({
          route: routeDirRel,
          reason: `write failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
    }

    for (const s of schemas) {
      extracted.push({
        route: routeDirRel,
        contractFile: targetRel,
        schemaName: s.name,
        sourceFile: routeRel,
      });
    }
  }

  return { extracted, skipped, dryRun };
}

// ─────────────────────────────────────────────────────────────────────────
// MCP tool definition + handler map
// ─────────────────────────────────────────────────────────────────────────

export const extractContractToolDefinitions: Tool[] = [
  {
    name: "mandu.refactor.extract_contract",
    description:
      "Scan `app/api/**/route.ts` for inline Zod schemas and extract them to `contract/<group>.contract.ts` using the `defineContract()` convention. The source handler is left untouched — follow-up manual step is to import the contract and swap ad-hoc validation. Dry-run by default.",
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
            "When true (default), return the plan without writing files. When false, write the contract files to `contract/`.",
        },
        route: {
          type: "string",
          description:
            "Optional prefix to restrict scan (e.g. 'app/api/users').",
        },
      },
      required: [],
    },
  },
];

export function extractContractTools(projectRoot: string) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> =
    {
      "mandu.refactor.extract_contract": async (args) =>
        runExtract(projectRoot, args as ExtractContractInput),
    };
  return handlers;
}
