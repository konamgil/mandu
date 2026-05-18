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

## Agent Workflow Contract

This skill is a Domain addendum. It must not replace `mandu-agent-workflow`.
Use it only after `mandu.agent.plan` selects the hydration, island, partial, or route domain.

Canonical workflow step: `plan -> apply -> verify -> repair`.

Preferred MCP tools:

| Step | Tools |
|------|-------|
| plan | `mandu.agent.plan`, `mandu.island.list` |
| apply | `mandu.agent.apply`, `mandu.hydration.set`, `mandu.hydration.addClientSlot` |
| verify | `mandu.agent.verify`, `mandu.build`, `mandu.build.status` |
| repair | `mandu.agent.repair` |

Allowed file edits:

- `app/**/*.partial.tsx`, `app/**/*.island.tsx`, route-local client components
- Page hydration metadata only when the plan names the route
- Shared client utilities only after inspecting existing client boundaries

Verification command:

```bash
mandu agent verify --changed --json --write
```

Common failures:

- Rendering page-level islands inline instead of using `partial().Render`
- Forgetting route hydration metadata when a server page renders partials
- Moving server-only imports into client bundles

Repair path:

```bash
mandu agent repair --from .mandu/agent-verify.json --json
```

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

## Runtime API Constraints

- `island()` / `Mandu.island()` takes one definition object: `island({ setup, render })`.
- Do not call `island("visible", Component)`; use `wrapComponent(Component)` for a simple page-level island wrapper.
- Islands are page-level client bundles. Do not render them as inline JSX like `<MyIsland />`.
- For an embedded interactive region inside a server page, use `partial()`: put it in `*.partial.tsx`, export `partial({ id, component })`, and render the returned `.Render` component from the server page.
- A server page that renders partials must opt into hydration, for example `export const hydration = { strategy: "island", priority: "visible", preload: false }`.

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
