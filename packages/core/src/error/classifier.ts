import type { GeneratedMap } from "../generator/generate";
import type { ManduError, RouteContext, ErrorType } from "./types";
import { ErrorCode, ERROR_MESSAGES, ERROR_SUMMARIES } from "./types";
import { StackTraceAnalyzer, type StackFrame } from "./stack-analyzer";

/**
 * ValidationError 타입 체크 (filling/context.ts에서 정의)
 */
function isValidationError(error: unknown): error is { errors: unknown[] } {
  return (
    error !== null &&
    typeof error === "object" &&
    "errors" in error &&
    Array.isArray((error as { errors: unknown[] }).errors)
  );
}

/**
 * 에러 분류기
 */
export class ErrorClassifier {
  private analyzer: StackTraceAnalyzer;
  private routeContext?: RouteContext;
  private isDev: boolean;

  constructor(
    generatedMap: GeneratedMap | null = null,
    routeContext?: RouteContext,
    rootDir: string = process.cwd()
  ) {
    this.analyzer = new StackTraceAnalyzer(generatedMap, rootDir);
    this.routeContext = routeContext;
    this.isDev = process.env.NODE_ENV !== "production";
  }

  /**
   * 에러를 ManduError로 분류
   */
  classify(error: unknown): ManduError {
    // ValidationError 체크
    if (isValidationError(error)) {
      return this.createValidationError(error);
    }

    // 일반 Error 객체
    if (error instanceof Error) {
      return this.classifyError(error);
    }

    // 그 외 (문자열, 숫자 등)
    return this.createUnknownError(error);
  }

  /**
   * ValidationError 처리
   */
  private createValidationError(error: { errors: unknown[] }): ManduError {
    const slotFile = this.findSlotFile();

    return {
      errorType: "LOGIC_ERROR",
      code: ErrorCode.SLOT_VALIDATION_ERROR,
      message: ERROR_MESSAGES[ErrorCode.SLOT_VALIDATION_ERROR],
      summary: ERROR_SUMMARIES[ErrorCode.SLOT_VALIDATION_ERROR],
      fix: {
        file: slotFile || "spec/slots/",
        suggestion: "요청 데이터가 스키마와 일치하는지 확인하세요",
      },
      route: this.routeContext,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Error 객체 분류
   */
  private classifyError(error: Error): ManduError {
    const frames = this.analyzer.parseStack(error.stack);
    const source = this.analyzer.determineErrorSource(frames);
    const blameFrame = this.analyzer.findBlameFrame(frames);

    let errorType: ErrorType;
    let code: ErrorCode;
    let fixFile: string;
    let suggestion: string;

    switch (source) {
      case "slot":
        errorType = "LOGIC_ERROR";
        code = ErrorCode.SLOT_RUNTIME_ERROR;
        fixFile = blameFrame?.file || this.findSlotFile() || "spec/slots/";
        suggestion = this.generateSlotSuggestion(error);
        break;

      case "spec":
        errorType = "SPEC_ERROR";
        code = ErrorCode.SPEC_VALIDATION_ERROR;
        fixFile = blameFrame?.file || "spec/routes.manifest.json";
        suggestion = "Spec 파일의 JSON 구문 또는 스키마를 확인하세요";
        break;

      case "generated":
        // Generated 파일 에러 → Slot으로 매핑 시도
        if (blameFrame) {
          const slotLocation = this.analyzer.mapToSlotLocation(blameFrame.file, blameFrame.line);
          if (slotLocation) {
            errorType = "LOGIC_ERROR";
            code = ErrorCode.SLOT_RUNTIME_ERROR;
            fixFile = slotLocation.file;
            suggestion = this.generateSlotSuggestion(error);
            break;
          }
        }
        // 매핑 실패 시 프레임워크 버그로 처리
        errorType = "FRAMEWORK_BUG";
        code = ErrorCode.FRAMEWORK_INTERNAL;
        fixFile = blameFrame?.file || "packages/core/";
        suggestion = "Generated 파일에서 예기치 않은 오류 발생. 버그 리포트를 등록해주세요.";
        break;

      case "framework":
        errorType = "FRAMEWORK_BUG";
        code = this.determineFrameworkCode(blameFrame);
        fixFile = blameFrame?.file || "packages/core/";
        suggestion = "Mandu 프레임워크 내부 오류입니다. GitHub 이슈를 등록해주세요.";
        break;

      default:
        // Unknown → 보수적으로 LOGIC_ERROR로 분류
        errorType = "LOGIC_ERROR";
        code = ErrorCode.SLOT_HANDLER_ERROR;
        fixFile = this.findSlotFile() || "spec/slots/";
        suggestion = this.generateSlotSuggestion(error);
    }

    const manduError: ManduError = {
      errorType,
      code,
      message: error.message,
      summary: this.generateSummary(code, blameFrame),
      fix: {
        file: fixFile,
        suggestion,
        line: blameFrame?.line,
      },
      route: this.routeContext,
      timestamp: new Date().toISOString(),
    };

    // 개발 모드에서 디버그 정보 추가
    if (this.isDev && error.stack) {
      manduError.debug = {
        stack: error.stack,
        originalError: error.message,
        generatedFile: this.analyzer.isGeneratedFile(blameFrame?.file || "")
          ? blameFrame?.file
          : undefined,
      };
    }

    return manduError;
  }

  /**
   * 알 수 없는 타입의 에러 처리
   */
  private createUnknownError(error: unknown): ManduError {
    const message = typeof error === "string" ? error : String(error);

    return {
      errorType: "LOGIC_ERROR",
      code: ErrorCode.SLOT_HANDLER_ERROR,
      message,
      summary: `핸들러 오류 - ${this.findSlotFile() || "slot"} 파일 확인 필요`,
      fix: {
        file: this.findSlotFile() || "spec/slots/",
        suggestion: "핸들러에서 throw된 값을 확인하세요",
      },
      route: this.routeContext,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 라우트 컨텍스트에서 Slot 파일 경로 찾기
   */
  private findSlotFile(): string | null {
    if (!this.routeContext?.id) return null;
    return `spec/slots/${this.routeContext.id}.slot.ts`;
  }

  /**
   * Slot 에러에 대한 제안 생성
   */
  private generateSlotSuggestion(error: Error): string {
    const message = error.message.toLowerCase();

    if (message.includes("undefined") || message.includes("null")) {
      return "null/undefined 처리를 확인하세요. ctx.body() 결과나 파라미터 값이 없을 수 있습니다.";
    }

    if (message.includes("is not a function")) {
      return "호출하려는 함수가 정의되어 있는지 확인하세요.";
    }

    if (message.includes("cannot read") || message.includes("cannot access")) {
      return "객체의 속성에 접근하기 전에 객체가 존재하는지 확인하세요.";
    }

    if (message.includes("import") || message.includes("module")) {
      return "import 경로와 모듈 이름이 올바른지 확인하세요.";
    }

    return "slot 파일의 로직을 검토하세요.";
  }

  /**
   * 프레임워크 에러 코드 결정
   */
  private determineFrameworkCode(frame: StackFrame | null): ErrorCode {
    if (!frame) return ErrorCode.FRAMEWORK_INTERNAL;

    const file = frame.file.toLowerCase();

    if (file.includes("generator") || file.includes("generate")) {
      return ErrorCode.FRAMEWORK_GENERATOR_ERROR;
    }

    if (file.includes("ssr") || file.includes("render")) {
      return ErrorCode.FRAMEWORK_SSR_ERROR;
    }

    if (file.includes("router") || file.includes("routing")) {
      return ErrorCode.FRAMEWORK_ROUTER_ERROR;
    }

    return ErrorCode.FRAMEWORK_INTERNAL;
  }

  /**
   * 요약 메시지 생성
   */
  private generateSummary(code: ErrorCode, frame: StackFrame | null): string {
    const baseSummary = ERROR_SUMMARIES[code] || "오류 발생";

    if (frame?.file) {
      const shortFile = frame.file.split("/").pop() || frame.file;
      return `${baseSummary} (${shortFile}:${frame.line || "?"})`;
    }

    return baseSummary;
  }
}

/**
 * 특정 에러 타입에 대한 ManduError 생성 헬퍼
 */
export function createSpecError(
  code: ErrorCode,
  message: string,
  file: string = "spec/routes.manifest.json",
  suggestion?: string
): ManduError {
  return {
    errorType: "SPEC_ERROR",
    code,
    message,
    summary: ERROR_SUMMARIES[code] || message,
    fix: {
      file,
      suggestion: suggestion || ERROR_MESSAGES[code] || "Spec 파일을 확인하세요",
    },
    timestamp: new Date().toISOString(),
  };
}

export function createLogicError(
  code: ErrorCode,
  message: string,
  slotFile: string,
  routeContext?: RouteContext,
  suggestion?: string
): ManduError {
  return {
    errorType: "LOGIC_ERROR",
    code,
    message,
    summary: ERROR_SUMMARIES[code] || message,
    fix: {
      file: slotFile,
      suggestion: suggestion || ERROR_MESSAGES[code] || "Slot 파일을 확인하세요",
    },
    route: routeContext,
    timestamp: new Date().toISOString(),
  };
}

export function createFrameworkBug(
  code: ErrorCode,
  message: string,
  file?: string
): ManduError {
  return {
    errorType: "FRAMEWORK_BUG",
    code,
    message,
    summary: ERROR_SUMMARIES[code] || message,
    fix: {
      file: file || "packages/core/",
      suggestion: "Mandu 프레임워크 내부 오류입니다. GitHub 이슈를 등록해주세요.",
    },
    timestamp: new Date().toISOString(),
  };
}
