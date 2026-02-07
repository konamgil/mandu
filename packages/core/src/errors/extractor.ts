/**
 * DNA-007: Error Code Extraction
 *
 * 다양한 에러 소스에서 에러 코드 추출 및 분류
 * - Node.js 시스템 에러 (ENOENT, ECONNREFUSED 등)
 * - HTTP 에러 (status codes)
 * - 커스텀 에러 (code, errorCode 프로퍼티)
 * - 라이브러리별 에러 형식
 */

/**
 * 에러 카테고리
 */
export type ErrorCategory =
  | "system"      // 파일 시스템, 네트워크 등 OS 레벨
  | "validation"  // 입력 검증 실패
  | "auth"        // 인증/인가 실패
  | "network"     // 네트워크 연결 문제
  | "timeout"     // 타임아웃
  | "config"      // 설정 오류
  | "internal"    // 내부 로직 에러
  | "external"    // 외부 서비스 에러
  | "unknown";    // 분류 불가

/**
 * 추출된 에러 정보
 */
export interface ExtractedErrorInfo {
  /** 에러 코드 (있는 경우) */
  code?: string;
  /** HTTP 상태 코드 (있는 경우) */
  statusCode?: number;
  /** 에러 메시지 */
  message: string;
  /** 에러 카테고리 */
  category: ErrorCategory;
  /** 스택 트레이스 (있는 경우) */
  stack?: string;
  /** 원본 에러 */
  original: unknown;
  /** 에러 이름 */
  name: string;
  /** 추가 컨텍스트 */
  context?: Record<string, unknown>;
}

/**
 * Node.js 시스템 에러 코드 → 카테고리 매핑
 */
const SYSTEM_ERROR_CATEGORIES: Record<string, ErrorCategory> = {
  // 파일 시스템
  ENOENT: "system",
  EACCES: "system",
  EPERM: "system",
  EEXIST: "system",
  ENOTDIR: "system",
  EISDIR: "system",
  EMFILE: "system",
  ENOSPC: "system",

  // 네트워크
  ECONNREFUSED: "network",
  ECONNRESET: "network",
  ENOTFOUND: "network",
  ETIMEDOUT: "timeout",
  ECONNABORTED: "network",
  EHOSTUNREACH: "network",
  ENETUNREACH: "network",

  // 기타
  EINVAL: "validation",
  ENOTEMPTY: "system",
};

/**
 * HTTP 상태 코드 → 카테고리 매핑
 */
function categoryFromStatusCode(status: number): ErrorCategory {
  if (status >= 400 && status < 500) {
    if (status === 401 || status === 403) return "auth";
    if (status === 408) return "timeout";
    return "validation";
  }
  if (status >= 500) {
    if (status === 502 || status === 503 || status === 504) return "external";
    return "internal";
  }
  return "unknown";
}

/**
 * 에러 코드 추출
 *
 * 다양한 에러 형식에서 코드를 추출합니다:
 * - `error.code` (Node.js 시스템 에러)
 * - `error.errorCode` (커스텀 에러)
 * - `error.errno` (숫자형 에러 코드)
 *
 * @example
 * ```ts
 * try {
 *   await fs.readFile("/nonexistent");
 * } catch (err) {
 *   const code = extractErrorCode(err);
 *   // code === "ENOENT"
 * }
 * ```
 */
export function extractErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }

  const obj = err as Record<string, unknown>;

  // 문자열 code 프로퍼티
  if ("code" in obj && typeof obj.code === "string") {
    return obj.code;
  }

  // errorCode 프로퍼티 (커스텀 에러)
  if ("errorCode" in obj && typeof obj.errorCode === "string") {
    return obj.errorCode;
  }

  // errno (숫자형 - 문자열로 변환)
  if ("errno" in obj && typeof obj.errno === "number") {
    return `ERRNO_${obj.errno}`;
  }

  return undefined;
}

/**
 * HTTP 상태 코드 추출
 */
export function extractStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }

  const obj = err as Record<string, unknown>;

  // status 프로퍼티
  if ("status" in obj && typeof obj.status === "number") {
    return obj.status;
  }

  // statusCode 프로퍼티
  if ("statusCode" in obj && typeof obj.statusCode === "number") {
    return obj.statusCode;
  }

  // response.status (axios 스타일)
  if (
    "response" in obj &&
    obj.response &&
    typeof obj.response === "object" &&
    "status" in (obj.response as object)
  ) {
    const status = (obj.response as Record<string, unknown>).status;
    if (typeof status === "number") {
      return status;
    }
  }

  return undefined;
}

/**
 * 에러 메시지 추출
 */
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  if (typeof err === "string") {
    return err;
  }

  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;

    if ("message" in obj && typeof obj.message === "string") {
      return obj.message;
    }

    if ("error" in obj && typeof obj.error === "string") {
      return obj.error;
    }

    // JSON 직렬화 시도
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  return String(err);
}

/**
 * 에러 카테고리 분류
 */
export function classifyError(err: unknown): ErrorCategory {
  const code = extractErrorCode(err);
  const statusCode = extractStatusCode(err);

  // 시스템 에러 코드로 분류
  if (code && code in SYSTEM_ERROR_CATEGORIES) {
    return SYSTEM_ERROR_CATEGORIES[code];
  }

  // HTTP 상태 코드로 분류
  if (statusCode) {
    return categoryFromStatusCode(statusCode);
  }

  // 에러 이름으로 분류
  if (err instanceof Error) {
    const name = err.name.toLowerCase();
    if (name.includes("validation") || name.includes("invalid")) {
      return "validation";
    }
    if (name.includes("auth") || name.includes("permission")) {
      return "auth";
    }
    if (name.includes("timeout")) {
      return "timeout";
    }
    if (name.includes("network") || name.includes("fetch")) {
      return "network";
    }
    if (name.includes("config")) {
      return "config";
    }
  }

  // 코드 패턴으로 분류 (더 구체적인 패턴을 먼저 체크)
  if (code) {
    const upperCode = code.toUpperCase();
    if (upperCode.startsWith("AUTH") || upperCode.includes("UNAUTHORIZED")) {
      return "auth";
    }
    if (upperCode.includes("TIMEOUT")) {
      return "timeout";
    }
    // CONFIG를 VALIDATION보다 먼저 체크 (CONFIG_INVALID 같은 케이스)
    if (upperCode.includes("CONFIG")) {
      return "config";
    }
    if (upperCode.includes("VALIDATION") || upperCode.includes("INVALID")) {
      return "validation";
    }
  }

  return "unknown";
}

/**
 * 에러 정보 종합 추출
 *
 * @example
 * ```ts
 * try {
 *   await fetch("https://api.example.com");
 * } catch (err) {
 *   const info = extractErrorInfo(err);
 *   console.log(`[${info.code}] ${info.message} (${info.category})`);
 * }
 * ```
 */
export function extractErrorInfo(err: unknown): ExtractedErrorInfo {
  const code = extractErrorCode(err);
  const statusCode = extractStatusCode(err);
  const message = extractErrorMessage(err);
  const category = classifyError(err);

  let name = "Error";
  let stack: string | undefined;
  let context: Record<string, unknown> | undefined;

  if (err instanceof Error) {
    name = err.name;
    stack = err.stack;

    // cause 추출 (ES2022+)
    if ("cause" in err && err.cause) {
      context = { cause: err.cause };
    }
  }

  // 추가 컨텍스트 수집
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;

    // 일반적인 컨텍스트 프로퍼티들
    const contextKeys = ["path", "address", "port", "syscall", "hostname", "url"];
    for (const key of contextKeys) {
      if (key in obj && obj[key] !== undefined) {
        context = context ?? {};
        context[key] = obj[key];
      }
    }
  }

  return {
    code,
    statusCode,
    message,
    category,
    name,
    stack,
    original: err,
    context,
  };
}

/**
 * 예상치 못한 에러 포맷팅
 *
 * 에러 타입에 따라 적절한 형식으로 출력합니다.
 *
 * @example
 * ```ts
 * process.on("uncaughtException", (err) => {
 *   console.error(formatUncaughtError(err));
 * });
 * ```
 */
export function formatUncaughtError(err: unknown, verbose = false): string {
  const info = extractErrorInfo(err);
  const lines: string[] = [];

  // 헤더
  const codeDisplay = info.code ? `[${info.code}]` : `[${info.category.toUpperCase()}]`;
  lines.push(`${codeDisplay} ${info.name}: ${info.message}`);

  // HTTP 상태 코드
  if (info.statusCode) {
    lines.push(`  HTTP Status: ${info.statusCode}`);
  }

  // 컨텍스트
  if (info.context && Object.keys(info.context).length > 0) {
    for (const [key, value] of Object.entries(info.context)) {
      if (key !== "cause") {
        lines.push(`  ${key}: ${String(value)}`);
      }
    }
  }

  // 스택 트레이스 (verbose 모드)
  if (verbose && info.stack) {
    lines.push("");
    lines.push("Stack trace:");
    lines.push(info.stack);
  }

  return lines.join("\n");
}

/**
 * 에러가 특정 카테고리인지 확인
 */
export function isErrorCategory(err: unknown, category: ErrorCategory): boolean {
  return classifyError(err) === category;
}

/**
 * 재시도 가능한 에러인지 확인
 *
 * 네트워크 에러, 타임아웃, 일부 외부 서비스 에러는 재시도 가능
 */
export function isRetryableError(err: unknown): boolean {
  const category = classifyError(err);
  if (category === "network" || category === "timeout" || category === "external") {
    return true;
  }

  const statusCode = extractStatusCode(err);
  if (statusCode) {
    // 429 Too Many Requests, 502, 503, 504
    return [429, 502, 503, 504].includes(statusCode);
  }

  return false;
}

/**
 * 에러를 안전하게 직렬화
 *
 * 로깅이나 전송을 위해 에러를 JSON으로 변환합니다.
 */
export function serializeError(err: unknown): Record<string, unknown> {
  const info = extractErrorInfo(err);

  return {
    name: info.name,
    message: info.message,
    code: info.code,
    statusCode: info.statusCode,
    category: info.category,
    context: info.context,
    stack: info.stack,
  };
}
