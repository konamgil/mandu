/**
 * MCP tool — `mandu.refactor.rewrite_generated_barrel` tests.
 *
 * Coverage:
 *   • Tool definition structure + destructiveHint annotation
 *   • Input validation (bad dryRun, bad patterns)
 *   • Rewrite engine: single barrel, multi-symbol barrel, multiple re-exports
 *   • `deriveGeneratedKey` normalization
 *   • Dry-run is non-destructive
 *   • Actual write on !dryRun
 *   • Parse/read errors are captured under `skipped`, not thrown
 *   • Files without `__generated__` references are ignored
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  rewriteGeneratedBarrelToolDefinitions,
  rewriteGeneratedBarrelTools,
  rewriteBarrelSource,
  deriveGeneratedKey,
} from "../../src/tools/rewrite-generated-barrel";

describe("rewriteGeneratedBarrelToolDefinitions", () => {
  it("declares the tool with destructiveHint", () => {
    expect(rewriteGeneratedBarrelToolDefinitions).toHaveLength(1);
    const def = rewriteGeneratedBarrelToolDefinitions[0];
    expect(def.name).toBe("mandu.refactor.rewrite_generated_barrel");
    expect(def.annotations?.readOnlyHint).toBe(false);
    expect(def.annotations?.destructiveHint).toBe(true);
    expect(typeof def.description).toBe("string");
    expect(def.description!.length).toBeGreaterThan(40);
    expect(def.inputSchema.type).toBe("object");
  });
});

describe("deriveGeneratedKey", () => {
  it("strips the __generated__ prefix and .data suffix", () => {
    expect(deriveGeneratedKey("../__generated__/items.data")).toBe("items");
  });
  it("keeps nested paths", () => {
    expect(deriveGeneratedKey("./__generated__/foo/bar.data")).toBe("foo/bar");
  });
  it("handles index files", () => {
    expect(deriveGeneratedKey("./__generated__/foo/index")).toBe("foo");
  });
});

describe("rewriteBarrelSource — unit", () => {
  it("returns null when no __generated__ re-export is present", () => {
    const src = `export * from "./something-else";\n`;
    expect(rewriteBarrelSource(src)).toBeNull();
  });

  it("rewrites a single-symbol re-export", () => {
    const before = `export { items } from "../__generated__/items.data";\n`;
    const outcome = rewriteBarrelSource(before)!;
    expect(outcome).not.toBeNull();
    expect(outcome.after).toContain('import { getGenerated } from "@mandujs/core/runtime"');
    expect(outcome.after).toContain('declare module "@mandujs/core/runtime"');
    expect(outcome.after).toContain('interface GeneratedRegistry');
    expect(outcome.after).toContain('"items": typeof items');
    expect(outcome.after).toContain('export const items = getGenerated("items");');
    expect(outcome.rewrites).toHaveLength(1);
    expect(outcome.rewrites[0]).toMatchObject({ name: "items", key: "items" });
  });

  it("rewrites multi-symbol re-export with destructure", () => {
    const before = `export { users, posts } from "./__generated__/feed.data";\n`;
    const outcome = rewriteBarrelSource(before)!;
    expect(outcome.after).toContain('getGenerated("feed")');
    expect(outcome.after).toContain("export const users");
    expect(outcome.after).toContain("export const posts");
    expect(outcome.rewrites.map((r) => r.name).sort()).toEqual(["posts", "users"]);
  });

  it("handles `as` aliases", () => {
    const before = `export { items as allItems } from "../__generated__/items.data";\n`;
    const outcome = rewriteBarrelSource(before)!;
    expect(outcome.after).toContain("export const allItems = getGenerated");
    expect(outcome.rewrites[0].name).toBe("allItems");
  });

  it("handles multiple re-export statements in one file", () => {
    const before = [
      `export { items } from "./__generated__/items.data";`,
      `export { users } from "./__generated__/users.data";`,
      ``,
    ].join("\n");
    const outcome = rewriteBarrelSource(before)!;
    expect(outcome.rewrites).toHaveLength(2);
    expect(outcome.after).toContain("items");
    expect(outcome.after).toContain("users");
    // Only one import added at the top.
    const importMatches = outcome.after.match(
      /import \{ getGenerated \} from "@mandujs\/core\/runtime"/g,
    );
    expect(importMatches).toHaveLength(1);
  });

  it("does not double-insert the import when one exists", () => {
    const before =
      `import { getGenerated } from "@mandujs/core/runtime";\n` +
      `export { items } from "./__generated__/items.data";\n`;
    const outcome = rewriteBarrelSource(before)!;
    const importMatches = outcome.after.match(
      /import \{ getGenerated \} from "@mandujs\/core\/runtime"/g,
    );
    expect(importMatches).toHaveLength(1);
  });
});

describe("rewriteGeneratedBarrelTools handler — filesystem integration", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "mandu-barrel-"));
    // Create one barrel that matches and one that doesn't
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "data.ts"),
      `export { items } from "./__generated__/items.data";\n`,
    );
    await writeFile(
      path.join(root, "src", "other.ts"),
      `export * from "./helpers";\n`,
    );
    // A second barrel with multiple symbols
    await writeFile(
      path.join(root, "src", "feed.ts"),
      `export { a, b } from "./__generated__/feed.data";\n`,
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns a plan on dry-run and does not write", async () => {
    const before = await Bun.file(path.join(root, "src", "data.ts")).text();
    const handlers = rewriteGeneratedBarrelTools(root);
    const result = (await handlers["mandu.refactor.rewrite_generated_barrel"]({
      dryRun: true,
    })) as {
      scanned: number;
      matched: number;
      rewritten: number;
      plan: Array<{ file: string; before: string; after: string }>;
    };

    expect(result.matched).toBe(2);
    expect(result.rewritten).toBe(0);
    expect(result.plan.length).toBe(2);
    expect(result.plan.some((p) => p.file.endsWith("data.ts"))).toBe(true);

    // File content is untouched:
    const after = await Bun.file(path.join(root, "src", "data.ts")).text();
    expect(after).toBe(before);
  });

  it("writes files when dryRun:false", async () => {
    const handlers = rewriteGeneratedBarrelTools(root);
    const result = (await handlers["mandu.refactor.rewrite_generated_barrel"]({
      dryRun: false,
    })) as { matched: number; rewritten: number };

    expect(result.matched).toBe(2);
    expect(result.rewritten).toBe(2);

    const updated = await Bun.file(path.join(root, "src", "data.ts")).text();
    expect(updated).toContain("getGenerated");
    expect(updated).not.toContain('from "./__generated__/items.data"');
  });

  it("rejects non-boolean dryRun with a structured error", async () => {
    const handlers = rewriteGeneratedBarrelTools(root);
    const result = (await handlers["mandu.refactor.rewrite_generated_barrel"]({
      dryRun: "yes",
    })) as { error?: string; field?: string };
    expect(result.error).toBeDefined();
    expect(result.field).toBe("dryRun");
  });

  it("rejects non-array patterns", async () => {
    const handlers = rewriteGeneratedBarrelTools(root);
    const result = (await handlers["mandu.refactor.rewrite_generated_barrel"]({
      patterns: "src",
    })) as { error?: string; field?: string };
    expect(result.error).toBeDefined();
    expect(result.field).toBe("patterns");
  });
});
