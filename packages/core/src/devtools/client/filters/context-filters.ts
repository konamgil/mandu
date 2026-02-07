/**
 * Mandu Kitchen DevTools - Context Filters
 * @version 1.0.3
 *
 * 마스킹 파이프라인 - PII/시크릿 정보 필터링
 */

import type { RedactPattern } from '../../types';

// ============================================================================
// Built-in Patterns
// ============================================================================

/**
 * 기본 제공 시크릿 패턴
 */
const BUILT_IN_SECRET_PATTERNS: RegExp[] = [
  // JWT tokens
  /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/]*/g,

  // AWS keys
  /AKIA[0-9A-Z]{16}/g,
  /[A-Za-z0-9/+=]{40}/g, // AWS secret (when near access key)

  // API keys (generic patterns)
  /api[_-]?key["\s:=]+["']?[A-Za-z0-9-_]{20,}["']?/gi,
  /secret[_-]?key["\s:=]+["']?[A-Za-z0-9-_]{20,}["']?/gi,

  // Private keys
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,

  // Bearer tokens
  /Bearer\s+[A-Za-z0-9-_.]+/gi,

  // Basic auth
  /Basic\s+[A-Za-z0-9+/=]+/gi,
];

/**
 * PII 패턴 (이메일, 전화번호, IP 등)
 */
const PII_PATTERNS: RegExp[] = [
  // Email
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,

  // Phone numbers (다양한 형식)
  /\b\d{3}[-.]?\d{3,4}[-.]?\d{4}\b/g,
  /\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,

  // IPv4
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,

  // IPv6
  /([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}/g,

  // Credit card (기본 형식만)
  /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,

  // SSN (US)
  /\b\d{3}-\d{2}-\d{4}\b/g,
];

// ============================================================================
// Filter Functions
// ============================================================================

/**
 * Phase 1: 주석 제거
 */
export function removeComments(code: string): string {
  // Single-line comments
  let result = code.replace(/\/\/.*$/gm, '');

  // Multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');

  // HTML comments
  result = result.replace(/<!--[\s\S]*?-->/g, '');

  return result;
}

/**
 * Phase 1b: 문자열 처리
 *
 * @param mode
 * - 'smart': PII/시크릿 패턴만 마스킹 (권장)
 * - 'strip': 모든 문자열 제거
 */
export function handleStrings(code: string, mode: 'smart' | 'strip'): string {
  if (mode === 'strip') {
    // 모든 문자열 리터럴 제거
    return code
      .replace(/"(?:[^"\\]|\\.)*"/g, '"[STRING]"')
      .replace(/'(?:[^'\\]|\\.)*'/g, "'[STRING]'")
      .replace(/`(?:[^`\\]|\\.)*`/g, '`[STRING]`');
  }

  // Smart mode: PII/시크릿만 마스킹
  let result = code;

  // 시크릿 패턴 마스킹
  for (const pattern of BUILT_IN_SECRET_PATTERNS) {
    result = result.replace(pattern, '[SECRET]');
  }

  // PII 패턴 마스킹
  for (const pattern of PII_PATTERNS) {
    result = result.replace(pattern, '[PII]');
  }

  return result;
}

/**
 * Phase 2: 기본 보안 마스킹 (항상 적용, 비활성화 불가)
 */
export function redactBuiltInSecrets(text: string): string {
  let result = text;

  for (const pattern of BUILT_IN_SECRET_PATTERNS) {
    // Reset regex state for global patterns
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }

  return result;
}

/**
 * Phase 3: 사용자 정의 패턴 적용 (옵트인)
 */
export function redactCustomPatterns(
  text: string,
  patterns: RedactPattern[]
): string {
  let result = text;

  for (const patternDef of patterns) {
    try {
      const regex = new RegExp(patternDef.source, patternDef.flags ?? 'gi');
      const replacement = patternDef.replacement ?? '[REDACTED]';
      result = result.replace(regex, replacement);
    } catch (e) {
      // 잘못된 정규식은 무시
      console.warn(
        `[Mandu Kitchen] Invalid redact pattern: ${patternDef.source}`,
        e
      );
    }
  }

  return result;
}

/**
 * Phase 4: 용량 제한 (항상 마지막)
 */
export function truncate(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return text;

  // UTF-8 바이트 길이 계산
  const encoder = new TextEncoder();
  const encoded = encoder.encode(text);

  if (encoded.length <= maxBytes) {
    return text;
  }

  // 바이트 단위로 자르고 디코딩
  const truncated = encoded.slice(0, maxBytes);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let result = decoder.decode(truncated);

  // 잘린 멀티바이트 문자 처리 (마지막 불완전한 문자 제거)
  if (result.endsWith('\ufffd')) {
    result = result.slice(0, -1);
  }

  return result + '... [TRUNCATED]';
}

// ============================================================================
// Context Filters Pipeline
// ============================================================================

export interface FilterOptions {
  /** 문자열 처리 모드 */
  stringMode?: 'smart' | 'strip';
  /** 사용자 정의 패턴 */
  customPatterns?: RedactPattern[];
  /** 최대 바이트 */
  maxBytes?: number;
  /** 주석 제거 여부 (기본: true) */
  removeComments?: boolean;
}

/**
 * 전체 필터 파이프라인 실행
 */
export function applyContextFilters(
  text: string,
  options: FilterOptions = {}
): string {
  const {
    stringMode = 'smart',
    customPatterns = [],
    maxBytes = 50_000, // 50KB default
    removeComments: shouldRemoveComments = true,
  } = options;

  let result = text;

  // Phase 1: 주석 제거
  if (shouldRemoveComments) {
    result = removeComments(result);
  }

  // Phase 1b: 문자열 처리
  result = handleStrings(result, stringMode);

  // Phase 2: 기본 보안 마스킹 (항상 적용)
  result = redactBuiltInSecrets(result);

  // Phase 3: 사용자 정의 패턴
  if (customPatterns.length > 0) {
    result = redactCustomPatterns(result, customPatterns);
  }

  // Phase 4: 용량 제한 (항상 마지막)
  result = truncate(result, maxBytes);

  return result;
}

// ============================================================================
// Stack Trace Sanitizer
// ============================================================================

/**
 * 스택 트레이스에서 민감 정보 제거
 */
export function sanitizeStackTrace(stack: string | undefined): string | undefined {
  if (!stack) return undefined;

  let result = stack;

  // 파일 경로에서 사용자명 제거
  result = result.replace(/\/Users\/[^/]+\//g, '/Users/[USER]/');
  result = result.replace(/\\Users\\[^\\]+\\/g, '\\Users\\[USER]\\');
  result = result.replace(/\/home\/[^/]+\//g, '/home/[USER]/');

  // 쿼리스트링 파라미터 마스킹
  result = result.replace(/\?[^\s)]+/g, '?[PARAMS]');

  // 기본 시크릿 마스킹
  result = redactBuiltInSecrets(result);

  return result;
}

// ============================================================================
// Error Message Sanitizer
// ============================================================================

/**
 * 에러 메시지에서 민감 정보 제거
 */
export function sanitizeErrorMessage(message: string): string {
  let result = message;

  // PII 마스킹
  for (const pattern of PII_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[PII]');
  }

  // 시크릿 마스킹
  result = redactBuiltInSecrets(result);

  return result;
}
