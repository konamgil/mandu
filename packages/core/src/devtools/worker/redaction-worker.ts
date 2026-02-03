/**
 * Mandu Kitchen DevTools - Redaction Worker
 * @version 1.1.0
 *
 * Web Worker for heavy text processing (redaction, truncation)
 * Prevents main thread blocking during large payload processing
 */

import type { RedactPattern, WorkerTask } from '../types';

// ============================================================================
// Worker Message Types
// ============================================================================

export interface WorkerRequest {
  id: string;
  type: 'redact' | 'truncate' | 'ping';
  data: {
    text?: string;
    patterns?: RedactPattern[];
    maxBytes?: number;
  };
}

export interface WorkerResponse {
  id: string;
  success: boolean;
  result?: string;
  error?: string;
  timing?: number;
}

// ============================================================================
// Redaction Logic (Worker-safe, no DOM dependencies)
// ============================================================================

/**
 * 빌트인 시크릿 패턴
 */
const BUILT_IN_SECRET_PATTERNS: RedactPattern[] = [
  // JWT
  { source: 'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}', label: 'JWT' },
  // AWS Keys
  { source: 'AKIA[0-9A-Z]{16}', label: 'AWS_KEY' },
  // Generic API Keys
  { source: '(?:api[_-]?key|apikey)["\']?\\s*[:=]\\s*["\']?[A-Za-z0-9_-]{20,}', flags: 'i', label: 'API_KEY' },
  // Bearer Tokens
  { source: 'Bearer\\s+[A-Za-z0-9_-]{20,}', label: 'BEARER' },
  // Generic Secrets
  { source: '(?:secret|password|passwd|pwd)["\']?\\s*[:=]\\s*["\']?[^\\s"\']{8,}', flags: 'i', label: 'SECRET' },
];

/**
 * PII 패턴
 */
const PII_PATTERNS: RedactPattern[] = [
  // Email
  { source: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}', label: 'EMAIL' },
  // Phone (국제)
  { source: '\\+?[1-9]\\d{1,14}', label: 'PHONE' },
  // IP Address
  { source: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', label: 'IP' },
  // Credit Card (basic)
  { source: '\\b(?:\\d{4}[- ]?){3}\\d{4}\\b', label: 'CARD' },
  // SSN (US)
  { source: '\\b\\d{3}-\\d{2}-\\d{4}\\b', label: 'SSN' },
];

/**
 * 패턴 적용
 */
function applyPattern(text: string, pattern: RedactPattern): string {
  try {
    const regex = new RegExp(pattern.source, pattern.flags ?? 'g');
    const replacement = pattern.replacement ?? `[${pattern.label ?? 'REDACTED'}]`;
    return text.replace(regex, replacement);
  } catch {
    // 잘못된 정규식은 무시
    return text;
  }
}

/**
 * 텍스트 리댁션
 */
function redactText(
  text: string,
  customPatterns: RedactPattern[] = [],
  options: { applyBuiltIn?: boolean; applyPII?: boolean } = {}
): string {
  const { applyBuiltIn = true, applyPII = true } = options;

  let result = text;

  // 빌트인 시크릿 패턴 적용
  if (applyBuiltIn) {
    for (const pattern of BUILT_IN_SECRET_PATTERNS) {
      result = applyPattern(result, pattern);
    }
  }

  // PII 패턴 적용
  if (applyPII) {
    for (const pattern of PII_PATTERNS) {
      result = applyPattern(result, pattern);
    }
  }

  // 커스텀 패턴 적용
  for (const pattern of customPatterns) {
    result = applyPattern(result, pattern);
  }

  return result;
}

/**
 * 텍스트 truncation (UTF-8 바이트 기준)
 */
function truncateText(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);

  if (bytes.length <= maxBytes) {
    return text;
  }

  // 바이트 제한에 맞게 자르기 (UTF-8 경계 고려)
  let truncatedBytes = bytes.slice(0, maxBytes - 3); // '...' 공간 확보

  // UTF-8 멀티바이트 문자 경계 맞추기
  while (truncatedBytes.length > 0) {
    const lastByte = truncatedBytes[truncatedBytes.length - 1];
    // 멀티바이트 문자의 중간 바이트인지 확인 (10xxxxxx 패턴)
    if ((lastByte & 0xc0) === 0x80) {
      truncatedBytes = truncatedBytes.slice(0, -1);
    } else {
      break;
    }
  }

  const decoder = new TextDecoder();
  return decoder.decode(truncatedBytes) + '...';
}

// ============================================================================
// Worker Entry Point
// ============================================================================

/**
 * Worker 메시지 핸들러
 */
function handleMessage(request: WorkerRequest): WorkerResponse {
  const startTime = performance.now();

  try {
    switch (request.type) {
      case 'ping':
        return {
          id: request.id,
          success: true,
          result: 'pong',
          timing: performance.now() - startTime,
        };

      case 'redact': {
        const { text = '', patterns = [] } = request.data;
        const result = redactText(text, patterns);
        return {
          id: request.id,
          success: true,
          result,
          timing: performance.now() - startTime,
        };
      }

      case 'truncate': {
        const { text = '', maxBytes = 10000 } = request.data;
        const result = truncateText(text, maxBytes);
        return {
          id: request.id,
          success: true,
          result,
          timing: performance.now() - startTime,
        };
      }

      default:
        return {
          id: request.id,
          success: false,
          error: `Unknown request type: ${(request as any).type}`,
        };
    }
  } catch (error) {
    return {
      id: request.id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Worker 컨텍스트에서만 실행
if (typeof self !== 'undefined' && typeof (self as any).postMessage === 'function') {
  self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const response = handleMessage(event.data);
    (self as any).postMessage(response);
  };
}

// ============================================================================
// Exports for testing / main-thread fallback
// ============================================================================

export {
  redactText,
  truncateText,
  handleMessage,
  BUILT_IN_SECRET_PATTERNS,
  PII_PATTERNS,
};
