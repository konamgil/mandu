/**
 * mandu upgrade - Update @mandujs packages to latest versions
 *
 * --check: compare installed vs latest without modifying anything.
 * Default: runs bun update for all @mandujs packages.
 */

import path from "path";
import { resolveFromCwd, pathExists } from "../util/fs";

export interface UpgradeOptions {
  check?: boolean;
}

const PACKAGES = ["@mandujs/core", "@mandujs/cli", "@mandujs/mcp"] as const;

async function getInstalledVersion(rootDir: string, pkg: string): Promise<string> {
  try {
    const pkgJson = path.join(rootDir, "node_modules", pkg, "package.json");
    if (!(await pathExists(pkgJson))) return "not installed";
    const data = await Bun.file(pkgJson).json();
    return data.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function getLatestVersion(pkg: string): Promise<string> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
    if (!res.ok) return "fetch failed";
    const data = (await res.json()) as { version?: string };
    return data.version ?? "unknown";
  } catch {
    return "fetch failed";
  }
}

export async function upgrade(options: UpgradeOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  console.log("🔄 Mandu Upgrade\n");

  if (options.check) {
    console.log("  Package              Installed    Latest");
    console.log("  ─────────────────────────────────────────");

    for (const pkg of PACKAGES) {
      const [installed, latest] = await Promise.all([
        getInstalledVersion(rootDir, pkg),
        getLatestVersion(pkg),
      ]);
      const marker = installed === latest ? "✅" : "⬆️ ";
      const label = pkg.padEnd(22);
      console.log(`  ${marker} ${label} ${installed.padEnd(12)} ${latest}`);
    }
    return true;
  }

  // Run bun update
  console.log("  Updating packages...\n");
  const proc = Bun.spawn(["bun", "update", ...PACKAGES], {
    cwd: rootDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;

  if (code !== 0) {
    console.error("\n❌ Update failed.");
    return false;
  }

  console.log("\n✅ Packages updated.");
  return true;
}
