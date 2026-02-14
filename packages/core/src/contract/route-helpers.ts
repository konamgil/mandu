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

export function querySchema<TSchema extends ZodTypeAny>(schema: TSchema) {
  return (source: QuerySource): z.infer<TSchema> => {
    const params = toSearchParams(source);
    return schema.parse(paramsToObject(params));
  };
}

export function bodySchema<TSchema extends ZodTypeAny>(schema: TSchema) {
  return async (request: Request): Promise<z.infer<TSchema>> => {
    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().includes("application/json")) {
      throw new TypeError("Body must be application/json");
    }

    const payload = await request.clone().json();
    return schema.parse(payload);
  };
}

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
