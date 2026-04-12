/**
 * mandu info - Print project and environment information
 *
 * Displays Mandu version, Bun version, OS, config status, and active settings.
 */

import os from "os";
import path from "path";
import { resolveFromCwd, pathExists } from "../util/fs";
import { CONFIG_FILES, loadManduConfig } from "@mandujs/core";

export async function info(): Promise<boolean> {
  const rootDir = resolveFromCwd(".");

  // Read @mandujs/core version from its package.json
  let coreVersion = "unknown";
  try {
    const corePkgPath = require.resolve("@mandujs/core/package.json");
    const corePkg = await Bun.file(corePkgPath).json();
    coreVersion = corePkg.version;
  } catch {
    // Fallback: resolve from workspace
    try {
      const fallbackPath = path.resolve(rootDir, "node_modules/@mandujs/core/package.json");
      const corePkg = await Bun.file(fallbackPath).json();
      coreVersion = corePkg.version;
    } catch {
      // leave as "unknown"
    }
  }

  const bunVersion = process.versions.bun ?? "unknown";
  const platform = `${process.platform} ${os.arch()}`;

  // Detect config file
  let configFile = "none";
  for (const name of CONFIG_FILES) {
    const filePath = path.join(rootDir, name);
    if (await pathExists(filePath)) {
      configFile = name;
      break;
    }
  }

  // Load config for guard/adapter info
  let guardPreset = "mandu (default)";
  let adapter = "none (built-in Bun)";

  if (configFile !== "none") {
    try {
      const config = await loadManduConfig(rootDir);
      if (config.guard?.preset) {
        guardPreset = config.guard.preset;
      }
      const adapterValue = (config as Record<string, unknown>).adapter as
        | { name?: string }
        | undefined;
      if (adapterValue?.name) {
        adapter = adapterValue.name;
      }
    } catch {
      // use defaults
    }
  }

  console.log("🥟 Mandu Info\n");
  console.log(`  Mandu:    v${coreVersion}`);
  console.log(`  Bun:      v${bunVersion}`);
  console.log(`  OS:       ${platform}`);
  console.log(`  Config:   ${configFile}`);
  console.log(`  Guard:    ${guardPreset}`);
  console.log(`  Adapter:  ${adapter}`);

  return true;
}
