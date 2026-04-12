# Mandu Implementation Status

> Last updated: 2026-04-11

All packages have reached **100% feature completion**. Test suite: **1,397 pass, 0 fail**. Typecheck passes across core, cli, mcp, and ate.

---

## Overview

| Package | Features | Done | Status |
|---------|----------|------|--------|
| **Core** (`@mandujs/core`) | 28 | 28 | 100% |
| **CLI** (`@mandujs/cli`) | 26 | 26 | 100% |
| **MCP** (`@mandujs/mcp`) | 23 | 23 | 100% |
| **Skills** | 9 | 9 | 100% |
| **Total** | **86** | **86** | **100%** |

---

## Core Framework (28/28)

### Phase 1 -- Server Foundations

| Feature | Description |
|---------|-------------|
| AbortController | Request cancellation and timeout support |
| Zero-JS mode | Server-rendered pages with no client JavaScript |
| ETag / 304 | Conditional responses with cache validation |

### Phase 2 -- Data Mutation

| Feature | Description |
|---------|-------------|
| filling.action() | Server-side form action handlers |
| `<Form>` component | Progressive enhancement form with client fallback |
| useMandu hook | Unified context hook for request, params, and state |

### Phase 3 -- Caching and Rendering

| Feature | Description |
|---------|-------------|
| ISR / SWR cache | Incremental static regeneration with stale-while-revalidate |
| Route render modes | Per-route SSR, SSG, and ISR configuration |
| Global middleware | Application-wide request/response pipeline |

### Phase 4 -- Deployment

| Feature | Description |
|---------|-------------|
| Adapter system | Pluggable deployment targets (Bun, Node, edge) |
| Prerendering / SSG | Build-time static page generation |
| Nested route parallel loaders | Concurrent data loading for nested layouts |

### Phase 5 -- DX and Networking

| Feature | Description |
|---------|-------------|
| RPC client | Type-safe remote procedure calls from client to server |
| Middleware plugins | cors, jwt, compress, logger, timeout (5 built-in) |
| useFetch | SSR-aware data fetching hook with cache |
| WebSocket | Real-time bidirectional communication |
| Test helpers | Utilities for testing routes, fillings, and islands |

### Phase 6 -- Performance and Content

| Feature | Description |
|---------|-------------|
| Code splitting | Automatic route-based and island-based chunking |
| View Transitions | Animated page transitions via the View Transitions API |
| Image optimization | Automatic resizing, format conversion, and lazy loading |
| Content Collections | Type-safe Markdown/MDX content with schema validation |

### Appendix -- Additional APIs

| Feature | Description |
|---------|-------------|
| Route ErrorBoundary | Per-route error UI with recovery |
| shouldRevalidate | Fine-grained cache revalidation control |
| Session storage | Server-side session with pluggable backends |
| useHead / useSeoMeta | Declarative head and SEO meta management |
| island('never') exclusion | Opt-out of hydration for static islands |
| @slot segments | Named layout slot segments for parallel routes |

---

## CLI (26/26)

38 commands across 6 categories.

| Category | Commands |
|----------|----------|
| Core workflow | dev, build, start, preview, clean, info |
| Architecture guard | guard, contract, explain, fix, review |
| MCP bridge | 85 tools accessible from the terminal |
| Deployment | deploy, upgrade, completion |
| Scaffolding | scaffold, middleware, session, ws, auth, collection |
| AI-assisted | ask, generate --ai |

---

## MCP Server (23/23)

85 tools organized into 18 categories with dot-notation naming and backward-compatible aliases.

| Feature | Detail |
|---------|--------|
| Tools | 85 tools, dot-notation naming |
| Categories | 18 (guard, contract, scaffold, brain, ...) |
| Prompts | 3 server prompts |
| Resources | 3 server resources |
| Profile system | User/project profile configuration |
| Transaction lock | Concurrent operation safety |
| Annotations | Metadata annotations on all 85 tools |
| Description quality | Optimized for LLM tool selection |

---

## Skills (9/9)

| Skill | Purpose |
|-------|---------|
| 9 SKILL.md files | Declarative capability definitions |
| Plugin packaging | npm-publishable skill packages |
| Claude Code hooks | Integration with Claude Code workflows |

---

## Quality

| Metric | Value |
|--------|-------|
| Tests | 1,397 pass, 0 fail |
| Typecheck | core, cli, mcp, ate -- all pass |
| License | MPL-2.0 |
| Runtime | Bun-native |
