import {
  loadManifest,
  runGuardCheck,
  buildGuardReport,
  printReportSummary,
  writeReport,
  runAutoCorrect,
  isAutoCorrectableViolation,
} from "@mandujs/core";
import { resolveFromCwd, getRootDir } from "../util/fs";

export interface GuardCheckOptions {
  autoCorrect?: boolean;
}

export async function guardCheck(options: GuardCheckOptions = {}): Promise<boolean> {
  const { autoCorrect = true } = options;

  const specPath = resolveFromCwd("spec/routes.manifest.json");
  const rootDir = getRootDir();

  console.log(`🥟 Mandu Guard`);
  console.log(`📄 Spec 파일: ${specPath}`);
  console.log(`🔧 Auto-correct: ${autoCorrect ? "ON" : "OFF"}\n`);

  const result = await loadManifest(specPath);

  if (!result.success || !result.data) {
    console.error("❌ Spec 로드 실패:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  console.log(`✅ Spec 로드 완료`);
  console.log(`🔍 Guard 검사 중...\n`);

  let checkResult = await runGuardCheck(result.data, rootDir);

  // Auto-correct 시도
  if (!checkResult.passed && autoCorrect) {
    const autoCorrectableCount = checkResult.violations.filter(isAutoCorrectableViolation).length;

    if (autoCorrectableCount > 0) {
      console.log(`⚠️  ${checkResult.violations.length}개 위반 감지 (자동 수정 가능: ${autoCorrectableCount}개)`);
      console.log(`🔄 Auto-correct 실행 중...\n`);

      const autoCorrectResult = await runAutoCorrect(
        checkResult.violations,
        result.data,
        rootDir
      );

      // 수행된 단계 출력
      for (const step of autoCorrectResult.steps) {
        const icon = step.success ? "✅" : "❌";
        console.log(`  ${icon} [${step.action}] ${step.message}`);
      }

      if (autoCorrectResult.fixed) {
        console.log(`\n✅ Auto-correct 완료 (${autoCorrectResult.retriedCount}회 재시도)`);
        if (autoCorrectResult.changeId) {
          console.log(`   트랜잭션: ${autoCorrectResult.changeId} (커밋됨)`);
        }

        // 최종 Guard 재검사
        checkResult = await runGuardCheck(result.data, rootDir);
      } else if (autoCorrectResult.rolledBack) {
        console.log(`\n⚠️  Auto-correct 실패 - 롤백됨`);
        if (autoCorrectResult.changeId) {
          console.log(`   트랜잭션: ${autoCorrectResult.changeId} (롤백됨)`);
        }
        console.log(`   원래 상태로 복원되었습니다.`);

        const manualViolations = autoCorrectResult.remainingViolations.filter(
          (v) => !isAutoCorrectableViolation(v)
        );

        if (manualViolations.length > 0) {
          console.log(`\n⚠️  수동 수정이 필요한 위반:`);
          for (const v of manualViolations) {
            console.log(`  - [${v.ruleId}] ${v.file}`);
            console.log(`    💡 ${v.suggestion}`);
          }
        }

        // 남은 위반으로 업데이트
        checkResult = {
          passed: false,
          violations: autoCorrectResult.remainingViolations,
        };
      } else {
        console.log(`\n⚠️  일부 위반은 수동 수정이 필요합니다:`);

        const manualViolations = autoCorrectResult.remainingViolations.filter(
          (v) => !isAutoCorrectableViolation(v)
        );

        for (const v of manualViolations) {
          console.log(`  - [${v.ruleId}] ${v.file}`);
          console.log(`    💡 ${v.suggestion}`);
        }

        // 남은 위반으로 업데이트
        checkResult = {
          passed: autoCorrectResult.remainingViolations.length === 0,
          violations: autoCorrectResult.remainingViolations,
        };
      }

      console.log("");
    }
  }

  const report = buildGuardReport(checkResult);
  printReportSummary(report);

  const reportPath = resolveFromCwd("mandu-report.json");
  await writeReport(report, reportPath);
  console.log(`📋 Report 저장: ${reportPath}`);

  if (!checkResult.passed) {
    console.log(`\n❌ Guard 실패: ${checkResult.violations.length}개 위반 발견`);
    return false;
  }

  console.log(`\n✅ Guard 통과`);
  console.log(`💡 다음 단계: bunx mandu dev`);

  return true;
}
