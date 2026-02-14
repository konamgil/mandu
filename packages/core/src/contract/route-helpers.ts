import { z, type ZodTypeAny } from "zod";

export type ApiErrorCode = string;

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
}

export interface ApiErrorOptions {
  status?: number;
  details?: unknown;
  headers?: HeadersInit;
}

export type QuerySource =
  | Request
  | URL
  | URLSearchParams
  | string
  | Record<string, string | number | boolean | null | undefined>;

function toSearchParams(source: QuerySource): URLSearchParams {
  if (source instanceof Request) {
    return new URL(source.url).searchParams;
  }

  if (source instanceof URL) {
    return source.searchParams;
  }

  if (source instanceof URLSearchParams) {
    return source;
  }

  if (typeof source === "string") {
    const raw = source.startsWith("?") ? source.slice(1) : source;
    return new URLSearchParams(raw);
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  return params;
}

function paramsToObject(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of params.entries()) {
    const prev = out[key];
    if (prev === undefined) {
      out[key] = value;
      continue;
    }
    if (Array.isArray(prev)) {
      prev.push(value);
      continue;
    }
    out[key] = [prev, value];
  }
  return out;
}

/**
 * Creates a parser for URL query parameters with Zod schema validation
 *
 * @param schema - Zod schema for validation
 * @returns Parser function that accepts various query sources
 *
 * @example
 * ```ts
 * const parseQuery = querySchema(z.object({
 *   page: z.coerce.number().default(1),
 *   limit: z.coerce.number().max(100).default(20)
 * }));
 *
 * const query = parseQuery(request);
 * ```
 */
export function querySchema<TSchema extends ZodTypeAny>(schema: TSchema) {
  return (source: QuerySource): z.infer<TSchema> => {
    const params = toSearchParams(source);
    return schema.parse(paramsToObject(params));
  };
}

/**
 * Creates a parser for JSON request body with Zod schema validation
 *
 * Validates Content-Type (application/json or application/*+json) and parses JSON.
 * Throws TypeError for invalid content-type or malformed JSON.
 *
 * @param schema - Zod schema for validation
 * @returns Async parser function that accepts Request
 *
 * @example
 * ```ts
 * const parseBody = bodySchema(z.object({
 *   text: z.string().min(1).max(500)
 * }));
 *
 * const body = await parseBody(request);
 * ```
 */
export function bodySchema<TSchema extends ZodTypeAny>(schema: TSchema) {
  return async (request: Request): Promise<z.infer<TSchema>> => {
    const contentType = request.headers.get("content-type") ?? "";

    if (!/^application\/(.+\+json|json)$/i.test(contentType.split(";")[0]?.trim() ?? "")) {
      throw new TypeError("Body must be application/json");
    }

    let payload: unknown;
    try {
      payload = await request.clone().json();
    } catch {
      throw new TypeError("Request body contains invalid JSON");
    }

    return schema.parse(payload);
  };
}

/**
 * Creates a standardized API error response
 *
 * Returns Response with JSON payload: { error, code, details? }
 *
 * @param error - Human-readable error message
 * @param code - Machine-readable error code
 * @param options - Optional status (default 400), details, and headers
 * @returns Response with error payload
 *
 * @example
 * ```ts
 * return apiError("Invalid input", "VALIDATION_ERROR", {
 *   status: 422,
 *   details: { field: "email", issue: "Invalid format" }
 * });
 * ```
 */
export function apiError(error: string, code: ApiErrorCode, options: ApiErrorOptions = {}): Response {
  const { status = 400, details, headers } = options;
  const payload: ApiErrorBody & { details?: unknown } = { error, code };

  if (details !== undefined) {
    payload.details = details;
  }

  return Response.json(payload, {
    status,
    headers,
  });
}
