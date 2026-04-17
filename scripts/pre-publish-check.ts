#!/usr/bin/env bun
/**
 * Pre-publish check: workspace 의존성이 올바르게 해결되었는지 확인
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import * as fs from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";

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
    // Catalog refs in the SOURCE package.json are legitimate and are
    // substituted by `bun publish` / `bun pm pack`. The staged-tarball
    // assertion below is what actually guards the published output.
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

/**
 * Stage a tarball via `bun pm pack` and assert the extracted package.json
 * contains no unsubstituted `workspace:` or `catalog:` specifiers.
 *
 * Runs serially per package (Bun's pack writes into a temp dir we control).
 */
async function assertNoLeakedSpecifiers(pkgDir: string): Promise<string[]> {
  const issues: string[] = [];
  const tmp = await fs.mkdtemp(join(tmpdir(), "mandu-publish-check-"));
  try {
    execSync(`bun pm pack --destination "${tmp}"`, {
      cwd: pkgDir,
      stdio: "pipe",
    });
    const entries = await fs.readdir(tmp);
    const tarball = entries.find(e => e.endsWith(".tgz"));
    if (!tarball) {
      issues.push(`❌ ${pkgDir}: bun pm pack produced no tarball`);
      return issues;
    }
    // Use bsdtar on Windows (System32\tar.exe) which handles drive letters;
    // msys tar (/usr/bin/tar) treats "C:" as a remote host spec and fails.
    const tarCmd = process.platform === "win32"
      ? `"${join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")}" -xzf "${join(tmp, tarball)}" -C "${tmp}"`
      : `tar -xzf "${join(tmp, tarball)}" -C "${tmp}"`;
    execSync(tarCmd, { stdio: "pipe" });
    const stagedPkgPath = join(tmp, "package", "package.json");
    const staged = await fs.readFile(stagedPkgPath, "utf-8");
    const parsed: PackageJson = JSON.parse(staged);
    for (const block of [parsed.dependencies, parsed.devDependencies] as const) {
      if (!block) continue;
      for (const [name, spec] of Object.entries(block)) {
        if (spec.startsWith("catalog:")) {
          issues.push(`❌ ${parsed.name}: ${name}@${spec} (catalog ref leaked into tarball!)`);
        }
        if (spec.startsWith("workspace:")) {
          issues.push(`❌ ${parsed.name}: ${name}@${spec} (workspace ref leaked into tarball!)`);
        }
      }
    }
    if (issues.length === 0) {
      console.log(`  ✅ ${parsed.name} tarball: no leaked catalog:/workspace: specifiers`);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  return issues;
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
  } catch (err: unknown) {
    console.error(`❌ Error reading ${pkgPath}:`, err instanceof Error ? err.message : String(err));
    hasIssues = true;
  }
}

// 3. 스테이지된 tarball 검증 (catalog:/workspace: 누설 방지)
console.log("📦 Step 3: 스테이지된 tarball 검증...\n");

const publishablePackages = ["packages/core", "packages/cli", "packages/mcp", "packages/ate", "packages/skills"];
for (const pkgDir of publishablePackages) {
  const abs = resolve(process.cwd(), pkgDir);
  try {
    const leakIssues = await assertNoLeakedSpecifiers(abs);
    if (leakIssues.length > 0) {
      hasIssues = true;
      leakIssues.forEach(issue => console.log(`  ${issue}`));
    }
  } catch (err) {
    hasIssues = true;
    console.error(`❌ Tarball check failed for ${pkgDir}:`, err instanceof Error ? err.message : String(err));
  }
}
console.log();

// 4. 버전 일관성 검증
console.log("🔢 Step 4: 버전 일관성 검증...\n");

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
