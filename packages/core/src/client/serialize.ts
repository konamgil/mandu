/**
 * Mandu Props Serialization 📦
 * Fresh 스타일 고급 직렬화/역직렬화
 *
 * @see https://fresh.deno.dev/docs/concepts/islands
 *
 * 지원 타입:
 * - 원시형: null, boolean, number, string, bigint, undefined
 * - 특수 객체: Date, URL, RegExp, Map, Set
 * - 순환 참조
 * - 중첩 객체/배열
 */

// ============================================
// 타입 마커
// ============================================

const TYPE_MARKERS = {
  /** undefined */
  UNDEFINED: "\x00_",
  /** Date */
  DATE: "\x00D",
  /** URL */
  URL: "\x00U",
  /** RegExp */
  REGEXP: "\x00R",
  /** Map */
  MAP: "\x00M",
  /** Set */
  SET: "\x00S",
  /** 순환 참조 */
  REF: "\x00$",
  /** BigInt */
  BIGINT: "\x00B",
  /** Symbol (제한적 지원) */
  SYMBOL: "\x00Y",
  /** Error */
  ERROR: "\x00E",
} as const;

// ============================================
// 직렬화
// ============================================

/**
 * 직렬화 컨텍스트 (순환 참조 추적)
 */
interface SerializeContext {
  /** 이미 본 객체 → 인덱스 */
  seen: Map<object, number>;
  /** 참조 테이블 */
  refs: object[];
}

/**
 * Props 직렬화
 *
 * @example
 * ```typescript
 * const props = {
 *   date: new Date(),
 *   url: new URL('https://example.com'),
 *   items: new Set([1, 2, 3]),
 *   cache: new Map([['key', 'value']]),
 * };
 *
 * const json = serializeProps(props);
 * // 클라이언트로 전송
 * ```
 */
export function serializeProps(props: Record<string, unknown>): string {
  const ctx: SerializeContext = { seen: new Map(), refs: [] };
  return JSON.stringify(serialize(props, ctx));
}

/**
 * 값 직렬화 (재귀)
 */
function serialize(value: unknown, ctx: SerializeContext): unknown {
  // null
  if (value === null) return null;

  // undefined
  if (value === undefined) return TYPE_MARKERS.UNDEFINED;

  // 원시형
  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    // 타입 마커와 충돌 방지 (첫 문자가 \x00인 경우)
    if (value.startsWith("\x00")) {
      return "\x00\x00" + value;
    }
    return value;
  }

  if (typeof value === "bigint") {
    return TYPE_MARKERS.BIGINT + value.toString();
  }

  if (typeof value === "symbol") {
    // Symbol은 description만 보존
    return TYPE_MARKERS.SYMBOL + (value.description ?? "");
  }

  // 함수는 직렬화 불가
  if (typeof value === "function") {
    console.warn("[Mandu Serialize] Functions cannot be serialized, skipping");
    return undefined;
  }

  // 객체 순환 참조 체크
  if (typeof value === "object") {
    const existing = ctx.seen.get(value);
    if (existing !== undefined) {
      return TYPE_MARKERS.REF + existing;
    }

    const idx = ctx.refs.length;
    ctx.seen.set(value, idx);
    ctx.refs.push(value);
  }

  // Date
  if (value instanceof Date) {
    return TYPE_MARKERS.DATE + value.toISOString();
  }

  // URL
  if (value instanceof URL) {
    return TYPE_MARKERS.URL + value.href;
  }

  // RegExp
  if (value instanceof RegExp) {
    return TYPE_MARKERS.REGEXP + value.toString();
  }

  // Error
  if (value instanceof Error) {
    return [
      TYPE_MARKERS.ERROR,
      value.name,
      value.message,
      value.stack ?? "",
    ];
  }

  // Map
  if (value instanceof Map) {
    const entries: [unknown, unknown][] = [];
    for (const [k, v] of value.entries()) {
      entries.push([serialize(k, ctx), serialize(v, ctx)]);
    }
    return [TYPE_MARKERS.MAP, ...entries];
  }

  // Set
  if (value instanceof Set) {
    const items: unknown[] = [];
    for (const item of value) {
      items.push(serialize(item, ctx));
    }
    return [TYPE_MARKERS.SET, ...items];
  }

  // 배열
  if (Array.isArray(value)) {
    return value.map((item) => serialize(item, ctx));
  }

  // 일반 객체
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as object)) {
    const serialized = serialize(v, ctx);
    if (serialized !== undefined) {
      result[k] = serialized;
    }
  }
  return result;
}

// ============================================
// 역직렬화
// ============================================

/**
 * 역직렬화 컨텍스트 (순환 참조 복원)
 */
interface DeserializeContext {
  refs: unknown[];
}

/**
 * Props 역직렬화
 *
 * @example
 * ```typescript
 * // 서버에서 받은 JSON
 * const json = '{"date":"\x00D2025-01-28T00:00:00.000Z"}';
 *
 * const props = deserializeProps(json);
 * console.log(props.date instanceof Date); // true
 * ```
 */
export function deserializeProps(json: string): Record<string, unknown> {
  const ctx: DeserializeContext = { refs: [] };
  const parsed = JSON.parse(json);
  return deserialize(parsed, ctx) as Record<string, unknown>;
}

/**
 * 값 역직렬화 (재귀)
 */
function deserialize(value: unknown, ctx: DeserializeContext): unknown {
  // null
  if (value === null) return null;

  // 문자열 → 타입 마커 체크
  if (typeof value === "string") {
    // undefined
    if (value === TYPE_MARKERS.UNDEFINED) return undefined;

    // 이스케이프된 문자열 (\x00\x00 → \x00)
    if (value.startsWith("\x00\x00")) {
      return value.slice(2);
    }

    // Date
    if (value.startsWith(TYPE_MARKERS.DATE)) {
      return new Date(value.slice(2));
    }

    // URL
    if (value.startsWith(TYPE_MARKERS.URL)) {
      return new URL(value.slice(2));
    }

    // RegExp
    if (value.startsWith(TYPE_MARKERS.REGEXP)) {
      const str = value.slice(2);
      const match = str.match(/^\/(.*)\/([gimsuy]*)$/);
      if (match) {
        return new RegExp(match[1], match[2]);
      }
      return str; // 파싱 실패 시 문자열 반환
    }

    // BigInt
    if (value.startsWith(TYPE_MARKERS.BIGINT)) {
      return BigInt(value.slice(2));
    }

    // Symbol
    if (value.startsWith(TYPE_MARKERS.SYMBOL)) {
      return Symbol(value.slice(2));
    }

    // 순환 참조
    if (value.startsWith(TYPE_MARKERS.REF)) {
      const idx = parseInt(value.slice(2), 10);
      return ctx.refs[idx];
    }

    return value;
  }

  // 원시형
  if (typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  // 배열 → 특수 타입 체크
  if (Array.isArray(value)) {
    const marker = value[0];

    // Error
    if (marker === TYPE_MARKERS.ERROR) {
      const [, name, message, stack] = value as [string, string, string, string];
      const error = new Error(message);
      error.name = name;
      if (stack) error.stack = stack;
      ctx.refs.push(error);
      return error;
    }

    // Map
    if (marker === TYPE_MARKERS.MAP) {
      const map = new Map();
      ctx.refs.push(map);
      for (let i = 1; i < value.length; i++) {
        const [k, v] = value[i] as [unknown, unknown];
        map.set(deserialize(k, ctx), deserialize(v, ctx));
      }
      return map;
    }

    // Set
    if (marker === TYPE_MARKERS.SET) {
      const set = new Set();
      ctx.refs.push(set);
      for (let i = 1; i < value.length; i++) {
        set.add(deserialize(value[i], ctx));
      }
      return set;
    }

    // 일반 배열
    const arr: unknown[] = [];
    ctx.refs.push(arr);
    for (const item of value) {
      arr.push(deserialize(item, ctx));
    }
    return arr;
  }

  // 일반 객체
  if (typeof value === "object") {
    const obj: Record<string, unknown> = {};
    ctx.refs.push(obj);
    for (const [k, v] of Object.entries(value)) {
      obj[k] = deserialize(v, ctx);
    }
    return obj;
  }

  return value;
}

// ============================================
// 유틸리티
// ============================================

/**
 * 직렬화 가능 여부 체크
 */
export function isSerializable(value: unknown): boolean {
  if (value === null || value === undefined) return true;

  const type = typeof value;
  if (type === "boolean" || type === "number" || type === "string" || type === "bigint") {
    return true;
  }

  if (type === "function" || type === "symbol") {
    return false;
  }

  if (value instanceof Date || value instanceof URL || value instanceof RegExp) {
    return true;
  }

  if (value instanceof Map || value instanceof Set) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isSerializable);
  }

  if (type === "object") {
    return Object.values(value as object).every(isSerializable);
  }

  return false;
}

/**
 * SSR에서 클라이언트로 props 전달용 스크립트 생성
 */
export function generatePropsScript(
  islandId: string,
  props: Record<string, unknown>
): string {
  const json = serializeProps(props);
  const escaped = json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return `<script type="application/json" data-mandu-props="${islandId}">${escaped}</script>`;
}

/**
 * 클라이언트에서 props 스크립트 파싱
 */
export function parsePropsScript(islandId: string): Record<string, unknown> | null {
  if (typeof document === "undefined") return null;

  const script = document.querySelector(
    `script[data-mandu-props="${islandId}"]`
  ) as HTMLScriptElement | null;

  if (!script?.textContent) return null;

  try {
    return deserializeProps(script.textContent);
  } catch (err) {
    console.error(`[Mandu] Failed to parse props for island ${islandId}:`, err);
    return null;
  }
}
