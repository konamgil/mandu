/**
 * Mandu 결정론적 해싱 유틸리티 🔐
 *
 * ont-run의 해싱 기법을 참고하여 구현
 * @see DNA/ont-run/src/lockfile/hasher.ts
 *
 * 특징:
 * - 키 순서에 관계없이 동일한 해시 생성 (결정론적)
 * - 비직렬화 요소(함수, Date, BigInt 등) 정규화
 * - 민감 키 제외 옵션
 */

import { createHash } from "node:crypto";

// ============================================
// 타입 정의
// ============================================

export interface HashOptions {
  /** 해시 알고리즘 (기본값: sha256) */
  algorithm?: "sha256";
  /** 해시 길이 (기본값: 16) */
  length?: number;
  /** 해시에서 제외할 키 */
  exclude?: string[];
}

export interface NormalizeOptions {
  /** 제외할 키 패턴 */
  exclude?: string[];
  /** Date를 ISO 문자열로 변환 (기본값: true) */
  dateToIso?: boolean;
  /** BigInt를 문자열로 변환 (기본값: true) */
  bigintToString?: boolean;
  /** Map/Set을 배열로 변환 (기본값: true) */
  collectionToArray?: boolean;
  /** 함수 제거 (기본값: true) */
  removeFunction?: boolean;
  /** Symbol 제거 (기본값: true) */
  removeSymbol?: boolean;
}

// ============================================
// 정규화
// ============================================

/**
 * 객체를 해싱 가능한 형태로 정규화
 *
 * 정규화 규칙:
 * 1. 키를 알파벳 순으로 정렬
 * 2. undefined 키 제거 (JSON.stringify와 동일)
 * 3. 함수, Symbol 제거
 * 4. Date → ISO 문자열
 * 5. BigInt → 문자열 + 'n' 접미사
 * 6. Map → [key, value] 배열
 * 7. Set → 정렬된 배열
 * 8. 순환 참조 감지
 */
export function normalizeForHash(
  value: unknown,
  options: NormalizeOptions = {},
  seen: WeakSet<object> = new WeakSet()
): unknown {
  const {
    exclude = [],
    dateToIso = true,
    bigintToString = true,
    collectionToArray = true,
    removeFunction = true,
    removeSymbol = true,
  } = options;

  // null
  if (value === null) return null;

  // undefined → 제거됨 (반환하지 않음)
  if (value === undefined) return undefined;

  // 원시형
  if (typeof value === "boolean" || typeof value === "number") {
    // NaN, Infinity 처리
    if (Number.isNaN(value)) return "__NaN__";
    if (value === Infinity) return "__Infinity__";
    if (value === -Infinity) return "__-Infinity__";
    return value;
  }

  if (typeof value === "string") {
    return value;
  }

  // BigInt
  if (typeof value === "bigint") {
    return bigintToString ? `${value}n` : value;
  }

  // Symbol
  if (typeof value === "symbol") {
    return removeSymbol ? undefined : `Symbol(${value.description ?? ""})`;
  }

  // 함수
  if (typeof value === "function") {
    return removeFunction ? undefined : `[Function: ${value.name || "anonymous"}]`;
  }

  // 객체 타입 처리
  if (typeof value === "object") {
    // 순환 참조 감지
    if (seen.has(value)) {
      return "__circular__";
    }
    seen.add(value);

    // Date
    if (value instanceof Date) {
      return dateToIso ? value.toISOString() : value;
    }

    // URL
    if (value instanceof URL) {
      return value.href;
    }

    // RegExp
    if (value instanceof RegExp) {
      return value.toString();
    }

    // Error
    if (value instanceof Error) {
      return {
        __type__: "Error",
        name: value.name,
        message: value.message,
      };
    }

    // Map
    if (value instanceof Map) {
      if (!collectionToArray) return value;
      const entries: [unknown, unknown][] = [];
      for (const [k, v] of value.entries()) {
        entries.push([
          normalizeForHash(k, options, seen),
          normalizeForHash(v, options, seen),
        ]);
      }
      // 키로 정렬 (결정론적)
      entries.sort((a, b) => {
        const aKey = toSortableString(a[0]);
        const bKey = toSortableString(b[0]);
        return aKey.localeCompare(bKey);
      });
      return { __type__: "Map", entries };
    }

    // Set
    if (value instanceof Set) {
      if (!collectionToArray) return value;
      const items: unknown[] = [];
      for (const item of value) {
        items.push(normalizeForHash(item, options, seen));
      }
      // 정렬 (결정론적)
      items.sort((a, b) => {
        const aStr = toSortableString(a);
        const bStr = toSortableString(b);
        return aStr.localeCompare(bStr);
      });
      return { __type__: "Set", items };
    }

    // 배열
    if (Array.isArray(value)) {
      return value.map((item) => normalizeForHash(item, options, seen));
    }

    // 일반 객체 - 키 정렬
    const sortedKeys = Object.keys(value).sort();
    const result: Record<string, unknown> = {};

    for (const key of sortedKeys) {
      // 제외 키 체크
      if (exclude.includes(key)) continue;

      const v = (value as Record<string, unknown>)[key];
      const normalized = normalizeForHash(v, options, seen);

      // undefined는 포함하지 않음 (JSON.stringify와 동일)
      if (normalized !== undefined) {
        result[key] = normalized;
      }
    }

    return result;
  }

  return value;
}

// ============================================
// 해싱
// ============================================

/**
 * 설정 객체의 결정론적 해시 계산
 *
 * @example
 * ```typescript
 * const hash1 = computeConfigHash({ a: 1, b: 2 });
 * const hash2 = computeConfigHash({ b: 2, a: 1 });
 * console.log(hash1 === hash2); // true (키 순서 무관)
 * ```
 */
export function computeConfigHash(
  config: unknown,
  options: HashOptions = {}
): string {
  const { algorithm = "sha256", length = 16, exclude = [] } = options;

  // 1. 정규화
  const normalized = normalizeForHash(config, { exclude });

  // 2. JSON 문자열화 (이미 정렬되어 있음)
  // undefined나 함수만 있는 경우 빈 문자열 처리
  const jsonString = normalized === undefined ? "" : JSON.stringify(normalized);

  // 3. 해싱
  const hash = createHash(algorithm).update(jsonString).digest("hex");

  // 4. 길이 조절
  return hash.slice(0, length);
}

/**
 * 설정 무결성 검증
 *
 * @example
 * ```typescript
 * const hash = computeConfigHash(config);
 * // ... 나중에 ...
 * const isValid = verifyConfigIntegrity(config, hash);
 * ```
 */
export function verifyConfigIntegrity(
  config: unknown,
  expectedHash: string,
  options: HashOptions = {}
): boolean {
  const actualHash = computeConfigHash(config, options);
  return actualHash === expectedHash;
}

/**
 * 두 설정의 해시 비교
 */
export function compareConfigHashes(
  config1: unknown,
  config2: unknown,
  options: HashOptions = {}
): { equal: boolean; hash1: string; hash2: string } {
  const hash1 = computeConfigHash(config1, options);
  const hash2 = computeConfigHash(config2, options);

  return {
    equal: hash1 === hash2,
    hash1,
    hash2,
  };
}

// ============================================
// 유틸리티
// ============================================

/**
 * 해싱 가능 여부 체크
 * (정규화 후에도 의미 있는 데이터가 있는지)
 */
export function isHashable(value: unknown): boolean {
  const normalized = normalizeForHash(value);
  return normalized !== undefined;
}

/**
 * 해시 충돌 가능성 경고 (개발용)
 * 16자 해시의 충돌 확률은 매우 낮지만, 디버깅용으로 제공
 */
export function getHashInfo(hash: string): {
  length: number;
  bits: number;
  collisionProbability: string;
} {
  const bits = hash.length * 4; // hex는 문자당 4비트
  // Birthday paradox 근사: sqrt(2^n) 에서 50% 충돌
  const collisionAt = Math.pow(2, bits / 2);

  return {
    length: hash.length,
    bits,
    collisionProbability: `~${collisionAt.toExponential(2)} 해시에서 50% 충돌 가능`,
  };
}

// ============================================
// 내부 유틸
// ============================================

function toSortableString(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (typeof json === "string") return json;
  } catch {
    // ignore
  }
  return String(value);
}
