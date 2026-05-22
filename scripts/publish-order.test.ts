import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { collectPublishOrderIssues, PUBLISHABLE_PACKAGE_DIRS } from "./publish-order";

async function writePackage(root: string, dir: string, pkg: unknown) {
  const abs = path.join(root, dir);
  await mkdir(abs, { recursive: true });
  await writeFile(path.join(abs, "package.json"), JSON.stringify(pkg, null, 2));
}

async function withTempRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "mandu-publish-order-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("collectPublishOrderIssues", () => {
  test("current publish order respects internal package dependencies", () => {
    expect(collectPublishOrderIssues(PUBLISHABLE_PACKAGE_DIRS, process.cwd())).toEqual([]);
  });

  test("reports internal packages published after their consumers", async () => {
    await withTempRoot(async (root) => {
      await writePackage(root, "packages/core", { name: "@test/core" });
      await writePackage(root, "packages/cli", {
        name: "@test/cli",
        dependencies: { "@test/edge": "^1.0.0" },
      });
      await writePackage(root, "packages/edge", {
        name: "@test/edge",
        dependencies: { "@test/core": "^1.0.0" },
      });

      const issues = collectPublishOrderIssues(
        ["packages/core", "packages/cli", "packages/edge"],
        root,
      );

      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain("@test/cli");
      expect(issues[0]).toContain("@test/edge");
      expect(issues[0]).toContain("must come before");
    });
  });
});
