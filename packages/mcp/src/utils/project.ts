import path from "path";
import fs from "fs/promises";
import { pathToFileURL } from "url";

/**
 * Find the Mandu project root by looking for mandu.config.* or app/ directory.
 *
 * Detection order (first match wins):
 *  1. mandu.config.ts / .js / .json in the current directory
 *  2. app/ directory in the current directory
 *  3. Walk up to parent directories and repeat
 *
 * For monorepo sub-projects (e.g. demo/ai-chat inside a larger workspace),
 * the config file takes priority so that the MCP server binds to the correct
 * sub-project even when launched from the monorepo root.
 *
 * ## Monorepo Sub-Project Setup
 *
 * When using MCP in a monorepo sub-project, the recommended `.mcp.json` is:
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "mandu": {
 *       "command": "bun",
 *       "args": ["run", "node_modules/@mandujs/mcp/src/index.ts"],
 *       "cwd": "."
 *     }
 *   }
 * }
 * ```
 *
 * The sub-project must have `@mandujs/mcp` as a devDependency.
 * Using a `cwd` that points to a parent monorepo root will NOT work because
 * the MCP stdio transport resolves paths relative to the spawned process,
 * and the parent's node_modules layout differs from the sub-project's.
 */
export async function findProjectRoot(startDir: string = process.cwd()): Promise<string | null> {
  let currentDir = path.resolve(startDir);

  while (currentDir !== path.dirname(currentDir)) {
    // Prioritize config files — they unambiguously mark a Mandu project root,
    // which is critical for monorepo sub-projects that each have their own config.
    for (const configFile of ["mandu.config.ts", "mandu.config.js", "mandu.config.json"]) {
      try {
        await fs.access(path.join(currentDir, configFile));
        return currentDir;
      } catch {}
    }

    // Check for app/ directory (FS Routes source)
    try {
      const appStat = await fs.stat(path.join(currentDir, "app"));
      if (appStat.isDirectory()) {
        // Extra guard: only treat this as a Mandu project if it also has
        // package.json (avoids false positives from unrelated app/ dirs)
        try {
          await fs.access(path.join(currentDir, "package.json"));
          return currentDir;
        } catch {
          // No package.json — likely not a Mandu project, keep searching
        }
      }
    } catch {}

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
