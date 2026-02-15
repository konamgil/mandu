import {
  loadManifest,
  generateManifest,
  generateRoutes,
  buildGenerateReport,
  printReportSummary,
  writeReport,
  parseResourceSchemas,
  generateResourcesArtifacts,
  logGeneratorResult,
} from "@mandujs/core";
import { resolveFromCwd, getRootDir } from "../util/fs";
import path from "path";
import fs from "fs/promises";

/**
 * Discover resource schema files in spec/resources/
 */
async function discoverResourceSchemas(rootDir: string): Promise<string[]> {
  const resourcesDir = path.join(rootDir, "spec/resources");

  try {
    await fs.access(resourcesDir);
  } catch {
    // spec/resources doesn't exist, no resources to discover
    return [];
  }

  const schemaPaths: string[] = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        await scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".resource.ts")) {
        schemaPaths.push(fullPath);
      }
    }
  }

  await scanDir(resourcesDir);
  return schemaPaths;
}

export async function generateApply(options?: { force?: boolean }): Promise<boolean> {
  const rootDir = getRootDir();
  const manifestPath = resolveFromCwd(".mandu/routes.manifest.json");

  console.log(`🥟 Mandu Generate`);
  console.log(`📄 FS Routes + Resources 코드 생성\n`);

  // ============================================
  // 1. Generate FS Routes artifacts
  // ============================================

  // Regenerate manifest from FS Routes
  const fsResult = await generateManifest(rootDir);
  console.log(`✅ 매니페스트 생성 완료 (${fsResult.fsRoutesCount}개 라우트)`);

  const result = await loadManifest(manifestPath);

  if (!result.success || !result.data) {
    console.error("❌ 매니페스트 로드 실패:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  console.log(`🔄 FS Routes 코드 생성 중...\n`);

  const generateResult = await generateRoutes(result.data, rootDir);

  const report = buildGenerateReport(generateResult);
  printReportSummary(report);

  const reportPath = resolveFromCwd("mandu-report.json");
  await writeReport(report, reportPath);
  console.log(`📋 Report 저장: ${reportPath}`);

  if (!generateResult.success) {
    console.log(`\n❌ FS Routes generate 실패`);
    return false;
  }

  console.log(`\n✅ FS Routes generate 완료`);

  // ============================================
  // 2. Generate Resource artifacts
  // ============================================

  console.log(`\n🔍 리소스 스키마 검색 중...\n`);

  const schemaPaths = await discoverResourceSchemas(rootDir);

  if (schemaPaths.length === 0) {
    console.log(`📋 리소스 스키마 없음 (spec/resources/*.resource.ts)`);
    console.log(`💡 리소스 생성: bunx mandu generate resource`);
  } else {
    console.log(`📋 ${schemaPaths.length}개 리소스 스키마 발견`);
    schemaPaths.forEach((p) =>
      console.log(`   - ${path.relative(rootDir, p)}`)
    );

    try {
      console.log(`\n🔄 리소스 아티팩트 생성 중...\n`);

      const resources = await parseResourceSchemas(schemaPaths);
      const resourceResult = await generateResourcesArtifacts(resources, {
        rootDir,
        force: options?.force ?? false,
      });

      logGeneratorResult(resourceResult);

      if (!resourceResult.success) {
        console.log(`\n❌ 리소스 generate 실패`);
        return false;
      }

      console.log(`\n✅ 리소스 generate 완료`);
    } catch (error) {
      console.error(
        `\n❌ 리소스 generate 오류: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  // ============================================
  // Final Summary
  // ============================================

  console.log(`\n✅ generate 완료`);
  console.log(`💡 다음 단계: bunx mandu guard`);

  return true;
}
