import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  migrateCoreV1Imports,
  rewriteCoreV1Imports,
} from "./core-v1-imports";

describe("core v1 import codemod", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it("keeps stable entries and moves retired directory/file entries", () => {
    const result = rewriteCoreV1Imports([
      'import { createContract } from "@mandujs/core/contract";',
      'import { build } from "@mandujs/core/bundler";',
      'import { analyze } from "@mandujs/core/bundler/analyzer";',
      'import { legacy } from "@mandujs/core/compat/auth/index";',
    ].join("\n"));

    expect(result.replacements).toBe(2);
    expect(result.source).toContain('"@mandujs/core/contract"');
    expect(result.source).toContain('"@mandujs/core/compat/bundler/index"');
    expect(result.source).toContain('"@mandujs/core/compat/bundler/analyzer"');
    expect(result.source).toContain('"@mandujs/core/compat/auth/index"');
  });

  it("supports check/dry-run followed by an explicit write", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-core-v1-codemod-"));
    roots.push(root);
    const file = path.join(root, "app.ts");
    await fs.writeFile(file, 'import { newId } from "@mandujs/core/id";\n');

    const preview = await migrateCoreV1Imports(["."], { cwd: root });
    expect(preview.changes).toEqual([{ file: "app.ts", replacements: 1 }]);
    expect(await fs.readFile(file, "utf8")).toContain("@mandujs/core/id");

    const written = await migrateCoreV1Imports(["."], { cwd: root, write: true });
    expect(written.changes).toHaveLength(1);
    expect(await fs.readFile(file, "utf8")).toContain("@mandujs/core/compat/id/index");
  });
});
