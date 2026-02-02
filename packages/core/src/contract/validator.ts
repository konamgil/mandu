/**
 * Mandu Contract Validator
 * 런타임 요청/응답 검증 + 정규화
 *
 * 모드:
 * - lenient (기본): 응답 검증 실패 시 경고만 출력
 * - strict: 응답 검증 실패 시 에러 반환 (프로덕션 안전성)
 *
 * 정규화:
 * - strip (기본): 정의되지 않은 필드 제거 (Mass Assignment 방지)
 * - strict: 정의되지 않은 필드 있으면 에러
 * - passthrough: 모든 필드 허용
 */

import type { z } from "zod";
import type {
  ContractSchema,
  ContractValidationResult,
  ContractValidationError,
  ContractValidationIssue,
  MethodRequestSchema,
  ContractNormalizeMode,
  ResponseSchemaWithExamples,
} from "./schema";
import {
  type NormalizeMode,
  type NormalizeOptions,
  normalizeSchema,
  createCoerceSchema,
} from "./normalize";
import { ZodObject } from "zod";

function isResponseSchemaWithExamples(
  schema: z.ZodTypeAny | ResponseSchemaWithExamples | undefined
): schema is ResponseSchemaWithExamples {
  return (
    schema !== undefined &&
    typeof schema === "object" &&
    "schema" in schema
  );
}

/**
 * Validator 옵션
 */
export interface ContractValidatorOptions {
  /**
   * strict: 응답 검증 실패 시 에러 Response 반환
   * lenient: 응답 검증 실패 시 경고만 출력 (기본값)
   */
  mode?: "strict" | "lenient";
  /**
   * 응답 검증 실패 시 커스텀 에러 핸들러
   */
  onResponseViolation?: (errors: ContractValidationError[], statusCode: number) => void;
  /**
   * 정규화 모드
   * - strip (기본): 정의되지 않은 필드 제거
   * - strict: 정의되지 않은 필드 있으면 에러
   * - passthrough: 모든 필드 허용 (정규화 안 함)
   */
  normalize?: NormalizeMode;
  /**
   * Query/Params의 타입 자동 변환 (coerce)
   * URL의 query string과 path params는 항상 문자열이므로
   * 스키마에 정의된 타입으로 자동 변환
   * @default true
   */
  coerceQueryParams?: boolean;
}

/**
 * 검증 및 정규화 결과
 */
export interface ValidateAndNormalizeResult extends ContractValidationResult {
  /** 정규화된 데이터 */
  data?: {
    query?: unknown;
    body?: unknown;
    params?: unknown;
    headers?: unknown;
  };
}

/**
 * Parse query string from URL
 */
function parseQueryString(url: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  try {
    const urlObj = new URL(url);
    urlObj.searchParams.forEach((value, key) => {
      const existing = result[key];
      if (existing !== undefined) {
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          result[key] = [existing, value];
        }
      } else {
        result[key] = value;
      }
    });
  } catch {
    // Invalid URL, return empty object
  }
  return result;
}

/**
 * Convert Zod error to validation issues
 */
function zodErrorToIssues(error: z.ZodError): ContractValidationIssue[] {
  return error.errors.map((issue) => ({
    path: issue.path,
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Contract Validator
 * Validates requests and responses against contract schemas
 */
export class ContractValidator {
  private options: Required<ContractValidatorOptions>;

  constructor(
    private contract: ContractSchema,
    options: ContractValidatorOptions = {}
  ) {
    // Contract의 normalize/coerceQueryParams 설정을 우선 적용
    this.options = {
      mode: options.mode ?? "lenient",
      onResponseViolation: options.onResponseViolation ?? (() => {}),
      normalize: options.normalize ?? contract.normalize ?? "strip",
      coerceQueryParams: options.coerceQueryParams ?? contract.coerceQueryParams ?? true,
    };
  }

  /**
   * 정규화 모드 변경
   */
  setNormalizeMode(mode: NormalizeMode): void {
    this.options.normalize = mode;
  }

  /**
   * 현재 정규화 모드 확인
   */
  getNormalizeMode(): NormalizeMode {
    return this.options.normalize;
  }

  /**
   * 현재 모드 확인
   */
  isStrictMode(): boolean {
    return this.options.mode === "strict";
  }

  /**
   * 모드 변경
   */
  setMode(mode: "strict" | "lenient"): void {
    this.options.mode = mode;
  }

  /**
   * Validate incoming request against contract
   * @param req - The incoming request
   * @param method - HTTP method
   * @param pathParams - Path parameters extracted by router
   */
  async validateRequest(
    req: Request,
    method: string,
    pathParams: Record<string, string> = {}
  ): Promise<ContractValidationResult> {
    const methodSchema = this.contract.request[method] as MethodRequestSchema | undefined;
    if (!methodSchema) {
      // No schema defined for this method, pass through
      return { success: true };
    }

    const errors: ContractValidationError[] = [];

    // Validate query parameters
    if (methodSchema.query) {
      const query = parseQueryString(req.url);
      const result = methodSchema.query.safeParse(query);
      if (!result.success) {
        errors.push({
          type: "query",
          issues: zodErrorToIssues(result.error),
        });
      }
    }

    // Validate path parameters
    if (methodSchema.params) {
      const result = methodSchema.params.safeParse(pathParams);
      if (!result.success) {
        errors.push({
          type: "params",
          issues: zodErrorToIssues(result.error),
        });
      }
    }

    // Validate headers
    if (methodSchema.headers) {
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      const result = methodSchema.headers.safeParse(headers);
      if (!result.success) {
        errors.push({
          type: "headers",
          issues: zodErrorToIssues(result.error),
        });
      }
    }

    // Validate body (for methods that have body)
    if (methodSchema.body) {
      try {
        const contentType = req.headers.get("content-type") || "";
        let body: unknown;

        if (contentType.includes("application/json")) {
          body = await req.clone().json();
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          const formData = await req.clone().formData();
          body = Object.fromEntries(formData.entries());
        } else if (contentType.includes("multipart/form-data")) {
          const formData = await req.clone().formData();
          body = Object.fromEntries(formData.entries());
        } else {
          // Try JSON as default
          try {
            body = await req.clone().json();
          } catch {
            body = await req.clone().text();
          }
        }

        const result = methodSchema.body.safeParse(body);
        if (!result.success) {
          errors.push({
            type: "body",
            issues: zodErrorToIssues(result.error),
          });
        }
      } catch (error) {
        errors.push({
          type: "body",
          issues: [
            {
              path: [],
              message: `Failed to parse request body: ${error instanceof Error ? error.message : "Unknown error"}`,
              code: "invalid_type",
            },
          ],
        });
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    return { success: true };
  }

  /**
   * Validate and normalize incoming request against contract
   * 검증 + 정규화를 동시에 수행하고 정규화된 데이터 반환
   *
   * @param req - The incoming request
   * @param method - HTTP method
   * @param pathParams - Path parameters extracted by router
   * @returns Validation result with normalized data
   *
   * @example
   * ```typescript
   * const result = await validator.validateAndNormalizeRequest(req, "POST", { id: "123" });
   * if (result.success) {
   *   // result.data.body는 정의된 필드만 포함 (strip 모드)
   *   // result.data.query.page는 숫자로 변환됨 (coerce)
   *   console.log(result.data.body);
   * }
   * ```
   */
  async validateAndNormalizeRequest(
    req: Request,
    method: string,
    pathParams: Record<string, string> = {}
  ): Promise<ValidateAndNormalizeResult> {
    const methodSchema = this.contract.request[method] as MethodRequestSchema | undefined;
    if (!methodSchema) {
      return { success: true, data: {} };
    }

    const errors: ContractValidationError[] = [];
    const normalizedData: ValidateAndNormalizeResult["data"] = {};
    const normalizeOpts: NormalizeOptions = { mode: this.options.normalize };

    // Query: coerce + normalize
    if (methodSchema.query) {
      const query = parseQueryString(req.url);
      try {
        let querySchema = methodSchema.query;

        // coerce 적용 (query string은 항상 문자열)
        if (this.options.coerceQueryParams && querySchema instanceof ZodObject) {
          querySchema = createCoerceSchema(querySchema);
        }

        // normalize 적용 (strip/strict)
        querySchema = normalizeSchema(querySchema, normalizeOpts);

        const result = querySchema.safeParse(query);
        if (!result.success) {
          errors.push({
            type: "query",
            issues: zodErrorToIssues(result.error),
          });
        } else {
          normalizedData.query = result.data;
        }
      } catch (error) {
        errors.push({
          type: "query",
          issues: [{ path: [], message: String(error), code: "custom" }],
        });
      }
    }

    // Params: coerce + normalize
    if (methodSchema.params) {
      try {
        let paramsSchema = methodSchema.params;

        // coerce 적용 (path params도 항상 문자열)
        if (this.options.coerceQueryParams && paramsSchema instanceof ZodObject) {
          paramsSchema = createCoerceSchema(paramsSchema);
        }

        // normalize 적용
        paramsSchema = normalizeSchema(paramsSchema, normalizeOpts);

        const result = paramsSchema.safeParse(pathParams);
        if (!result.success) {
          errors.push({
            type: "params",
            issues: zodErrorToIssues(result.error),
          });
        } else {
          normalizedData.params = result.data;
        }
      } catch (error) {
        errors.push({
          type: "params",
          issues: [{ path: [], message: String(error), code: "custom" }],
        });
      }
    }

    // Headers: normalize only (no coerce)
    if (methodSchema.headers) {
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      try {
        const headersSchema = normalizeSchema(methodSchema.headers, normalizeOpts);
        const result = headersSchema.safeParse(headers);
        if (!result.success) {
          errors.push({
            type: "headers",
            issues: zodErrorToIssues(result.error),
          });
        } else {
          normalizedData.headers = result.data;
        }
      } catch (error) {
        errors.push({
          type: "headers",
          issues: [{ path: [], message: String(error), code: "custom" }],
        });
      }
    }

    // Body: normalize only (JSON은 타입 보존됨, coerce 불필요)
    if (methodSchema.body) {
      try {
        const contentType = req.headers.get("content-type") || "";
        let body: unknown;

        if (contentType.includes("application/json")) {
          body = await req.clone().json();
        } else if (contentType.includes("application/x-www-form-urlencoded")) {
          const formData = await req.clone().formData();
          body = Object.fromEntries(formData.entries());
        } else if (contentType.includes("multipart/form-data")) {
          const formData = await req.clone().formData();
          body = Object.fromEntries(formData.entries());
        } else {
          try {
            body = await req.clone().json();
          } catch {
            body = await req.clone().text();
          }
        }

        // normalize 적용 (strip으로 정의 안 한 필드 제거)
        const bodySchema = normalizeSchema(methodSchema.body, normalizeOpts);
        const result = bodySchema.safeParse(body);
        if (!result.success) {
          errors.push({
            type: "body",
            issues: zodErrorToIssues(result.error),
          });
        } else {
          normalizedData.body = result.data;
        }
      } catch (error) {
        errors.push({
          type: "body",
          issues: [
            {
              path: [],
              message: `Failed to parse request body: ${error instanceof Error ? error.message : "Unknown error"}`,
              code: "invalid_type",
            },
          ],
        });
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    return { success: true, data: normalizedData };
  }

  /**
   * Validate response against contract
   * @param responseBody - The response body (already parsed)
   * @param statusCode - HTTP status code
   */
  validateResponse(responseBody: unknown, statusCode: number): ContractValidationResult {
    const responseSchemaOrWithExamples = this.contract.response[statusCode];
    if (!responseSchemaOrWithExamples) {
      // No schema defined for this status code, pass through
      return { success: true };
    }

    const responseSchema = isResponseSchemaWithExamples(responseSchemaOrWithExamples)
      ? responseSchemaOrWithExamples.schema
      : responseSchemaOrWithExamples;

    const result = responseSchema.safeParse(responseBody);
    if (!result.success) {
      const errors: ContractValidationError[] = [
        {
          type: "response",
          issues: zodErrorToIssues(result.error),
        },
      ];

      // 커스텀 핸들러 호출
      this.options.onResponseViolation(errors, statusCode);

      return {
        success: false,
        errors,
      };
    }

    return { success: true, data: result.data };
  }

  /**
   * Validate response and return error Response in strict mode
   * @param response - The original Response object
   * @returns Original response or error response
   */
  async validateResponseStrict(response: Response): Promise<{
    valid: boolean;
    response: Response;
    errors?: ContractValidationError[];
  }> {
    // Clone response to read body
    const cloned = response.clone();
    const contentType = response.headers.get("content-type") || "";

    // Only validate JSON responses
    if (!contentType.includes("application/json")) {
      return { valid: true, response };
    }

    let body: unknown;
    try {
      body = await cloned.json();
    } catch {
      return { valid: true, response }; // Can't parse, skip validation
    }

    const result = this.validateResponse(body, response.status);

    if (!result.success) {
      if (this.options.mode === "strict") {
        // strict 모드: 에러 응답 반환
        const errorResponse = Response.json(
          {
            errorType: "CONTRACT_VIOLATION",
            code: "MANDU_C001",
            message: "Response does not match contract schema",
            summary: "응답이 Contract 스키마와 일치하지 않습니다",
            statusCode: response.status,
            violations: result.errors,
            timestamp: new Date().toISOString(),
          },
          { status: 500 }
        );
        return { valid: false, response: errorResponse, errors: result.errors };
      } else {
        // lenient 모드: 경고만 출력하고 원래 응답 반환
        console.warn(
          "\x1b[33m[Mandu] Contract violation in response:\x1b[0m",
          result.errors
        );
        return { valid: false, response, errors: result.errors };
      }
    }

    return { valid: true, response };
  }

  /**
   * Get all defined methods in this contract
   */
  getMethods(): string[] {
    return Object.keys(this.contract.request).filter((key) =>
      ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(key)
    );
  }

  /**
   * Get all defined status codes in this contract
   */
  getStatusCodes(): number[] {
    return Object.keys(this.contract.response)
      .filter((k) => /^\d+$/.test(k))
      .map((k) => parseInt(k, 10));
  }

  /**
   * Check if method has request schema
   */
  hasMethodSchema(method: string): boolean {
    return !!this.contract.request[method];
  }

  /**
   * Check if status code has response schema
   */
  hasResponseSchema(statusCode: number): boolean {
    return !!this.contract.response[statusCode];
  }

  /**
   * Get the underlying contract schema
   */
  getSchema(): ContractSchema {
    return this.contract;
  }
}

/**
 * Format validation errors for HTTP response
 */
export function formatValidationErrors(errors: ContractValidationError[]): {
  error: string;
  details: Array<{
    type: string;
    issues: Array<{
      path: string;
      message: string;
    }>;
  }>;
} {
  return {
    error: "Validation Error",
    details: errors.map((e) => ({
      type: e.type,
      issues: e.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    })),
  };
}
