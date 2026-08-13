import { readFileSync } from "fs";
import { resolve } from "path";

export const PUBLISHABLE_PACKAGE_DIRS = [
  "packages/core",
  "packages/ate",
  "packages/skills",
  "packages/mcp",
  "packages/edge",
  "packages/cli",
];

/** Stable product release train. A failure in Labs/generated distributions
 * must not prevent publishing the Core/CLI/MCP Golden Path. */
export const PRODUCT_PACKAGE_DIRS = [
  "packages/core",
  "packages/mcp",
  "packages/cli",
];

export const LABS_PACKAGE_DIRS = [
  "packages/ate",
  "packages/edge",
  "packages/playground-runner",
];

export const GENERATED_PACKAGE_DIRS = ["packages/skills"];

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const PUBLISH_ORDER_DEP_BLOCKS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

export function collectPublishOrderIssues(
  packageDirs = PUBLISHABLE_PACKAGE_DIRS,
  rootDir = process.cwd(),
): string[] {
  const packages = packageDirs.map((dir, index) => {
    const pkg: PackageJson = JSON.parse(
      readFileSync(resolve(rootDir, dir, "package.json"), "utf-8"),
    );
    return { dir, index, pkg };
  });
  const byName = new Map(packages.map((entry) => [entry.pkg.name, entry]));
  const issues: string[] = [];

  for (const consumer of packages) {
    for (const blockName of PUBLISH_ORDER_DEP_BLOCKS) {
      const deps = consumer.pkg[blockName];
      if (!deps) continue;

      for (const depName of Object.keys(deps)) {
        const producer = byName.get(depName);
        if (!producer) continue;
        if (producer.index <= consumer.index) continue;

        issues.push(
          `❌ ${consumer.pkg.name} ${blockName}.${depName} is published after its consumer ` +
            `(${producer.dir} must come before ${consumer.dir})`,
        );
      }
    }
  }

  return issues;
}
