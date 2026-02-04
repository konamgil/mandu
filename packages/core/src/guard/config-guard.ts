/**
 * Config Guard - 설정 무결성 검증
 *
 * Lockfile을 사용한 설정 무결성 검증을 Guard 시스템에 통합
 *
 * @see docs/plans/09_lockfile_integration_plan.md
 */

import {
  readLockfile,
  readMcpConfig,
  validateLockfile,
  validateWithPolicy,
  detectMode,
  type ManduLockfile,
  type LockfileValidationResult,
  type LockfileMode,
} from "../lockfile";
import type { ConfigDiff } from "../utils/differ";

// ============================================
// 타입
// ============================================

export interface ConfigGuardError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ConfigGuardWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ConfigGuardResult {
  /** 설정 로드 성공 여부 */
  configValid: boolean;
  /** lockfile 검증 통과 여부 */
  lockfileValid: boolean;
  /** lockfile 존재 여부 */
  lockfileExists: boolean;
  /** 심각한 오류 */
  errors: ConfigGuardError[];
  /** 경고 */
  warnings: ConfigGuardWarning[];
  /** 설정 변경 사항 */
  diff?: ConfigDiff;
  /** 현재 해시 */
  currentHash?: string;
  /** lockfile 해시 */
  lockedHash?: string;
  /** 정책 액션 */
  action: "pass" | "warn" | "error" | "block";
  /** 우회 여부 */
  bypassed: boolean;
}

export interface ConfigGuardOptions {
  /** 검증 모드 (환경 자동 감지가 기본) */
  mode?: LockfileMode;
}

// ============================================
// 메인 함수
// ============================================

/**
 * 설정 무결성 검증 (Guard 통합용)
 *
 * @param rootDir 프로젝트 루트 디렉토리
 * @param config 현재 설정 객체
 * @param options 검증 옵션
 * @returns 검증 결과
 *
 * @example
 * ```typescript
 * const result = await guardConfig(rootDir, config);
 * if (!result.lockfileValid) {
 *   console.error("설정 무결성 검증 실패");
 * }
 * ```
 */
export async function guardConfig(
  rootDir: string,
  config: Record<string, unknown>,
  options: ConfigGuardOptions = {}
): Promise<ConfigGuardResult> {
  const errors: ConfigGuardError[] = [];
  const warnings: ConfigGuardWarning[] = [];

  // 1. Lockfile 읽기
  const lockfile = await readLockfile(rootDir);
  const lockfileExists = lockfile !== null;

  // 1-1. MCP 설정 읽기 (선택)
  let mcpConfig: Record<string, unknown> | null = null;
  try {
    mcpConfig = await readMcpConfig(rootDir);
  } catch (error) {
    warnings.push({
      code: "MCP_CONFIG_PARSE_ERROR",
      message: `MCP 설정 로드 실패: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // 2. 정책 기반 검증
  const mode = options.mode ?? detectMode();
  const { result, action, bypassed } = validateWithPolicy(config, lockfile, mode, mcpConfig);

  // 3. 결과 처리
  if (!lockfileExists) {
    warnings.push({
      code: "LOCKFILE_NOT_FOUND",
      message: "Lockfile이 존재하지 않습니다. 'mandu lock'으로 생성하세요.",
    });
  }

  if (result) {
    // 오류 변환
    for (const error of result.errors) {
      errors.push({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }

    // 경고 변환
    for (const warning of result.warnings) {
      warnings.push({
        code: warning.code,
        message: warning.message,
        details: warning.details,
      });
    }
  }

  return {
    configValid: true,
    lockfileValid: result?.valid ?? false,
    lockfileExists,
    errors,
    warnings,
    diff: result?.diff,
    currentHash: result?.currentHash,
    lockedHash: result?.lockedHash,
    action,
    bypassed,
  };
}

/**
 * 빠른 무결성 검증 (해시만 비교)
 */
export async function quickConfigGuard(
  rootDir: string,
  config: Record<string, unknown>
): Promise<boolean> {
  const lockfile = await readLockfile(rootDir);
  if (!lockfile) return true; // lockfile 없으면 통과
  let mcpConfig: Record<string, unknown> | null = null;
  try {
    mcpConfig = await readMcpConfig(rootDir);
  } catch {
    // ignore
  }

  const result = validateLockfile(config, lockfile, mcpConfig);
  return result.valid;
}

// ============================================
// 포맷팅
// ============================================

/**
 * Config Guard 결과를 콘솔 메시지로 변환
 */
export function formatConfigGuardResult(result: ConfigGuardResult): string {
  const lines: string[] = [];

  if (result.lockfileValid) {
    lines.push("✅ 설정 무결성 확인됨");
    if (result.currentHash) {
      lines.push(`   해시: ${result.currentHash}`);
    }
  } else if (!result.lockfileExists) {
    lines.push("💡 Lockfile 없음");
    lines.push("   'mandu lock'으로 생성 권장");
  } else {
    lines.push("❌ 설정 무결성 검증 실패");

    for (const error of result.errors) {
      lines.push(`   🔴 ${error.message}`);
    }
  }

  if (result.warnings.length > 0 && result.lockfileExists) {
    lines.push("");
    lines.push("   경고:");
    for (const warning of result.warnings) {
      lines.push(`   ⚠️  ${warning.message}`);
    }
  }

  if (result.bypassed) {
    lines.push("");
    lines.push("   ⚡ MANDU_LOCK_BYPASS=1로 우회됨");
  }

  return lines.join("\n");
}

/**
 * Config Guard 결과를 JSON으로 변환 (에이전트용)
 */
export function formatConfigGuardAsJSON(result: ConfigGuardResult): string {
  return JSON.stringify(
    {
      ok: result.lockfileValid,
      lockfileExists: result.lockfileExists,
      action: result.action,
      bypassed: result.bypassed,
      currentHash: result.currentHash,
      lockedHash: result.lockedHash,
      errors: result.errors,
      warnings: result.warnings,
      hasDiff: result.diff?.hasChanges ?? false,
    },
    null,
    2
  );
}

// ============================================
// 통합 헬스 체크
// ============================================

export interface UnifiedHealthResult {
  /** 전체 통과 여부 */
  ok: boolean;
  /** 건강 점수 (0-100) */
  healthScore: number;
  /** 아키텍처 검증 */
  architecture: {
    violations: number;
    errors: number;
    warnings: number;
  };
  /** 설정 검증 */
  config: ConfigGuardResult;
}

/**
 * 통합 헬스 점수 계산
 */
export function calculateHealthScore(
  archViolations: number,
  archErrors: number,
  configResult: ConfigGuardResult
): number {
  let score = 100;

  // 아키텍처 위반 감점
  score -= archErrors * 10;
  score -= (archViolations - archErrors) * 2;

  // 설정 무결성 감점
  if (!configResult.lockfileExists) {
    score -= 5; // lockfile 없음
  } else if (!configResult.lockfileValid) {
    score -= 20; // 불일치
  }

  // 경고 감점
  score -= configResult.warnings.length * 1;

  return Math.max(0, Math.min(100, score));
}
