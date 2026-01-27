import type { RoutesManifest } from "../spec/schema";
import type { GuardViolation } from "./rules";
import { GUARD_RULES } from "./rules";
import { runGuardCheck } from "./check";
import { writeLock } from "../spec/lock";
import { generateRoutes } from "../generator/generate";
import path from "path";

export interface AutoCorrectStep {
  ruleId: string;
  action: string;
  success: boolean;
  message: string;
}

export interface AutoCorrectResult {
  fixed: boolean;
  steps: AutoCorrectStep[];
  remainingViolations: GuardViolation[];
  retriedCount: number;
}

// 자동 수정 가능한 규칙들
const AUTO_CORRECTABLE_RULES = new Set([
  GUARD_RULES.SPEC_HASH_MISMATCH.id,
  GUARD_RULES.GENERATED_MANUAL_EDIT.id,
  GUARD_RULES.SLOT_NOT_FOUND.id,
]);

export function isAutoCorrectableViolation(violation: GuardViolation): boolean {
  return AUTO_CORRECTABLE_RULES.has(violation.ruleId);
}

export async function runAutoCorrect(
  violations: GuardViolation[],
  manifest: RoutesManifest,
  rootDir: string,
  maxRetries: number = 3
): Promise<AutoCorrectResult> {
  const steps: AutoCorrectStep[] = [];
  let currentViolations = violations;
  let retriedCount = 0;

  while (retriedCount < maxRetries) {
    const autoCorrectableViolations = currentViolations.filter(isAutoCorrectableViolation);

    if (autoCorrectableViolations.length === 0) {
      break;
    }

    // 각 위반에 대해 수정 시도
    let anyFixed = false;

    for (const violation of autoCorrectableViolations) {
      const step = await correctViolation(violation, manifest, rootDir);
      steps.push(step);

      if (step.success) {
        anyFixed = true;
      }
    }

    if (!anyFixed) {
      // 아무것도 수정하지 못했으면 루프 종료
      break;
    }

    // Guard 재검사
    retriedCount++;
    const recheckResult = await runGuardCheck(manifest, rootDir);
    currentViolations = recheckResult.violations;

    if (recheckResult.passed) {
      return {
        fixed: true,
        steps,
        remainingViolations: [],
        retriedCount,
      };
    }
  }

  return {
    fixed: currentViolations.length === 0,
    steps,
    remainingViolations: currentViolations,
    retriedCount,
  };
}

async function correctViolation(
  violation: GuardViolation,
  manifest: RoutesManifest,
  rootDir: string
): Promise<AutoCorrectStep> {
  switch (violation.ruleId) {
    case GUARD_RULES.SPEC_HASH_MISMATCH.id:
      return await correctSpecHashMismatch(manifest, rootDir);

    case GUARD_RULES.GENERATED_MANUAL_EDIT.id:
      return await correctGeneratedManualEdit(manifest, rootDir);

    case GUARD_RULES.SLOT_NOT_FOUND.id:
      return await correctSlotNotFound(manifest, rootDir);

    default:
      return {
        ruleId: violation.ruleId,
        action: "skip",
        success: false,
        message: `자동 수정 불가능한 규칙: ${violation.ruleId}`,
      };
  }
}

async function correctSpecHashMismatch(
  manifest: RoutesManifest,
  rootDir: string
): Promise<AutoCorrectStep> {
  try {
    const lockPath = path.join(rootDir, "spec/spec.lock.json");
    await writeLock(lockPath, manifest);

    return {
      ruleId: GUARD_RULES.SPEC_HASH_MISMATCH.id,
      action: "spec-upsert",
      success: true,
      message: "spec.lock.json 업데이트 완료",
    };
  } catch (error) {
    return {
      ruleId: GUARD_RULES.SPEC_HASH_MISMATCH.id,
      action: "spec-upsert",
      success: false,
      message: `spec.lock.json 업데이트 실패: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function correctGeneratedManualEdit(
  manifest: RoutesManifest,
  rootDir: string
): Promise<AutoCorrectStep> {
  try {
    const result = await generateRoutes(manifest, rootDir);

    if (result.success) {
      return {
        ruleId: GUARD_RULES.GENERATED_MANUAL_EDIT.id,
        action: "generate",
        success: true,
        message: `코드 재생성 완료 (${result.created.length}개 파일)`,
      };
    } else {
      return {
        ruleId: GUARD_RULES.GENERATED_MANUAL_EDIT.id,
        action: "generate",
        success: false,
        message: `코드 재생성 실패: ${result.errors.join(", ")}`,
      };
    }
  } catch (error) {
    return {
      ruleId: GUARD_RULES.GENERATED_MANUAL_EDIT.id,
      action: "generate",
      success: false,
      message: `코드 재생성 실패: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function correctSlotNotFound(
  manifest: RoutesManifest,
  rootDir: string
): Promise<AutoCorrectStep> {
  try {
    const result = await generateRoutes(manifest, rootDir);

    if (result.success) {
      const slotCount = result.created.filter((f) => f.includes("slots")).length;
      return {
        ruleId: GUARD_RULES.SLOT_NOT_FOUND.id,
        action: "generate-slot",
        success: true,
        message: `Slot 파일 생성 완료 (${slotCount}개 파일)`,
      };
    } else {
      return {
        ruleId: GUARD_RULES.SLOT_NOT_FOUND.id,
        action: "generate-slot",
        success: false,
        message: `Slot 파일 생성 실패: ${result.errors.join(", ")}`,
      };
    }
  } catch (error) {
    return {
      ruleId: GUARD_RULES.SLOT_NOT_FOUND.id,
      action: "generate-slot",
      success: false,
      message: `Slot 파일 생성 실패: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
