/**
 * Zod Internal Access Utilities
 *
 * Zod 스키마의 내부 `_def` 속성에 접근하는 로직을 중앙화합니다.
 * `as any` 캐스팅은 이 파일 내부에만 존재하며,
 * 외부에는 타입 안전한 API만 노출합니다.
 */

import type { ZodTypeAny } from "zod";

// ============================================================================
// Internal _def access (as any is confined here)
// ============================================================================

interface ZodDef {
  typeName: string;
  innerType?: ZodTypeAny;
  type?: ZodTypeAny;
  schema?: ZodTypeAny;
  shape?: () => Record<string, ZodTypeAny>;
  checks?: ReadonlyArray<{ kind: string; value?: number; inclusive?: boolean; regex?: RegExp }>;
  values?: readonly unknown[];
  options?: readonly ZodTypeAny[];
  value?: unknown;
  defaultValue?: () => unknown;
  description?: string;
}

/**
 * Zod 스키마의 내부 _def 속성을 안전하게 추출합니다.
 */
function getDef(schema: ZodTypeAny): ZodDef {
  return (schema as any)._def;
}

// ============================================================================
// Type Name
// ============================================================================

/** Zod 스키마의 typeName을 반환합니다. */
export function getZodTypeName(schema: ZodTypeAny): string {
  return getDef(schema).typeName;
}

// ============================================================================
// Inner Type Access
// ============================================================================

/**
 * ZodOptional, ZodNullable, ZodDefault 등 래퍼 스키마의 내부 타입을 반환합니다.
 * `_def.innerType`에 해당합니다.
 */
export function getZodInnerType(schema: ZodTypeAny): ZodTypeAny | undefined {
  return getDef(schema).innerType;
}

/**
 * ZodArray의 요소 타입을 반환합니다.
 * `_def.type`에 해당합니다.
 */
export function getZodArrayElementType(schema: ZodTypeAny): ZodTypeAny | undefined {
  return getDef(schema).type;
}

/**
 * ZodEffects의 내부 스키마를 반환합니다.
 * `_def.schema`에 해당합니다.
 */
export function getZodEffectsSchema(schema: ZodTypeAny): ZodTypeAny | undefined {
  return getDef(schema).schema;
}

// ============================================================================
// Object Shape
// ============================================================================

/**
 * ZodObject의 shape를 반환합니다.
 * `_def.shape()`에 해당합니다.
 */
export function getZodObjectShape(schema: ZodTypeAny): Record<string, ZodTypeAny> | undefined {
  const def = getDef(schema);
  return typeof def.shape === "function" ? def.shape() : undefined;
}

// ============================================================================
// Checks (validation rules)
// ============================================================================

interface ZodCheck {
  kind: string;
  value?: number;
  inclusive?: boolean;
  regex?: RegExp;
}

/**
 * ZodString, ZodNumber 등의 validation checks를 반환합니다.
 * `_def.checks`에 해당합니다.
 */
export function getZodChecks(schema: ZodTypeAny): readonly ZodCheck[] {
  return getDef(schema).checks ?? [];
}

// ============================================================================
// Enum / Literal / Union
// ============================================================================

/** ZodEnum의 values를 반환합니다. */
export function getZodEnumValues(schema: ZodTypeAny): readonly unknown[] | undefined {
  return getDef(schema).values;
}

/** ZodUnion의 options를 반환합니다. */
export function getZodUnionOptions(schema: ZodTypeAny): readonly ZodTypeAny[] | undefined {
  return getDef(schema).options;
}

/** ZodLiteral의 value를 반환합니다. */
export function getZodLiteralValue(schema: ZodTypeAny): unknown {
  return getDef(schema).value;
}

// ============================================================================
// Default Value
// ============================================================================

/**
 * ZodDefault의 기본값을 반환합니다.
 * `_def.defaultValue()`에 해당합니다.
 */
export function getZodDefaultValue(schema: ZodTypeAny): unknown {
  const fn = getDef(schema).defaultValue;
  return typeof fn === "function" ? fn() : undefined;
}

// ============================================================================
// Type Predicates
// ============================================================================

/** 스키마가 ZodOptional인지 확인합니다. */
export function isZodOptional(schema: ZodTypeAny): boolean {
  return getZodTypeName(schema) === "ZodOptional";
}

/** 스키마가 ZodDefault인지 확인합니다. */
export function isZodDefault(schema: ZodTypeAny): boolean {
  return getZodTypeName(schema) === "ZodDefault";
}

/** 필드가 required인지 확인합니다 (Optional/Default가 아닌 경우). */
export function isZodRequired(schema: ZodTypeAny): boolean {
  const typeName = getZodTypeName(schema);
  return typeName !== "ZodOptional" && typeName !== "ZodDefault";
}
