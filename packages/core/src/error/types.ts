/**
 * 에러 타입 분류
 */
export type ErrorType = "SPEC_ERROR" | "LOGIC_ERROR" | "FRAMEWORK_BUG";

/**
 * 에러 코드 체계
 * - SPEC_ERROR: E1xx
 * - LOGIC_ERROR: E2xx
 * - FRAMEWORK_BUG: Fxxx
 */
export enum ErrorCode {
  // SPEC_ERROR (1xx)
  SPEC_NOT_FOUND = "MANDU_E101",
  SPEC_PARSE_ERROR = "MANDU_E102",
  SPEC_VALIDATION_ERROR = "MANDU_E103",
  SPEC_ROUTE_DUPLICATE = "MANDU_E104",
  SPEC_ROUTE_NOT_FOUND = "MANDU_E105",

  // LOGIC_ERROR (2xx)
  SLOT_NOT_FOUND = "MANDU_E201",
  SLOT_IMPORT_ERROR = "MANDU_E202",
  SLOT_RUNTIME_ERROR = "MANDU_E203",
  SLOT_VALIDATION_ERROR = "MANDU_E204",
  SLOT_HANDLER_ERROR = "MANDU_E205",

  // FRAMEWORK_BUG (Fxx)
  FRAMEWORK_GENERATOR_ERROR = "MANDU_F001",
  FRAMEWORK_SSR_ERROR = "MANDU_F002",
  FRAMEWORK_ROUTER_ERROR = "MANDU_F003",
  FRAMEWORK_INTERNAL = "MANDU_F999",
}

/**
 * 수정 대상 정보
 */
export interface FixTarget {
  /** 수정해야 할 파일 경로 */
  file: string;
  /** 수정 가이드 */
  suggestion: string;
  /** 라인 번호 (선택) */
  line?: number;
}

/**
 * 라우트 컨텍스트
 */
export interface RouteContext {
  /** 라우트 ID */
  id: string;
  /** URL 패턴 */
  pattern: string;
  /** 라우트 종류 */
  kind?: "api" | "page";
}

/**
 * 디버그 정보 (개발 모드에서만 포함)
 */
export interface DebugInfo {
  /** 스택 트레이스 */
  stack: string;
  /** 원본 에러 메시지 */
  originalError: string;
  /** Generated 파일 경로 (있는 경우) */
  generatedFile?: string;
}

/**
 * Mandu 에러 응답 구조
 */
export interface ManduError {
  /** 에러 타입 */
  errorType: ErrorType;
  /** 에러 코드 */
  code: ErrorCode | string;
  /** HTTP 상태 코드 (선택) */
  httpStatus?: number;
  /** 에러 메시지 */
  message: string;
  /** 한줄 요약 (에이전트용) */
  summary: string;
  /** 수정 대상 정보 */
  fix: FixTarget;
  /** 라우트 컨텍스트 (있는 경우) */
  route?: RouteContext;
  /** 디버그 정보 (개발 모드) */
  debug?: DebugInfo;
  /** 타임스탬프 */
  timestamp: string;
}

/**
 * 에러 코드 → 메시지 매핑
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  // SPEC_ERROR
  [ErrorCode.SPEC_NOT_FOUND]: "Spec 파일을 찾을 수 없습니다",
  [ErrorCode.SPEC_PARSE_ERROR]: "Spec 파일 파싱 오류",
  [ErrorCode.SPEC_VALIDATION_ERROR]: "Spec 스키마 검증 실패",
  [ErrorCode.SPEC_ROUTE_DUPLICATE]: "라우트 패턴 중복",
  [ErrorCode.SPEC_ROUTE_NOT_FOUND]: "라우트를 찾을 수 없습니다",

  // LOGIC_ERROR
  [ErrorCode.SLOT_NOT_FOUND]: "Slot 파일을 찾을 수 없습니다",
  [ErrorCode.SLOT_IMPORT_ERROR]: "Slot 파일 import 오류",
  [ErrorCode.SLOT_RUNTIME_ERROR]: "Slot 런타임 오류",
  [ErrorCode.SLOT_VALIDATION_ERROR]: "입력 검증 실패",
  [ErrorCode.SLOT_HANDLER_ERROR]: "핸들러 실행 오류",

  // FRAMEWORK_BUG
  [ErrorCode.FRAMEWORK_GENERATOR_ERROR]: "Generator 내부 오류",
  [ErrorCode.FRAMEWORK_SSR_ERROR]: "SSR 렌더링 오류",
  [ErrorCode.FRAMEWORK_ROUTER_ERROR]: "Router 내부 오류",
  [ErrorCode.FRAMEWORK_INTERNAL]: "알 수 없는 내부 오류",
};

/**
 * 에러 코드 → 요약 매핑
 */
export const ERROR_SUMMARIES: Record<ErrorCode, string> = {
  // SPEC_ERROR
  [ErrorCode.SPEC_NOT_FOUND]: "Spec 파일 없음 - spec 디렉토리 확인 필요",
  [ErrorCode.SPEC_PARSE_ERROR]: "Spec 파싱 오류 - JSON 문법 확인 필요",
  [ErrorCode.SPEC_VALIDATION_ERROR]: "Spec 검증 실패 - 스키마 확인 필요",
  [ErrorCode.SPEC_ROUTE_DUPLICATE]: "라우트 중복 - spec 파일 수정 필요",
  [ErrorCode.SPEC_ROUTE_NOT_FOUND]: "라우트 없음 - spec 파일에 추가 필요",

  // LOGIC_ERROR
  [ErrorCode.SLOT_NOT_FOUND]: "Slot 파일 없음 - generate 실행 필요",
  [ErrorCode.SLOT_IMPORT_ERROR]: "Slot import 오류 - slot 파일 확인 필요",
  [ErrorCode.SLOT_RUNTIME_ERROR]: "Slot 런타임 오류 - slot 파일 수정 필요",
  [ErrorCode.SLOT_VALIDATION_ERROR]: "입력 검증 실패 - 요청 데이터 확인 필요",
  [ErrorCode.SLOT_HANDLER_ERROR]: "핸들러 오류 - slot 파일 수정 필요",

  // FRAMEWORK_BUG
  [ErrorCode.FRAMEWORK_GENERATOR_ERROR]: "Generator 오류 - 버그 리포트 필요",
  [ErrorCode.FRAMEWORK_SSR_ERROR]: "SSR 오류 - 버그 리포트 필요",
  [ErrorCode.FRAMEWORK_ROUTER_ERROR]: "Router 오류 - 버그 리포트 필요",
  [ErrorCode.FRAMEWORK_INTERNAL]: "내부 오류 - 버그 리포트 필요",
};
