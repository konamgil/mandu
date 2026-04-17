/**
 * Mandu Runtime Logger 📝
 * Trace 기반 요청/응답 로깅 레이어
 *
 * 역할 분리:
 * - Trace = 수집 (원본 이벤트, duration 측정)
 * - Logger = 출력 (포맷/필터/레드액션/샘플링)
 *
 * 기본값은 안전:
 * - includeHeaders: false
 * - includeBody: false
 * - redact: 민감 정보 자동 마스킹
 *
 * @example
 * ```typescript
 * import { logger } from "@mandujs/core";
 *
 * // 기본 사용
 * app.use(logger());
 * // → GET /api/users
 * // ← GET /api/users 200 23ms
 *
 * // 개발 모드
 * app.use(logger({
 *   level: "debug",
 *   includeHeaders: true,
 * }));
 *
 * // 프로덕션 (JSON 형식)
 * app.use(logger({
 *   format: "json",
 *   slowThresholdMs: 500,
 * }));
 * ```
 */

import type { ManduContext } from "../filling/context";
import {
  enableTrace,
  getTrace,
  buildTraceReport,
  type TraceReport,
} from "./trace";
import { newShortId } from "../id";

// ============================================
// Types
// ============================================

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "pretty" | "json";

/**
 * Logger 옵션
 */
export interface LoggerOptions {
  /**
   * 로그 포맷
   * - pretty: 개발용 컬러 출력
   * - json: 운영용 구조화 로그
   * @default "pretty"
   */
  format?: LogFormat;

  /**
   * 로그 레벨
   * - debug: 모든 요청 상세 출력
   * - info: 기본 요청/응답 (기본값)
   * - warn: 느린 요청 + 에러
   * - error: 에러만
   * @default "info"
   */
  level?: LogLevel;

  /**
   * 헤더 포함 여부
   * ⚠️ 기본 OFF - 민감 정보 노출 위험
   * @default false
   */
  includeHeaders?: boolean;

  /**
   * 바디 포함 여부
   * ⚠️ 기본 OFF - 민감 정보 노출 + 스트림 문제
   * @default false
   */
  includeBody?: boolean;

  /**
   * 바디 최대 바이트 (includeBody=true 시)
   * @default 1024
   */
  maxBodyBytes?: number;

  /**
   * 레드액션 대상 헤더/필드명 (기본값 내장)
   * 추가할 필드만 지정하면 기본값과 병합됨
   */
  redact?: string[];

  /**
   * Request ID 생성 방식
   * - "auto": crypto.randomUUID() 또는 타임스탬프 기반
   * - 함수: 커스텀 생성
   * @default "auto"
   */
  requestId?: "auto" | ((ctx: ManduContext) => string);

  /**
   * 샘플링 비율 (0-1)
   * 운영 환경에서 로그 양 조절
   * @default 1 (100%)
   */
  sampleRate?: number;

  /**
   * 느린 요청 임계값 (ms)
   * 이 값 초과 시 warn 레벨로 상세 출력
   * @default 1000
   */
  slowThresholdMs?: number;

  /**
   * Trace 리포트 포함 여부 (느린 요청 시)
   * @default true
   */
  includeTraceOnSlow?: boolean;

  /**
   * 커스텀 로그 싱크 (외부 시스템 연동용)
   * 지정 시 console 출력 대신 이 함수 호출
   */
  sink?: (entry: LogEntry) => void;

  /**
   * 로깅 제외 경로 패턴
   * @example ["/health", "/metrics", /^\/static\//]
   */
  skip?: (string | RegExp)[];
}

/**
 * 로그 엔트리 (JSON 출력 및 sink용)
 */
export interface LogEntry {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  status?: number;
  duration?: number;
  level: LogLevel;
  error?: {
    message: string;
    stack?: string;
  };
  headers?: Record<string, string>;
  body?: unknown;
  trace?: TraceReport;
  slow?: boolean;
}

// ============================================
// Constants
// ============================================

/** 기본 레드액션 대상 (대소문자 무시) */
const DEFAULT_REDACT_PATTERNS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "apikey",
  "api_key",
  "password",
  "passwd",
  "secret",
  "token",
  "bearer",
  "credential",
  "credentials",
  "private",
  "session",
  "jwt",
];

/** Context 저장 키 */
const LOGGER_START_KEY = "__mandu_logger_start";
const LOGGER_REQUEST_ID_KEY = "__mandu_logger_request_id";
const LOGGER_ERROR_KEY = "__mandu_logger_error";
const LOGGER_RESPONSE_KEY = "__mandu_logger_response";

/** 로그 레벨 우선순위 */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** ANSI 컬러 코드 */
const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

// ============================================
// Utilities
// ============================================

/**
 * Request ID 생성 — 짧은 8자 hex prefix. v7 기반이면 시간 정렬됨.
 */
function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return newShortId();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * 현재 시간 (고해상도)
 */
function now(): number {
  if (typeof performance !== "undefined" && performance.now) {
    return performance.now();
  }
  return Date.now();
}

/**
 * URL에서 pathname 추출
 */
function getPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * 헤더 레드액션 처리
 */
function redactHeaders(
  headers: Headers,
  patterns: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  const lowerPatterns = patterns.map((p) => p.toLowerCase());

  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    const shouldRedact = lowerPatterns.some(
      (pattern) => lowerKey.includes(pattern) || pattern.includes(lowerKey)
    );
    result[key] = shouldRedact ? "[REDACTED]" : value;
  });

  return result;
}

/**
 * 객체 내 민감 필드 레드액션
 */
function redactObject(
  obj: unknown,
  patterns: string[],
  maxBytes: number
): unknown {
  if (obj === null || obj === undefined) return obj;

  // 문자열이면 길이 제한만
  if (typeof obj === "string") {
    if (obj.length > maxBytes) {
      return obj.slice(0, maxBytes) + `... [truncated ${obj.length - maxBytes} bytes]`;
    }
    return obj;
  }

  // 배열
  if (Array.isArray(obj)) {
    const str = JSON.stringify(obj);
    if (str.length > maxBytes) {
      return `[Array length=${obj.length}, truncated]`;
    }
    return obj.map((item) => redactObject(item, patterns, maxBytes));
  }

  // 객체
  if (typeof obj === "object") {
    const lowerPatterns = patterns.map((p) => p.toLowerCase());
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      const shouldRedact = lowerPatterns.some(
        (pattern) => lowerKey.includes(pattern) || pattern.includes(lowerKey)
      );

      if (shouldRedact) {
        result[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        result[key] = redactObject(value, patterns, maxBytes);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  return obj;
}

/**
 * 경로가 skip 패턴에 매칭되는지 확인
 */
function shouldSkip(path: string, patterns: (string | RegExp)[]): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === "string") {
      return path === pattern || path.startsWith(pattern + "/");
    }
    return pattern.test(path);
  });
}

/**
 * 로그 레벨 필터링
 */
function shouldLog(entryLevel: LogLevel, configLevel: LogLevel): boolean {
  return LEVEL_PRIORITY[entryLevel] >= LEVEL_PRIORITY[configLevel];
}

/**
 * HTTP 상태 코드에 따른 색상
 */
function getStatusColor(status: number): string {
  if (status >= 500) return COLORS.red;
  if (status >= 400) return COLORS.yellow;
  if (status >= 300) return COLORS.cyan;
  return COLORS.green;
}

// ============================================
// Pretty Formatter
// ============================================

function formatPretty(entry: LogEntry): string {
  const { method, path, status, duration, requestId, error, slow, headers, trace } = entry;

  const lines: string[] = [];

  // 요청 라인
  if (status === undefined) {
    // 요청 시작
    lines.push(
      `${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.cyan}→${COLORS.reset} ${method} ${path}`
    );
  } else {
    // 응답
    const statusColor = getStatusColor(status);
    const durationStr = duration !== undefined ? ` ${duration.toFixed(0)}ms` : "";
    const slowIndicator = slow ? ` ${COLORS.yellow}[SLOW]${COLORS.reset}` : "";

    lines.push(
      `${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.magenta}←${COLORS.reset} ${method} ${path} ${statusColor}${status}${COLORS.reset}${durationStr}${slowIndicator}`
    );
  }

  // 에러
  if (error) {
    lines.push(`  ${COLORS.red}Error: ${error.message}${COLORS.reset}`);
    if (error.stack) {
      const stackLines = error.stack.split("\n").slice(1, 4);
      stackLines.forEach((line) => {
        lines.push(`  ${COLORS.dim}${line.trim()}${COLORS.reset}`);
      });
    }
  }

  // 헤더 (debug 모드)
  if (headers && Object.keys(headers).length > 0) {
    lines.push(`  ${COLORS.dim}Headers:${COLORS.reset}`);
    for (const [key, value] of Object.entries(headers)) {
      lines.push(`    ${COLORS.dim}${key}:${COLORS.reset} ${value}`);
    }
  }

  // Trace 리포트 (느린 요청)
  if (trace && trace.entries.length > 0) {
    lines.push(`  ${COLORS.dim}Trace:${COLORS.reset}`);
    for (const traceEntry of trace.entries) {
      const name = traceEntry.name ? ` (${traceEntry.name})` : "";
      lines.push(
        `    ${COLORS.dim}${traceEntry.event}${name}: ${traceEntry.duration.toFixed(1)}ms${COLORS.reset}`
      );
    }
  }

  return lines.join("\n");
}

// ============================================
// JSON Formatter
// ============================================

function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

// ============================================
// Logger Middleware Factory
// ============================================

/**
 * Logger 미들웨어 생성
 *
 * @example
 * ```typescript
 * // 기본 사용
 * app.use(logger());
 *
 * // 개발 모드
 * app.use(logger({
 *   level: "debug",
 *   includeHeaders: true,
 * }));
 *
 * // 프로덕션
 * app.use(logger({
 *   format: "json",
 *   sampleRate: 0.1,  // 10% 샘플링
 *   slowThresholdMs: 500,
 * }));
 * ```
 */
export function logger(options: LoggerOptions = {}) {
  const config = {
    format: options.format ?? "pretty",
    level: options.level ?? "info",
    includeHeaders: options.includeHeaders ?? false,
    includeBody: options.includeBody ?? false,
    maxBodyBytes: options.maxBodyBytes ?? 1024,
    redact: [...DEFAULT_REDACT_PATTERNS, ...(options.redact ?? [])],
    requestId: options.requestId ?? "auto",
    sampleRate: options.sampleRate ?? 1,
    slowThresholdMs: options.slowThresholdMs ?? 1000,
    includeTraceOnSlow: options.includeTraceOnSlow ?? true,
    sink: options.sink,
    skip: options.skip ?? [],
  };

  const formatter = config.format === "json" ? formatJson : formatPretty;

  /**
   * 로그 출력 함수
   */
  function log(entry: LogEntry): void {
    if (!shouldLog(entry.level, config.level)) return;

    if (config.sink) {
      config.sink(entry);
    } else {
      const output = formatter(entry);
      switch (entry.level) {
        case "error":
          console.error(output);
          break;
        case "warn":
          console.warn(output);
          break;
        default:
          console.log(output);
      }
    }
  }

  return {
    /**
     * onRequest 훅 - 요청 시작 기록
     */
    onRequest(ctx: ManduContext): void {
      const path = getPathname(ctx.url);

      // Skip 체크
      if (shouldSkip(path, config.skip)) return;

      // 샘플링 체크
      if (config.sampleRate < 1 && Math.random() > config.sampleRate) return;

      // Trace 활성화
      enableTrace(ctx);

      // 시작 시간 저장
      ctx.set(LOGGER_START_KEY, now());

      // Request ID 생성/저장
      const requestId =
        config.requestId === "auto"
          ? generateRequestId()
          : config.requestId(ctx);
      ctx.set(LOGGER_REQUEST_ID_KEY, requestId);

      // debug 레벨이면 요청 시작도 로깅
      if (config.level === "debug") {
        const entry: LogEntry = {
          timestamp: new Date().toISOString(),
          requestId,
          method: ctx.method,
          path,
          level: "debug",
        };

        if (config.includeHeaders) {
          entry.headers = redactHeaders(ctx.headers, config.redact);
        }

        log(entry);
      }
    },

    /**
     * onError 훅 - 에러 캡처
     */
    onError(ctx: ManduContext, error: Error): void {
      ctx.set(LOGGER_ERROR_KEY, error);
    },

    /**
     * afterHandle 훅 - 응답 캡처 (바디 로깅용)
     */
    afterHandle(ctx: ManduContext, response: Response): Response {
      ctx.set(LOGGER_RESPONSE_KEY, response);
      return response;
    },

    /**
     * afterResponse 훅 - 최종 로그 출력
     */
    async afterResponse(ctx: ManduContext): Promise<void> {
      const startTime = ctx.get<number>(LOGGER_START_KEY);
      const requestId = ctx.get<string>(LOGGER_REQUEST_ID_KEY);

      // 시작 기록이 없으면 skip된 요청
      if (startTime === undefined || requestId === undefined) return;

      const path = getPathname(ctx.url);
      const duration = now() - startTime;
      const error = ctx.get<Error>(LOGGER_ERROR_KEY);
      const response = ctx.get<Response>(LOGGER_RESPONSE_KEY);
      const status = response?.status ?? (error ? 500 : 200);
      const isSlow = duration > config.slowThresholdMs;

      // 로그 레벨 결정
      let level: LogLevel = "info";
      if (error) {
        level = "error";
      } else if (isSlow) {
        level = "warn";
      }

      // 로그 엔트리 생성
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        requestId,
        method: ctx.method,
        path,
        status,
        duration,
        level,
        slow: isSlow,
      };

      // 에러 정보
      if (error) {
        entry.error = {
          message: error.message,
          stack: error.stack,
        };
      }

      // 헤더 (debug 또는 느린 요청)
      if (config.includeHeaders || (isSlow && config.level === "debug")) {
        entry.headers = redactHeaders(ctx.headers, config.redact);
      }

      // 바디 (명시적 활성화 + debug 레벨만)
      if (config.includeBody && config.level === "debug" && response) {
        try {
          const cloned = response.clone();
          const contentType = cloned.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const body = await cloned.json();
            entry.body = redactObject(body, config.redact, config.maxBodyBytes);
          }
        } catch {
          // 바디 파싱 실패 시 무시
        }
      }

      // Trace 리포트 (느린 요청)
      if (isSlow && config.includeTraceOnSlow) {
        const collector = getTrace(ctx);
        if (collector) {
          entry.trace = buildTraceReport(collector);
        }
      }

      log(entry);
    },
  };
}

/**
 * Logger 훅들을 LifecycleStore에 등록하는 헬퍼
 *
 * @example
 * ```typescript
 * import { createLifecycleStore } from "./lifecycle";
 * import { logger, applyLogger } from "./logger";
 *
 * const lifecycle = createLifecycleStore();
 * applyLogger(lifecycle, logger({ level: "debug" }));
 * ```
 */
export function applyLogger(
  lifecycle: {
    onRequest: Array<{ fn: (ctx: ManduContext) => void | Promise<void>; scope: string }>;
    onError: Array<{ fn: (ctx: ManduContext, error: Error) => void | Promise<void>; scope: string }>;
    afterHandle: Array<{ fn: (ctx: ManduContext, response: Response) => Response | Promise<Response>; scope: string }>;
    afterResponse: Array<{ fn: (ctx: ManduContext) => void | Promise<void>; scope: string }>;
  },
  loggerInstance: ReturnType<typeof logger>
): void {
  lifecycle.onRequest.push({ fn: loggerInstance.onRequest, scope: "global" });
  lifecycle.onError.push({ fn: loggerInstance.onError as (ctx: ManduContext, error: Error) => void, scope: "global" });
  lifecycle.afterHandle.push({ fn: loggerInstance.afterHandle, scope: "global" });
  lifecycle.afterResponse.push({ fn: loggerInstance.afterResponse, scope: "global" });
}

// ============================================
// Convenience Presets
// ============================================

/**
 * 개발용 로거 프리셋
 */
export function devLogger(options: Partial<LoggerOptions> = {}) {
  return logger({
    format: "pretty",
    level: "debug",
    includeHeaders: true,
    slowThresholdMs: 500,
    ...options,
  });
}

/**
 * 프로덕션용 로거 프리셋
 */
export function prodLogger(options: Partial<LoggerOptions> = {}) {
  return logger({
    format: "json",
    level: "info",
    includeHeaders: false,
    includeBody: false,
    sampleRate: 1,
    slowThresholdMs: 1000,
    ...options,
  });
}
