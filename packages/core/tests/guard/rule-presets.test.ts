/**
 * Phase 18.ν — Rule preset tests (forbidImport / requireNamedExport /
 * requirePrefixForExports).
 *
 * Each preset is a thin factory over `defineGuardRule()`. We exercise
 * the factory directly (unit-style) by constructing a `GuardRuleContext`
 * in-memory instead of going through the filesystem — keeps the suite
 * fast and the asserted behavior close to the rule body.
 */

import { describe, it, expect } from "bun:test";
import {
  forbidImport,
  requireNamedExport,
  requirePrefixForExports,
} from "../../src/guard/rule-presets";
import type { GuardRuleContext, GuardViolation } from "../../src/guard/define-rule";
import { extractImportsAST, extractExportsAST } from "../../src/guard/ast-analyzer";

function makeCtx(sourceFile: string, content: string): GuardRuleContext {
  return {
    sourceFile,
    content,
    imports: extractImportsAST(content),
    exports: extractExportsAST(content),
    config: {},
    projectRoot: "/tmp/project",
  };
}

async function runRule(rule: ReturnType<typeof forbidImport>, ctx: GuardRuleContext): Promise<GuardViolation[]> {
  const result = await rule.check(ctx);
  return Array.isArray(result) ? result : [];
}

// ═════════════════════════════════════════════════════════════════════════
// forbidImport
// ═════════════════════════════════════════════════════════════════════════

describe("forbidImport", () => {
  it("flags a matching literal import", async () => {
    const rule = forbidImport({ from: "axios" });
    const ctx = makeCtx("src/a.ts", `import axios from "axios";\n`);
    const hits = await runRule(rule, ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
    expect(hits[0].message).toContain("axios");
  });

  it("does not flag unrelated imports", async () => {
    const rule = forbidImport({ from: "axios" });
    const ctx = makeCtx("src/a.ts", `import { z } from "zod";\n`);
    const hits = await runRule(rule, ctx);
    expect(hits).toEqual([]);
  });

  it("supports regex `from` matchers", async () => {
    const rule = forbidImport({ from: /^node:(fs|child_process)$/ });
    const ctx = makeCtx(
      "src/a.ts",
      `import fs from "node:fs";\nimport { spawn } from "node:child_process";\nimport path from "node:path";\n`
    );
    const hits = await runRule(rule, ctx);
    expect(hits).toHaveLength(2);
    const paths = hits.map((h) => h.message);
    expect(paths.some((p) => p.includes("node:fs"))).toBe(true);
    expect(paths.some((p) => p.includes("node:child_process"))).toBe(true);
  });

  it("honors includePaths restriction", async () => {
    const rule = forbidImport({
      from: "axios",
      includePaths: [/^app\//],
    });
    const ctxExcluded = makeCtx("src/a.ts", `import axios from "axios";\n`);
    const ctxIncluded = makeCtx("app/page.ts", `import axios from "axios";\n`);
    expect(await runRule(rule, ctxExcluded)).toEqual([]);
    expect(await runRule(rule, ctxIncluded)).toHaveLength(1);
  });

  it("honors excludePaths even when included", async () => {
    const rule = forbidImport({
      from: "axios",
      includePaths: [/^app\//],
      excludePaths: [/test/],
    });
    const ctx = makeCtx("app/test/page.ts", `import axios from "axios";\n`);
    expect(await runRule(rule, ctx)).toEqual([]);
  });

  it("derives a stable id from the `from` argument", () => {
    expect(forbidImport({ from: "axios" }).id).toBe("forbid-import:axios");
    expect(forbidImport({ from: /node:.*/ }).id).toContain("forbid-import:node");
  });

  it("accepts a custom id + severity + hint", async () => {
    const rule = forbidImport({
      from: "axios",
      id: "company-no-axios",
      severity: "warning",
      hint: "Use fetch().",
    });
    expect(rule.id).toBe("company-no-axios");
    expect(rule.severity).toBe("warning");
    const ctx = makeCtx("src/a.ts", `import axios from "axios";\n`);
    const hits = await runRule(rule, ctx);
    expect(hits[0].hint).toBe("Use fetch().");
  });

  it("respects the secondary `matches` filter", async () => {
    // `matches: /subpath/` should only flag axios imports whose path
    // contains "subpath" — primary `from` matches every axios import.
    const rule = forbidImport({ from: /^axios/, matches: /subpath/ });
    const ctx = makeCtx(
      "src/a.ts",
      `import axios from "axios";\nimport fn from "axios/subpath/helper";\n`
    );
    const hits = await runRule(rule, ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("subpath");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// requireNamedExport
// ═════════════════════════════════════════════════════════════════════════

describe("requireNamedExport", () => {
  it("flags files missing required exports (all mode)", async () => {
    const rule = requireNamedExport({
      patterns: [/route\.ts$/],
      names: ["GET", "POST"],
    });
    const ctx = makeCtx("app/api/users/route.ts", `export function GET() {}\n`);
    const hits = await rule.check(ctx);
    expect(Array.isArray(hits) ? hits : []).toHaveLength(1);
    const arr = Array.isArray(hits) ? hits : [];
    expect(arr[0].message).toContain("POST");
  });

  it("passes when all required names are exported (all mode)", async () => {
    const rule = requireNamedExport({
      patterns: [/route\.ts$/],
      names: ["GET"],
    });
    const ctx = makeCtx("app/api/users/route.ts", `export function GET() {}\n`);
    const hits = await rule.check(ctx);
    expect(Array.isArray(hits) ? hits : []).toEqual([]);
  });

  it("requireAny: passes when at least one is exported", async () => {
    const rule = requireNamedExport({
      patterns: [/route\.ts$/],
      names: ["GET", "POST", "PUT"],
      requireAny: true,
    });
    const ctx = makeCtx("app/api/users/route.ts", `export function POST() {}\n`);
    const hits = await rule.check(ctx);
    expect(Array.isArray(hits) ? hits : []).toEqual([]);
  });

  it("requireAny: fails when none of the names are exported", async () => {
    const rule = requireNamedExport({
      patterns: [/route\.ts$/],
      names: ["GET", "POST"],
      requireAny: true,
    });
    const ctx = makeCtx("app/api/users/route.ts", `export function handler() {}\n`);
    const hits = await rule.check(ctx);
    const arr = Array.isArray(hits) ? hits : [];
    expect(arr).toHaveLength(1);
    expect(arr[0].message).toContain("none");
  });

  it("skips files that do not match any pattern", async () => {
    const rule = requireNamedExport({
      patterns: [/route\.ts$/],
      names: ["GET"],
    });
    const ctx = makeCtx("src/lib/util.ts", `export function helper() {}\n`);
    const hits = await rule.check(ctx);
    expect(Array.isArray(hits) ? hits : []).toEqual([]);
  });

  it("supports string patterns as substring matches", async () => {
    const rule = requireNamedExport({
      patterns: ["api/"],
      names: ["GET"],
    });
    const ctx = makeCtx("app/api/x.ts", `export function handler() {}\n`);
    const hits = await rule.check(ctx);
    expect((Array.isArray(hits) ? hits : []).length).toBe(1);
  });

  it("throws on empty names array", () => {
    expect(() =>
      requireNamedExport({
        patterns: [/./],
        names: [],
      })
    ).toThrow();
  });

  it("throws on empty patterns array", () => {
    expect(() =>
      requireNamedExport({
        patterns: [],
        names: ["x"],
      })
    ).toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// requirePrefixForExports
// ═════════════════════════════════════════════════════════════════════════

describe("requirePrefixForExports", () => {
  it("allows exports whose names match the string prefix", async () => {
    const rule = requirePrefixForExports({
      patterns: [/route\.ts$/],
      prefix: "GET",
    });
    const ctx = makeCtx("app/api/route.ts", `export function GET() {}\n`);
    expect(Array.isArray(await rule.check(ctx)) ? await rule.check(ctx) : []).toEqual([]);
  });

  it("flags exports whose names do not match the prefix", async () => {
    const rule = requirePrefixForExports({
      patterns: [/route\.ts$/],
      prefix: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/,
    });
    const ctx = makeCtx(
      "app/api/route.ts",
      `export function GET() {}\nexport function helper() {}\n`
    );
    const hits = await rule.check(ctx);
    const arr = Array.isArray(hits) ? hits : [];
    expect(arr).toHaveLength(1);
    expect(arr[0].message).toContain("helper");
  });

  it("honors the allowList", async () => {
    const rule = requirePrefixForExports({
      patterns: [/route\.ts$/],
      prefix: /^(GET|POST)$/,
      allowList: ["metadata"],
    });
    const ctx = makeCtx(
      "app/api/route.ts",
      `export function GET() {}\nexport const metadata = {};\n`
    );
    const arr = Array.isArray(await rule.check(ctx)) ? await rule.check(ctx) : [];
    expect(arr).toEqual([]);
  });

  it("skips files that do not match any pattern", async () => {
    const rule = requirePrefixForExports({
      patterns: [/route\.ts$/],
      prefix: /^GET$/,
    });
    const ctx = makeCtx("src/util.ts", `export function badName() {}\n`);
    const arr = Array.isArray(await rule.check(ctx)) ? await rule.check(ctx) : [];
    expect(arr).toEqual([]);
  });

  it("only scans named exports by default (ignores default exports)", async () => {
    const rule = requirePrefixForExports({
      patterns: [/route\.ts$/],
      prefix: /^GET$/,
    });
    const ctx = makeCtx(
      "app/api/route.ts",
      `export default function MyHandler() {}\nexport function GET() {}\n`
    );
    const arr = Array.isArray(await rule.check(ctx)) ? await rule.check(ctx) : [];
    expect(arr).toEqual([]);
  });

  it("derives a stable id from the prefix", () => {
    expect(requirePrefixForExports({ patterns: [/./], prefix: "GET" }).id).toBe(
      "require-prefix:GET"
    );
    expect(
      requirePrefixForExports({ patterns: [/./], prefix: /^(GET|POST)$/ }).id
    ).toContain("require-prefix:");
  });

  it("emits violations with line numbers when available", async () => {
    const rule = requirePrefixForExports({
      patterns: [/route\.ts$/],
      prefix: /^GET$/,
    });
    const ctx = makeCtx(
      "app/api/route.ts",
      `export function helper() {}\nexport function GET() {}\n`
    );
    const arr = Array.isArray(await rule.check(ctx)) ? await rule.check(ctx) : [];
    expect(arr).toHaveLength(1);
    expect(arr[0].line).toBeGreaterThan(0);
  });

  it("throws on empty patterns array", () => {
    expect(() =>
      requirePrefixForExports({
        patterns: [],
        prefix: "GET",
      })
    ).toThrow();
  });
});
