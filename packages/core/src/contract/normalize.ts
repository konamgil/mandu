/**
 * Mandu Schema Normalization
 * 스키마 기반 데이터 정규화 (보안 + 타입 안전성)
 *
 * 기능:
 * - Strip: 정의되지 않은 필드 제거 (Mass Assignment 방지)
 * - Strict: 정의되지 않은 필드 있으면 에러
 * - Coerce: 타입 자동 변환 (문자열 → 숫자 등)
 *
 * @example
 * ```typescript
 * import { normalizeData, NormalizeMode } from "@mandujs/core/contract";
 *
 * const schema = z.object({ name: z.string(), age: z.number() });
 * const input = { name: "Kim", age: 25, admin: true };
 *
 * // Strip 모드: 정의된 필드만 추출
 * const result = normalizeData(schema, input, { mode: "strip" });
 * // { name: "Kim", age: 25 }
 * ```
 */

import { z, type ZodTypeAny, type ZodObject, type ZodRawShape } from "zod";
import {
  getZodChecks,
  getZodInnerType,
  getZodArrayElementType,
  getZodDefaultValue,
} from "./zod-utils";

/**
 * 정규화 모드
 * - strip: 정의되지 않은 필드 제거 (기본값, 권장)
 * - strict: 정의되지 않은 필드 있으면 에러
 * - passthrough: 모든 필드 허용 (정규화 안 함)
 */
export type NormalizeMode = "strip" | "strict" | "passthrough";

/**
 * 정규화 옵션
 */
export interface NormalizeOptions {
  /**
   * 정규화 모드
   * @default "strip"
   */
  mode?: NormalizeMode;

  /**
   * Query/Params의 타입 자동 변환 (coerce) 활성화
   * URL의 query string과 path params는 항상 문자열이므로
   * 스키마에 정의된 타입으로 자동 변환
   * @default true
   */
  coerceQueryParams?: boolean;

  /**
   * 깊은 정규화 (중첩 객체에도 적용)
   * @default true
   */
  deep?: boolean;
}

/**
 * 전역 기본 정규화 옵션
 */
const DEFAULT_OPTIONS: Required<NormalizeOptions> = {
  mode: "strip",
  coerceQueryParams: true,
  deep: true,
};

/**
 * 전역 옵션 설정
 */
let globalOptions: Required<NormalizeOptions> = { ...DEFAULT_OPTIONS };

/**
 * 전역 정규화 옵션 설정
 *
 * @example
 * ```typescript
 * setNormalizeOptions({
 *   mode: "strict",
 *   coerceQueryParams: true,
 * });
 * ```
 */
export function setNormalizeOptions(options: NormalizeOptions): void {
  globalOptions = { ...DEFAULT_OPTIONS, ...options };
}

/**
 * 현재 전역 옵션 조회
 */
export function getNormalizeOptions(): Required<NormalizeOptions> {
  return { ...globalOptions };
}

/**
 * 전역 옵션 초기화
 */
export function resetNormalizeOptions(): void {
  globalOptions = { ...DEFAULT_OPTIONS };
}

/**
 * ZodObject 스키마에 정규화 모드 적용
 *
 * @param schema - Zod 객체 스키마
 * @param mode - 정규화 모드
 * @returns 모드가 적용된 스키마
 */
export function applyNormalizeMode<T extends ZodRawShape>(
  schema: ZodObject<T>,
  mode: NormalizeMode
): ZodObject<T> {
  switch (mode) {
    case "strip":
      return schema.strip();
    case "strict":
      return schema.strict();
    case "passthrough":
      return schema.passthrough();
    default:
      return schema.strip();
  }
}

/**
 * 스키마가 ZodObject인지 확인
 */
function isZodObject(schema: ZodTypeAny): schema is ZodObject<ZodRawShape> {
  return schema instanceof z.ZodObject;
}

/**
 * 스키마에 정규화 적용
 * ZodObject가 아닌 경우 원본 반환
 *
 * @param schema - Zod 스키마
 * @param options - 정규화 옵션
 * @returns 정규화된 스키마
 */
export function normalizeSchema<T extends ZodTypeAny>(
  schema: T,
  options?: NormalizeOptions
): T {
  const opts = { ...globalOptions, ...options };

  if (!isZodObject(schema)) {
    return schema;
  }

  return applyNormalizeMode(schema, opts.mode) as unknown as T;
}

/**
 * 데이터 정규화 실행
 * 스키마에 정의된 필드만 추출하고 타입 변환
 *
 * @param schema - Zod 스키마
 * @param data - 입력 데이터
 * @param options - 정규화 옵션
 * @returns 정규화된 데이터
 * @throws ZodError - 검증 실패 시
 *
 * @example
 * ```typescript
 * const schema = z.object({ name: z.string(), age: z.number() });
 *
 * // Strip 모드 (기본)
 * normalizeData(schema, { name: "Kim", age: 25, admin: true });
 * // → { name: "Kim", age: 25 }
 *
 * // Strict 모드
 * normalizeData(schema, { name: "Kim", age: 25, admin: true }, { mode: "strict" });
 * // → ZodError: Unrecognized key(s) in object: 'admin'
 * ```
 */
export function normalizeData<T extends ZodTypeAny>(
  schema: T,
  data: unknown,
  options?: NormalizeOptions
): z.infer<T> {
  const normalizedSchema = normalizeSchema(schema, options);
  return normalizedSchema.parse(data);
}

/**
 * 안전한 데이터 정규화 (에러 시 null 반환)
 *
 * @param schema - Zod 스키마
 * @param data - 입력 데이터
 * @param options - 정규화 옵션
 * @returns 정규화 결과
 */
export function safeNormalizeData<T extends ZodTypeAny>(
  schema: T,
  data: unknown,
  options?: NormalizeOptions
): {
  success: true;
  data: z.infer<T>;
} | {
  success: false;
  error: z.ZodError;
} {
  const normalizedSchema = normalizeSchema(schema, options);
  const result = normalizedSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return { success: false, error: result.error };
}

/**
 * Query/Params용 coerce 스키마 생성
 * URL에서 오는 값은 항상 문자열이므로 자동 변환 필요
 *
 * @example
 * ```typescript
 * // 원본 스키마
 * const schema = z.object({
 *   page: z.number(),
 *   active: z.boolean(),
 * });
 *
 * // Coerce 적용
 * const coercedSchema = createCoerceSchema(schema);
 * coercedSchema.parse({ page: "1", active: "true" });
 * // → { page: 1, active: true }
 * ```
 */
export function createCoerceSchema<T extends ZodRawShape>(
  schema: ZodObject<T>
): ZodObject<T> {
  const shape = schema.shape;
  const coercedShape: Record<string, ZodTypeAny> = {};

  for (const [key, value] of Object.entries(shape)) {
    coercedShape[key] = applyCoercion(value as ZodTypeAny);
  }

  return z.object(coercedShape as T);
}

/**
 * 단일 스키마에 coercion 적용
 */
function applyCoercion(schema: ZodTypeAny): ZodTypeAny {
  // ZodNumber → z.coerce.number()
  if (schema instanceof z.ZodNumber) {
    let coerced = z.coerce.number();
    // 기존 체크 유지 (min, max 등)
    const checks = getZodChecks(schema);
    for (const check of checks) {
      switch (check.kind) {
        case "min":
          coerced = check.inclusive
            ? coerced.gte(check.value!)
            : coerced.gt(check.value!);
          break;
        case "max":
          coerced = check.inclusive
            ? coerced.lte(check.value!)
            : coerced.lt(check.value!);
          break;
        case "int":
          coerced = coerced.int();
          break;
      }
    }
    return coerced;
  }

  // ZodBoolean → z.coerce.boolean() 또는 커스텀 변환
  if (schema instanceof z.ZodBoolean) {
    // "true", "false", "1", "0" 처리
    return z.preprocess((val) => {
      if (typeof val === "string") {
        if (val === "true" || val === "1") return true;
        if (val === "false" || val === "0") return false;
      }
      return val;
    }, z.boolean());
  }

  // ZodBigInt → z.coerce.bigint()
  if (schema instanceof z.ZodBigInt) {
    return z.coerce.bigint();
  }

  // ZodDate → z.coerce.date()
  if (schema instanceof z.ZodDate) {
    return z.coerce.date();
  }

  // ZodOptional → 내부 스키마에 coercion 적용
  if (schema instanceof z.ZodOptional) {
    return applyCoercion(getZodInnerType(schema)!).optional();
  }

  // ZodDefault → 내부 스키마에 coercion 적용
  if (schema instanceof z.ZodDefault) {
    const inner = applyCoercion(getZodInnerType(schema)!);
    return inner.default(getZodDefaultValue(schema));
  }

  // ZodNullable → 내부 스키마에 coercion 적용
  if (schema instanceof z.ZodNullable) {
    return applyCoercion(getZodInnerType(schema)!).nullable();
  }

  // ZodArray → 배열 요소에 coercion 적용 (쿼리스트링 배열)
  if (schema instanceof z.ZodArray) {
    return z.array(applyCoercion(getZodArrayElementType(schema)!));
  }

  // 그 외는 원본 반환
  return schema;
}

/**
 * Request 데이터 전체 정규화
 * query, body, params, headers 각각에 적절한 정규화 적용
 */
export interface NormalizedRequestData {
  query?: unknown;
  body?: unknown;
  params?: unknown;
  headers?: unknown;
}

export interface RequestSchemas {
  query?: ZodTypeAny;
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  headers?: ZodTypeAny;
}

/**
 * Request 데이터 정규화
 * - query/params: coerce 적용 (문자열 → 숫자 등)
 * - body: strip/strict 모드 적용
 * - headers: 그대로 검증
 *
 * @param schemas - 각 필드별 스키마
 * @param data - 원본 데이터
 * @param options - 정규화 옵션
 * @returns 정규화된 데이터
 */
export function normalizeRequestData(
  schemas: RequestSchemas,
  data: NormalizedRequestData,
  options?: NormalizeOptions
): NormalizedRequestData {
  const opts = { ...globalOptions, ...options };
  const result: NormalizedRequestData = {};

  // Query: coerce + strip
  if (schemas.query && data.query !== undefined) {
    let querySchema = schemas.query;

    // coerce 적용
    if (opts.coerceQueryParams && isZodObject(querySchema)) {
      querySchema = createCoerceSchema(querySchema);
    }

    // strip/strict 적용
    querySchema = normalizeSchema(querySchema, opts);

    result.query = querySchema.parse(data.query);
  }

  // Params: coerce + strip
  if (schemas.params && data.params !== undefined) {
    let paramsSchema = schemas.params;

    // coerce 적용
    if (opts.coerceQueryParams && isZodObject(paramsSchema)) {
      paramsSchema = createCoerceSchema(paramsSchema);
    }

    // strip/strict 적용
    paramsSchema = normalizeSchema(paramsSchema, opts);

    result.params = paramsSchema.parse(data.params);
  }

  // Body: strip/strict만 적용 (coerce 안 함 - JSON은 타입 보존)
  if (schemas.body && data.body !== undefined) {
    const bodySchema = normalizeSchema(schemas.body, opts);
    result.body = bodySchema.parse(data.body);
  }

  // Headers: 검증만 (정규화 안 함)
  if (schemas.headers && data.headers !== undefined) {
    result.headers = schemas.headers.parse(data.headers);
  }

  return result;
}

/**
 * 타입 유틸리티: 정규화된 데이터 타입 추론
 */
export type NormalizedData<T extends ZodTypeAny> = z.infer<T>;
