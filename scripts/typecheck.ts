#!/usr/bin/env bun
/**
 * Mandu Type-Check Script
 *
 * 각 패키지의 tsconfig.json 기준으로 tsc --noEmit 실행.
 * 전체 패키지를 순회하며 타입 에러를 수집/보고합니다.
 *
 * Usage:
 *   bun run typecheck           # 전체 패키지 타입 체크
 *   bun run typecheck core      # 특정 패키지만
 *   bun run typecheck core cli  # 복수 패키지
 */

import { $ } from "bun";
import { join } from "path";
import { existsSync } from "fs";

const ROOT = join(import.meta.dir, "..");
const ALL_PACKAGES = ["core", "cli", "mcp", "ate"];

const requestedPackages = process.argv.slice(2);
const packages =
  requestedPackages.length > 0
    ? requestedPackages.filter((p) => {
        if (!ALL_PACKAGES.includes(p)) {
          console.error(`Unknown package: ${p} (available: ${ALL_PACKAGES.join(", ")})`);
          return false;
        }
        return true;
      })
    : ALL_PACKAGES;

if (packages.length === 0) {
  process.exit(1);
}

let hasError = false;

for (const pkg of packages) {
  const pkgDir = join(ROOT, "packages", pkg);
  const tsconfigPath = join(pkgDir, "tsconfig.json");

  if (!existsSync(tsconfigPath)) {
    console.log(`⏭️  ${pkg} — tsconfig.json not found, skipping`);
    continue;
  }

  console.log(`🔍 ${pkg} — type-checking...`);

  try {
    await $`tsc --noEmit --project ${tsconfigPath}`.quiet();
    console.log(`✅ ${pkg} — no errors`);
  } catch (err: unknown) {
    hasError = true;
    console.error(`❌ ${pkg} — type errors found:\n`);
    const shellErr = err as { stdout?: Buffer; stderr?: Buffer };
    if (shellErr.stdout) {
      console.error(shellErr.stdout.toString());
    }
    if (shellErr.stderr) {
      console.error(shellErr.stderr.toString());
    }
  }
}

if (hasError) {
  console.error("\n❌ Type check failed.");
  process.exit(1);
} else {
  console.log("\n✅ All packages passed type check.");
}
