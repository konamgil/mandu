/**
 * 도메인별 에러 클래스
 *
 * ManduError 인터페이스 기반의 실제 Error 클래스들.
 * try-catch에서 instanceof 체크 가능.
 */

import { ErrorCode, ERROR_MESSAGES, ERROR_SUMMARIES } from "./types";
import type { ManduError, RouteContext, ErrorType } from "./types";

/**
 * Mandu 에러 베이스 클래스
 */
export abstract class ManduBaseError extends Error implements ManduError {
  abstract readonly errorType: ErrorType;
  readonly code: ErrorCode | string;
  readonly httpStatus?: number;
  readonly summary: string;
  readonly fix: { file: string; suggestion: string; line?: number };
  readonly route?: RouteContext;
  readonly timestamp: string;

  constructor(
    code: ErrorCode | string,
    message: string,
    fix: { file: string; suggestion: string; line?: number },
    options?: {
      httpStatus?: number;
      route?: RouteContext;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = options?.httpStatus;
    this.summary =
      typeof code === "string" && code in ERROR_SUMMARIES
        ? ERROR_SUMMARIES[code as ErrorCode]
        : message;
    this.fix = fix;
    this.route = options?.route;
    this.timestamp = new Date().toISOString();
  }

  /**
   * ManduError 인터페이스로 변환
   */
  toManduError(): ManduError {
    return {
      errorType: this.errorType,
      code: this.code,
      httpStatus: this.httpStatus,
      message: this.message,
      summary: this.summary,
      fix: this.fix,
      route: this.route,
      timestamp: this.timestamp,
    };
  }
}

// ============================================================
// 파일 시스템 에러
// ============================================================

/**
 * 파일 읽기/쓰기 에러
 */
export class FileError extends ManduBaseError {
  readonly errorType = "LOGIC_ERROR" as const;
  readonly filePath: string;
  readonly operation: "read" | "write" | "access" | "stat";

  constructor(
    filePath: string,
    operation: "read" | "write" | "access" | "stat",
    cause?: unknown
  ) {
    const message = `파일 ${operation} 실패: ${filePath}`;
    super(
      ErrorCode.SLOT_IMPORT_ERROR,
      message,
      {
        file: filePath,
        suggestion: `파일이 존재하고 읽기 권한이 있는지 확인하세요`,
      },
      { cause }
    );
    this.filePath = filePath;
    this.operation = operation;
  }
}

/**
 * 디렉토리 읽기 에러
 */
export class DirectoryError extends ManduBaseError {
  readonly errorType = "LOGIC_ERROR" as const;
  readonly dirPath: string;

  constructor(dirPath: string, cause?: unknown) {
    super(
      ErrorCode.SLOT_NOT_FOUND,
      `디렉토리 읽기 실패: ${dirPath}`,
      {
        file: dirPath,
        suggestion: `디렉토리가 존재하고 접근 가능한지 확인하세요`,
      },
      { cause }
    );
    this.dirPath = dirPath;
  }
}

// ============================================================
// Guard 에러
// ============================================================

/**
 * Guard 아키텍처 검사 에러
 */
export class GuardError extends ManduBaseError {
  readonly errorType = "LOGIC_ERROR" as const;
  readonly ruleId: string;

  constructor(
    ruleId: string,
    message: string,
    file: string,
    options?: {
      line?: number;
      suggestion?: string;
      cause?: unknown;
    }
  ) {
    super(
      ErrorCode.SLOT_VALIDATION_ERROR,
      message,
      {
        file,
        suggestion: options?.suggestion || "아키텍처 규칙을 확인하세요",
        line: options?.line,
      },
      { cause: options?.cause }
    );
    this.ruleId = ruleId;
  }
}

// ============================================================
// Router 에러
// ============================================================

/**
 * 라우터 에러
 */
export class RouterError extends ManduBaseError {
  readonly errorType = "FRAMEWORK_BUG" as const;

  constructor(
    message: string,
    file: string,
    options?: {
      route?: RouteContext;
      cause?: unknown;
    }
  ) {
    super(
      ErrorCode.FRAMEWORK_ROUTER_ERROR,
      message,
      {
        file,
        suggestion: "라우트 설정을 확인하세요",
      },
      { httpStatus: 500, ...options }
    );
  }
}

// ============================================================
// SSR 에러
// ============================================================

/**
 * SSR 렌더링 에러
 */
export class SSRError extends ManduBaseError {
  readonly errorType = "FRAMEWORK_BUG" as const;

  constructor(
    message: string,
    route: RouteContext,
    cause?: unknown
  ) {
    super(
      ErrorCode.FRAMEWORK_SSR_ERROR,
      message,
      {
        file: `app/${route.id}/page.tsx`,
        suggestion: "페이지 컴포넌트에서 렌더링 오류가 발생했습니다",
      },
      { httpStatus: 500, route, cause }
    );
  }
}

// ============================================================
// Contract 에러
// ============================================================

/**
 * API 계약 위반 에러
 */
export class ContractError extends ManduBaseError {
  readonly errorType = "LOGIC_ERROR" as const;

  constructor(
    message: string,
    contractFile: string,
    options?: {
      route?: RouteContext;
      cause?: unknown;
    }
  ) {
    super(
      ErrorCode.SLOT_VALIDATION_ERROR,
      message,
      {
        file: contractFile,
        suggestion: "API 계약과 실제 구현이 일치하는지 확인하세요",
      },
      { httpStatus: 400, ...options }
    );
  }
}

// ============================================================
// Security 에러
// ============================================================

/**
 * 보안 관련 에러
 */
export class SecurityError extends ManduBaseError {
  readonly errorType = "LOGIC_ERROR" as const;
  readonly securityType: "path_traversal" | "injection" | "unauthorized" | "import_violation";

  constructor(
    securityType: "path_traversal" | "injection" | "unauthorized" | "import_violation",
    message: string,
    file?: string
  ) {
    super(
      ErrorCode.SLOT_HANDLER_ERROR,
      message,
      {
        file: file || "unknown",
        suggestion: "보안 정책을 위반하는 요청입니다",
      },
      { httpStatus: 403 }
    );
    this.securityType = securityType;
  }
}
