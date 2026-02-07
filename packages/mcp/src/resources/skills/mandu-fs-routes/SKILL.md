---
name: mandu-fs-routes
description: |
  File-system based routing for Mandu. Use when creating pages, API routes,
  layouts, or dynamic routes. Triggers on tasks involving app/ folder,
  page.tsx, route.ts, layout.tsx, [id], [...slug], or URL patterns.
license: MIT
metadata:
  author: mandu
  version: "1.0.0"
---

# Mandu FS Routes

FS Routes는 파일 시스템 기반 라우팅입니다. `app/` 폴더의 파일 구조가 URL이 됩니다.

## When to Apply

Reference these guidelines when:
- Creating new pages or API endpoints
- Setting up dynamic routes with parameters
- Implementing shared layouts
- Organizing route groups
- Working with catch-all routes

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | File Naming | CRITICAL | `routes-naming-` |
| 2 | Page Routes | HIGH | `routes-page-` |
| 3 | API Routes | HIGH | `routes-api-` |
| 4 | Dynamic Routes | MEDIUM | `routes-dynamic-` |
| 5 | Layouts | MEDIUM | `routes-layout-` |

## Quick Reference

### 1. File Naming (CRITICAL)

- `routes-naming-page` - Use page.tsx for page components
- `routes-naming-route` - Use route.ts for API handlers
- `routes-naming-layout` - Use layout.tsx for shared layouts

### 2. Page Routes (HIGH)

- `routes-page-component` - Export default function component
- `routes-page-metadata` - Export metadata object for SEO

### 3. API Routes (HIGH)

- `routes-api-methods` - Export GET, POST, PUT, DELETE functions
- `routes-api-request` - Access Request object as first parameter

### 4. Dynamic Routes (MEDIUM)

- `routes-dynamic-param` - Use [id] for single parameter
- `routes-dynamic-catchall` - Use [...slug] for catch-all
- `routes-dynamic-optional` - Use [[...slug]] for optional catch-all

### 5. Layouts (MEDIUM)

- `routes-layout-wrapper` - Layouts wrap all child pages
- `routes-layout-nesting` - Layouts can be nested

## URL Mapping

| File Path | URL |
|-----------|-----|
| `app/page.tsx` | `/` |
| `app/about/page.tsx` | `/about` |
| `app/users/[id]/page.tsx` | `/users/:id` |
| `app/api/users/route.ts` | `/api/users` |
| `app/(auth)/login/page.tsx` | `/login` |

## How to Use

Read individual rule files for detailed explanations:

```
rules/routes-naming-page.md
rules/routes-dynamic-param.md
```
