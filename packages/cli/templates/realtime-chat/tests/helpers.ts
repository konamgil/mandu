// Mandu Test Helpers
// 테스트에서 사용할 유틸리티 함수들

import type { Request } from "bun";

/**
 * API 핸들러 테스트용 Request 생성
 */
export function createTestRequest(
  url: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  }
): Request {
  const { method = "GET", body, headers = {} } = options || {};

  return new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Response를 JSON으로 파싱
 */
export async function parseJsonResponse<T = unknown>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

/**
 * Response 상태 검증
 */
export function assertStatus(response: Response, expectedStatus: number): void {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}`
    );
  }
}

/**
 * 테스트용 라우트 파라미터 생성
 */
export function createParams(params: Record<string, string>): Record<string, string> {
  return params;
}
