/**
 * Mandu Symbol 상수 정의 🔣
 *
 * ont-run의 Symbol 기반 메타데이터 패턴 참고
 * @see DNA/ont-run/src/config/categorical.ts
 * @see docs/plans/08_ont-run_adoption_plan.md - 섹션 3.2
 *
 * Symbol.for()를 사용하여 전역 심볼 레지스트리에 등록
 * → 모듈 간에도 동일한 심볼 공유 가능
 */

// ============================================
// 메타데이터 심볼
// ============================================

/**
 * MCP 서버 상태 메타데이터
 * - connected, disconnected, error 등
 */
export const MCP_SERVER_STATUS = Symbol.for("mandu:mcpServerStatus");

/**
 * 검증 컨텍스트 메타데이터
 * - 커스텀 검증 규칙, 에러 메시지 등
 */
export const VALIDATION_CONTEXT = Symbol.for("mandu:validationContext");

/**
 * 스키마 참조 메타데이터
 * - 다른 스키마/함수 참조
 */
export const SCHEMA_REFERENCE = Symbol.for("mandu:schemaReference");

/**
 * 필드 소스 메타데이터
 * - 필드 값의 출처 (env, config, default 등)
 */
export const FIELD_SOURCE = Symbol.for("mandu:fieldSource");

/**
 * 민감 정보 마커
 * - 로깅/출력 시 마스킹 필요
 */
export const SENSITIVE_FIELD = Symbol.for("mandu:sensitiveField");

/**
 * 보호된 필드 마커
 * - AI 에이전트 수정 불가
 */
export const PROTECTED_FIELD = Symbol.for("mandu:protectedField");

/**
 * 기본값 출처 메타데이터
 * - 기본값이 어디서 왔는지 추적
 */
export const DEFAULT_SOURCE = Symbol.for("mandu:defaultSource");

/**
 * 런타임 주입 메타데이터
 * - 런타임에 주입되는 값 표시
 */
export const RUNTIME_INJECTED = Symbol.for("mandu:runtimeInjected");

// ============================================
// 타입 정의
// ============================================

export interface McpServerStatusMetadata {
  status: "connected" | "disconnected" | "error" | "unknown";
  lastChecked?: string;
  error?: string;
}

export interface ValidationContextMetadata {
  customMessage?: string;
  severity?: "error" | "warning" | "info";
  autoFix?: boolean;
}

export interface SchemaReferenceMetadata {
  type: "mcpServer" | "function" | "schema" | "env";
  name: string;
  optional?: boolean;
}

export interface FieldSourceMetadata {
  source: "env" | "config" | "default" | "computed" | "injected";
  key?: string;
  fallback?: unknown;
}

export interface SensitiveFieldMetadata {
  redactIn: ("log" | "diff" | "snapshot")[];
  mask?: string;
}

export interface ProtectedFieldMetadata {
  reason: string;
  allowedModifiers?: string[];
}

// ============================================
// 심볼-타입 매핑
// ============================================

export type SymbolMetadataMap = {
  [MCP_SERVER_STATUS]: McpServerStatusMetadata;
  [VALIDATION_CONTEXT]: ValidationContextMetadata;
  [SCHEMA_REFERENCE]: SchemaReferenceMetadata;
  [FIELD_SOURCE]: FieldSourceMetadata;
  [SENSITIVE_FIELD]: SensitiveFieldMetadata;
  [PROTECTED_FIELD]: ProtectedFieldMetadata;
  [DEFAULT_SOURCE]: string;
  [RUNTIME_INJECTED]: boolean;
};

// ============================================
// 심볼 목록 (순회용)
// ============================================

export const ALL_METADATA_SYMBOLS = [
  MCP_SERVER_STATUS,
  VALIDATION_CONTEXT,
  SCHEMA_REFERENCE,
  FIELD_SOURCE,
  SENSITIVE_FIELD,
  PROTECTED_FIELD,
  DEFAULT_SOURCE,
  RUNTIME_INJECTED,
] as const;

/**
 * 심볼이 mandu 메타데이터 심볼인지 확인
 */
export function isManduMetadataSymbol(sym: symbol): boolean {
  return ALL_METADATA_SYMBOLS.includes(sym as any);
}

/**
 * 심볼 이름 가져오기 (디버깅용)
 */
export function getSymbolName(sym: symbol): string | undefined {
  return sym.description?.replace("mandu:", "");
}
