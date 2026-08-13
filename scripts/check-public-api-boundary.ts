#!/usr/bin/env bun
import { readFileSync } from "fs";
import { resolve } from "path";

type ApiStability = "stable" | "compatibility" | "experimental" | "internal";

interface PackageJson {
  name: string;
  exports?: Record<string, unknown>;
}

interface ClassificationRule {
  stability: ApiStability;
  exact?: readonly string[];
  prefixes?: readonly string[];
  reason: string;
}

export interface PublicApiBoundaryResult {
  issues: string[];
  classified: Record<ApiStability, string[]>;
  rootStarExports: string[];
}

export const V1_CORE_EXPORTS = [
  ".",
  "./client",
  "./config",
  "./contract",
  "./error",
  "./guard",
  "./middleware",
  "./plugins",
  "./router",
  "./runtime",
  "./testing",
] as const;

const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    stability: "stable",
    exact: V1_CORE_EXPORTS,
    reason: "minimal v1 application authoring and safety surface",
  },
  {
    stability: "compatibility",
    exact: ["./compat/*"],
    reason: "temporary v0 migration namespace; excluded from the v1 contract",
  },
];

const STABLE_ROOT_STAR_EXPORTS = new Set([
  "./spec",
  "./runtime",
  "./guard",
  "./report",
  "./filling",
  "./errors",
  "./slot",
  "./contract",
  "./router",
  "./config",
  "./island",
  "./intent",
  "./types",
]);

export function classifyCoreExport(subpath: string): ApiStability | null {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.exact?.includes(subpath)) return rule.stability;
    if (rule.prefixes?.some((prefix) => subpath.startsWith(prefix))) {
      return rule.stability;
    }
  }
  return null;
}

export function findRootStarExports(source: string): string[] {
  const exports: string[] = [];
  const pattern = /^\s*export\s+\*\s+from\s+["'](\.[^"']+)["']\s*;?\s*$/gm;
  for (const match of source.matchAll(pattern)) {
    exports.push(match[1] as string);
  }
  return exports;
}

export function checkPublicApiBoundary(rootDir: string = process.cwd()): PublicApiBoundaryResult {
  const pkgPath = resolve(rootDir, "packages/core/package.json");
  const rootIndexPath = resolve(rootDir, "packages/core/src/index.ts");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as PackageJson;
  const rootIndex = readFileSync(rootIndexPath, "utf-8");
  const classified: Record<ApiStability, string[]> = {
    stable: [],
    compatibility: [],
    experimental: [],
    internal: [],
  };
  const issues: string[] = [];
  const rootStarExports = findRootStarExports(rootIndex);
  const exportEntries = Object.keys(pkg.exports ?? {}).sort();

  if (exportEntries.length < 10 || exportEntries.length > 12) {
    issues.push(
      `❌ @mandujs/core export map has ${exportEntries.length} entries; v1 budget is 10-12`,
    );
  }

  for (const subpath of exportEntries) {
    const stability = classifyCoreExport(subpath);
    if (!stability) {
      issues.push(`❌ @mandujs/core export ${subpath} is not classified as stable, experimental, or internal`);
      continue;
    }
    classified[stability].push(subpath);
  }

  for (const subpath of rootStarExports) {
    if (!STABLE_ROOT_STAR_EXPORTS.has(subpath)) {
      issues.push(`❌ root @mandujs/core export * from ${subpath} is not in the stable root surface`);
    }
  }

  return { issues, classified, rootStarExports };
}

if (import.meta.main) {
  const result = checkPublicApiBoundary();
  console.log("🔎 Core public API boundary");
  for (const stability of ["stable", "compatibility", "experimental", "internal"] as const) {
    console.log(`  ${stability}: ${result.classified[stability].length}`);
  }

  if (result.issues.length > 0) {
    result.issues.forEach((issue) => console.error(`  ${issue}`));
    process.exit(1);
  }

  console.log("  ✅ every @mandujs/core export is classified");
}
