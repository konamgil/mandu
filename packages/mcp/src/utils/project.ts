import path from "path";
import fs from "fs/promises";
import { pathToFileURL } from "url";

/**
 * Find the Mandu project root by looking for app/ directory or mandu.config.*
 */
export async function findProjectRoot(startDir: string = process.cwd()): Promise<string | null> {
  let currentDir = path.resolve(startDir);

  while (currentDir !== path.dirname(currentDir)) {
    // Check for app/ directory (FS Routes source)
    try {
      const appStat = await fs.stat(path.join(currentDir, "app"));
      if (appStat.isDirectory()) return currentDir;
    } catch {}

    // Check for mandu.config.* files
    for (const configFile of ["mandu.config.ts", "mandu.config.js", "mandu.config.json"]) {
      try {
        await fs.access(path.join(currentDir, configFile));
        return currentDir;
      } catch {}
    }

    currentDir = path.dirname(currentDir);
  }

  return null;
}

/**
 * Get standard paths for a Mandu project
 */
export function getProjectPaths(rootDir: string) {
  return {
    root: rootDir,
    appDir: path.join(rootDir, "app"),
    specDir: path.join(rootDir, "spec"),
    manifestPath: path.join(rootDir, ".mandu", "routes.manifest.json"),
    lockPath: path.join(rootDir, ".mandu", "spec.lock.json"),
    slotsDir: path.join(rootDir, "spec", "slots"),
    contractsDir: path.join(rootDir, "spec", "contracts"),
    historyDir: path.join(rootDir, ".mandu", "history"),
    generatedMapPath: path.join(rootDir, ".mandu", "generated", "generated.map.json"),
    serverRoutesDir: path.join(rootDir, ".mandu", "generated", "server", "routes"),
    webRoutesDir: path.join(rootDir, ".mandu", "generated", "web", "routes"),
  };
}

/**
 * Check if a path is inside the project
 */
export function isInsideProject(filePath: string, rootDir: string): boolean {
  const resolved = path.resolve(filePath);
  const root = path.resolve(rootDir);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/**
 * Read JSON file safely
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return null;
    }
    return await file.json();
  } catch {
    return null;
  }
}

/**
 * Write JSON file safely.
 * Note: Callers are responsible for ensuring filePath is within the project root.
 * All internal callers use paths derived from getProjectPaths() which are scoped to projectRoot.
 */
export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await Bun.write(filePath, JSON.stringify(data, null, 2));
}

/**
 * Read Mandu config from mandu.config.ts/js/json
 */
export async function readConfig(rootDir: string): Promise<Record<string, unknown> | null> {
  const configFiles = [
    "mandu.config.ts",
    "mandu.config.js",
    "mandu.config.json",
  ];

  for (const configFile of configFiles) {
    const configPath = path.join(rootDir, configFile);
    try {
      const file = Bun.file(configPath);
      if (await file.exists()) {
        if (configFile.endsWith(".json")) {
          return await file.json();
        } else {
          // For TS/JS files, use pathToFileURL for cross-platform compatibility
          const module = await import(pathToFileURL(configPath).href);
          return module.default ?? module;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}
