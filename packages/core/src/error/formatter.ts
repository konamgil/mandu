import type { ManduError, RouteContext } from "./types";
import { ErrorCode } from "./types";

/**
 * 포맷 옵션
 */
export interface FormatOptions {
  /** 개발 모드 (디버그 정보 포함) */
  isDev?: boolean;
  /** 스택 트레이스 포함 */
  includeStack?: boolean;
  /** 색상 사용 (콘솔용) */
  useColors?: boolean;
}

/**
 * ManduError를 JSON 응답용 객체로 포맷
 */
export function formatErrorResponse(error: ManduError, options: FormatOptions = {}): object {
  const { isDev = process.env.NODE_ENV !== "production" } = options;

  const response: Record<string, unknown> = {
    errorType: error.errorType,
    code: error.code,
    message: error.message,
    summary: error.summary,
    fix: error.fix,
  };

  if (error.route) {
    response.route = error.route;
  }

  // 개발 모드에서만 디버그 정보 포함
  if (isDev && error.debug) {
    response.debug = error.debug;
  }

  response.timestamp = error.timestamp;

  return response;
}

/**
 * ManduError를 콘솔 출력용 문자열로 포맷
 */
export function formatErrorForConsole(error: ManduError, options: FormatOptions = {}): string {
  const { useColors = true, includeStack = true, isDev = true } = options;

  const lines: string[] = [];

  // 헤더
  const typeColor = getErrorTypeColor(error.errorType);
  const header = useColors
    ? `${typeColor}[${error.errorType}]${RESET} ${error.code}`
    : `[${error.errorType}] ${error.code}`;
  lines.push(header);

  // 메시지
  lines.push(`  ${error.message}`);

  // 요약
  if (useColors) {
    lines.push(`  ${CYAN}→ ${error.summary}${RESET}`);
  } else {
    lines.push(`  → ${error.summary}`);
  }

  // 수정 안내
  lines.push("");
  if (useColors) {
    lines.push(`  ${YELLOW}Fix:${RESET} ${error.fix.file}${error.fix.line ? `:${error.fix.line}` : ""}`);
    lines.push(`       ${error.fix.suggestion}`);
  } else {
    lines.push(`  Fix: ${error.fix.file}${error.fix.line ? `:${error.fix.line}` : ""}`);
    lines.push(`       ${error.fix.suggestion}`);
  }

  // 라우트 컨텍스트
  if (error.route) {
    lines.push("");
    lines.push(`  Route: ${error.route.id} (${error.route.pattern})`);
  }

  // 디버그 정보 (개발 모드)
  if (isDev && includeStack && error.debug?.stack) {
    lines.push("");
    lines.push("  Stack:");
    const stackLines = error.debug.stack.split("\n").slice(0, 10);
    for (const stackLine of stackLines) {
      lines.push(`    ${stackLine}`);
    }
    if (error.debug.stack.split("\n").length > 10) {
      lines.push("    ...(truncated)");
    }
  }

  return lines.join("\n");
}

/**
 * 404 에러 응답 생성
 */
export function createNotFoundResponse(
  pathname: string,
  routeContext?: RouteContext
): ManduError {
  return {
    errorType: "SPEC_ERROR",
    code: ErrorCode.SPEC_ROUTE_NOT_FOUND,
    httpStatus: 404,
    message: `Route not found: ${pathname}`,
    summary: "라우트 없음 - spec 파일에 추가 필요",
    fix: {
      file: "spec/routes.manifest.json",
      suggestion: `'${pathname}' 패턴의 라우트를 추가하세요`,
    },
    route: routeContext,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 핸들러 미등록 에러 응답 생성
 */
export function createHandlerNotFoundResponse(
  routeId: string,
  pattern: string
): ManduError {
  return {
    errorType: "FRAMEWORK_BUG",
    code: ErrorCode.FRAMEWORK_ROUTER_ERROR,
    httpStatus: 500,
    message: `Handler not registered for route: ${routeId}`,
    summary: "핸들러 미등록 - generate 재실행 필요",
    fix: {
      file: `.mandu/generated/server/routes/${routeId}.route.ts`,
      suggestion: "bunx mandu generate를 실행하세요",
    },
    route: {
      id: routeId,
      pattern,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * 페이지 모듈 로드 실패 에러 응답 생성
 */
export function createPageLoadErrorResponse(
  routeId: string,
  pattern: string,
  originalError?: Error
): ManduError {
  const error: ManduError = {
    errorType: "LOGIC_ERROR",
    code: ErrorCode.SLOT_IMPORT_ERROR,
    httpStatus: 500,
    message: originalError?.message || `Failed to load page module for route: ${routeId}`,
    summary: `페이지 모듈 로드 실패 - ${routeId}.route.tsx 확인 필요`,
    fix: {
      file: `.mandu/generated/web/routes/${routeId}.route.tsx`,
      suggestion: "import 경로와 컴포넌트 export를 확인하세요",
    },
    route: {
      id: routeId,
      pattern,
      kind: "page",
    },
    timestamp: new Date().toISOString(),
  };

  if (originalError?.stack && process.env.NODE_ENV !== "production") {
    error.debug = {
      stack: originalError.stack,
      originalError: originalError.message,
    };
  }

  return error;
}

/**
 * SSR 렌더링 에러 응답 생성
 */
export function createSSRErrorResponse(
  routeId: string,
  pattern: string,
  originalError?: Error
): ManduError {
  const error: ManduError = {
    errorType: "FRAMEWORK_BUG",
    code: ErrorCode.FRAMEWORK_SSR_ERROR,
    httpStatus: 500,
    message: originalError?.message || `SSR rendering failed for route: ${routeId}`,
    summary: `SSR 렌더링 실패 - 컴포넌트 확인 필요`,
    fix: {
      file: `.mandu/generated/web/routes/${routeId}.route.tsx`,
      suggestion: "React 컴포넌트가 서버에서 렌더링 가능한지 확인하세요 (브라우저 전용 API 사용 금지)",
    },
    route: {
      id: routeId,
      pattern,
      kind: "page",
    },
    timestamp: new Date().toISOString(),
  };

  if (originalError?.stack && process.env.NODE_ENV !== "production") {
    error.debug = {
      stack: originalError.stack,
      originalError: originalError.message,
    };
  }

  return error;
}

// ANSI 색상 코드
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const RESET = "\x1b[0m";

/**
 * 에러 타입에 따른 색상 반환
 */
function getErrorTypeColor(errorType: string): string {
  switch (errorType) {
    case "SPEC_ERROR":
      return YELLOW;
    case "LOGIC_ERROR":
      return RED;
    case "FRAMEWORK_BUG":
      return MAGENTA;
    default:
      return CYAN;
  }
}
