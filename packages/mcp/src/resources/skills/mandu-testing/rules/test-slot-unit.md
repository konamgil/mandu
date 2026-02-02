---
title: Unit Test Slot Handlers
impact: HIGH
impactDescription: Ensures API correctness
tags: testing, slot, unit, bun-test
---

## Unit Test Slot Handlers

**Impact: HIGH (Ensures API correctness)**

slot 핸들러를 단위 테스트하여 API 로직의 정확성을 검증하세요.

**기본 테스트 구조:**

```typescript
// spec/slots/users.slot.test.ts
import { describe, it, expect, beforeEach, mock } from "bun:test";
import usersSlot from "./users.slot";
import { createMockContext } from "@/test/helpers";

describe("Users Slot", () => {
  describe("GET /users", () => {
    it("should return list of users", async () => {
      // Arrange
      const ctx = createMockContext({
        method: "GET",
        query: { page: "1", limit: "10" },
      });

      // Act
      const response = await usersSlot.handlers.get(ctx);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.users).toBeArray();
      expect(response.body.total).toBeNumber();
    });

    it("should filter by role", async () => {
      const ctx = createMockContext({
        method: "GET",
        query: { role: "admin" },
      });

      const response = await usersSlot.handlers.get(ctx);

      expect(response.status).toBe(200);
      expect(response.body.users.every(u => u.role === "admin")).toBe(true);
    });
  });

  describe("POST /users", () => {
    it("should create a new user", async () => {
      const ctx = createMockContext({
        method: "POST",
        body: { email: "test@example.com", name: "Test User" },
      });

      const response = await usersSlot.handlers.post(ctx);

      expect(response.status).toBe(201);
      expect(response.body.user.email).toBe("test@example.com");
    });

    it("should return 400 for invalid email", async () => {
      const ctx = createMockContext({
        method: "POST",
        body: { email: "invalid-email", name: "Test" },
      });

      const response = await usersSlot.handlers.post(ctx);

      expect(response.status).toBe(400);
      expect(response.body.errors).toBeDefined();
    });
  });
});
```

## Mock Context 헬퍼

```typescript
// test/helpers.ts
interface MockContextOptions {
  method?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  user?: { id: string; role: string } | null;
}

export function createMockContext(options: MockContextOptions = {}) {
  const store = new Map<string, unknown>();

  // 사용자 설정
  if (options.user) {
    store.set("user", options.user);
  }

  return {
    req: {
      method: options.method || "GET",
    },
    params: options.params || {},
    query: options.query || {},
    headers: {
      get: (key: string) => options.headers?.[key.toLowerCase()] || null,
    },

    body: async <T>() => options.body as T,

    get: <T>(key: string) => store.get(key) as T,
    set: (key: string, value: unknown) => store.set(key, value),

    // 응답 메서드
    ok: (data: unknown) => ({ status: 200, body: data }),
    created: (data: unknown) => ({ status: 201, body: data }),
    noContent: () => ({ status: 204, body: null }),
    error: (data: unknown) => ({ status: 400, body: data }),
    unauthorized: (msg?: string) => ({ status: 401, body: { message: msg } }),
    forbidden: (msg?: string) => ({ status: 403, body: { message: msg } }),
    notFound: (msg?: string) => ({ status: 404, body: { message: msg } }),
    fail: (msg?: string) => ({ status: 500, body: { message: msg } }),
  };
}
```

## Guard 테스트

```typescript
describe("Guard", () => {
  it("should reject unauthenticated requests", async () => {
    const ctx = createMockContext({
      user: null,  // 인증 안 됨
    });

    const response = await usersSlot.guard(ctx);

    expect(response.status).toBe(401);
  });

  it("should allow authenticated requests", async () => {
    const ctx = createMockContext({
      user: { id: "1", role: "user" },
    });

    const response = await usersSlot.guard(ctx);

    expect(response).toBeUndefined();  // void = 통과
  });
});
```

## 데이터베이스 모킹

```typescript
import { mock } from "bun:test";
import * as db from "@/lib/db";

// 모듈 모킹
mock.module("@/lib/db", () => ({
  user: {
    findMany: mock(() => [
      { id: "1", email: "test@example.com" },
    ]),
    create: mock((data) => ({ id: "2", ...data.data })),
  },
}));
```

## 테스트 실행

```bash
# 모든 테스트
bun test

# 특정 파일
bun test spec/slots/users.slot.test.ts

# 패턴 매칭
bun test --filter "Users"

# Watch 모드
bun test --watch

# 커버리지
bun test --coverage
```

Reference: [Bun Test Runner](https://bun.sh/docs/cli/test)
