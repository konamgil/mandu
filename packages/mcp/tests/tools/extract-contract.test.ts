/**
 * MCP tool — `mandu.refactor.extract_contract` tests.
 *
 * Coverage:
 *   • Tool definition + destructiveHint
 *   • `findZodObjectEnd` — brace-depth tracking for nested z.object
 *   • `detectInlineSchemas` — basic and with method inference
 *   • `renderContractModule` — contract file shape
 *   • Dry-run does not write; !dryRun writes the file
 *   • Input validation
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  extractContractToolDefinitions,
  extractContractTools,
  detectInlineSchemas,
  findZodObjectEnd,
  renderContractModule,
} from "../../src/tools/extract-contract";

describe("extractContractToolDefinitions", () => {
  it("declares the tool with destructiveHint", () => {
    expect(extractContractToolDefinitions).toHaveLength(1);
    const def = extractContractToolDefinitions[0];
    expect(def.name).toBe("mandu.refactor.extract_contract");
    expect(def.annotations?.readOnlyHint).toBe(false);
    expect(def.annotations?.destructiveHint).toBe(true);
  });
});

describe("findZodObjectEnd", () => {
  it("finds the closing paren of a simple z.object call", () => {
    const src = `const X = z.object({ a: z.string() });`;
    const start = src.indexOf("z.object");
    const end = findZodObjectEnd(src, start);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).toBe("z.object({ a: z.string() })");
  });

  it("respects nested braces", () => {
    const src = `const X = z.object({ a: z.object({ b: z.number() }) });rest`;
    const start = src.indexOf("z.object");
    const end = findZodObjectEnd(src, start);
    expect(src.slice(start, end)).toBe(
      "z.object({ a: z.object({ b: z.number() }) })",
    );
  });
});

describe("detectInlineSchemas", () => {
  it("detects a simple const binding", () => {
    const src = `const CreateUser = z.object({ name: z.string() });\n`;
    const out = detectInlineSchemas(src);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("CreateUser");
    expect(out[0].body).toContain("z.object");
  });

  it("infers POST when schema is referenced from POST handler", () => {
    const src =
      `const CreateUser = z.object({ name: z.string() });\n` +
      `export async function POST(req: Request) { CreateUser.parse(req.body); }\n`;
    const out = detectInlineSchemas(src);
    expect(out[0].method).toBe("POST");
  });

  it("falls back to heuristic method from name", () => {
    const src = `const UpdateThing = z.object({ id: z.string() });\n`;
    const out = detectInlineSchemas(src);
    expect(out[0].method).toBe("POST");
  });

  it("returns empty for files with no inline schemas", () => {
    expect(detectInlineSchemas(`export function GET() { return new Response(); }`)).toEqual([]);
  });
});

describe("renderContractModule", () => {
  it("emits a valid-looking defineContract module", () => {
    const out = renderContractModule("app/api/users/route.ts", [
      { name: "CreateUser", body: "z.object({ name: z.string() })", method: "POST" },
    ]);
    expect(out.fileName).toBe("users.contract.ts");
    expect(out.contractName).toBe("usersContract");
    expect(out.source).toContain('import { z } from "zod"');
    expect(out.source).toContain('import { defineContract } from "@mandujs/core"');
    expect(out.source).toContain("export const usersContract = defineContract");
    expect(out.source).toContain('method: "POST"');
    expect(out.source).toContain('path: "/api/users"');
  });
});

describe("extractContractTools — filesystem integration", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "mandu-contract-"));
    await mkdir(path.join(root, "app", "api", "posts"), { recursive: true });
    await writeFile(
      path.join(root, "app", "api", "posts", "route.ts"),
      `import { z } from "zod";\n` +
        `const CreatePost = z.object({ title: z.string(), body: z.string() });\n` +
        `export async function POST(req: Request) {\n` +
        `  const parsed = CreatePost.parse(await req.json());\n` +
        `  return new Response(JSON.stringify(parsed));\n` +
        `}\n`,
    );
    // A route with no inline schemas — should be skipped
    await mkdir(path.join(root, "app", "api", "health"), { recursive: true });
    await writeFile(
      path.join(root, "app", "api", "health", "route.ts"),
      `export function GET() { return new Response("ok"); }\n`,
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("plans extractions on dry-run without writing", async () => {
    const handlers = extractContractTools(root);
    const result = (await handlers["mandu.refactor.extract_contract"]({
      dryRun: true,
    })) as {
      extracted: Array<{ route: string; contractFile: string; schemaName: string }>;
      skipped: Array<{ route: string; reason: string }>;
    };
    expect(result.extracted.length).toBe(1);
    expect(result.extracted[0].schemaName).toBe("CreatePost");
    expect(result.extracted[0].contractFile).toContain("posts.contract.ts");
    expect(result.skipped.some((s) => s.route.includes("health"))).toBe(true);

    const wrote = await Bun.file(
      path.join(root, "contract", "posts.contract.ts"),
    ).exists();
    expect(wrote).toBe(false);
  });

  it("writes the contract file on !dryRun", async () => {
    const handlers = extractContractTools(root);
    const result = (await handlers["mandu.refactor.extract_contract"]({
      dryRun: false,
    })) as { extracted: unknown[] };
    expect(result.extracted).toHaveLength(1);

    const contractPath = path.join(root, "contract", "posts.contract.ts");
    const exists = await Bun.file(contractPath).exists();
    expect(exists).toBe(true);
    const content = await Bun.file(contractPath).text();
    expect(content).toContain("defineContract");
    expect(content).toContain("postsContract");
  });

  it("rejects invalid dryRun", async () => {
    const handlers = extractContractTools(root);
    const result = (await handlers["mandu.refactor.extract_contract"]({
      dryRun: "yes",
    })) as { error?: string; field?: string };
    expect(result.error).toBeDefined();
    expect(result.field).toBe("dryRun");
  });
});
