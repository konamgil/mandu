/**
 * Mandu RPC Client
 * Contract 정의에서 타입 안전한 API 클라이언트 생성
 */

// ========== Types ==========

/** RPC 클라이언트 에러 */
export class RpcError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(`API Error ${status}`);
    this.name = "RpcError";
  }
}

export interface RpcRequestOptions {
  query?: Record<string, unknown>;
  body?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface RpcClientOptions {
  /** API base URL (기본: 현재 origin) */
  baseUrl?: string;
  /** 공통 헤더 */
  headers?: Record<string, string>;
  /** 커스텀 fetch (테스트용) */
  fetch?: typeof globalThis.fetch;
}

// ========== Implementation ==========

/**
 * Contract 기반 타입 안전 RPC 클라이언트 생성
 *
 * @example
 * ```typescript
 * import { createClient } from "@mandujs/core/client";
 * import type todoContract from "../spec/contracts/api-todos.contract";
 *
 * const api = createClient<typeof todoContract>("/api/todos");
 *
 * // 타입 추론 동작
 * const { todos } = await api.get({ query: { page: 2 } });
 * const { id } = await api.post({ body: { title: "New" } });
 * ```
 */
export function createClient<TContract = unknown>(
  path: string,
  options?: RpcClientOptions
): RpcMethods {
  const baseFetch = options?.fetch ?? globalThis.fetch;
  const baseUrl = options?.baseUrl ?? "";
  const baseHeaders = options?.headers ?? {};

  function makeRequest(method: string) {
    return async (input?: RpcRequestOptions): Promise<unknown> => {
      const url = new URL(`${baseUrl}${path}`, typeof window !== "undefined" ? window.location.origin : "http://localhost");

      // URL 파라미터 치환
      if (input?.params) {
        let resolvedPath = url.pathname;
        for (const [key, value] of Object.entries(input.params)) {
          resolvedPath = resolvedPath.replace(`:${key}`, encodeURIComponent(value));
        }
        // 미해결 파라미터 검출
        if (resolvedPath.includes(":")) {
          throw new RpcError(0, `Unresolved path params in "${resolvedPath}". Check your params object.`);
        }
        url.pathname = resolvedPath;
      }

      // Query 파라미터
      if (input?.query) {
        for (const [key, value] of Object.entries(input.query)) {
          if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
          }
        }
      }

      const headers: Record<string, string> = {
        ...baseHeaders,
        ...input?.headers,
        "Accept": "application/json",
      };

      const fetchOptions: RequestInit = {
        method: method.toUpperCase(),
        headers,
        signal: input?.signal,
      };

      // Body (GET/HEAD 제외)
      if (input?.body && method !== "GET" && method !== "HEAD") {
        fetchOptions.body = JSON.stringify(input.body);
        headers["Content-Type"] = "application/json";
      }

      const response = await baseFetch(url.toString(), fetchOptions);

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = await response.text().catch(() => null);
        }
        throw new RpcError(response.status, body);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        return response.json();
      }
      return response.text();
    };
  }

  return {
    get: makeRequest("GET"),
    post: makeRequest("POST"),
    put: makeRequest("PUT"),
    patch: makeRequest("PATCH"),
    delete: makeRequest("DELETE"),
  };
}

export interface RpcMethods {
  get: (input?: RpcRequestOptions) => Promise<unknown>;
  post: (input?: RpcRequestOptions) => Promise<unknown>;
  put: (input?: RpcRequestOptions) => Promise<unknown>;
  patch: (input?: RpcRequestOptions) => Promise<unknown>;
  delete: (input?: RpcRequestOptions) => Promise<unknown>;
}
