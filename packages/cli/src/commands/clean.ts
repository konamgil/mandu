/**
 * mandu clean - Remove build artifacts
 *
 * Deletes .mandu/client/, .mandu/static/, and the .mandu/vendor-cache/
 * (cached React vendor shims — must be cleared too, otherwise a stale
 * `_react.js` survives `mandu clean` and is restored on the next dev build).
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
    // Cached React vendor shims (_react.js, _jsx-dev-runtime.js, …). A stale
    // entry here survives a client/ wipe and gets restored on the next dev
    // build, so a broken vendor bundle can't be fixed by `mandu clean`
    // unless this is cleared too.
    path.join(manduDir, "vendor-cache"),
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
