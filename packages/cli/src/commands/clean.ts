/**
 * mandu clean - Remove build artifacts
 *
 * Deletes .mandu/client/ and .mandu/static/ directories.
 * With --all: also removes .mandu/generated/ and .mandu/manifest.json.
 */

import path from "path";
import fs from "fs/promises";
import { resolveFromCwd, pathExists } from "../util/fs";

export interface CleanOptions {
  all?: boolean;
}

async function removeIfExists(targetPath: string): Promise<boolean> {
  if (!(await pathExists(targetPath))) return false;
  await fs.rm(targetPath, { recursive: true, force: true });
  return true;
}

export async function clean(options: CleanOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  const manduDir = path.join(rootDir, ".mandu");

  console.log("🧹 Mandu Clean\n");

  const targets = [
    path.join(manduDir, "client"),
    path.join(manduDir, "static"),
  ];

  if (options.all) {
    targets.push(
      path.join(manduDir, "generated"),
      path.join(manduDir, "manifest.json"),
    );
  }

  let removedCount = 0;

  for (const target of targets) {
    const label = path.relative(rootDir, target);
    const removed = await removeIfExists(target);
    if (removed) {
      console.log(`  ✅ Removed ${label}`);
      removedCount++;
    } else {
      console.log(`  ⏭️  Skipped ${label} (not found)`);
    }
  }

  console.log(
    removedCount > 0
      ? `\n🧹 Cleaned ${removedCount} target(s)`
      : "\n📭 Nothing to clean",
  );

  return true;
}
