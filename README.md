<p align="center">
  <img src="https://raw.githubusercontent.com/konamgil/mandu/main/mandu_only_simbol.png" alt="Mandu Logo" width="180" />
</p>

<h1 align="center">Mandu</h1>

<p align="center">
  <strong>Agent-Native Fullstack Framework</strong><br/>
  Architecture that doesn't break even when AI agents write your code
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mandujs/core"><img src="https://img.shields.io/npm/v/@mandujs/core?label=core" alt="npm core" /></a>
  <a href="https://www.npmjs.com/package/@mandujs/cli"><img src="https://img.shields.io/npm/v/@mandujs/cli?label=cli" alt="npm cli" /></a>
  <a href="https://www.npmjs.com/package/@mandujs/mcp"><img src="https://img.shields.io/npm/v/@mandujs/mcp?label=mcp" alt="npm mcp" /></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/frontend-React-61dafb?logo=react" alt="React" />
</p>

<p align="center">
  <a href="./README.ko.md">한국어</a> | English
</p>

---

## Quick Start

```bash
# Create new project
bunx @mandujs/cli init my-app
cd my-app && bun install

# Start development (everything is automatic!)
bun run dev
```

That's it. Create `app/page.tsx` and start coding.

---

## What is Mandu?

**Mandu** is a **Bun + TypeScript + React fullstack framework** designed for AI-assisted development.

### The Problem We Solve

> Not "how fast AI can code" but
> **enforcing architecture that AI cannot break**

Current AI coding has a fundamental problem: the more agents code, the more architecture deteriorates. Mandu solves this with:

- **FS Routes**: File-system based routing (like Next.js) - structure IS the API
- **Mandu Guard**: Real-time architecture enforcement - violations detected instantly
- **Slot System**: Isolated spaces where agents safely write business logic

```
┌─────────────────────────────────────────────────────────────┐
│                     Mandu Architecture                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   📁 app/              File-System Routes (structure = API)  │
│        ↓                                                     │
│   🛡️ Guard             Real-time architecture enforcement    │
│        ↓                                                     │
│   🎯 Slot              Agent's permitted workspace           │
│        ↓                                                     │
│   🏝️ Island            Selective client-side hydration       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Features

| Feature | Description |
|---------|-------------|
| **FS Routes** | File-system based routing - `app/users/page.tsx` → `/users` |
| **Mandu Guard** | Real-time architecture checker with 5 presets (FSD, Clean, Hexagonal, Atomic, Mandu) |
| **Slot System** | Isolated areas where agents safely write business logic |
| **Island Hydration** | Selective client-side JavaScript for performance |
| **Contract API** | Type-safe API contracts with Zod schema validation |
| **MCP Server** | 25+ tools for AI agents to directly manipulate the framework |
| **HMR Support** | Hot Module Replacement for rapid development |
| **Transaction API** | Atomic changes with snapshot-based rollback |

---

## Workflow

### Modern Workflow (Recommended)

```bash
# 1. Create project
bunx @mandujs/cli init my-app

# 2. Create pages in app/ folder
#    app/page.tsx        → /
#    app/users/page.tsx  → /users
#    app/api/users/route.ts → /api/users

# 3. Start development (Guard auto-enabled)
bunx mandu dev

# 4. Build for production
bunx mandu build
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `mandu init` | Create new project |
| `mandu dev` | Start dev server (FS Routes + Guard auto-enabled) |
| `mandu dev --guard` | Dev with architecture monitoring |
| `mandu build` | Build for production |
| `mandu guard arch` | Run architecture check |
| `mandu routes list` | Show all routes |
| `mandu status` | Show project status |

---

## FS Routes

Create routes by simply adding files to the `app/` directory:

```
app/
├── page.tsx              → /
├── layout.tsx            → Layout for all pages
├── users/
│   ├── page.tsx          → /users
│   ├── [id]/
│   │   └── page.tsx      → /users/:id
│   └── [...slug]/
│       └── page.tsx      → /users/* (catch-all)
├── api/
│   └── users/
│       └── route.ts      → /api/users (API endpoint)
└── (auth)/               → Route group (no URL segment)
    ├── login/
    │   └── page.tsx      → /login
    └── register/
        └── page.tsx      → /register
```

### Special Files

| File | Purpose |
|------|---------|
| `page.tsx` | Page component |
| `layout.tsx` | Shared layout wrapper |
| `route.ts` | API endpoint handler |
| `loading.tsx` | Loading state |
| `error.tsx` | Error boundary |
| `slot.ts` | Server-side business logic |
| `client.tsx` | Client-side interactive component (Island) |

---

## Mandu Guard

Real-time architecture enforcement with preset support.

### Architecture Presets

| Preset | Description | Use Case |
|--------|-------------|----------|
| `mandu` | FSD + Clean Architecture hybrid (default) | Fullstack projects |
| `fsd` | Feature-Sliced Design | Frontend-focused |
| `clean` | Clean Architecture | Backend-focused |
| `hexagonal` | Hexagonal/Ports & Adapters | Domain-driven |
| `atomic` | Atomic Design | UI component libraries |

### Usage

```bash
# One-time check
bunx mandu guard arch

# Watch mode
bunx mandu guard arch --watch

# CI mode (exit 1 on errors)
bunx mandu guard arch --ci

# With specific preset
bunx mandu guard arch --preset fsd

# Generate report
bunx mandu guard arch --output report.md --report-format markdown
```

### Layer Hierarchy (Mandu Preset)

```
Frontend (FSD)           Backend (Clean)
─────────────────        ─────────────────
app                      api
  ↓                        ↓
pages                    application
  ↓                        ↓
widgets                  domain
  ↓                        ↓
features                 infra
  ↓                        ↓
entities                 core
  ↓                        ↓
shared ←───────────────── shared
```

Upper layers can only import from lower layers. Guard detects violations in real-time.

---

## Slot System

Write business logic in isolated slot files:

```typescript
// spec/slots/users.slot.ts
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .guard((ctx) => {
    if (!ctx.get("user")) return ctx.unauthorized("Login required");
  })
  .get(async (ctx) => {
    const users = await db.users.findMany();
    return ctx.ok({ data: users });
  })
  .post(async (ctx) => {
    const body = await ctx.body<{ name: string; email: string }>();
    const user = await db.users.create({ data: body });
    return ctx.created({ data: user });
  });
```

### Context API

| Method | Description |
|--------|-------------|
| `ctx.ok(data)` | 200 OK |
| `ctx.created(data)` | 201 Created |
| `ctx.error(message)` | 400 Bad Request |
| `ctx.unauthorized(message)` | 401 Unauthorized |
| `ctx.notFound(message)` | 404 Not Found |
| `ctx.body<T>()` | Parse request body |
| `ctx.params` | Route parameters |
| `ctx.query` | Query parameters |

---

## Island Hydration

Selective client-side JavaScript for optimal performance:

```tsx
// spec/slots/counter.client.tsx
import { useState } from "react";

export default function Counter({ initial = 0 }) {
  const [count, setCount] = useState(initial);

  return (
    <div>
      <p>{count}</p>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  );
}
```

Configure in route:
```json
{
  "id": "counter",
  "hydration": {
    "strategy": "island",
    "priority": "visible"
  }
}
```

| Strategy | Description |
|----------|-------------|
| `none` | Pure static HTML |
| `island` | Partial hydration (default) |
| `full` | Full page hydration |

| Priority | When JS Loads |
|----------|---------------|
| `immediate` | On page load |
| `visible` | When in viewport |
| `idle` | During browser idle |
| `interaction` | On user interaction |

---

## Contract API

Type-safe API contracts with full inference:

```typescript
import { Mandu } from "@mandujs/core";
import { z } from "zod";

// Define contract
const userContract = Mandu.contract({
  request: {
    GET: { query: z.object({ id: z.string() }) },
    POST: { body: z.object({ name: z.string(), email: z.string().email() }) }
  },
  response: {
    200: z.object({ data: z.any() }),
    400: z.object({ error: z.string() })
  }
});

// Create handlers (fully typed)
const handlers = Mandu.handler(userContract, {
  GET: (ctx) => ({ data: fetchUser(ctx.query.id) }),
  POST: (ctx) => ({ data: createUser(ctx.body) })
});

// Type-safe client
const client = Mandu.client(userContract, { baseUrl: "/api/users" });
const result = await client.GET({ query: { id: "123" } });
```

---

## MCP Server (AI Integration)

Mandu includes a full MCP server for AI agent integration.

### Setup

```json
// .mcp.json
{
  "mcpServers": {
    "mandu": {
      "command": "bunx",
      "args": ["@mandujs/mcp"],
      "cwd": "/path/to/project"
    }
  }
}
```

### Tools (25+)

| Category | Tools |
|----------|-------|
| **Spec** | `mandu_list_routes`, `mandu_add_route`, `mandu_update_route`, `mandu_delete_route` |
| **Guard** | `mandu_guard_check`, `mandu_check_location`, `mandu_check_import` |
| **Generate** | `mandu_generate` |
| **Transaction** | `mandu_begin`, `mandu_commit`, `mandu_rollback` |
| **Slot** | `mandu_read_slot`, `mandu_write_slot`, `mandu_validate_slot` |
| **Hydration** | `mandu_build`, `mandu_list_islands`, `mandu_set_hydration` |
| **Brain** | `mandu_doctor`, `mandu_watch_start`, `mandu_get_architecture` |

### Resources

| URI | Description |
|-----|-------------|
| `mandu://spec/manifest` | Current routes manifest |
| `mandu://watch/warnings` | Architecture violation warnings |
| `mandu://transaction/active` | Active transaction state |

---

## Project Structure

### Generated Project

```
my-app/
├── app/                    # FS Routes (pages, layouts, API)
│   ├── page.tsx
│   └── api/
├── spec/
│   ├── routes.manifest.json  # Route definitions
│   └── slots/                # Business logic
├── .mandu/
│   ├── client/               # Built bundles
│   └── manifest.json         # Bundle manifest
└── package.json
```

### Framework

```
mandu/
├── packages/
│   ├── core/       # @mandujs/core - Runtime, Guard, Router, Bundler
│   ├── cli/        # @mandujs/cli - CLI commands
│   └── mcp/        # @mandujs/mcp - MCP server for AI agents
└── tests/
```

---

## Tech Stack

| Area | Technology |
|------|------------|
| Runtime | Bun |
| Language | TypeScript |
| Frontend | React |
| Rendering | Streaming SSR |
| Validation | Zod |
| AI Protocol | MCP |

---

## Roadmap

### v0.9.x (Current) — 44 features done

**Core Runtime**
- [x] Middleware compose & lifecycle hooks
- [x] Streaming SSR
- [x] Filling API (guard, hooks, middleware)
- [x] Runtime logger & trace system

**Routing**
- [x] FS Routes (scanner, patterns, generator, watcher)
- [x] Layout system (layoutChain, loading, error)
- [x] Advanced routes (catch-all, optional params)
- [x] Client-side router (Link, NavLink, hooks)

**Architecture**
- [x] Mandu Guard with 5 presets (mandu, fsd, clean, hexagonal, atomic)
- [x] AST-based import analysis
- [x] Statistics & trend tracking
- [x] Real-time violation detection

**API & Types**
- [x] Contract API with Zod
- [x] Type-safe handlers & clients
- [x] OpenAPI 3.0 generator
- [x] Schema normalization

**Hydration**
- [x] Island hydration (visible, idle, interaction)
- [x] Partials & slots
- [x] Error boundary & loading states
- [x] HMR support

**AI Integration**
- [x] MCP server (25+ tools, 7 resources)
- [x] Brain (Doctor, Watcher, Architecture analyzer)
- [x] Transaction API with snapshots
- [x] Real-time push notifications

**Security**
- [x] Path traversal prevention
- [x] Port validation

### v0.10.x (Next)

**Data Layer**
- [ ] Data Loader API
- [ ] Cache Store adapter
- [ ] ISR (Incremental Static Regeneration)

**Realtime**
- [ ] WebSocket channels
- [ ] Server-sent events
- [ ] Resumable state (QRL-lite)

**Build & Deploy**
- [ ] Build plugins & hooks
- [ ] Bundle analyzer
- [ ] Production deployment guides

**Observability**
- [ ] Performance benchmarks
- [ ] Integration hooks

---

## Documentation

- `docs/README.md` — Documentation index
- `docs/api/api-reference.md` — API reference
- `docs/status.md` — Implementation status
- `docs/specs/` — Technical specifications

---

## Contributing

```bash
git clone https://github.com/konamgil/mandu.git
cd mandu && bun install
bun test
```

---

## Why "Mandu"?

Like a dumpling (mandu), the **wrapper (generated code) stays consistent** while the **filling (slot) can vary infinitely**. No matter how much agents code, the dumpling shape (architecture) is preserved. 🥟

---

## License

MIT

---

<p align="center">
  <sub>Built with 🥟 by the Mandu Team</sub>
</p>
