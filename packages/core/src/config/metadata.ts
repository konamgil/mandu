/**
 * Mandu Symbol 메타데이터 유틸리티 🏷️
 *
 * Zod 스키마에 메타데이터를 부착하고 조회하는 유틸리티
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { withMetadata, getMetadata, SENSITIVE_FIELD } from "./metadata";
 *
 * const tokenSchema = withMetadata(
 *   z.string(),
 *   SENSITIVE_FIELD,
 *   { redactIn: ["log", "diff"] }
 * );
 *
 * const metadata = getMetadata(tokenSchema, SENSITIVE_FIELD);
 * // { redactIn: ["log", "diff"] }
 * ```
 */

import type { z } from "zod";
import {
  type SymbolMetadataMap,
  ALL_METADATA_SYMBOLS,
  isManduMetadataSymbol,
  SENSITIVE_FIELD,
  PROTECTED_FIELD,
  FIELD_SOURCE,
  SCHEMA_REFERENCE,
  VALIDATION_CONTEXT,
} from "./symbols.js";

// ============================================
// 타입 안전한 Symbol 프로퍼티 접근 유틸리티
// ============================================

/**
 * SchemaRecord: Zod 스키마를 symbol 키 접근 가능한 레코드로 변환.
 * `as any` 캐스팅을 이 한 곳에서만 수행하여 나머지 코드의 타입 안전성을 보장.
 */
type SchemaRecord = Record<symbol, unknown>;

function asRecord(schema: z.ZodType): SchemaRecord {
  return schema as unknown as SchemaRecord;
}

// ============================================
// 메타데이터 부착
// ============================================

/**
 * Zod 스키마에 메타데이터 부착
 *
 * @param schema Zod 스키마
 * @param key 메타데이터 심볼 키
 * @param value 메타데이터 값
 * @returns 메타데이터가 부착된 스키마 (원본 수정)
 *
 * @example
 * ```typescript
 * const schema = withMetadata(
 *   z.string(),
 *   SENSITIVE_FIELD,
 *   { redactIn: ["log"] }
 * );
 * ```
 */
export function withMetadata<
  T extends z.ZodType,
  K extends keyof SymbolMetadataMap,
>(
  schema: T,
  key: K,
  value: SymbolMetadataMap[K]
): T {
  asRecord(schema)[key] = value;
  return schema;
}

/**
 * 여러 메타데이터를 한 번에 부착
 *
 * @example
 * ```typescript
 * const schema = withMetadataMultiple(z.string(), [
 *   [SENSITIVE_FIELD, { redactIn: ["log"] }],
 *   [PROTECTED_FIELD, { reason: "Security" }],
 * ]);
 * ```
 */
export function withMetadataMultiple<T extends z.ZodType>(
  schema: T,
  entries: Array<[symbol, unknown]>
): T {
  const record = asRecord(schema);
  for (const [key, value] of entries) {
    record[key] = value;
  }
  return schema;
}

// ============================================
// 메타데이터 조회
// ============================================

/**
 * 스키마에서 메타데이터 조회
 *
 * @param schema Zod 스키마
 * @param key 메타데이터 심볼 키
 * @returns 메타데이터 값 또는 undefined
 */
export function getMetadata<K extends keyof SymbolMetadataMap>(
  schema: z.ZodType,
  key: K
): SymbolMetadataMap[K] | undefined {
  return asRecord(schema)[key] as SymbolMetadataMap[K] | undefined;
}

/**
 * 스키마에 특정 메타데이터가 있는지 확인
 */
export function hasMetadata(schema: z.ZodType, key: symbol): boolean {
  return key in asRecord(schema);
}

/**
 * 스키마의 모든 mandu 메타데이터 조회
 */
export function getAllMetadata(
  schema: z.ZodType
): Partial<SymbolMetadataMap> {
  const result = {} as Record<symbol, unknown>;
  const record = asRecord(schema);

  for (const sym of ALL_METADATA_SYMBOLS) {
    if (sym in record) {
      result[sym] = record[sym];
    }
  }

  return result as Partial<SymbolMetadataMap>;
}

// ============================================
// 메타데이터 제거
// ============================================

/**
 * 스키마에서 메타데이터 제거
 */
export function removeMetadata<T extends z.ZodType>(
  schema: T,
  key: symbol
): T {
  delete asRecord(schema)[key];
  return schema;
}

/**
 * 스키마에서 모든 mandu 메타데이터 제거
 */
export function clearAllMetadata<T extends z.ZodType>(schema: T): T {
  const record = asRecord(schema);
  for (const sym of ALL_METADATA_SYMBOLS) {
    if (sym in record) {
      delete record[sym];
    }
  }
  return schema;
}

// ============================================
// 메타데이터 복사
// ============================================

/**
 * 한 스키마의 메타데이터를 다른 스키마로 복사
 */
export function copyMetadata<T extends z.ZodType>(
  from: z.ZodType,
  to: T
): T {
  const fromRecord = asRecord(from);
  const toRecord = asRecord(to);
  for (const sym of ALL_METADATA_SYMBOLS) {
    if (sym in fromRecord) {
      toRecord[sym] = fromRecord[sym];
    }
  }
  return to;
}

// ============================================
// 스키마 체인 헬퍼
// ============================================

/**
 * 메타데이터와 함께 스키마를 체이닝하기 위한 빌더
 *
 * @example
 * ```typescript
 * const schema = schemaWithMeta(z.string())
 *   .sensitive({ redactIn: ["log"] })
 *   .protected({ reason: "Security" })
 *   .build();
 * ```
 */
export function schemaWithMeta<T extends z.ZodType>(schema: T) {
  return new SchemaMetaBuilder(schema);
}

class SchemaMetaBuilder<T extends z.ZodType> {
  constructor(private schema: T) {}

  /**
   * 민감 필드로 마킹
   */
  sensitive(meta: SymbolMetadataMap[typeof SENSITIVE_FIELD]) {
    withMetadata(this.schema, SENSITIVE_FIELD, meta);
    return this;
  }

  /**
   * 보호된 필드로 마킹
   */
  protected(meta: SymbolMetadataMap[typeof PROTECTED_FIELD]) {
    withMetadata(this.schema, PROTECTED_FIELD, meta);
    return this;
  }

  /**
   * 필드 소스 설정
   */
  source(meta: SymbolMetadataMap[typeof FIELD_SOURCE]) {
    withMetadata(this.schema, FIELD_SOURCE, meta);
    return this;
  }

  /**
   * 스키마 참조 설정
   */
  ref(meta: SymbolMetadataMap[typeof SCHEMA_REFERENCE]) {
    withMetadata(this.schema, SCHEMA_REFERENCE, meta);
    return this;
  }

  /**
   * 검증 컨텍스트 설정
   */
  validation(meta: SymbolMetadataMap[typeof VALIDATION_CONTEXT]) {
    withMetadata(this.schema, VALIDATION_CONTEXT, meta);
    return this;
  }

  /**
   * 커스텀 메타데이터 추가
   */
  meta<K extends keyof SymbolMetadataMap>(key: K, value: SymbolMetadataMap[K]) {
    withMetadata(this.schema, key, value);
    return this;
  }

  /**
   * 스키마 반환
   */
  build(): T {
    return this.schema;
  }
}

// ============================================
// 유틸리티
// ============================================

/**
 * 객체의 모든 Symbol 키 가져오기
 */
export function getSymbolKeys(obj: object): symbol[] {
  return Object.getOwnPropertySymbols(obj);
}

/**
 * mandu 메타데이터 심볼만 필터링
 */
export function getManduSymbolKeys(obj: object): symbol[] {
  return getSymbolKeys(obj).filter(isManduMetadataSymbol);
}

/**
 * 스키마에 메타데이터가 있는지 확인
 */
export function hasAnyMetadata(schema: z.ZodType): boolean {
  return getManduSymbolKeys(schema as object).length > 0;
}

/**
 * 메타데이터를 일반 객체로 직렬화 (디버깅용)
 */
export function serializeMetadata(
  schema: z.ZodType
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const record = asRecord(schema);

  for (const sym of getManduSymbolKeys(schema as object)) {
    const name = sym.description ?? sym.toString();
    result[name] = record[sym];
  }

  return result;
}
