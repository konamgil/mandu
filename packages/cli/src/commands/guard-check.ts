import { loadManifest } from "../../../core/src/spec/load";
import { runGuardCheck } from "../../../core/src/guard/check";
import { buildGuardReport, printReportSummary, writeReport } from "../../../core/src/report/build";
import { resolveFromCwd, getRootDir } from "../util/fs";

export async function guardCheck(): Promise<boolean> {
  const specPath = resolveFromCwd("spec/routes.manifest.json");
  const rootDir = getRootDir();

  console.log(`🥟 Mandu Guard`);
  console.log(`📄 Spec 파일: ${specPath}\n`);

  const result = await loadManifest(specPath);

  if (!result.success || !result.data) {
    console.error("❌ Spec 로드 실패:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  console.log(`✅ Spec 로드 완료`);
  console.log(`🔍 Guard 검사 중...\n`);

  const checkResult = await runGuardCheck(result.data, rootDir);

  const report = buildGuardReport(checkResult);
  printReportSummary(report);

  const reportPath = resolveFromCwd("mandu-report.json");
  await writeReport(report, reportPath);
  console.log(`📋 Report 저장: ${reportPath}`);

  if (!checkResult.passed) {
    console.log(`\n❌ guard 실패: ${checkResult.violations.length}개 위반 발견`);
    return false;
  }

  console.log(`\n✅ guard 통과`);
  console.log(`💡 다음 단계: bunx mandu dev`);

  return true;
}
