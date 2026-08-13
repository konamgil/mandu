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

## Agent Workflow Contract

This skill is a Domain addendum. It must not replace `mandu-agent-workflow`.
Use it only after `mandu.agent.plan` selects the route or API domain.

Canonical workflow step: `plan -> apply -> verify`.

Preferred MCP tools:

| Step | Tools |
|------|-------|
| plan | `mandu.agent.plan`, `mandu.route.list` |
| apply | `mandu.agent.apply`, `mandu.generate`, `mandu.route.add` |
| verify | `mandu.agent.verify`, `mandu.manifest.validate` |
| repair | `mandu.agent.repair` |

Allowed file edits:

- `app/**/page.tsx`, `app/**/layout.tsx`, `app/**/route.ts`
- Route-local metadata files and co-located helpers
- Related contract/slot files only when the plan includes those domains

Verification command:

```bash
mandu agent verify --changed --json --write
```

Common failures:

- Creating a page or API route before reading the local `app/` pattern
- Editing generated route manifests by hand
- Adding API files without contract verification when the plan includes API work

Repair path:

```bash
mandu agent repair --from .mandu/agent-verify.json --json
```

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
