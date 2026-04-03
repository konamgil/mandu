import type { GuardViolation } from "../guard/rules";
import type { GuardCheckResult } from "../guard/check";
import type { GenerateResult } from "../generator/generate";

export interface ManuduReport {
  status: "pass" | "fail";
  timestamp: string;
  guardViolations: GuardViolation[];
  generateResult?: {
    created: string[];
    deleted: string[];
    errors: string[];
  };
  nextActions: string[];
}

export function buildGuardReport(checkResult: GuardCheckResult): ManuduReport {
  const nextActions: string[] = [];

  if (!checkResult.passed) {
    const hasManualEdit = checkResult.violations.some(
      (v) => v.ruleId === "GENERATED_MANUAL_EDIT"
    );
    const hasInvalidImport = checkResult.violations.some(
      (v) => v.ruleId === "INVALID_GENERATED_IMPORT"
    );
    const hasForbiddenImport = checkResult.violations.some(
      (v) => v.ruleId === "FORBIDDEN_IMPORT_IN_GENERATED"
    );

    if (hasManualEdit) {
      nextActions.push("bunx mandu generate");
    }
    if (hasInvalidImport) {
      nextActions.push("generated 파일 직접 import를 제거하고 런타임 레지스트리 사용");
    }
    if (hasForbiddenImport) {
      nextActions.push("generated 파일에서 금지된 import를 제거하고 slot에서 처리");
    }
  }

  return {
    status: checkResult.passed ? "pass" : "fail",
    timestamp: new Date().toISOString(),
    guardViolations: checkResult.violations,
    nextActions,
  };
}

export function buildGenerateReport(generateResult: GenerateResult): ManuduReport {
  const nextActions: string[] = [];

  if (!generateResult.success) {
    nextActions.push("generate 오류를 수정하고 다시 실행하세요");
  } else {
    if (generateResult.created.length > 0) {
      nextActions.push("bunx mandu guard로 검증 실행");
    }
  }

  return {
    status: generateResult.success ? "pass" : "fail",
    timestamp: new Date().toISOString(),
    guardViolations: [],
    generateResult: {
      created: generateResult.created,
      deleted: generateResult.deleted,
      errors: generateResult.errors,
    },
    nextActions,
  };
}

export async function writeReport(report: ManuduReport, outputPath: string): Promise<void> {
  await Bun.write(outputPath, JSON.stringify(report, null, 2));
}

export function printReportSummary(report: ManuduReport): void {
  const statusIcon = report.status === "pass" ? "✅" : "❌";
  console.log(`\n${statusIcon} Guard Status: ${report.status.toUpperCase()}`);
  console.log(`📅 Timestamp: ${report.timestamp}`);

  if (report.guardViolations.length > 0) {
    console.log(`\n⚠️  Violations (${report.guardViolations.length}):`);
    for (const violation of report.guardViolations) {
      console.log(`  [${violation.ruleId}] ${violation.file}`);
      console.log(`    └─ ${violation.message}`);
      console.log(`    💡 ${violation.suggestion}`);
    }
  }

  if (report.generateResult) {
    if (report.generateResult.created.length > 0) {
      console.log(`\n📁 Created (${report.generateResult.created.length}):`);
      for (const file of report.generateResult.created) {
        console.log(`  + ${file}`);
      }
    }
    if (report.generateResult.deleted.length > 0) {
      console.log(`\n🗑️  Deleted (${report.generateResult.deleted.length}):`);
      for (const file of report.generateResult.deleted) {
        console.log(`  - ${file}`);
      }
    }
    if (report.generateResult.errors.length > 0) {
      console.log(`\n❌ Errors (${report.generateResult.errors.length}):`);
      for (const error of report.generateResult.errors) {
        console.log(`  ! ${error}`);
      }
    }
  }

  if (report.nextActions.length > 0) {
    console.log(`\n🎯 Next Actions:`);
    for (const action of report.nextActions) {
      console.log(`  → ${action}`);
    }
  }

  console.log("");
}
