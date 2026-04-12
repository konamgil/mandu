/**
 * Mandu Testing Utilities
 * 서버 없이 라우트/filling 단위 테스트
 */

import { ManduContext } from "../filling/context";
import type { ManduFilling } from "../filling/filling";

// ========== Types ==========

export interface TestRequestOptions {
  method?: string;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  /** Action 이름 — 자동으로 _action을 body에 삽입하고 ManduAction 헤더를 추가 */
  action?: string;
}

// ========== testFilling ==========

/**
 * Filling 단위 테스트 — 서버 없이 직접 실행
 *
 * @example
 * ```typescript
 * import { testFilling } from "@mandujs/core/testing";
 * import todoRoute from "./app/api/todos/route";
 *
 * const res = await testFilling(todoRoute, {
 *   method: "GET",
 *   query: { page: "2" },
 * });
 * expect(res.status).toBe(200);
 *
 * const data = await res.json();
 * expect(data.todos).toHaveLength(10);
 * ```
 */
export async function testFilling(
  filling: ManduFilling,
  options: TestRequestOptions = {}
): Promise<Response> {
  const {
    method: rawMethod,
    query,
    body: rawBody,
    headers: rawHeaders = {},
    params = {},
    action,
  } = options;

  // action 지정 시 자동으로 POST + _action body + ManduAction 헤더
  const method = rawMethod ?? (action ? "POST" : "GET");
  const headers = { ...rawHeaders };
  let body = rawBody;

  if (action) {
    headers["X-Requested-With"] = "ManduAction";
    headers["Accept"] = "application/json";
    if (body && typeof body === "object" && !(body instanceof FormData)) {
      body = { _action: action, ...(body as Record<string, unknown>) };
    } else if (!body) {
      body = { _action: action };
    }
  }

  const url = new URL("http://localhost/test");
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const requestInit: RequestInit = {
    method,
    headers,
  };

  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    if (body instanceof FormData) {
      requestInit.body = body;
    } else {
      requestInit.body = JSON.stringify(body);
      (requestInit.headers as Record<string, string>)["Content-Type"] = "application/json";
    }
  }

  const request = new Request(url.toString(), requestInit);
  return filling.handle(request, params);
}

/**
 * 간단한 Request 생성 헬퍼
 *
 * @example
 * ```typescript
 * const req = createTestRequest("/api/todos", { method: "POST", body: { title: "test" } });
 * ```
 */
export function createTestRequest(
  path: string,
  options: TestRequestOptions = {}
): Request {
  const { method = "GET", query, body, headers = {} } = options;

  const url = new URL(`http://localhost${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const requestInit: RequestInit = { method, headers: { ...headers } };

  if (body !== undefined && method !== "GET" && method !== "HEAD") {
    if (body instanceof FormData) {
      requestInit.body = body;
    } else {
      requestInit.body = JSON.stringify(body);
      (requestInit.headers as Record<string, string>)["Content-Type"] = "application/json";
    }
  }

  return new Request(url.toString(), requestInit);
}

/**
 * ManduContext 테스트용 생성 헬퍼
 *
 * @example
 * ```typescript
 * const ctx = createTestContext("/api/users/123", { params: { id: "123" } });
 * expect(ctx.params.id).toBe("123");
 * ```
 */
export function createTestContext(
  path: string,
  options: TestRequestOptions = {}
): ManduContext {
  const request = createTestRequest(path, options);
  return new ManduContext(request, options.params);
}
