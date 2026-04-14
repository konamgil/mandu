#!/usr/bin/env bun
/**
 * Mandu Publish Script
 *
 * workspace:* 의존성을 실제 버전으로 직접 치환한 뒤 bun publish 실행.
 * npm 배포 후 GITHUB_TOKEN이 있으면 GitHub Packages에도 dual publish.
 * 배포 후 원래 workspace:* 로 복원합니다.
 *
 * Usage:
 *   bun run scripts/publish.ts          # 실제 배포
 *   bun run scripts/publish.ts --dry-run # 미리보기
 */

import { $ } from "bun";
import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";

// Publish 순서: 의존성 위상 순서대로 (의존되는 것이 먼저)
// core → skills (peerDep core) → mcp (deps core+ate) → cli (deps core+mcp+skills)
const PACKAGES = ["packages/core", "packages/skills", "packages/mcp", "packages/cli"];
const ROOT = join(import.meta.dir, "..");
const isDryRun = process.argv.includes("--dry-run");
const skipCheck = process.argv.includes("--skip-check");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GPR_REGISTRY = "https://npm.pkg.github.com";
// 명시적 npm registry — ~/.npmrc의 registry= 라인이 verdaccio 등으로 설정돼 있어도
// public npmjs.org로 보내기 위함. NPM_REGISTRY 환경변수로 override 가능.
const NPM_REGISTRY = process.env.NPM_REGISTRY ?? "https://registry.npmjs.org/";

// Pre-publish check
if (!skipCheck) {
  console.log("🔍 Running pre-publish check...\n");
  try {
    execSync("bun run scripts/pre-publish-check.ts", { stdio: "inherit", cwd: ROOT });
  } catch (err) {
    console.error("\n❌ Pre-publish check failed!");
    process.exit(1);
  }
  console.log();
}

interface PackageJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function getPublishedVersion(name: string): Promise<string | null> {
  try {
    // ~/.npmrc의 registry=가 verdaccio로 설정돼 있어도 public npm에서 조회
    const result = await $`npm view ${name} version --registry=${NPM_REGISTRY}`.text();
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * 모든 workspace 패키지의 name → version 매핑 생성
 */
async function buildVersionMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const pkg of PACKAGES) {
    const pkgJson: PackageJson = JSON.parse(
      await readFile(join(ROOT, pkg, "package.json"), "utf-8")
    );
    map.set(pkgJson.name, pkgJson.version);
  }
  return map;
}

/**
 * package.json의 workspace:* 참조를 실제 버전으로 치환
 * 원본 내용을 반환하여 복원에 사용
 */
async function resolveWorkspaceDeps(
  pkgPath: string,
  versionMap: Map<string, string>
): Promise<{ original: string; resolved: boolean }> {
  const filePath = join(pkgPath, "package.json");
  const original = await readFile(filePath, "utf-8");
  const pkgJson: PackageJson = JSON.parse(original);
  let resolved = false;

  for (const deps of [pkgJson.dependencies, pkgJson.devDependencies]) {
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (version.startsWith("workspace:")) {
        const actualVersion = versionMap.get(name);
        if (actualVersion) {
          deps[name] = `^${actualVersion}`;
          resolved = true;
        }
      }
    }
  }

  if (resolved) {
    await writeFile(filePath, JSON.stringify(pkgJson, null, 2) + "\n");
  }

  return { original, resolved };
}

/**
 * package.json을 원본으로 복원
 */
async function restorePackageJson(pkgPath: string, original: string): Promise<void> {
  await writeFile(join(pkgPath, "package.json"), original);
}

/**
 * GitHub Packages(GPR)에 배포
 * 임시 .npmrc를 패키지 디렉토리에 생성 후 배포, 완료 후 삭제
 */
async function publishToGPR(pkgPath: string, pkgName: string): Promise<void> {
  const npmrcPath = join(pkgPath, ".npmrc");
  const npmrcContent = [
    `@mandujs:registry=${GPR_REGISTRY}`,
    `//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}`,
    "",
  ].join("\n");

  try {
    await writeFile(npmrcPath, npmrcContent);

    if (isDryRun) {
      console.log(`   📦 GPR dry-run: would publish ${pkgName} to ${GPR_REGISTRY}`);
    } else {
      await $`cd ${pkgPath} && bun publish --access public`.text();
      console.log(`   ✅ GPR published successfully`);
    }
  } finally {
    // 항상 임시 .npmrc 삭제
    try {
      await unlink(npmrcPath);
    } catch {
      // .npmrc가 없으면 무시
    }
  }
}

async function main() {
  console.log(isDryRun ? "🔍 Dry run mode\n" : "🚀 Publishing packages\n");

  if (GITHUB_TOKEN) {
    console.log("🔑 GITHUB_TOKEN detected — dual publish (npm + GitHub Packages)\n");
  } else {
    console.log("ℹ️  No GITHUB_TOKEN — npm only (set GITHUB_TOKEN to enable GitHub Packages)\n");
  }

  const versionMap = buildVersionMap();
  const versions = await versionMap;

  console.log("📋 Workspace versions:");
  for (const [name, version] of versions) {
    console.log(`   ${name}@${version}`);
  }
  console.log();

  for (const pkg of PACKAGES) {
    const pkgPath = join(ROOT, pkg);
    const pkgJson: PackageJson = JSON.parse(
      await readFile(join(pkgPath, "package.json"), "utf-8")
    );

    const published = await getPublishedVersion(pkgJson.name);
    const alreadyOnNpm = published === pkgJson.version;

    if (alreadyOnNpm && !GITHUB_TOKEN) {
      console.log(`⏭️  ${pkgJson.name}@${pkgJson.version} — already on npm, skipping`);
      continue;
    }

    console.log(`📦 ${pkgJson.name}@${pkgJson.version} (npm: ${published ?? "not found"})`);

    // workspace:* → 실제 버전으로 치환
    const { original, resolved } = await resolveWorkspaceDeps(pkgPath, versions);
    if (resolved) {
      console.log(`   🔗 workspace:* → resolved to actual versions`);
    }

    try {
      // 1) npm 배포
      if (alreadyOnNpm) {
        console.log(`   ⏭️  npm: already published, skipping`);
      } else if (isDryRun) {
        const result = await $`cd ${pkgPath} && bun publish --dry-run --registry=${NPM_REGISTRY}`.text();
        console.log(result);
      } else {
        const result = await $`cd ${pkgPath} && bun publish --access public --registry=${NPM_REGISTRY}`.text();
        console.log(`   ✅ Published to npm`);
        console.log(result);
      }

      // 2) GitHub Packages 배포
      if (GITHUB_TOKEN) {
        try {
          await publishToGPR(pkgPath, pkgJson.name);
        } catch (gprErr) {
          console.warn(`   ⚠️  GPR publish failed for ${pkgJson.name}`);
          console.warn(`   ${gprErr}`);
        }
      }
    } catch (err) {
      console.error(`   ❌ Failed to publish ${pkgJson.name}`);
      console.error(err);
      // 실패해도 원본 복원
      if (resolved) await restorePackageJson(pkgPath, original);
      process.exit(1);
    }

    // 원본 복원 (workspace:* 유지)
    if (resolved) {
      await restorePackageJson(pkgPath, original);
      console.log(`   🔄 Restored workspace:* in package.json`);
    }
  }

  console.log("\n✨ Done!");
}

main();
