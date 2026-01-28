/**
 * Mandu Contract Validator
 * 런타임 요청/응답 검증
 */

import type { z } from "zod";
import type {
  ContractSchema,
  ContractValidationResult,
  ContractValidationError,
  ContractValidationIssue,
  MethodRequestSchema,
} from "./schema";

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
  constructor(private contract: ContractSchema) {}

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
   * Validate response against contract (development mode)
   * @param responseBody - The response body (already parsed)
   * @param statusCode - HTTP status code
   */
  validateResponse(responseBody: unknown, statusCode: number): ContractValidationResult {
    const responseSchema = this.contract.response[statusCode];
    if (!responseSchema) {
      // No schema defined for this status code, pass through
      return { success: true };
    }

    const result = responseSchema.safeParse(responseBody);
    if (!result.success) {
      return {
        success: false,
        errors: [
          {
            type: "response",
            issues: zodErrorToIssues(result.error),
          },
        ],
      };
    }

    return { success: true, data: result.data };
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
