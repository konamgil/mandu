import { existsSync, type Dirent } from "fs";
import * as fs from "fs/promises";
import { join, relative, resolve } from "path";

export async function collectTempArtifactDirs(
  pkgDir: string,
  rootDir = process.cwd(),
): Promise<string[]> {
  const issues: string[] = [];
  const root = resolve(pkgDir);
  const projectRoot = resolve(rootDir);

  if (!existsSync(root)) return issues;

  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const abs = join(dir, entry.name);
      if (/^\.tmp-/.test(entry.name)) {
        issues.push(
          `❌ ${relative(projectRoot, abs)}: temporary test artifact directory must not be inside a publishable package`,
        );
        continue;
      }
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await walk(abs);
    }
  }

  await walk(root);
  return issues;
}
