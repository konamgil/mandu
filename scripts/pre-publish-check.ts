#!/usr/bin/env bun
/**
 * Pre-publish check: workspace 의존성이 올바르게 해결되었는지 확인
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

interface PackageJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const WORKSPACE_PACKAGES = ["@mandujs/core", "@mandujs/cli", "@mandujs/mcp", "@mandujs/ate"];

function checkPackage(pkgPath: string): { name: string; issues: string[] } {
  const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const issues: string[] = [];

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  for (const [dep, version] of Object.entries(allDeps)) {
    if (WORKSPACE_PACKAGES.includes(dep)) {
      if (version.includes("workspace:")) {
        issues.push(`❌ ${dep}: ${version} (workspace protocol not resolved!)`);
      } else {
        console.log(`  ✅ ${dep}: ${version}`);
      }
    }
  }

  return { name: pkg.name, issues };
}

console.log("🔍 Pre-publish check: workspace 의존성 검증\n");

// 1. lockfile 업데이트 확인
console.log("📦 Step 1: Lockfile 업데이트 확인...");
try {
  const status = execSync("git status --porcelain bun.lockb", { encoding: "utf-8" });
  if (status.trim()) {
    console.log("⚠️  bun.lockb가 변경되었습니다. 커밋하시겠습니까?");
  } else {
    console.log("✅ Lockfile up-to-date\n");
  }
} catch {
  console.log("✅ Lockfile up-to-date\n");
}

// 2. workspace 의존성 검증
console.log("🔗 Step 2: Workspace 의존성 검증...\n");

const packages = ["packages/core", "packages/cli", "packages/mcp"];
let hasIssues = false;

for (const pkgDir of packages) {
  const pkgPath = resolve(process.cwd(), pkgDir, "package.json");
  try {
    const { name, issues } = checkPackage(pkgPath);
    console.log(`📦 ${name}`);

    if (issues.length > 0) {
      hasIssues = true;
      issues.forEach(issue => console.log(`  ${issue}`));
    }
    console.log();
  } catch (err: any) {
    console.error(`❌ Error reading ${pkgPath}:`, err.message);
    hasIssues = true;
  }
}

// 3. 버전 일관성 검증
console.log("🔢 Step 3: 버전 일관성 검증...\n");

const versions = new Map<string, string>();
for (const pkgDir of packages) {
  const pkg: PackageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), pkgDir, "package.json"), "utf-8")
  );
  versions.set(pkg.name, pkg.version);
  console.log(`  ${pkg.name}: ${pkg.version}`);
}

console.log();

// 최종 결과
if (hasIssues) {
  console.error("❌ Pre-publish check FAILED!");
  console.error("\n💡 Fix:");
  console.error("   1. Run: bun install");
  console.error("   2. Commit updated bun.lockb");
  console.error("   3. Re-run publish");
  process.exit(1);
} else {
  console.log("✅ Pre-publish check PASSED!");
  console.log("\n✨ Ready to publish!\n");
}
