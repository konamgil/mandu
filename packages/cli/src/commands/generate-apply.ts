import { loadManifest, generateManifest, generateRoutes, buildGenerateReport, printReportSummary, writeReport } from "@mandujs/core";
import { resolveFromCwd, getRootDir } from "../util/fs";

export async function generateApply(): Promise<boolean> {
  const rootDir = getRootDir();
  const manifestPath = resolveFromCwd(".mandu/routes.manifest.json");

  console.log(`🥟 Mandu Generate`);
  console.log(`📄 FS Routes 기반 코드 생성\n`);

  // Regenerate manifest from FS Routes
  const fsResult = await generateManifest(rootDir);
  console.log(`✅ 매니페스트 생성 완료 (${fsResult.fsRoutesCount}개 라우트)`);

  const result = await loadManifest(manifestPath);

  if (!result.success || !result.data) {
    console.error("❌ 매니페스트 로드 실패:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  console.log(`🔄 코드 생성 중...\n`);

  const generateResult = await generateRoutes(result.data, rootDir);

  const report = buildGenerateReport(generateResult);
  printReportSummary(report);

  const reportPath = resolveFromCwd("mandu-report.json");
  await writeReport(report, reportPath);
  console.log(`📋 Report 저장: ${reportPath}`);

  if (!generateResult.success) {
    console.log(`\n❌ generate 실패`);
    return false;
  }

  console.log(`\n✅ generate 완료`);
  console.log(`💡 다음 단계: bunx mandu guard`);

  return true;
}
