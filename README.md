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

## The Problem

### AI Coding's Structural Challenge

Current AI-assisted development has a fundamental problem:

- **Architecture Decay**: The more agents code, the more folder structures, layer rules, and patterns deteriorate
- **Post-hoc Cleanup Fails**: Trying to fix with linters causes side effects and wasted time
- **Reproducibility Loss**: Each project ends up with different architecture, making maintenance nightmarish

### What We're Really Solving

> Not "how fast AI can code" but
> **enforcing architecture that AI cannot break (Architecture Preservation)**

---

## What is Mandu?

**Mandu** is a **Bun + TypeScript + React fullstack framework** that automates the entire flow from:

**Natural Language → Spec → Generate → Slot → Guard → Report**

```
┌─────────────────────────────────────────────────────────────┐
│                        Mandu Flow                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   📝 Spec (JSON)      Single Source of Truth (SSOT)          │
│        ↓                                                     │
│   ⚙️  Generate        Auto-generate skeleton code            │
│        ↓                                                     │
│   🎯 Slot             Agent's permitted workspace            │
│        ↓                                                     │
│   🛡️  Guard           Architecture preservation check        │
│        ↓                                                     │
│   📊 Report           Results + auto-fix guidance            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Features

### Core Architecture

| Feature | Description |
|---------|-------------|
| **Spec-Driven Development** | JSON manifest is the single source of truth |
| **Code Generation** | Routes, handlers, and components auto-generated from spec |
| **Slot System** | Isolated areas where agents safely write business logic |
| **Guard System** | Enforces architecture rules and prevents contamination |
| **Transaction API** | Atomic changes with snapshot-based rollback |
| **MCP Server** | AI agents can directly manipulate the framework |
| **Island Hydration** | Selective client-side JavaScript for performance |
| **HMR Support** | Hot Module Replacement for rapid development |
| **Error Classification** | Intelligent error categorization with fix suggestions |

---

## Quick Start

### 1. Create a New Project

```bash
# Install Bun (if not installed)
curl -fsSL https://bun.sh/install | bash

# Create new project
bunx @mandujs/cli init my-app
cd my-app
```

### 2. Install Dependencies & Run

```bash
bun install

# Validate spec and update lock
bun run spec

# Generate code from spec
bun run generate

# Run development server
bun run dev
```

### 3. Open in Browser

```
http://localhost:3000      → SSR Page
http://localhost:3000/api/health → API Response
```

---

## Who Does What

| Task | 👤 Human | 🤖 Agent | 🔌 MCP | 🔧 CLI |
|------|:--------:|:--------:|:------:|:------:|
| Requirements | Define | Receive | - | - |
| Project Init | Run | - | - | `init` |
| Add Routes | Approve | Design | `add_route` | - |
| Generate Code | - | Call | `generate` | `generate` |
| Write Slots | Review | Write | `write_slot` | - |
| Guard Check | Review | Call | `guard_check` | `guard` |
| Build/Dev | Run | - | - | `build`/`dev` |

```
👤 Human ──→ 🤖 Agent ──→ 🔌 MCP ──→ 📦 Core ──→ 📁 Files
                                       ↑
👤 Human ─────────────→ 🔧 CLI ────────┘
```

> **MCP** = Agent's interface to Core
> **CLI** = Human's interface to Core
> Both call the same `@mandujs/core` functions

---

## Core Principles

| # | Principle | Description |
|---|-----------|-------------|
| 1 | **Spec = SSOT** | The spec (JSON) is the single source of truth. Code is derived from spec. |
| 2 | **Generated = Disposable** | Generated code can be deleted and regenerated anytime. |
| 3 | **Slot = Safe Zone** | Agents only work within designated slots. |
| 4 | **Guard > Lint** | Minimize linting; Guard is the architecture gatekeeper. |
| 5 | **Self-Correction** | Built-in auto-retry loops for failure recovery. |

---

## Project Structure

### Framework (This Repository)

```
mandu/
├── packages/
│   ├── core/                 # @mandujs/core
│   │   ├── spec/            # Schema, load, lock, validation
│   │   ├── runtime/         # Server, router, SSR
│   │   ├── generator/       # Code generation engine
│   │   ├── guard/           # Architecture enforcement
│   │   ├── bundler/         # Client-side bundling + HMR
│   │   ├── filling/         # Business logic API (Mandu.filling())
│   │   ├── error/           # Error classification system
│   │   ├── change/          # Transaction & history management
│   │   ├── slot/            # Slot validation & auto-correction
│   │   └── client/          # Island hydration runtime
│   │
│   ├── cli/                  # @mandujs/cli
│   │   └── commands/        # init, spec-upsert, generate, guard, build, dev
│   │
│   └── mcp/                  # @mandujs/mcp
│       ├── tools/           # MCP tools (20+ tools)
│       └── resources/       # MCP resources (5 resources)
│
└── tests/                    # Framework tests
```

### Generated Project Structure

```
my-app/
├── spec/
│   ├── routes.manifest.json     # Route definitions (SSOT)
│   ├── spec.lock.json           # Hash verification
│   ├── slots/                   # Business logic files
│   │   ├── users.slot.ts       # Server-side logic
│   │   └── users.client.ts     # Client-side interactive logic
│   └── history/                 # Transaction snapshots
│       ├── changes.json        # Change audit trail
│       └── *.snapshot.json     # Rollback snapshots
│
├── apps/
│   ├── server/
│   │   ├── main.ts              # Server entry point
│   │   └── generated/routes/    # Auto-generated API handlers
│   │       └── *.route.ts
│   │
│   └── web/
│       ├── entry.tsx            # Web entry point
│       ├── generated/routes/    # Auto-generated page components
│       │   └── *.route.tsx
│       └── components/          # Shared components
│
├── .mandu/
│   ├── client/                  # Built client bundles
│   │   ├── _runtime.js         # Hydration runtime
│   │   ├── _vendor.js          # Shared dependencies (React)
│   │   └── *.island.js         # Per-route island bundles
│   └── manifest.json            # Bundle manifest
│
└── package.json
```

---

## CLI Commands

### Basic Commands

| Command | Description |
|---------|-------------|
| `mandu init <name>` | Create a new project |
| `mandu spec-upsert` | Validate spec and update lock file |
| `mandu generate` | Generate code from spec |
| `mandu guard` | Run architecture checks |
| `mandu build` | Build client bundles for production |
| `mandu dev` | Run development server with HMR |

### Transaction Commands

| Command | Description |
|---------|-------------|
| `mandu change begin` | Start a transaction (creates snapshot) |
| `mandu change commit` | Finalize changes |
| `mandu change rollback` | Restore from snapshot |
| `mandu change status` | Show current transaction state |
| `mandu change list` | View change history |
| `mandu change prune` | Clean old snapshots |

### Command Examples

```bash
# Initialize project
bunx @mandujs/cli init my-app

# Development workflow
bunx mandu spec-upsert          # Validate spec
bunx mandu generate             # Generate code
bunx mandu guard                # Check architecture
bunx mandu dev                  # Run dev server

# Production build
bunx mandu build --minify       # Build optimized bundles

# Safe changes with transaction
bunx mandu change begin --message "Add users API"
# ... make changes ...
bunx mandu change commit        # Success: finalize
bunx mandu change rollback      # Failure: restore snapshot
```

---

## Spec System

### routes.manifest.json

```json
{
  "version": 1,
  "routes": [
    {
      "id": "home",
      "pattern": "/",
      "kind": "page",
      "module": "apps/server/generated/routes/home.route.ts",
      "componentModule": "apps/web/generated/routes/home.route.tsx"
    },
    {
      "id": "users-api",
      "pattern": "/api/users",
      "kind": "api",
      "methods": ["GET", "POST"],
      "module": "apps/server/generated/routes/users-api.route.ts",
      "slotModule": "spec/slots/users.slot.ts"
    },
    {
      "id": "dashboard",
      "pattern": "/dashboard",
      "kind": "page",
      "module": "apps/server/generated/routes/dashboard.route.ts",
      "componentModule": "apps/web/generated/routes/dashboard.route.tsx",
      "slotModule": "spec/slots/dashboard.slot.ts",
      "clientModule": "spec/slots/dashboard.client.ts",
      "hydration": {
        "strategy": "island",
        "priority": "visible",
        "preload": true
      }
    }
  ]
}
```

### Route Properties

| Property | Required | Description |
|----------|----------|-------------|
| `id` | Yes | Unique route identifier |
| `pattern` | Yes | URL pattern (e.g., `/api/users/:id`) |
| `kind` | Yes | `"api"` or `"page"` |
| `methods` | No | HTTP methods for API routes |
| `module` | Yes | Server handler module path |
| `componentModule` | Page only | React component module path |
| `slotModule` | No | Business logic module path |
| `clientModule` | No | Client-side interactive logic |
| `hydration` | No | Hydration configuration |
| `loader` | No | SSR data loading configuration |

---

## Slot System (Business Logic)

### Writing Slot Logic

Slots are where you write your business logic using the `Mandu.filling()` API:

```typescript
// spec/slots/users.slot.ts
import { Mandu } from "@mandujs/core";

interface User {
  id: number;
  name: string;
  email: string;
}

export default Mandu.filling<{ users: User[] }>()
  // Data loader (runs on SSR)
  .loader(async (ctx) => {
    const users = await fetchUsers();
    return { users };
  })

  // Authentication guard
  .guard(async (ctx) => {
    if (!ctx.user) {
      return ctx.unauthorized("Login required");
    }
    return ctx.next();
  })

  // GET /api/users
  .get((ctx) => {
    const { users } = ctx.loaderData;
    return ctx.ok({ data: users });
  })

  // POST /api/users
  .post(async (ctx) => {
    const body = await ctx.body<{ name: string; email: string }>();

    if (!body.name || !body.email) {
      return ctx.badRequest("Name and email required");
    }

    const newUser = await createUser(body);
    return ctx.created({ data: newUser });
  })

  // GET /api/users/:id
  .get("/:id", async (ctx) => {
    const user = await findUser(ctx.params.id);

    if (!user) {
      return ctx.notFound("User not found");
    }

    return ctx.ok({ data: user });
  })

  // DELETE /api/users/:id
  .delete("/:id", async (ctx) => {
    await deleteUser(ctx.params.id);
    return ctx.noContent();
  });
```

### Context API

| Method | Description |
|--------|-------------|
| `ctx.ok(data)` | 200 OK response |
| `ctx.created(data)` | 201 Created response |
| `ctx.noContent()` | 204 No Content response |
| `ctx.badRequest(message)` | 400 Bad Request |
| `ctx.unauthorized(message)` | 401 Unauthorized |
| `ctx.forbidden(message)` | 403 Forbidden |
| `ctx.notFound(message)` | 404 Not Found |
| `ctx.body<T>()` | Parse request body |
| `ctx.params` | Route parameters |
| `ctx.query` | Query string parameters |
| `ctx.headers` | Request headers |
| `ctx.user` | Authenticated user (if any) |
| `ctx.loaderData` | Data from loader |

---

## Island Hydration

### What are Islands?

Islands are interactive components that get hydrated on the client while the rest of the page remains static HTML. This approach delivers:

- **Faster Initial Load**: Most of the page is static HTML
- **Better Performance**: Only interactive parts load JavaScript
- **SEO Friendly**: Full HTML content for search engines

### Hydration Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| `none` | Pure static HTML, no JavaScript | SEO-critical, read-only pages |
| `island` | Partial hydration (default) | Mixed static + interactive |
| `full` | Entire page hydrated | SPA-like interactive pages |
| `progressive` | Lazy sequential hydration | Large pages, performance |

### Hydration Priorities

| Priority | When JavaScript Loads | Use Case |
|----------|----------------------|----------|
| `immediate` | On page load | Critical interactions |
| `visible` | When in viewport (default) | Below-the-fold content |
| `idle` | During browser idle time | Non-critical features |
| `interaction` | On user interaction | Lazy activation |

### Creating an Island

1. **Add client module to route:**

```json
{
  "id": "counter",
  "pattern": "/counter",
  "kind": "page",
  "module": "apps/server/generated/routes/counter.route.ts",
  "componentModule": "apps/web/generated/routes/counter.route.tsx",
  "clientModule": "spec/slots/counter.client.ts",
  "hydration": {
    "strategy": "island",
    "priority": "visible"
  }
}
```

2. **Write the client component:**

```typescript
// spec/slots/counter.client.ts
import React, { useState } from "react";

export default function Counter({ initialCount = 0 }) {
  const [count, setCount] = useState(initialCount);

  return (
    <div className="counter-island">
      <h2>Interactive Counter</h2>
      <p className="count">{count}</p>
      <button onClick={() => setCount(count - 1)}>-</button>
      <button onClick={() => setCount(count + 1)}>+</button>
    </div>
  );
}
```

3. **Build and run:**

```bash
bunx mandu build       # Build client bundles
bunx mandu dev         # Or run dev server with HMR
```

---

## Hot Module Replacement (HMR)

### How HMR Works

During development, Mandu watches for changes to `.client.ts` files and automatically:

1. Rebuilds the affected island bundle
2. Notifies connected browsers via WebSocket
3. Triggers a page reload (or targeted island update)

### HMR Features

- **WebSocket Server**: Runs on port + 1 (e.g., 3001 for dev server on 3000)
- **Auto-Reconnection**: Reconnects automatically if connection lost
- **Error Overlay**: Shows build errors directly in browser
- **File Watching**: Watches `spec/slots/*.client.ts` files

### Development Server Output

```
🥟 Mandu Dev Server
📄 Spec file: /path/to/spec/routes.manifest.json

✅ Spec loaded: 5 routes
  📄 Page: / -> home
  📡 API: /api/health -> health
  📄 Page: /counter -> counter 🏝️    ← Island indicator

🔥 HMR server running on ws://localhost:3001
🔨 Initial client bundle build...
✅ Built 1 island
👀 Watching for client slot changes...
🥟 Mandu Dev Server running at http://localhost:3000
🔥 HMR enabled on port 3001
```

---

## Guard System

Guard enforces architecture preservation by checking:

| Rule | What it Checks | Fix Command |
|------|---------------|-------------|
| `SPEC_HASH_MISMATCH` | spec.lock.json hash matches spec | `mandu spec-upsert` |
| `GENERATED_MANUAL_EDIT` | "DO NOT EDIT" marker intact | `mandu generate` |
| `INVALID_GENERATED_IMPORT` | No imports from /generated/ | Use runtime registry |
| `FORBIDDEN_IMPORT_IN_GENERATED` | No fs, child_process, etc. | Move logic to slot |
| `SLOT_NOT_FOUND` | Slot file exists if specified | `mandu generate` |

### Running Guard

```bash
# Check all rules
bunx mandu guard

# Check with auto-correction
bunx mandu guard --auto-correct
```

---

## MCP Server (AI Agent Integration)

Mandu includes a full MCP (Model Context Protocol) server that allows AI agents to directly interact with the framework.

### Setup

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "mandu": {
      "command": "bunx",
      "args": ["@mandujs/mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

### Available MCP Tools

#### Spec Management

| Tool | Description |
|------|-------------|
| `mandu_list_routes` | List all routes |
| `mandu_get_route` | Get specific route details |
| `mandu_add_route` | Add a new route |
| `mandu_update_route` | Modify existing route |
| `mandu_delete_route` | Remove a route |
| `mandu_validate_spec` | Validate manifest |

#### Code Generation

| Tool | Description |
|------|-------------|
| `mandu_generate` | Run code generation |

#### Transaction Management

| Tool | Description |
|------|-------------|
| `mandu_begin` | Start transaction with snapshot |
| `mandu_commit` | Finalize changes |
| `mandu_rollback` | Restore from snapshot |
| `mandu_tx_status` | Get transaction state |

#### Slot Management

| Tool | Description |
|------|-------------|
| `mandu_read_slot` | Read slot file content |
| `mandu_write_slot` | Write slot file (with auto-correction) |
| `mandu_validate_slot` | Validate slot syntax |

#### Guard & Validation

| Tool | Description |
|------|-------------|
| `mandu_guard_check` | Run all guard checks |
| `mandu_analyze_error` | Analyze error and get fix suggestions |

#### Hydration & Build

| Tool | Description |
|------|-------------|
| `mandu_build` | Build client bundles |
| `mandu_build_status` | Get bundle statistics |
| `mandu_list_islands` | List routes with hydration |
| `mandu_set_hydration` | Configure hydration strategy |
| `mandu_add_client_slot` | Create client slot for route |

#### History

| Tool | Description |
|------|-------------|
| `mandu_list_changes` | View change history |
| `mandu_prune_history` | Clean old snapshots |

### MCP Resources

| URI | Description |
|-----|-------------|
| `mandu://spec/manifest` | Current routes.manifest.json |
| `mandu://spec/lock` | Current spec.lock.json |
| `mandu://generated/map` | Generated files mapping |
| `mandu://transaction/active` | Active transaction state |
| `mandu://slots/{routeId}` | Slot file content |

### Agent Workflow Example

```
User: "Create a users list API with pagination"

Agent:
1. mandu_begin({ message: "Add users API with pagination" })
   → Creates snapshot, returns changeId

2. mandu_add_route({
     id: "users-list",
     pattern: "/api/users",
     kind: "api",
     methods: ["GET", "POST"],
     slotModule: "spec/slots/users.slot.ts"
   })
   → Updates routes.manifest.json

3. mandu_generate()
   → Creates route handlers

4. mandu_write_slot({
     routeId: "users-list",
     content: `
       import { Mandu } from "@mandujs/core";

       export default Mandu.filling()
         .get(async (ctx) => {
           const page = parseInt(ctx.query.page) || 1;
           const limit = parseInt(ctx.query.limit) || 10;
           const users = await getUsers({ page, limit });
           return ctx.ok({ data: users, page, limit });
         })
         .post(async (ctx) => {
           const body = await ctx.body();
           const user = await createUser(body);
           return ctx.created({ data: user });
         });
     `,
     autoCorrect: true
   })
   → Writes business logic, auto-fixes issues

5. mandu_guard_check()
   → Validates architecture

6. mandu_commit()
   → Finalizes transaction

Result: New API ready with full rollback capability
```

---

## Error Handling System

### Error Classification

Mandu automatically classifies errors into three types:

| Type | Description | Typical Cause |
|------|-------------|---------------|
| `SPEC_ERROR` | Manifest/validation issues | Invalid JSON, missing required fields |
| `LOGIC_ERROR` | Slot runtime failures | Business logic bugs, database errors |
| `FRAMEWORK_BUG` | Generated code errors | Should not occur; indicates framework issue |

### Error Response Format

```json
{
  "errorType": "LOGIC_ERROR",
  "code": "SLOT_RUNTIME_ERROR",
  "message": "Cannot read property 'id' of undefined",
  "summary": "Null reference in users.slot.ts",
  "fix": {
    "file": "spec/slots/users.slot.ts",
    "line": 15,
    "suggestion": "Check that user object exists before accessing .id"
  },
  "route": {
    "id": "users-api",
    "pattern": "/api/users/:id"
  },
  "timestamp": "2025-01-28T12:00:00.000Z"
}
```

---

## Tech Stack

| Area | Technology | Reason |
|------|------------|--------|
| **Runtime** | Bun | Fast, all-in-one toolkit, native TypeScript |
| **Language** | TypeScript | Type safety, agent-friendly |
| **Frontend** | React | SSR support, ecosystem |
| **Rendering** | SSR (renderToString) | SEO, performance |
| **Validation** | Zod | Schema validation, type inference |
| **Protocol** | MCP | AI agent integration |

---

## Roadmap

### v0.4.x (Current)
- [x] Island hydration system
- [x] HMR (Hot Module Replacement)
- [x] MCP server with 20+ tools
- [x] Transaction API with snapshots
- [x] Error classification system
- [x] Slot auto-correction

### v0.5.x (Next)
- [ ] WebSocket platform
- [ ] Channel-logic slots
- [ ] Contract-first API
- [ ] Improved test templates

### v1.0.x
- [ ] ISR (Incremental Static Regeneration)
- [ ] CacheStore adapter
- [ ] Distributed WebSocket mode
- [ ] Production deployment guides

---

## Contributing

```bash
# Clone repository
git clone https://github.com/konamgil/mandu.git
cd mandu

# Install dependencies
bun install

# Run tests
bun test

# Test CLI locally
bun run packages/cli/src/main.ts --help
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
