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
 *
 * Content negotiation: for the built-in 404 not-found response, inspect the
 * request's `Accept` header. Browser navigation (Accept includes `text/html`)
 * gets a minimal HTML 404 page instead of raw JSON; API/fetch clients keep
 * the JSON error envelope. A custom `app/not-found.tsx` is handled upstream
 * and never reaches this fallback. See GitHub issue #320.
 */
export function errorToResponse(error: ManduError, isDev: boolean, req?: Request): Response {
  const status = statusFromError(error);

  if (status === 404 && req && acceptsHtml(req)) {
    return new Response(renderNotFoundHtml(error.message), {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return Response.json(formatErrorResponse(error, { isDev }), {
    status,
  });
}

/** Whether the request's `Accept` header opts into an HTML response. */
function acceptsHtml(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

/** Escape a string for safe interpolation into HTML text content. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Minimal built-in 404 HTML document for browser navigation. */
function renderNotFoundHtml(message: string): string {
  const safe = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>404 - Not Found</title>
</head>
<body>
<h1>404 - Not Found</h1>
<p>${safe}</p>
</body>
</html>`;
}
