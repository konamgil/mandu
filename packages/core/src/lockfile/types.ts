/**
 * Mandu Lockfile 타입 정의 🔒
 *
 * ont-run의 lockfile 패턴을 참고
 * @see DNA/ont-run/src/lockfile/types.ts
 * @see docs/plans/08_ont-run_adoption_plan.md - 섹션 3.4
 */

import type { ConfigDiff } from "../utils/differ.js";

// ============================================
// Lockfile 스키마
// ============================================

/**
 * Mandu Lockfile 구조
 *
 * 위치: .mandu/lockfile.json
 */
export interface ManduLockfile {
  /** Lockfile 스키마 버전 (하위 호환성 관리) */
  schemaVersion: 1;

  /** mandu 버전 */
  manduVersion: string;

  /** mandu.config 해시 (16자 hex) */
  configHash: string;

  /** .mcp.json 해시 (선택적) */
  mcpConfigHash?: string;

  /** 생성 시각 (ISO 8601) */
  generatedAt: string;

  /** 생성 환경 */
  environment?: "development" | "production" | "ci";

  /** MCP 서버별 해시 (선택적) */
  mcpServers?: Record<
    string,
    {
      /** 서버 설정 해시 */
      hash: string;
      /** 서버 버전 (있는 경우) */
      version?: string;
    }
  >;

  /** 설정 스냅샷 (선택적, 디버깅용) */
  snapshot?: {
    /** 정규화된 설정 객체 */
    config: Record<string, unknown>;
    /** 스냅샷 생성 환경 */
    environment: string;
  };
}

// ============================================
// 검증 결과
// ============================================

export type LockfileErrorCode =
  | "LOCKFILE_NOT_FOUND"
  | "LOCKFILE_PARSE_ERROR"
  | "LOCKFILE_SCHEMA_MISMATCH"
  | "CONFIG_HASH_MISMATCH"
  | "MCP_CONFIG_HASH_MISMATCH"
  | "MANDU_VERSION_MISMATCH";

export interface LockfileError {
  code: LockfileErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type LockfileWarningCode =
  | "LOCKFILE_OUTDATED"
  | "MCP_SERVER_ADDED"
  | "MCP_SERVER_REMOVED"
  | "SNAPSHOT_MISSING";

export interface LockfileWarning {
  code: LockfileWarningCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface LockfileValidationResult {
  /** 검증 통과 여부 */
  valid: boolean;
  /** 심각한 오류 목록 */
  errors: LockfileError[];
  /** 경고 목록 */
  warnings: LockfileWarning[];
  /** 변경사항 (불일치 시) */
  diff?: ConfigDiff;
  /** 현재 설정 해시 */
  currentHash?: string;
  /** lockfile의 해시 */
  lockedHash?: string;
}

// ============================================
// 환경별 동작 정책
// ============================================

export type LockfileMode = "development" | "build" | "ci" | "production";

export interface LockfilePolicyOptions {
  /** 현재 모드 */
  mode: LockfileMode;
  /** lockfile 불일치 시 동작 */
  onMismatch: "warn" | "error" | "block";
  /** lockfile 없을 때 동작 */
  onMissing: "warn" | "error" | "create" | "block";
  /** 우회 허용 여부 */
  allowBypass: boolean;
}

/**
 * 환경별 기본 정책
 *
 * - dev: 불일치 시 경고만
 * - build/ci: 불일치 시 실패
 * - prod: 불일치 시 서버 시작 차단
 */
export const DEFAULT_POLICIES: Record<LockfileMode, LockfilePolicyOptions> = {
  development: {
    mode: "development",
    onMismatch: "warn",
    onMissing: "warn",
    allowBypass: true,
  },
  build: {
    mode: "build",
    onMismatch: "error",
    onMissing: "error",
    allowBypass: true,
  },
  ci: {
    mode: "ci",
    onMismatch: "error",
    onMissing: "error",
    allowBypass: false,
  },
  production: {
    mode: "production",
    onMismatch: "block",
    onMissing: "block",
    allowBypass: true, // MANDU_LOCK_BYPASS=1로 긴급 우회
  },
};

// ============================================
// 생성 옵션
// ============================================

export interface LockfileGenerateOptions {
  /** mandu 버전 */
  manduVersion?: string;
  /** 환경 */
  environment?: "development" | "production" | "ci";
  /** 스냅샷 포함 여부 */
  includeSnapshot?: boolean;
  /** MCP 서버별 해시 포함 여부 */
  includeMcpServerHashes?: boolean;
}

// ============================================
// 상수
// ============================================

/** Lockfile 기본 경로 */
export const LOCKFILE_PATH = ".mandu/lockfile.json";

/** Lockfile 디렉토리 */
export const LOCKFILE_DIR = ".mandu";

/** 현재 스키마 버전 */
export const LOCKFILE_SCHEMA_VERSION = 1;

/** 우회 환경변수 이름 */
export const BYPASS_ENV_VAR = "MANDU_LOCK_BYPASS";
