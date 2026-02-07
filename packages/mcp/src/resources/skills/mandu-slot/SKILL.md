---
name: mandu-slot
description: |
  Mandu Slot API for writing business logic. Use when creating API handlers,
  implementing authentication guards, adding lifecycle hooks, or working with
  request/response context. Triggers on tasks involving Mandu.filling(),
  ctx.ok(), ctx.error(), .guard(), .get(), .post(), or slot files.
license: MIT
metadata:
  author: mandu
  version: "1.0.0"
---

# Mandu Slot

Slot은 비즈니스 로직을 작성하는 파일입니다. `Mandu.filling()` API를 사용하여
API 핸들러, 인증 가드, 라이프사이클 훅을 구현합니다.

## When to Apply

Reference these guidelines when:
- Creating new API endpoints with business logic
- Implementing authentication or authorization
- Adding request/response lifecycle hooks
- Working with request body, params, or query
- Handling errors and responses

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Basic Structure | CRITICAL | `slot-basic-` |
| 2 | HTTP Methods | HIGH | `slot-http-` |
| 3 | Context API | HIGH | `slot-ctx-` |
| 4 | Guard Pattern | MEDIUM | `slot-guard-` |
| 5 | Lifecycle Hooks | MEDIUM | `slot-lifecycle-` |

## Quick Reference

### 1. Basic Structure (CRITICAL)

- `slot-basic-structure` - Always use Mandu.filling() as default export
- `slot-basic-location` - Place slot files in spec/slots/ directory

### 2. HTTP Methods (HIGH)

- `slot-http-get` - Use .get() for read operations
- `slot-http-post` - Use .post() for create operations
- `slot-http-put-patch` - Use .put()/.patch() for updates
- `slot-http-delete` - Use .delete() for removal

### 3. Context API (HIGH)

- `slot-ctx-response` - Use ctx.ok(), ctx.created(), ctx.error() for responses
- `slot-ctx-body` - Use ctx.body<T>() for typed request body
- `slot-ctx-params` - Use ctx.params for route parameters
- `slot-ctx-state` - Use ctx.set()/ctx.get() for request state

### 4. Guard Pattern (MEDIUM)

- `slot-guard-auth` - Use .guard() for authentication checks
- `slot-guard-early-return` - Return response to block, void to continue

### 5. Lifecycle Hooks (MEDIUM)

- `slot-lifecycle-request` - Use .onRequest() for request initialization
- `slot-lifecycle-after` - Use .afterHandle() for response modification
- `slot-lifecycle-middleware` - Use .middleware() for Koa-style chains

## How to Use

Read individual rule files for detailed explanations:

```
rules/slot-basic-structure.md
rules/slot-ctx-response.md
rules/slot-guard-auth.md
```

## File Location

```
spec/slots/{name}.slot.ts    # Server logic
spec/slots/{name}.client.ts  # Client logic (Island)
```
