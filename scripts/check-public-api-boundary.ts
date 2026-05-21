#!/usr/bin/env bun
import { readFileSync } from "fs";
import { resolve } from "path";

type ApiStability = "stable" | "experimental" | "internal";

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

const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    stability: "internal",
    exact: [
      "./bundler",
      "./change",
      "./dev-error-overlay",
      "./generator",
      "./internal",
      "./lockfile",
      "./paths",
      "./plugins/runner",
      "./resource/generator-repo",
      "./runtime/cache",
      "./runtime/router",
      "./runtime/server",
      "./runtime/fast-refresh-types",
      "./guard/tsgolint-bridge",
      "./watcher",
    ],
    prefixes: [
      "./bundler/",
      "./resource/ddl/",
    ],
    reason: "framework implementation detail or release/build plumbing",
  },
  {
    stability: "experimental",
    exact: [
      "./a11y",
      "./agent",
      "./brain",
      "./deploy",
      "./design",
      "./desktop",
      "./diagnose",
      "./experimental",
      "./kitchen",
      "./scheduler",
    ],
    prefixes: [
      "./desktop/",
    ],
    reason: "v0 feature surface that can still change before v1",
  },
  {
    stability: "stable",
    exact: [
      ".",
      "./auth",
      "./client",
      "./contract",
      "./content",
      "./config",
      "./db",
      "./email",
      "./error",
      "./filling",
      "./guard",
      "./i18n",
      "./id",
      "./logging",
      "./middleware",
      "./observability",
      "./openapi/generator",
      "./perf",
      "./plugins",
      "./resource",
      "./router",
      "./routes",
      "./runtime",
      "./storage/s3",
      "./testing",
      "./components/Image",
    ],
    prefixes: [
      "./auth/",
      "./client/",
      "./config/",
      "./content/",
      "./contract/",
      "./db/",
      "./filling/",
      "./guard/",
      "./middleware/",
      "./perf/",
      "./plugins/",
      "./resource/",
      "./testing/",
    ],
    reason: "documented app, adapter, testing, or operator-facing API",
  },
];

const STABLE_ROOT_STAR_EXPORTS = new Set([
  "./spec",
  "./runtime",
  "./guard",
  "./report",
  "./filling",
  "./errors",
  "./logging",
  "./slot",
  "./contract",
  "./openapi",
  "./router",
  "./config",
  "./utils",
  "./seo",
  "./island",
  "./intent",
  "./observability",
  "./resource",
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
    experimental: [],
    internal: [],
  };
  const issues: string[] = [];
  const rootStarExports = findRootStarExports(rootIndex);

  for (const subpath of Object.keys(pkg.exports ?? {}).sort()) {
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
  for (const stability of ["stable", "experimental", "internal"] as const) {
    console.log(`  ${stability}: ${result.classified[stability].length}`);
  }

  if (result.issues.length > 0) {
    result.issues.forEach((issue) => console.error(`  ${issue}`));
    process.exit(1);
  }

  console.log("  ✅ every @mandujs/core export is classified");
}
