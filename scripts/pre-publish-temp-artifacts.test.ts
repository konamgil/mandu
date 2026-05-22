import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { collectTempArtifactDirs } from "./pre-publish-temp-artifacts";

async function withTempRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "mandu-temp-artifact-check-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("collectTempArtifactDirs", () => {
  test("reports .tmp-* directories inside publishable packages", async () => {
    await withTempRoot(async (root) => {
      const pkg = path.join(root, "packages", "core");
      await mkdir(path.join(pkg, "src", ".tmp-bundler-leftover"), { recursive: true });

      const issues = await collectTempArtifactDirs(pkg, root);

      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain("packages");
      expect(issues[0]).toContain(".tmp-bundler-leftover");
      expect(issues[0]).toContain("temporary test artifact");
    });
  });

  test("ignores clean package trees", async () => {
    await withTempRoot(async (root) => {
      const pkg = path.join(root, "packages", "core");
      await mkdir(path.join(pkg, "src", "bundler"), { recursive: true });

      await expect(collectTempArtifactDirs(pkg, root)).resolves.toEqual([]);
    });
  });

  test("skips node_modules while scanning packages", async () => {
    await withTempRoot(async (root) => {
      const pkg = path.join(root, "packages", "core");
      await mkdir(path.join(pkg, "node_modules", ".tmp-cache"), { recursive: true });

      await expect(collectTempArtifactDirs(pkg, root)).resolves.toEqual([]);
    });
  });
});
