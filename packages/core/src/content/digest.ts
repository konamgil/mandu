/**
 * Content Digest - 변경 감지용 해시 생성
 *
 * 콘텐츠의 고유 다이제스트를 생성하여 변경 감지에 사용
 * xxHash 스타일의 빠른 해시 또는 crypto 기반 SHA-256 사용
 */

import { createHash } from "crypto";

/**
 * 다이제스트 옵션
 */
export interface DigestOptions {
  /** 해시 알고리즘 (기본: sha256) */
  algorithm?: "sha256" | "md5" | "sha1";
  /** 출력 길이 (기본: 16) */
  length?: number;
}

const DEFAULT_OPTIONS: DigestOptions = {
  algorithm: "sha256",
  length: 16,
};

/**
 * 데이터에서 다이제스트 생성
 *
 * @example
 * ```ts
 * const digest = generateDigest({ title: "Hello", content: "World" });
 * // → "a1b2c3d4e5f6g7h8"
 * ```
 */
export function generateDigest(data: unknown, options?: DigestOptions): string {
  const { algorithm, length } = { ...DEFAULT_OPTIONS, ...options };

  const serialized = stableStringify(data);
  const hash = createHash(algorithm!);
  hash.update(serialized);

  return hash.digest("hex").slice(0, length);
}

/**
 * 파일 내용에서 다이제스트 생성
 */
export function generateFileDigest(content: string | Buffer, options?: DigestOptions): string {
  const { algorithm, length } = { ...DEFAULT_OPTIONS, ...options };

  const hash = createHash(algorithm!);
  hash.update(content);

  return hash.digest("hex").slice(0, length);
}

/**
 * 여러 소스를 결합한 다이제스트 생성
 *
 * @example
 * ```ts
 * const digest = combineDigests([
 *   generateDigest(frontmatter),
 *   generateFileDigest(body),
 * ]);
 * ```
 */
export function combineDigests(digests: string[], options?: DigestOptions): string {
  const { algorithm, length } = { ...DEFAULT_OPTIONS, ...options };

  const combined = digests.join(":");
  const hash = createHash(algorithm!);
  hash.update(combined);

  return hash.digest("hex").slice(0, length);
}

/**
 * 안정적인 JSON 문자열화 (키 순서 일관성 보장)
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return String(obj);
  }

  if (typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }

  if (obj instanceof Date) {
    return JSON.stringify(obj.toISOString());
  }

  if (obj instanceof Map) {
    const entries = Array.from(obj.entries()).sort(([a], [b]) =>
      String(a).localeCompare(String(b))
    );
    return stableStringify(Object.fromEntries(entries));
  }

  if (obj instanceof Set) {
    return stableStringify(Array.from(obj).sort());
  }

  // 일반 객체: 키를 정렬하여 직렬화
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify((obj as Record<string, unknown>)[key])}`
  );

  return "{" + pairs.join(",") + "}";
}

/**
 * 두 다이제스트 비교
 */
export function digestsMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a === b;
}

/**
 * 다이제스트 기반 변경 감지
 */
export function hasChanged(
  newDigest: string,
  oldDigest: string | undefined
): boolean {
  return !digestsMatch(newDigest, oldDigest);
}
