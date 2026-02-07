---
name: mandu-hydration
description: |
  Island Hydration pattern for Mandu. Use when creating interactive components,
  client-side state, or partial hydration. Triggers on tasks involving
  "use client", client.tsx, useState, useEffect, Island, or hydration.
license: MIT
metadata:
  author: mandu
  version: "1.0.0"
---

# Mandu Island Hydration

Island Hydration은 페이지의 일부분만 클라이언트에서 인터랙티브하게 만드는 기술입니다.
대부분의 페이지는 정적 HTML로 유지하고, 필요한 부분만 JavaScript를 로드합니다.

## When to Apply

Reference these guidelines when:
- Creating interactive client components
- Adding client-side state to pages
- Implementing partial hydration
- Setting up client-server data flow
- Working with Island communication

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Client Directive | CRITICAL | `hydration-directive-` |
| 2 | Island Structure | HIGH | `hydration-island-` |
| 3 | Hydration Priority | MEDIUM | `hydration-priority-` |
| 4 | Data Flow | MEDIUM | `hydration-data-` |

## Quick Reference

### 1. Client Directive (CRITICAL)

- `hydration-directive-use-client` - Add "use client" directive for client components
- `hydration-directive-file-naming` - Use .client.tsx for client component files

### 2. Island Structure (HIGH)

- `hydration-island-setup` - Use Mandu.island() with setup function
- `hydration-island-render` - Separate state logic from render

### 3. Hydration Priority (MEDIUM)

- `hydration-priority-immediate` - Load on page load (critical interactions)
- `hydration-priority-visible` - Load when visible (default)
- `hydration-priority-idle` - Load when browser idle
- `hydration-priority-interaction` - Load on user interaction

### 4. Data Flow (MEDIUM)

- `hydration-data-server` - Access server data with useServerData
- `hydration-data-event` - Communicate between Islands with useIslandEvent

## Hydration Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `none` | No JavaScript | Pure static pages |
| `island` | Partial hydration (default) | Static + interactive mix |
| `full` | Full hydration | SPA-style pages |

## Client Hooks

```typescript
import {
  useServerData,
  useHydrated,
  useIslandEvent,
} from "@mandujs/core/client";

// Access SSR data
const data = useServerData<UserData>("user", defaultValue);

// Check hydration status
const isHydrated = useHydrated();
```

## How to Use

Read individual rule files for detailed explanations:

```
rules/hydration-directive-use-client.md
rules/hydration-island-setup.md
```
