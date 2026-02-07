/**
 * MCP Error Handler
 *
 * DNA-007 에러 추출 시스템 기반 MCP 에러 처리
 */

import {
  extractErrorInfo,
  classifyError,
  serializeError,
  isRetryableError,
  type ErrorCategory,
  type ExtractedErrorInfo,
} from "@mandujs/core";

/**
 * MCP 에러 응답 타입
 */
export interface McpErrorResponse {
  /** 에러 메시지 */
  error: string;
  /** 에러 코드 (있는 경우) */
  code?: string;
  /** 에러 카테고리 (DNA-007) */
  category: ErrorCategory;
  /** 재시도 가능 여부 */
  retryable: boolean;
  /** 추가 컨텍스트 */
  context?: Record<string, unknown>;
  /** 복구 제안 */
  suggestion?: string;
}

/**
 * MCP 도구 응답 타입
 */
export interface McpToolResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * 에러를 MCP 응답 형식으로 변환
 *
 * @example
 * ```ts
 * try {
 *   await tool.execute(args);
 * } catch (err) {
 *   const response = formatMcpError(err, "mandu_guard_check");
 *   // { error: "...", code: "...", category: "validation", ... }
 * }
 * ```
 */
export function formatMcpError(err: unknown, toolName?: string): McpErrorResponse {
  const info = extractErrorInfo(err);

  return {
    error: info.message,
    code: info.code,
    category: info.category,
    retryable: isRetryableError(err),
    context: {
      ...info.context,
      toolName,
      errorName: info.name,
    },
    suggestion: generateSuggestion(info, toolName),
  };
}

/**
 * 에러 카테고리 및 도구별 복구 제안 생성
 */
function generateSuggestion(info: ExtractedErrorInfo, toolName?: string): string | undefined {
  // 도구별 특화 제안
  if (toolName) {
    const toolSuggestion = getToolSpecificSuggestion(toolName, info);
    if (toolSuggestion) return toolSuggestion;
  }

  // 카테고리별 일반 제안
  switch (info.category) {
    case "network":
      return "네트워크 연결을 확인하고 다시 시도해주세요.";

    case "timeout":
      return "요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.";

    case "auth":
      return "인증 정보를 확인해주세요.";

    case "validation":
      return "입력 값을 확인해주세요. 필수 파라미터가 누락되었거나 형식이 올바르지 않을 수 있습니다.";

    case "config":
      return "설정 파일(mandu.config.ts)을 확인해주세요.";

    case "system":
      if (info.code === "ENOENT") {
        const path = info.context?.path ?? "unknown";
        return `파일 또는 디렉토리를 찾을 수 없습니다: ${path}`;
      }
      if (info.code === "EACCES" || info.code === "EPERM") {
        return "파일 접근 권한을 확인해주세요.";
      }
      return "시스템 리소스를 확인해주세요.";

    case "external":
      return "외부 서비스에 문제가 있습니다. 잠시 후 다시 시도해주세요.";

    case "internal":
      return "내부 오류가 발생했습니다. 문제가 지속되면 이슈를 보고해주세요.";

    default:
      return undefined;
  }
}

/**
 * 도구별 특화된 에러 제안
 */
function getToolSpecificSuggestion(toolName: string, info: ExtractedErrorInfo): string | undefined {
  // spec 관련 도구
  if (toolName.startsWith("mandu_") && toolName.includes("route")) {
    if (info.code === "ENOENT") {
      return "routes.manifest.json 파일이 없습니다. `mandu init`을 먼저 실행해주세요.";
    }
    if (info.message.includes("not found")) {
      return "해당 라우트를 찾을 수 없습니다. `mandu_list_routes`로 존재하는 라우트를 확인해주세요.";
    }
  }

  // guard 관련 도구
  if (toolName === "mandu_guard_check") {
    if (info.category === "config") {
      return "Guard 설정을 확인해주세요. mandu.config.ts의 guard 섹션을 검토해주세요.";
    }
  }

  // contract 관련 도구
  if (toolName.includes("contract")) {
    if (info.category === "validation") {
      return "Contract 스키마가 올바른지 확인해주세요. Zod 스키마 문법을 확인해주세요.";
    }
  }

  // generate 관련 도구
  if (toolName === "mandu_generate") {
    if (info.code === "EEXIST") {
      return "파일이 이미 존재합니다. 덮어쓰려면 force 옵션을 사용해주세요.";
    }
  }

  // transaction 관련 도구
  if (toolName.includes("tx") || toolName.includes("transaction")) {
    if (info.message.includes("no active")) {
      return "활성화된 트랜잭션이 없습니다. `mandu_begin`으로 트랜잭션을 시작해주세요.";
    }
  }

  return undefined;
}

/**
 * 도구 실행 결과를 MCP 응답으로 변환
 *
 * @example
 * ```ts
 * // 성공 응답
 * const response = createToolResponse("mandu_list_routes", { routes: [...] });
 *
 * // 에러 응답
 * const response = createToolResponse("mandu_list_routes", null, new Error("..."));
 * ```
 */
export function createToolResponse(
  toolName: string,
  result: unknown,
  error?: unknown
): McpToolResponse {
  if (error) {
    const errorResponse = formatMcpError(error, toolName);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorResponse, null, 2),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

/**
 * 에러 응답인지 확인
 */
export function isErrorResponse(response: McpToolResponse): boolean {
  return response.isError === true;
}

/**
 * 에러 응답에서 McpErrorResponse 추출
 */
export function extractErrorFromResponse(response: McpToolResponse): McpErrorResponse | null {
  if (!response.isError) return null;

  try {
    const text = response.content[0]?.text;
    if (!text) return null;
    return JSON.parse(text) as McpErrorResponse;
  } catch {
    return null;
  }
}

/**
 * 에러 로깅 헬퍼
 */
export function logToolError(
  toolName: string,
  error: unknown,
  args?: Record<string, unknown>
): void {
  const info = extractErrorInfo(error);

  console.error(`[MCP:${toolName}] ${info.category.toUpperCase()}: ${info.message}`);

  if (info.code) {
    console.error(`  Code: ${info.code}`);
  }

  if (args && Object.keys(args).length > 0) {
    console.error(`  Args:`, JSON.stringify(args, null, 2));
  }

  if (info.context && Object.keys(info.context).length > 0) {
    console.error(`  Context:`, info.context);
  }
}
