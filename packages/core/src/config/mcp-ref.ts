/**
 * Mandu MCP 서버 참조 헬퍼 🔗
 *
 * MCP 서버 설정에 메타데이터를 부착하는 편의 함수들
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { mcpServerRef, sensitiveToken, envValue } from "./mcp-ref";
 *
 * const mcpConfigSchema = z.object({
 *   sequential: mcpServerRef("sequential-thinking"),
 *   apiKey: sensitiveToken(),
 *   baseUrl: envValue("API_BASE_URL", "http://localhost:3000"),
 * });
 * ```
 */

import { z } from "zod";
import { withMetadata, withMetadataMultiple } from "./metadata.js";
import {
  SCHEMA_REFERENCE,
  SENSITIVE_FIELD,
  FIELD_SOURCE,
  PROTECTED_FIELD,
  MCP_SERVER_STATUS,
  RUNTIME_INJECTED,
  type SchemaReferenceMetadata,
  type SensitiveFieldMetadata,
  type FieldSourceMetadata,
  type ProtectedFieldMetadata,
  type McpServerStatusMetadata,
} from "./symbols.js";

// ============================================
// MCP 서버 참조
// ============================================

/**
 * MCP 서버 참조 스키마 생성
 *
 * @param serverName 참조할 MCP 서버 이름
 * @param optional 선택적 참조 여부
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   mcpServer: mcpServerRef("sequential-thinking"),
 * });
 * ```
 */
export function mcpServerRef(
  serverName: string,
  optional: boolean = false
): z.ZodString {
  const schema = z.string();

  return withMetadata(schema, SCHEMA_REFERENCE, {
    type: "mcpServer",
    name: serverName,
    optional,
  } satisfies SchemaReferenceMetadata);
}

/**
 * MCP 서버 상태를 포함한 참조 스키마
 */
export function mcpServerWithStatus(
  serverName: string,
  initialStatus: McpServerStatusMetadata["status"] = "unknown"
): z.ZodString {
  const schema = z.string();

  return withMetadataMultiple(schema, [
    [
      SCHEMA_REFERENCE,
      {
        type: "mcpServer",
        name: serverName,
        optional: false,
      } satisfies SchemaReferenceMetadata,
    ],
    [
      MCP_SERVER_STATUS,
      {
        status: initialStatus,
      } satisfies McpServerStatusMetadata,
    ],
  ]);
}

// ============================================
// 민감 정보 스키마
// ============================================

/**
 * 민감한 토큰/시크릿 스키마
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   apiKey: sensitiveToken(),
 *   password: sensitiveToken("password"),
 * });
 * ```
 */
export function sensitiveToken(
  fieldName?: string
): z.ZodString {
  const schema = z.string();

  return withMetadataMultiple(schema, [
    [
      SENSITIVE_FIELD,
      {
        redactIn: ["log", "diff", "snapshot"],
        mask: "***",
      } satisfies SensitiveFieldMetadata,
    ],
    [
      PROTECTED_FIELD,
      {
        reason: `Sensitive ${fieldName ?? "token"} - should not be modified by AI`,
        allowedModifiers: ["human"],
      } satisfies ProtectedFieldMetadata,
    ],
  ]);
}

/**
 * 선택적 민감 토큰 스키마
 */
export function optionalSensitiveToken(): z.ZodOptional<z.ZodString> {
  return sensitiveToken().optional();
}

// ============================================
// 환경 변수 스키마
// ============================================

/**
 * 환경 변수에서 오는 값 스키마
 *
 * @param envKey 환경 변수 키
 * @param defaultValue 기본값
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   port: envValue("PORT", "3000").transform(Number),
 *   apiUrl: envValue("API_URL"),
 * });
 * ```
 */
export function envValue(
  envKey: string,
  defaultValue?: string
): z.ZodString {
  const schema = z.string();

  return withMetadata(schema, FIELD_SOURCE, {
    source: "env",
    key: envKey,
    fallback: defaultValue,
  } satisfies FieldSourceMetadata);
}

/**
 * 민감한 환경 변수 스키마 (토큰, 비밀키 등)
 */
export function sensitiveEnvValue(envKey: string): z.ZodString {
  const schema = z.string();

  return withMetadataMultiple(schema, [
    [
      FIELD_SOURCE,
      {
        source: "env",
        key: envKey,
      } satisfies FieldSourceMetadata,
    ],
    [
      SENSITIVE_FIELD,
      {
        redactIn: ["log", "diff", "snapshot"],
        mask: "***",
      } satisfies SensitiveFieldMetadata,
    ],
  ]);
}

// ============================================
// 보호된 필드 스키마
// ============================================

/**
 * AI 수정 불가 필드 스키마
 *
 * @param reason 보호 이유
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   securityLevel: protectedField("Security configuration"),
 * });
 * ```
 */
export function protectedField(reason: string): z.ZodString {
  const schema = z.string();

  return withMetadata(schema, PROTECTED_FIELD, {
    reason,
    allowedModifiers: ["human"],
  } satisfies ProtectedFieldMetadata);
}

/**
 * 숫자 타입의 보호된 필드
 */
export function protectedNumber(reason: string): z.ZodNumber {
  const schema = z.number();

  return withMetadata(schema, PROTECTED_FIELD, {
    reason,
    allowedModifiers: ["human"],
  } satisfies ProtectedFieldMetadata);
}

/**
 * 불리언 타입의 보호된 필드
 */
export function protectedBoolean(reason: string): z.ZodBoolean {
  const schema = z.boolean();

  return withMetadata(schema, PROTECTED_FIELD, {
    reason,
    allowedModifiers: ["human"],
  } satisfies ProtectedFieldMetadata);
}

// ============================================
// 런타임 주입 스키마
// ============================================

/**
 * 런타임에 주입되는 값 스키마
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   requestId: runtimeInjected(z.string()),
 *   userId: runtimeInjected(z.string().optional()),
 * });
 * ```
 */
export function runtimeInjected<T extends z.ZodType>(schema: T): T {
  return withMetadata(schema, RUNTIME_INJECTED, true);
}

// ============================================
// 복합 스키마 헬퍼
// ============================================

/**
 * MCP 서버 설정 스키마 생성
 *
 * @example
 * ```typescript
 * const mcpServerSchema = createMcpServerSchema();
 * // { command: string, args?: string[], env?: Record<string, string> }
 * ```
 */
export function createMcpServerSchema() {
  return z.object({
    /** 실행 명령어 */
    command: z.string(),
    /** 명령어 인자 */
    args: z.array(z.string()).optional(),
    /** 환경 변수 */
    env: z.record(z.string()).optional(),
    /** 서버 URL (stdio 대신 HTTP 사용 시) */
    url: z.string().url().optional(),
    /** 버전 */
    version: z.string().optional(),
  });
}

/**
 * 민감 정보가 포함된 MCP 서버 설정 스키마
 */
export function createMcpServerSchemaWithSecrets() {
  return z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z
      .record(
        withMetadata(z.string(), SENSITIVE_FIELD, {
          redactIn: ["log", "diff"],
        })
      )
      .optional(),
    url: z.string().url().optional(),
    token: sensitiveToken("MCP server token").optional(),
    apiKey: sensitiveToken("MCP server API key").optional(),
  });
}

// ============================================
// 유틸리티
// ============================================

/**
 * 스키마가 MCP 서버 참조인지 확인
 */
export function isMcpServerRef(schema: z.ZodType): boolean {
  const ref = (schema as any)[SCHEMA_REFERENCE] as SchemaReferenceMetadata | undefined;
  return ref?.type === "mcpServer";
}

/**
 * 스키마에서 MCP 서버 이름 추출
 */
export function getMcpServerName(schema: z.ZodType): string | undefined {
  const ref = (schema as any)[SCHEMA_REFERENCE] as SchemaReferenceMetadata | undefined;
  return ref?.type === "mcpServer" ? ref.name : undefined;
}

/**
 * 스키마가 민감 필드인지 확인
 */
export function isSensitiveField(schema: z.ZodType): boolean {
  return SENSITIVE_FIELD in (schema as any);
}

/**
 * 스키마가 보호된 필드인지 확인
 */
export function isProtectedField(schema: z.ZodType): boolean {
  return PROTECTED_FIELD in (schema as any);
}

/**
 * 스키마가 환경 변수 기반인지 확인
 */
export function isEnvBasedField(schema: z.ZodType): boolean {
  const source = (schema as any)[FIELD_SOURCE] as FieldSourceMetadata | undefined;
  return source?.source === "env";
}
