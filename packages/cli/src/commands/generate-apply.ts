import { loadManifest } from "../../../core/src/spec/load";
import { generateRoutes } from "../../../core/src/generator/generate";
import { buildGenerateReport, printReportSummary, writeReport } from "../../../core/src/report/build";
import { resolveFromCwd, getRootDir } from "../util/fs";

export async function generateApply(): Promise<boolean> {
  const specPath = resolveFromCwd("spec/routes.manifest.json");
  const rootDir = getRootDir();

  console.log(`🥟 Mandu Generate`);
  console.log(`📄 Spec 파일: ${specPath}\n`);

  const result = await loadManifest(specPath);

  if (!result.success || !result.data) {
    console.error("❌ Spec 로드 실패:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  console.log(`✅ Spec 로드 완료 (${result.data.routes.length}개 라우트)`);
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
