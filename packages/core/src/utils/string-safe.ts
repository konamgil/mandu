/**
 * DNA-005: UTF-16 Safe String Utilities
 *
 * 이모지, 특수 문자 등 서로게이트 쌍을 안전하게 처리
 * - 문자열 슬라이싱 시 깨짐 방지
 * - 에러 메시지 트렁케이션
 * - 로그 메시지 제한
 */

/**
 * High Surrogate 범위 체크 (U+D800 ~ U+DBFF)
 */
function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

/**
 * Low Surrogate 범위 체크 (U+DC00 ~ U+DFFF)
 */
function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

/**
 * UTF-16 안전 문자열 슬라이싱
 *
 * 서로게이트 쌍 경계에서 잘리지 않도록 보호
 *
 * @example
 * ```ts
 * // 이모지 포함 문자열
 * const text = "Hello 👋 World";
 *
 * // 일반 slice는 이모지를 깨뜨릴 수 있음
 * text.slice(0, 7); // "Hello �" (깨짐)
 *
 * // 안전한 슬라이싱
 * sliceUtf16Safe(text, 0, 7); // "Hello " (이모지 제외)
 * sliceUtf16Safe(text, 0, 8); // "Hello 👋" (이모지 포함)
 * ```
 */
export function sliceUtf16Safe(
  input: string,
  start: number,
  end?: number
): string {
  const len = input.length;
  let from = Math.max(0, start);
  let to = end === undefined ? len : Math.min(len, end);

  // 시작 위치가 Low Surrogate면 건너뛰기
  if (from > 0 && from < len) {
    const codeUnit = input.charCodeAt(from);
    if (isLowSurrogate(codeUnit) && isHighSurrogate(input.charCodeAt(from - 1))) {
      from += 1;
    }
  }

  // 끝 위치가 Low Surrogate면 제외
  if (to > 0 && to < len) {
    const codeUnit = input.charCodeAt(to);
    if (isLowSurrogate(codeUnit) && isHighSurrogate(input.charCodeAt(to - 1))) {
      to -= 1;
    }
  }

  return input.slice(from, to);
}

/**
 * 트렁케이션 옵션
 */
export interface TruncateOptions {
  /** 최대 길이 (기본: 100) */
  maxLength?: number;
  /** 생략 표시 (기본: "...") */
  ellipsis?: string;
  /** 단어 경계에서 자르기 */
  wordBoundary?: boolean;
  /** 트렁케이션 위치 */
  position?: "end" | "middle" | "start";
}

/**
 * 문자열 안전 트렁케이션
 *
 * @example
 * ```ts
 * truncateSafe("Hello World! 👋🌍", { maxLength: 12 });
 * // → "Hello Wor..."
 *
 * truncateSafe("Hello World! 👋🌍", { maxLength: 12, wordBoundary: true });
 * // → "Hello..."
 *
 * truncateSafe("Hello World!", { maxLength: 8, position: "middle" });
 * // → "Hel...d!"
 * ```
 */
export function truncateSafe(
  input: string,
  options: TruncateOptions = {}
): string {
  const {
    maxLength = 100,
    ellipsis = "...",
    wordBoundary = false,
    position = "end",
  } = options;

  // 이미 짧으면 그대로 반환
  if (input.length <= maxLength) {
    return input;
  }

  const ellipsisLen = ellipsis.length;
  const availableLen = maxLength - ellipsisLen;

  if (availableLen <= 0) {
    return ellipsis.slice(0, maxLength);
  }

  switch (position) {
    case "start": {
      const start = input.length - availableLen;
      let result = sliceUtf16Safe(input, start);
      return ellipsis + result;
    }

    case "middle": {
      const halfLen = Math.floor(availableLen / 2);
      const firstHalf = sliceUtf16Safe(input, 0, halfLen);
      const secondHalf = sliceUtf16Safe(input, input.length - halfLen);
      return firstHalf + ellipsis + secondHalf;
    }

    case "end":
    default: {
      let result = sliceUtf16Safe(input, 0, availableLen);

      if (wordBoundary) {
        // 마지막 공백 찾기
        const lastSpace = result.lastIndexOf(" ");
        if (lastSpace > 0) {
          result = result.slice(0, lastSpace);
        }
      }

      return result + ellipsis;
    }
  }
}

/**
 * 문자열 길이 (코드 포인트 기준)
 *
 * @example
 * ```ts
 * "👋".length;           // 2 (UTF-16 코드 유닛)
 * lengthInCodePoints("👋"); // 1 (코드 포인트)
 *
 * "👨‍👩‍👧‍👦".length;        // 11
 * lengthInCodePoints("👨‍👩‍👧‍👦"); // 7 (ZWJ 포함)
 * ```
 */
export function lengthInCodePoints(input: string): number {
  return [...input].length;
}

/**
 * 코드 포인트 기준 슬라이싱
 *
 * @example
 * ```ts
 * const emoji = "👋🌍🎉";
 * sliceByCodePoints(emoji, 0, 2); // "👋🌍"
 * ```
 */
export function sliceByCodePoints(
  input: string,
  start: number,
  end?: number
): string {
  const codePoints = [...input];
  const sliced = codePoints.slice(start, end);
  return sliced.join("");
}

/**
 * 문자열에서 이모지 제거
 *
 * @example
 * ```ts
 * stripEmoji("Hello 👋 World 🌍"); // "Hello  World "
 * ```
 */
export function stripEmoji(input: string): string {
  // 이모지 정규식 (Unicode 속성 기반)
  return input.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
    ""
  );
}

/**
 * 문자열에서 서로게이트 쌍 검출
 *
 * @example
 * ```ts
 * hasSurrogates("Hello"); // false
 * hasSurrogates("Hello 👋"); // true
 * ```
 */
export function hasSurrogates(input: string): boolean {
  for (let i = 0; i < input.length; i++) {
    if (isHighSurrogate(input.charCodeAt(i))) {
      return true;
    }
  }
  return false;
}

/**
 * 잘못된 서로게이트 시퀀스 수정
 *
 * @example
 * ```ts
 * // 고립된 서로게이트를 교체 문자로 대체
 * sanitizeSurrogates("\uD800"); // "�"
 * ```
 */
export function sanitizeSurrogates(
  input: string,
  replacement: string = "\uFFFD"
): string {
  let result = "";

  for (let i = 0; i < input.length; i++) {
    const codeUnit = input.charCodeAt(i);

    if (isHighSurrogate(codeUnit)) {
      // 다음 문자가 Low Surrogate인지 확인
      const nextCodeUnit = input.charCodeAt(i + 1);
      if (isLowSurrogate(nextCodeUnit)) {
        // 유효한 쌍
        result += input[i] + input[i + 1];
        i++; // 다음 문자 건너뛰기
      } else {
        // 고립된 High Surrogate
        result += replacement;
      }
    } else if (isLowSurrogate(codeUnit)) {
      // 고립된 Low Surrogate
      result += replacement;
    } else {
      result += input[i];
    }
  }

  return result;
}

/**
 * 바이트 수 기준 트렁케이션 (UTF-8)
 *
 * @example
 * ```ts
 * truncateByBytes("Hello 👋", 8); // "Hello "
 * ```
 */
export function truncateByBytes(
  input: string,
  maxBytes: number,
  ellipsis: string = ""
): string {
  const encoder = new TextEncoder();
  const ellipsisBytes = encoder.encode(ellipsis).length;
  const targetBytes = maxBytes - ellipsisBytes;

  if (targetBytes <= 0) {
    return ellipsis.slice(0, maxBytes);
  }

  const bytes = encoder.encode(input);
  if (bytes.length <= maxBytes) {
    return input;
  }

  // 바이트 단위로 자르면서 유효한 UTF-8 경계 찾기
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let result = decoder.decode(bytes.slice(0, targetBytes));

  // 마지막 문자가 깨졌으면 제거
  if (result.endsWith("\uFFFD")) {
    result = result.slice(0, -1);
  }

  return result + ellipsis;
}
