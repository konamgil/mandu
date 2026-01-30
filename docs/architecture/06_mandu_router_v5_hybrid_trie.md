# Router v5: Hybrid Trie Architecture

> **Status**: Implemented (2026-01-30)
> **Version**: 5.0.0
> **Author**: Claude & Team
> **Created**: 2025-01-30
> **Target**: `@mandujs/core/src/runtime/router.ts`
> **Implementation**: `packages/core/src/runtime/router.ts`
> **Tests**: `packages/core/src/runtime/router.test.ts`

---

## 1. Executive Summary

### 1.1 문제 정의

현재 Mandu 라우터는 **선형 탐색(O(n))** 방식으로, 라우트 등록 순서에 따라 매칭 결과가 달라지는 문제가 있다.

```typescript
// 현재 문제 상황
routes: [
  { pattern: "/api/todos/:id" },    // 먼저 등록
  { pattern: "/api/todos/stats" },  // 나중 등록
]

// GET /api/todos/stats → { id: "stats" } 로 잘못 매칭됨
```

### 1.2 해결책

**Hybrid 구조** 도입:
- **Static routes**: `Map<string, RouteSpec>` → O(1)
- **Dynamic routes**: `Trie (Radix Tree)` → O(k), k = path segments

### 1.3 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **Static First** | 정적 라우트가 항상 동적 라우트보다 우선 |
| **Specificity** | 더 구체적인 패턴이 우선 (`/users/me` > `/users/:id`) |
| **Explicit Security** | %2F, double-encoding, malformed UTF-8 명시적 차단 |
| **Fail-Fast Validation** | 등록 시점에 충돌/오류 검출 |

---

## 2. Background & Research

### 2.1 DNA 프레임워크 분석

| Framework | Router Type | Static Handling | Complexity |
|-----------|-------------|-----------------|------------|
| **Hono** | TrieRouter | Trie 내부 처리 | O(k) |
| **Fresh (Deno)** | URLPattern | Map + Array | O(1) + O(n) |
| **Express** | path-to-regexp | Linear scan | O(n) |
| **Fastify** | find-my-way | Radix Tree | O(k) |

### 2.2 선택 근거

```
┌─────────────────────────────────────────────────────────┐
│                    Hybrid Approach                       │
├─────────────────────────────────────────────────────────┤
│  Static Map (O(1))     │     Trie (O(k))                │
│  ─────────────────     │     ─────────                  │
│  /                     │     /users/:id                 │
│  /api/health           │     /api/todos/:id             │
│  /api/todos/stats      │     /files/*                   │
│  /api/todos/bulk       │                                │
└─────────────────────────────────────────────────────────┘

매칭 순서:
1. statics.get(pathname)     // O(1) - 대부분의 요청
2. trie.match(pathname)      // O(k) - 동적 경로만
```

---

## 3. Architecture Design

### 3.1 Data Structures

```typescript
/**
 * Trie 노드 구조 (P0-4 반영)
 *
 * paramChild를 { name, node } 객체로 분리하여
 * 파라미터 이름 충돌 검사를 명확하게 수행
 */
class TrieNode {
  /** 정적 세그먼트 자식 노드들 */
  children: Map<string, TrieNode> = new Map();

  /** 파라미터 자식 (:id, :name 등) */
  paramChild: { name: string; node: TrieNode } | null = null;

  /** 와일드카드 라우트 (*) */
  wildcardRoute: RouteSpec | null = null;

  /** 이 노드에서 끝나는 라우트 */
  route: RouteSpec | null = null;
}

/**
 * Router 클래스 메인 구조
 */
class Router {
  /** 정적 라우트 O(1) 조회용 */
  private statics: Map<string, RouteSpec> = new Map();

  /** 동적 라우트 Trie */
  private trie: TrieNode = new TrieNode();

  /** 중복 체크용 (정규화된 패턴 → routeId) */
  private registeredPatterns: Map<string, string> = new Map();
}
```

### 3.2 Trie 시각화

```
예시 라우트:
  /api/todos/stats      (static)
  /api/todos/bulk       (static)
  /api/todos/:id        (dynamic)
  /users/:id/posts      (dynamic)
  /files/*              (wildcard)

Trie 구조:
                      [root]
                         │
              ┌──────────┼──────────┐
              │          │          │
           "api"     "users"     "files"
              │          │          │
         "todos"     :id ────→ wildcardRoute
              │          │
        ┌─────┼─────┐  "posts"
        │     │     │     │
    "stats" "bulk" :id  [route]
        │     │     │
    [route] [route] [route]

Static Map:
  "/api/todos/stats" → RouteSpec
  "/api/todos/bulk"  → RouteSpec
```

---

## 4. Detailed Specification

### 4.1 Path Normalization (P0-1)

```typescript
/**
 * 경로 정규화
 *
 * 규칙:
 * 1. "/" 는 그대로 유지
 * 2. 그 외 trailing slash 제거: "/api/todos/" → "/api/todos"
 * 3. 연속 슬래시 정규화: "/api//todos" → "/api/todos" (선택적)
 *
 * 중요: 중복 체크는 반드시 정규화된 패턴 기준으로 수행
 */
private normalize(path: string): string {
  if (path === '/') return '/';
  return path.replace(/\/+$/, '');
}

// 등록 시 정규화 적용 (P0-1)
const normalized = this.normalize(pattern);
if (this.registeredPatterns.has(normalized)) {
  throw new RouterError('DUPLICATE_PATTERN', ...);
}
```

### 4.2 Segment-based Wildcard Validation (P0-2)

```typescript
/**
 * 와일드카드 검증
 *
 * 올바른 와일드카드:
 *   /files/*           ✅ 마지막 세그먼트
 *   /api/v1/docs/*     ✅ 마지막 세그먼트
 *
 * 잘못된 와일드카드:
 *   /files/*/more      ❌ 마지막이 아님
 *   /files/a*b         ❌ 세그먼트가 '*'가 아님 (글롭 패턴)
 */
private validateWildcard(segments: string[], routeId: string): void {
  const wildcardIdx = segments.findIndex(s => s === '*');

  if (wildcardIdx !== -1 && wildcardIdx !== segments.length - 1) {
    throw new RouterError(
      `Wildcard must be last segment`,
      'WILDCARD_NOT_LAST',
      routeId
    );
  }
}
```

### 4.3 Parameter Name Conflict Detection (P0-3)

```typescript
/**
 * 파라미터 이름 충돌 검사
 *
 * 충돌 케이스 (같은 Trie 노드에서 다른 param 이름):
 *   /users/:id          + /users/:userId/posts   ❌ PARAM_NAME_CONFLICT
 *   /a/:id              + /a/:name               ❌ PARAM_NAME_CONFLICT
 *
 * 비충돌 케이스 (다른 Trie 경로):
 *   /users/:id          + /posts/:postId         ✅ 다른 부모 노드
 *   /users/:id/comments + /users/:id/likes       ✅ 같은 param 이름
 */
private insertTrie(segments: string[], route: RouteSpec): void {
  let node = this.trie;

  for (const seg of segments) {
    if (seg.startsWith(':')) {
      const paramName = seg.slice(1);

      // 같은 노드에서 다른 param 이름이면 충돌
      if (node.paramChild && node.paramChild.name !== paramName) {
        throw new RouterError(
          `Param name conflict: ":${paramName}" vs ":${node.paramChild.name}"`,
          'PARAM_NAME_CONFLICT',
          route.id
        );
      }

      if (!node.paramChild) {
        node.paramChild = { name: paramName, node: new TrieNode() };
      }
      node = node.paramChild.node;
    }
    // ... 정적 세그먼트 처리
  }
}
```

### 4.4 Wildcard Parameter Key (P0-6)

```typescript
/**
 * 와일드카드 매칭 결과의 params 키
 *
 * 고정 키: '$wildcard'
 *
 * 예시:
 *   pattern: /files/*
 *   path:    /files/a/b/c
 *   result:  { $wildcard: "a/b/c" }
 */
const WILDCARD_PARAM_KEY = '$wildcard';

// 매칭 시
if (wildcardMatch) {
  const remaining = segments.slice(consumedIndex).join('/');
  return {
    route: wildcardMatch.route,
    params: { [WILDCARD_PARAM_KEY]: remaining }
  };
}
```

---

## 5. Security Policies

### 5.1 URI Decoding Security

```typescript
/**
 * 안전한 URI 디코딩
 *
 * 4단계 보안 검사:
 * 1. %2F (encoded slash) 차단 - Path Traversal 방지
 * 2. decodeURIComponent 실행
 * 3. 디코딩 결과에 '/' 포함 시 차단
 * 4. 디코딩 결과에 %2f 포함 시 차단 (double-encoding 방지)
 */
const ENCODED_SLASH_PATTERN = /%2f/i;

function safeDecodeURIComponent(str: string): string | null {
  // 1. Pre-decode %2F check
  if (ENCODED_SLASH_PATTERN.test(str)) {
    return null;
  }

  // 2. Decode
  let decoded: string;
  try {
    decoded = decodeURIComponent(str);
  } catch {
    // Malformed UTF-8
    return null;
  }

  // 3. Post-decode slash check
  if (decoded.includes('/')) {
    return null;
  }

  // 4. Double-encoding check (%252F → %2F)
  if (ENCODED_SLASH_PATTERN.test(decoded)) {
    return null;
  }

  return decoded;
}
```

### 5.2 Security Policy Summary

| Policy | Description | Attack Prevented |
|--------|-------------|------------------|
| **%2F Forbidden** | URL에서 %2F (encoded /) 금지 | Path Traversal |
| **Double-encoding** | %252F → %2F 차단 | WAF Bypass |
| **Malformed UTF-8** | 잘못된 인코딩 차단 | Encoding Attack |
| **Slash in Decoded** | 디코딩 결과에 / 포함 시 차단 | Smuggling |

### 5.3 Wildcard Policy

```typescript
/**
 * Policy A: /files/* 는 /files 와 매칭되지 않음
 *
 * 근거:
 * - 와일드카드는 "하나 이상의 세그먼트"를 의미
 * - /files 자체는 별도 라우트로 등록해야 함
 * - 명시적 > 암시적
 *
 * 예시:
 *   /files/*  + GET /files/a/b  → ✅ { $wildcard: "a/b" }
 *   /files/*  + GET /files      → ❌ null (매칭 안됨)
 *   /files/*  + GET /files/     → ❌ null (normalize 후 /files)
 */
```

---

## 6. Error Codes

### 6.1 RouterError Class (P0-5)

```typescript
/**
 * 라우터 에러 클래스
 *
 * interface가 아닌 class로 정의하여 instanceof 사용 가능
 */
export type RouterErrorCode =
  | 'DUPLICATE_PATTERN'
  | 'PARAM_NAME_CONFLICT'
  | 'WILDCARD_NOT_LAST'
  | 'ROUTE_CONFLICT';

export class RouterError extends Error {
  public readonly name = 'RouterError';

  constructor(
    message: string,
    public readonly code: RouterErrorCode,
    public readonly routeId: string,
    public readonly conflictsWith?: string
  ) {
    super(message);

    // V8 스택 트레이스 캡처
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RouterError);
    }
  }
}
```

### 6.2 Error Code Reference

| Code | Trigger | Example |
|------|---------|---------|
| `DUPLICATE_PATTERN` | 정규화된 패턴 중복 | `/api/users/` + `/api/users` |
| `PARAM_NAME_CONFLICT` | 같은 depth에서 다른 param 이름 | `/a/:id` + `/a/:name` |
| `WILDCARD_NOT_LAST` | 와일드카드가 마지막 세그먼트 아님 | `/files/*/more` |
| `ROUTE_CONFLICT` | (예약) 라우트 충돌 | TBD |

---

## 7. API Reference

### 7.1 Router Class

```typescript
export interface MatchResult {
  route: RouteSpec;
  params: Record<string, string>;
}

export interface RouterOptions {
  /** 디버그 로깅 활성화 */
  debug?: boolean;
}

export class Router {
  constructor(routes?: RouteSpec[], options?: RouterOptions);

  /**
   * 라우트 목록 설정 (기존 라우트 교체)
   * @throws {RouterError} 검증 실패 시
   */
  setRoutes(routes: RouteSpec[]): void;

  /**
   * 단일 라우트 추가
   * @throws {RouterError} 검증 실패 시
   */
  addRoute(route: RouteSpec): void;

  /**
   * 경로 매칭
   * @returns MatchResult or null (보안 위반 포함)
   */
  match(pathname: string): MatchResult | null;

  /**
   * 등록된 라우트 목록 반환
   */
  getRoutes(): RouteSpec[];

  /**
   * 통계 정보 (디버깅용)
   */
  getStats(): {
    staticCount: number;
    dynamicCount: number;
    totalRoutes: number;
  };
}

export function createRouter(
  routes?: RouteSpec[],
  options?: RouterOptions
): Router;
```

### 7.2 Usage Example

```typescript
import { createRouter, RouterError } from '@mandujs/core/runtime/router';

const router = createRouter([
  { id: 'home', pattern: '/', kind: 'page' },
  { id: 'health', pattern: '/api/health', kind: 'api' },
  { id: 'todos-stats', pattern: '/api/todos/stats', kind: 'api' },
  { id: 'todos-item', pattern: '/api/todos/:id', kind: 'api' },
  { id: 'files', pattern: '/files/*', kind: 'api' },
]);

// 매칭
router.match('/');                    // { route: home, params: {} }
router.match('/api/todos/stats');     // { route: todos-stats, params: {} }
router.match('/api/todos/123');       // { route: todos-item, params: { id: '123' } }
router.match('/files/a/b/c');         // { route: files, params: { $wildcard: 'a/b/c' } }
router.match('/user/a%2Fb');          // null (보안 차단)

// 에러 처리
try {
  router.addRoute({ id: 'dup', pattern: '/api/todos/stats', kind: 'api' });
} catch (e) {
  if (e instanceof RouterError && e.code === 'DUPLICATE_PATTERN') {
    console.error(`Duplicate: ${e.routeId} conflicts with ${e.conflictsWith}`);
  }
}
```

---

## 8. Test Strategy

### 8.1 Test Cases (11개)

| # | Category | Input | Expected |
|---|----------|-------|----------|
| 1 | Static Priority | `/api/todos/stats` | static route 우선 매칭 |
| 2 | Param Matching | `/api/todos/123` | `{ id: "123" }` |
| 3 | Wildcard | `/files/a/b/c` | `{ $wildcard: "a/b/c" }` |
| 4 | UTF-8 Decode | `/user/caf%C3%A9` | `{ name: "café" }` |
| 5 | %2F Block | `/user/a%2Fb` | `null` |
| 6 | Normalize Dup | `/api/users/` + `/api/users` | `DUPLICATE_PATTERN` |
| 7 | Param Conflict | `/users/:id` + `/users/:userId/posts` | `PARAM_NAME_CONFLICT` |
| 8 | Wildcard Position | `/files/*/more` | `WILDCARD_NOT_LAST` |
| 9 | Double-encoding | `/%252F` | `null` |
| 10a | Non-ASCII Static | `/café` (static) | 정상 매칭 |
| 10b | Non-ASCII Param | `/user/caf%C3%A9` (param) | decode 후 `café` |
| 11 | Wildcard Policy A | `/files/*` + GET `/files` | `null` (미매칭) |

### 8.2 Test File Structure

```typescript
// packages/core/src/runtime/router.test.ts

import { describe, test, expect } from 'bun:test';
import { Router, RouterError, createRouter } from './router';

describe('Router v5', () => {
  describe('Static vs Dynamic Priority', () => {
    test('static route takes precedence over param route', () => {
      // ...
    });
  });

  describe('Parameter Matching', () => {
    test('extracts params correctly', () => {
      // ...
    });
  });

  describe('Security', () => {
    test('blocks %2F in path segments', () => {
      // ...
    });

    test('blocks double-encoded slash', () => {
      // ...
    });
  });

  describe('Validation Errors', () => {
    test('throws DUPLICATE_PATTERN for normalized duplicates', () => {
      // ...
    });

    test('throws PARAM_NAME_CONFLICT for same-depth param mismatch', () => {
      // ...
    });
  });
});
```

---

## 9. Migration Guide

### 9.1 Breaking Changes

| Item | Before (v4) | After (v5) |
|------|-------------|------------|
| 매칭 순서 | 등록 순서 의존 | Static 우선, Trie 탐색 |
| params 디코딩 | 없음 (raw 전달) | `safeDecodeURIComponent` 적용 |
| %2F 처리 | 허용 | **차단** (null 반환) |
| 중복 검사 | 없음 | `DUPLICATE_PATTERN` 에러 |
| 와일드카드 키 | 없음 (미지원) | `$wildcard` 고정 |

### 9.2 Migration Checklist

```markdown
- [ ] 라우트 순서 의존 코드 제거 (이제 불필요)
- [ ] params에서 직접 decodeURIComponent 호출하는 코드 제거 (중복 디코딩 방지)
- [ ] %2F가 포함된 파라미터를 사용하는 라우트 확인 (없어야 함)
- [ ] 와일드카드 사용 시 $wildcard 키로 접근하도록 변경
- [ ] RouterError 처리 코드 추가 (선택)
```

### 9.3 Compatibility Check Results

현재 `todo-list-mandu` 프로젝트 분석 결과:

| Check | Status | Notes |
|-------|--------|-------|
| 상위 레이어 재디코딩 | ✅ 없음 | `context.ts`에서 params 그대로 사용 |
| %2F 필요 케이스 | ✅ 없음 | 모든 `:id` 파라미터가 단일 값 |
| 와일드카드 라우트 | ⏸️ 없음 | 향후 정적 파일 서빙 시 적용 |

---

## 10. Performance Considerations

### 10.1 Complexity Analysis

| Operation | Before (v4) | After (v5) |
|-----------|-------------|------------|
| Static route lookup | O(n) | **O(1)** |
| Dynamic route lookup | O(n) | **O(k)** |
| Route registration | O(1) | O(k) + validation |
| Memory usage | O(n) | O(n × k) |

> k = average path segment count (보통 3-5)

### 10.2 Benchmark Targets

```
Routes: 100개 (50 static + 50 dynamic)
Requests: 10,000회

Expected:
- Static route: < 0.01ms per match
- Dynamic route: < 0.05ms per match
- Memory: < 1MB for 100 routes
```

---

## 11. Future Enhancements

### 11.1 Phase 2 (선택적)

- [ ] 라우트 우선순위 수동 지정 (`priority` 필드)
- [ ] 정규식 제약조건 (`/users/:id(\\d+)`)
- [ ] 옵셔널 세그먼트 (`/users/:id?`)
- [ ] 라우트 그룹 (`/api/v1/*` → prefix 공유)

### 11.2 Phase 3 (장기)

- [ ] Hot reload 지원
- [ ] 라우트 분석 도구 (중복/충돌 시각화)
- [ ] OpenAPI 스키마 자동 생성 연동

---

## 12. Appendix

### A. Full Implementation Reference

전체 구현 코드는 별도 파일 참조:
- `packages/core/src/runtime/router.ts`
- `packages/core/src/runtime/router.test.ts`

### B. Related Documents

- [02_mandu_technical_architecture.md](./02_mandu_technical_architecture.md)
- [04_mandu_hydration_system.md](../specs/04_mandu_hydration_system.md)
- [05_mandu_backend-architecture-guardrails.md](./05_mandu_backend-architecture-guardrails.md)

### C. References

- [Hono TrieRouter](https://github.com/honojs/hono/blob/main/src/router/trie-router)
- [Fresh URLPattern Router](https://github.com/denoland/fresh)
- [find-my-way (Fastify)](https://github.com/delvedor/find-my-way)
- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 5.0.0 | 2025-01-30 | Initial RFC - Hybrid Trie Architecture |
