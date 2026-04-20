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

// ═══════════════════════════════════════════════════════════════════════════
// Phase 18.κ — Typed RPC Client (tRPC-like)
// ═══════════════════════════════════════════════════════════════════════════
//
// `createRpcClient<typeof postsRpc>()` returns a Proxy whose properties
// are the RPC procedure names (`list`, `get`, …). Each access produces
// an async function whose input type is the procedure's Zod input
// type and whose return type is the procedure's Zod output type.
//
// Wire protocol:
//   POST <baseUrl>/<method>
//   body: { "input": <value> }
//   response: { "ok": true, "data": <value> }
//            | { "ok": false, "error": { code, message, issues? } }
//
// Errors throw {@link RpcCallError} with the structured fields
// preserved so UI code can surface field-level validation issues.

import type { RpcClient, RpcDefinition, RpcProcedureRecord, RpcWireEnvelope, RpcWireError } from "../contract/rpc";

/** Options passed to {@link createRpcClient}. */
export interface CreateRpcClientOptions {
  /**
   * Absolute or site-relative base URL for the RPC endpoint —
   * typically `/api/rpc/<name>`. The method name is appended.
   */
  baseUrl: string;
  /** Extra headers sent with every call. */
  headers?: Record<string, string>;
  /** Custom fetch (e.g. test double or node-fetch polyfill). */
  fetch?: typeof globalThis.fetch;
  /**
   * Optional per-call AbortSignal factory. Useful when the proxy is
   * shared across React components that want independent cancellation.
   */
  signal?: AbortSignal;
}

/**
 * Typed error thrown by {@link createRpcClient} calls on non-OK
 * envelopes. Carries the wire-level {@link RpcWireError} + HTTP
 * status so callers can distinguish validation vs. handler errors
 * without string-matching on `message`.
 */
export class RpcCallError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: RpcWireError
  ) {
    super(`[Mandu RPC] ${error.code}: ${error.message}`);
    this.name = "RpcCallError";
  }

  /** Machine-readable code (forwarded from the server). */
  get code(): string {
    return this.error.code;
  }

  /** Field-level issues, if any. */
  get issues(): RpcWireError["issues"] {
    return this.error.issues;
  }
}

/**
 * Create a typed RPC client from an `RpcDefinition` type import.
 *
 * The implementation uses a `Proxy` so no codegen step is required —
 * TypeScript infers call signatures from the imported `typeof` at
 * compile time, and at runtime every property access produces a
 * fetch wrapper.
 *
 * @example
 * ```ts
 * import { createRpcClient } from "@mandujs/core/client";
 * import type { postsRpc } from "../server/rpc/posts";
 *
 * const api = createRpcClient<typeof postsRpc>({ baseUrl: "/api/rpc/posts" });
 * const posts = await api.list({ limit: 20 });   // fully typed
 * const post  = await api.get({ id: "abc" });    // fully typed
 * ```
 *
 * Type-check failures at the call site are real compile errors:
 * `api.list({ limit: "not-a-number" })` is a TS2322.
 */
export function createRpcClient<TDef extends RpcDefinition<RpcProcedureRecord>>(
  options: CreateRpcClientOptions
): RpcClient<TDef> {
  const baseFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const baseHeaders = options.headers ?? {};

  const call = async (method: string, input: unknown): Promise<unknown> => {
    const url = `${baseUrl}/${method}`;
    const payload = input === undefined ? { input: undefined } : { input };
    const response = await baseFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...baseHeaders,
      },
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    // Prefer JSON parse (every legitimate RPC response is JSON), but
    // tolerate non-JSON failure paths (e.g. upstream proxy error).
    let envelope: RpcWireEnvelope | null = null;
    const text = await response.text();
    try {
      envelope = text.length > 0 ? (JSON.parse(text) as RpcWireEnvelope) : null;
    } catch {
      envelope = null;
    }

    if (envelope && envelope.ok === true) {
      return envelope.data;
    }

    // Non-OK path — throw a structured error. Prefer server-emitted
    // envelope; fall back to a synthesized one for transport errors.
    let error: RpcWireError;
    if (envelope && envelope.ok === false) {
      error = envelope.error;
    } else {
      error = {
        code: response.ok ? "BAD_RESPONSE" : `HTTP_${response.status}`,
        message:
          text.length > 0
            ? text.slice(0, 500)
            : `RPC call to ${url} failed with HTTP ${response.status}`,
      };
    }
    throw new RpcCallError(response.status, error);
  };

  // A Proxy on a plain object: every property access returns a
  // pre-curried call fn. Symbol keys (`Symbol.toStringTag`, etc.) fall
  // through so `console.log(api)` does not throw.
  const target = Object.create(null) as Record<string, unknown>;
  return new Proxy(target, {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      // Allow common non-method inspection hooks to no-op.
      if (prop === "then") return undefined; // not thenable
      if (prop === "toJSON") return undefined;
      return (input?: unknown) => call(prop, input);
    },
  }) as RpcClient<TDef>;
}

