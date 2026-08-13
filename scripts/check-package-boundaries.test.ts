import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkPackageBoundaries,
  checkCoreOwnerBoundaries,
  CORE_OWNER_POLICIES,
  PRODUCT_PACKAGE_POLICIES,
} from "./check-package-boundaries";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("product package boundaries", () => {
  test("core, cli, and mcp match the refoundation dependency graph", async () => {
    expect(await checkPackageBoundaries()).toEqual([]);
  });

  test("the policy freezes all three product packages", () => {
    expect(PRODUCT_PACKAGE_POLICIES.map((policy) => policy.packageDir)).toEqual([
      "packages/core",
      "packages/cli",
      "packages/mcp",
    ]);
  });

  test("Core has explicit runtime, safety, and actions owners", () => {
    expect(CORE_OWNER_POLICIES.map((policy) => policy.owner)).toEqual([
      "runtime",
      "safety",
      "actions",
    ]);
  });

  test("runtime and safety cannot import actions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mandu-owner-boundary-"));
    tempRoots.push(root);
    await mkdir(path.join(root, "packages/core/src/runtime"), { recursive: true });
    await mkdir(path.join(root, "packages/core/src/agent"), { recursive: true });
    await writeFile(path.join(root, "packages/core/src/agent/index.ts"), "export const action = true;\n");
    await writeFile(
      path.join(root, "packages/core/src/runtime/server.ts"),
      'import { action } from "../agent";\nexport { action };\n',
    );

    const issues = await checkCoreOwnerBoundaries(root);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.policy).toContain("runtime");
    expect(issues[0]?.reason).toContain("not actions");
  });
});
