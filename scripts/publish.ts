#!/usr/bin/env bun
/**
 * Mandu Publish Script
 *
 * changeset publish 대신 bun publish를 사용하여
 * workspace:* 의존성을 실제 버전으로 자동 변환합니다.
 *
 * Usage:
 *   bun run scripts/publish.ts          # 실제 배포
 *   bun run scripts/publish.ts --dry-run # 미리보기
 */

import { $ } from "bun";
import { readFile } from "fs/promises";
import { join } from "path";

const PACKAGES = ["packages/core", "packages/cli", "packages/mcp"];
const ROOT = join(import.meta.dir, "..");
const isDryRun = process.argv.includes("--dry-run");

interface PackageJson {
  name: string;
  version: string;
}

async function getPublishedVersion(name: string): Promise<string | null> {
  try {
    const result = await $`npm view ${name} version`.text();
    return result.trim();
  } catch {
    return null;
  }
}

async function main() {
  console.log(isDryRun ? "🔍 Dry run mode\n" : "🚀 Publishing packages\n");

  for (const pkg of PACKAGES) {
    const pkgPath = join(ROOT, pkg);
    const pkgJson: PackageJson = JSON.parse(
      await readFile(join(pkgPath, "package.json"), "utf-8")
    );

    const published = await getPublishedVersion(pkgJson.name);

    if (published === pkgJson.version) {
      console.log(`⏭️  ${pkgJson.name}@${pkgJson.version} — already published, skipping`);
      continue;
    }

    console.log(`📦 ${pkgJson.name}@${pkgJson.version} (npm: ${published ?? "not found"})`);

    if (isDryRun) {
      const result = await $`cd ${pkgPath} && bun publish --dry-run`.text();
      console.log(result);
    } else {
      try {
        const result = await $`cd ${pkgPath} && bun publish --access public`.text();
        console.log(`   ✅ Published successfully`);
        console.log(result);
      } catch (err) {
        console.error(`   ❌ Failed to publish ${pkgJson.name}`);
        console.error(err);
        process.exit(1);
      }
    }
  }

  console.log("\n✨ Done!");
}

main();
