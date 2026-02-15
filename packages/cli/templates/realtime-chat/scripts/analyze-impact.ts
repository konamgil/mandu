#!/usr/bin/env bun

/**
 * Impact Analysis Script
 * 변경된 파일 목록을 기반으로 영향받는 E2E 테스트 식별
 *
 * Usage:
 *   bun run scripts/analyze-impact.ts changed-files.txt
 */

import fs from "fs/promises";
import path from "path";

interface ImpactMap {
  [pattern: string]: string[];
}

/**
 * 파일 패턴과 영향받는 테스트 매핑
 * 프로젝트 구조에 맞게 커스터마이즈 가능
 */
const IMPACT_MAP: ImpactMap = {
  // API routes → API 테스트
  "app/api/**": ["**/api*.spec.ts", "**/api*.test.ts"],

  // Client components → UI 테스트
  "src/client/**": ["**/ui*.spec.ts", "**/component*.spec.ts"],

  // Server logic → Integration 테스트
  "src/server/**": ["**/integration*.spec.ts", "**/server*.spec.ts"],

  // Shared contracts → 모든 통합 테스트
  "src/shared/contracts/**": ["**/integration*.spec.ts", "**/e2e*.spec.ts"],

  // Database/Schema → 데이터 관련 테스트
  "src/shared/schema/**": ["**/db*.spec.ts", "**/data*.spec.ts"],

  // Config files → 모든 테스트
  "*.config.*": ["**/*.spec.ts"],
  "package.json": ["**/*.spec.ts"],
};

/**
 * Glob 패턴 매칭 (간단한 구현)
 */
function matchPattern(filePath: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\./g, "\\.");

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

/**
 * 변경된 파일 목록을 기반으로 영향받는 테스트 패턴 추출
 */
function analyzeImpact(changedFiles: string[]): string[] {
  const affectedTestPatterns = new Set<string>();

  for (const file of changedFiles) {
    const normalizedPath = file.replace(/\\/g, "/");

    for (const [pattern, tests] of Object.entries(IMPACT_MAP)) {
      if (matchPattern(normalizedPath, pattern)) {
        tests.forEach((test) => affectedTestPatterns.add(test));
      }
    }
  }

  return Array.from(affectedTestPatterns);
}

/**
 * Main
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: bun run scripts/analyze-impact.ts <changed-files.txt>");
    process.exit(1);
  }

  const changedFilesPath = args[0];

  try {
    // Read changed files
    const content = await fs.readFile(changedFilesPath, "utf-8");
    const changedFiles = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (changedFiles.length === 0) {
      console.log("none");
      return;
    }

    // Analyze impact
    const affectedTests = analyzeImpact(changedFiles);

    if (affectedTests.length === 0) {
      console.log("none");
      return;
    }

    // Output affected test patterns (Playwright grep format)
    const grepPattern = affectedTests.join("|");
    console.log(grepPattern);
  } catch (error) {
    console.error("Error analyzing impact:", error);
    // Fallback: run all tests
    console.log("all");
  }
}

main();
