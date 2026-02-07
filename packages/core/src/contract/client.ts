/**
 * Mandu Contract Client
 * Contract 기반 타입 안전 클라이언트
 *
 * tRPC/Elysia Eden 패턴 채택:
 * - Contract에서 클라이언트 타입 자동 추론
 * - 타입 안전 fetch 호출
 */

import type { z } from "zod";
import type {
  ContractSchema,
  ContractMethod,
  MethodRequestSchema,
} from "./schema";
import type { InferResponseSchema } from "./types";
import { TIMEOUTS } from "../constants";

/**
 * Client options for making requests
 */
export interface ClientOptions {
  /** Base URL for API requests */
  baseUrl: string;
  /** Default headers for all requests */
  headers?: Record<string, string>;
  /** Custom fetch function (for SSR or testing) */
  fetch?: typeof fetch;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Request options for a specific call
 */
export interface RequestOptions<
  TQuery = unknown,
  TBody = unknown,
  TParams = unknown,
  THeaders = Record<string, string>,
> {
  query?: TQuery;
  body?: TBody;
  params?: TParams;
  headers?: THeaders;
  signal?: AbortSignal;
}

/**
 * Client response wrapper
 */
export interface ClientResponse<T> {
  data: T;
  status: number;
  headers: Headers;
  ok: boolean;
}

/**
 * Infer request options from method schema
 */
type InferRequestOptions<T extends MethodRequestSchema | undefined> =
  T extends MethodRequestSchema
    ? RequestOptions<
        T["query"] extends z.ZodTypeAny ? z.input<T["query"]> : undefined,
        T["body"] extends z.ZodTypeAny ? z.input<T["body"]> : undefined,
        T["params"] extends z.ZodTypeAny ? z.input<T["params"]> : undefined,
        T["headers"] extends z.ZodTypeAny
          ? z.input<T["headers"]>
          : Record<string, string>
      >
    : RequestOptions<undefined, undefined, undefined, Record<string, string>>;

/**
 * Infer success response from contract
 */
type InferSuccessResponse<TResponse extends ContractSchema["response"]> =
  InferResponseSchema<TResponse[200]> extends never
    ? InferResponseSchema<TResponse[201]> extends never
      ? unknown
      : InferResponseSchema<TResponse[201]>
    : InferResponseSchema<TResponse[200]>;

/**
 * Contract client method
 */
export type ContractClientMethod<
  T extends MethodRequestSchema | undefined,
  TResponse extends ContractSchema["response"],
> = (
  options?: InferRequestOptions<T>
) => Promise<ClientResponse<InferSuccessResponse<TResponse>>>;

/**
 * Contract client interface
 */
export type ContractClient<T extends ContractSchema> = {
  [M in Extract<keyof T["request"], ContractMethod>]: ContractClientMethod<
    T["request"][M] extends MethodRequestSchema ? T["request"][M] : undefined,
    T["response"]
  >;
};

/**
 * Build query string from object
 */
function buildQueryString(query: Record<string, unknown> | undefined): string {
  if (!query) return "";

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        for (const v of value) {
          params.append(key, String(v));
        }
      } else {
        params.append(key, String(value));
      }
    }
  }

  const str = params.toString();
  return str ? `?${str}` : "";
}

/**
 * Replace path parameters in URL
 */
function replacePathParams(
  path: string,
  params: Record<string, unknown> | undefined
): string {
  if (!params) return path;

  let result = path;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`:${key}`, encodeURIComponent(String(value)));
    result = result.replace(`[${key}]`, encodeURIComponent(String(value)));
  }
  return result;
}

/**
 * Create a type-safe client from a contract
 *
 * @example
 * ```typescript
 * const userContract = Mandu.contract({
 *   request: {
 *     GET: { query: z.object({ page: z.number() }) },
 *     POST: { body: z.object({ name: z.string() }) },
 *   },
 *   response: {
 *     200: z.object({ users: z.array(UserSchema) }),
 *     201: z.object({ user: UserSchema }),
 *   },
 * });
 *
 * const client = createClient(userContract, {
 *   baseUrl: "http://localhost:3000/api/users",
 * });
 *
 * // Type-safe calls
 * const users = await client.GET({ query: { page: 1 } });
 * // users.data is typed as { users: User[] }
 *
 * const newUser = await client.POST({ body: { name: "Alice" } });
 * // newUser.data is typed as { user: User }
 * ```
 */
export function createClient<T extends ContractSchema>(
  _contract: T,
  options: ClientOptions
): ContractClient<T> {
  const {
    baseUrl,
    headers: defaultHeaders = {},
    fetch: customFetch = fetch,
    timeout = TIMEOUTS.CLIENT_DEFAULT,
  } = options;

  const methods: ContractMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

  const client = {} as ContractClient<T>;

  for (const method of methods) {
    // @ts-expect-error - Dynamic method assignment
    client[method] = async (
      requestOptions: RequestOptions = {}
    ): Promise<ClientResponse<unknown>> => {
      const { query, body, params, headers = {}, signal } = requestOptions;

      // Build URL
      let url = replacePathParams(baseUrl, params as Record<string, unknown>);
      url += buildQueryString(query as Record<string, unknown>);

      // Build request options
      const fetchOptions: RequestInit = {
        method,
        headers: {
          ...defaultHeaders,
          ...headers,
        },
        signal,
      };

      // Add body for non-GET methods
      if (body && method !== "GET") {
        fetchOptions.headers = {
          ...fetchOptions.headers,
          "Content-Type": "application/json",
        };
        fetchOptions.body = JSON.stringify(body);
      }

      // Add timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      if (!signal) {
        fetchOptions.signal = controller.signal;
      }

      try {
        const response = await customFetch(url, fetchOptions);
        clearTimeout(timeoutId);

        let data: unknown;
        const contentType = response.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        return {
          data,
          status: response.status,
          headers: response.headers,
          ok: response.ok,
        };
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    };
  }

  return client;
}

/**
 * Type-safe fetch wrapper for a single endpoint
 *
 * @example
 * ```typescript
 * const result = await contractFetch(userContract, "GET", "/api/users", {
 *   query: { page: 1, limit: 10 },
 * });
 * // result.data is typed based on contract response
 * ```
 */
export async function contractFetch<
  T extends ContractSchema,
  M extends Extract<keyof T["request"], ContractMethod>,
>(
  _contract: T,
  method: M,
  url: string,
  options: InferRequestOptions<
    T["request"][M] extends MethodRequestSchema ? T["request"][M] : undefined
  > = {} as InferRequestOptions<
    T["request"][M] extends MethodRequestSchema ? T["request"][M] : undefined
  >,
  clientOptions: Partial<ClientOptions> = {}
): Promise<ClientResponse<InferSuccessResponse<T["response"]>>> {
  const {
    query,
    body,
    params,
    headers = {},
    signal,
  } = options as RequestOptions;

  const {
    headers: defaultHeaders = {},
    fetch: customFetch = fetch,
    timeout = TIMEOUTS.CLIENT_DEFAULT,
  } = clientOptions;

  // Build URL
  let finalUrl = replacePathParams(url, params as Record<string, unknown>);
  finalUrl += buildQueryString(query as Record<string, unknown>);

  // Build request options
  const fetchOptions: RequestInit = {
    method,
    headers: {
      ...defaultHeaders,
      ...(headers as Record<string, string>),
    },
    signal,
  };

  // Add body for non-GET methods
  if (body && method !== "GET") {
    fetchOptions.headers = {
      ...fetchOptions.headers,
      "Content-Type": "application/json",
    };
    fetchOptions.body = JSON.stringify(body);
  }

  // Add timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  if (!signal) {
    fetchOptions.signal = controller.signal;
  }

  try {
    const response = await customFetch(finalUrl, fetchOptions);
    clearTimeout(timeoutId);

    let data: unknown;
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      data: data as InferSuccessResponse<T["response"]>,
      status: response.status,
      headers: response.headers,
      ok: response.ok,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
