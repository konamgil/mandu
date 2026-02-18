import type { ManduError } from "./types";
import { ErrorCode } from "./types";
import { formatErrorResponse } from "./formatter";

/**
 * Result 타입 - 성공/실패를 명시적으로 표현
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: ManduError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (error: ManduError): Result<never> => ({ ok: false, error });

/**
 * Result가 성공인지 검사하는 type guard
 */
export function isOk<T>(result: Result<T>): result is { ok: true; value: T } {
  return result.ok === true;
}

/**
 * Result가 실패인지 검사하는 type guard
 */
export function isErr<T>(result: Result<T>): result is { ok: false; error: ManduError } {
  return result.ok === false;
}

/**
 * ManduError -> HTTP status 매핑
 */
export function statusFromError(error: ManduError): number {
  if (typeof error.httpStatus === "number") {
    return error.httpStatus;
  }

  switch (error.code) {
    case ErrorCode.SPEC_NOT_FOUND:
      return 404;
    case ErrorCode.SPEC_PARSE_ERROR:
    case ErrorCode.SPEC_VALIDATION_ERROR:
    case ErrorCode.SPEC_ROUTE_DUPLICATE:
      return 400;
    case ErrorCode.SPEC_ROUTE_NOT_FOUND:
      return 404;
    case ErrorCode.SLOT_VALIDATION_ERROR:
      return 400;
    default:
      return 500;
  }
}

/**
 * 에러를 Response로 변환
 */
export function errorToResponse(error: ManduError, isDev: boolean): Response {
  return Response.json(formatErrorResponse(error, { isDev }), {
    status: statusFromError(error),
  });
}
