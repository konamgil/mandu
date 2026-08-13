---
title: Mock Fetch Requests in Tests
impact: MEDIUM
impactDescription: Isolates tests from external dependencies
tags: testing, mock, fetch, api
---

## Mock Fetch Requests in Tests

**Impact: MEDIUM (Isolates tests from external dependencies)**

외부 API 호출을 모킹하여 테스트를 격리하고 빠르게 실행하세요.

**기본 fetch 모킹:**

```typescript
// tests/helpers/mockFetch.ts
import { mock, beforeEach, afterEach } from "bun:test";

const originalFetch = global.fetch;

export function mockFetch(responses: Record<string, unknown>) {
  global.fetch = mock((url: string, options?: RequestInit) => {
    const key = `${options?.method || "GET"} ${url}`;
    const response = responses[key];

    if (!response) {
      return Promise.reject(new Error(`No mock for: ${key}`));
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(response),
      text: () => Promise.resolve(JSON.stringify(response)),
    } as Response);
  });
}

export function restoreFetch() {
  global.fetch = originalFetch;
}
```

**사용 예시:**

```typescript
// app/users/client.test.tsx
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { mockFetch, restoreFetch } from "@/tests/helpers/mockFetch";
import { UserListIsland } from "./client";

describe("UserListIsland", () => {
  beforeEach(() => {
    mockFetch({
      "GET /api/users": {
        users: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
      },
      "POST /api/users": {
        user: { id: 3, name: "Charlie" },
      },
    });
  });

  afterEach(() => {
    restoreFetch();
  });

  it("should fetch and display users", async () => {
    render(<UserListIsland />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeDefined();
      expect(screen.getByText("Bob")).toBeDefined();
    });
  });
});
```

## 조건부 응답 모킹

```typescript
export function createMockFetch() {
  const mocks: Array<{
    match: (url: string, options?: RequestInit) => boolean;
    response: () => Promise<Response>;
  }> = [];

  const mockFn = mock((url: string, options?: RequestInit) => {
    for (const { match, response } of mocks) {
      if (match(url, options)) {
        return response();
      }
    }
    return Promise.reject(new Error(`No mock for: ${url}`));
  });

  return {
    mock: mockFn,
    when: (pattern: string | RegExp) => ({
      respond: (data: unknown, status = 200) => {
        mocks.push({
          match: (url) =>
            typeof pattern === "string"
              ? url.includes(pattern)
              : pattern.test(url),
          response: () =>
            Promise.resolve({
              ok: status >= 200 && status < 300,
              status,
              json: () => Promise.resolve(data),
            } as Response),
        });
      },
      reject: (error: Error) => {
        mocks.push({
          match: (url) =>
            typeof pattern === "string"
              ? url.includes(pattern)
              : pattern.test(url),
          response: () => Promise.reject(error),
        });
      },
    }),
    install: () => {
      global.fetch = mockFn;
    },
    restore: () => {
      global.fetch = originalFetch;
    },
  };
}
```

**사용:**

```typescript
const fetchMock = createMockFetch();

beforeEach(() => {
  fetchMock.when("/api/users").respond({ users: [] });
  fetchMock.when("/api/users/1").respond({ user: { id: 1, name: "Alice" } });
  fetchMock.when("/api/error").respond({ message: "Error" }, 500);
  fetchMock.install();
});

afterEach(() => {
  fetchMock.restore();
});
```

## 에러 응답 테스트

```typescript
it("should handle API error", async () => {
  mockFetch({
    "GET /api/users": { error: "Server error" },
  });
  // status 오버라이드
  global.fetch = mock(() =>
    Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Server error" }),
    } as Response)
  );

  render(<UserListIsland />);

  await waitFor(() => {
    expect(screen.getByText("Failed to load users")).toBeDefined();
  });
});
```

## 네트워크 에러 테스트

```typescript
it("should handle network error", async () => {
  global.fetch = mock(() =>
    Promise.reject(new Error("Network error"))
  );

  render(<UserListIsland />);

  await waitFor(() => {
    expect(screen.getByText("Network error")).toBeDefined();
  });
});
```

## fetch 호출 검증

```typescript
it("should call API with correct params", async () => {
  const mockFn = mock(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ users: [] }),
    } as Response)
  );
  global.fetch = mockFn;

  render(<UserListIsland filter="active" />);

  await waitFor(() => {
    expect(mockFn).toHaveBeenCalledWith(
      "/api/users?filter=active",
      expect.objectContaining({
        method: "GET",
      })
    );
  });
});
```
