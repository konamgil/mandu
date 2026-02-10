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

### Prerequisites

- **Bun** v1.0.0 or higher ([install Bun](https://bun.sh/docs/installation))

```bash
# Check Bun version
bun --version
```

### 1. Create a New Project

```bash
bunx @mandujs/cli init my-app
cd my-app
bun install
```

### 2. Start Development Server

```bash
bun run dev
```

Your app is now running at `http://localhost:3000`

### 3. Create Your First Page

Create `app/page.tsx`:

```tsx
export default function Home() {
  return (
    <div>
      <h1>Welcome to Mandu!</h1>
      <p>Edit this file and see changes instantly.</p>
    </div>
  );
}
```

### 4. Add an API Route

Create `app/api/hello/route.ts`:

```typescript
export function GET() {
  return Response.json({ message: "Hello from Mandu!" });
}
```

Now visit `http://localhost:3000/api/hello`

### 5. Build for Production

```bash
bun run build
```

That's it! You're ready to build with Mandu.

---

## Beginner's Guide

If you're new to Mandu, this section will help you understand the basics.

### Project Structure After Init

```
my-app/
├── app/                    # Your code goes here (FS Routes)
│   ├── page.tsx           # Home page (/)
│   └── api/
│       └── health/
│           └── route.ts   # Health check API (/api/health)
├── src/                    # Architecture layers
│   ├── client/             # Client (FSD)
│   ├── server/             # Server (Clean)
│   └── shared/             # Universal shared
│       ├── contracts/      # Client-safe contracts
│       ├── types/
│       ├── utils/
│       │   ├── client/     # Client-safe utils
│       │   └── server/     # Server-only utils
│       ├── schema/         # Server-only schema
│       └── env/            # Server-only env
├── spec/
│   └── routes.manifest.json  # Route definitions (auto-managed)
├── .mandu/                 # Build output (auto-generated)
├── package.json
└── tsconfig.json
```

### File Naming Conventions

| File Name | Purpose | URL |
|-----------|---------|-----|
| `app/page.tsx` | Home page | `/` |
| `app/about/page.tsx` | About page | `/about` |
| `app/users/[id]/page.tsx` | Dynamic user page | `/users/123` |
| `app/api/users/route.ts` | Users API | `/api/users` |
| `app/layout.tsx` | Shared layout | Wraps all pages |

### Common Tasks

#### Add a New Page

Create `app/about/page.tsx`:

```tsx
export default function About() {
  return (
    <div>
      <h1>About Us</h1>
      <p>Welcome to our site!</p>
    </div>
  );
}
```

Visit `http://localhost:3000/about`

#### Add a Dynamic Route

Create `app/users/[id]/page.tsx`:

```tsx
export default function UserProfile({ params }: { params: { id: string } }) {
  return (
    <div>
      <h1>User Profile</h1>
      <p>User ID: {params.id}</p>
    </div>
  );
}
```

Visit `http://localhost:3000/users/123`

#### Add an API with Multiple Methods

Create `app/api/users/route.ts`:

```typescript
// GET /api/users
export function GET() {
  return Response.json({
    users: [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" }
    ]
  });
}

// POST /api/users
export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({
    message: "User created",
    user: body
  }, { status: 201 });
}
```

#### Add a Layout

Create `app/layout.tsx`:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <title>My Mandu App</title>
      </head>
      <body>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
        <main>{children}</main>
        <footer>© 2025 My App</footer>
      </body>
    </html>
  );
}
```

### CLI Commands for Beginners

| Command | What it does |
|---------|--------------|
| `bunx @mandujs/cli init my-app` | Create a new project called "my-app" |
| `bun install` | Install all dependencies |
| `bun run dev` | Start development server at http://localhost:3000 |
| `bun run build` | Build for production |
| `bun run test` | Run tests |

#### More CLI Commands

```bash
# Check all available commands
bunx mandu --help

# Show all routes in your app
bunx mandu routes list

# Check architecture rules
bunx mandu guard arch

# Watch for architecture violations (real-time)
bunx mandu guard arch --watch
```

### Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| **Bun** | 1.0+ | JavaScript runtime & package manager |
| **React** | 19.x | UI library |
| **TypeScript** | 5.x | Type safety |

### Next Steps

1. **Read the [FS Routes](#fs-routes) section** to understand routing patterns
2. **Try [Mandu Guard](#mandu-guard)** to enforce architecture rules
3. **Explore [MCP Server](#mcp-server-ai-integration)** for AI agent integration

### Troubleshooting

| Problem | Solution |
|---------|----------|
| `command not found: bun` | Install Bun: `curl -fsSL https://bun.sh/install \| bash` |
| Port 3000 already in use | Stop other servers or use `PORT=3001 bun run dev` |
| Changes not reflecting | Restart dev server with `bun run dev` |
| TypeScript errors | Run `bun install` to ensure types are installed |

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
| **Self-Healing Guard** | Detect violations AND provide actionable fix suggestions with auto-fix |
| **Slot System** | Isolated areas where agents safely write business logic |
| **Semantic Slots** | Purpose & constraints for AI-generated code validation |
| **Decision Memory** | ADR storage for AI to reference past architecture decisions |
| **Architecture Negotiation** | AI-Framework dialog before implementation |
| **Island Hydration** | Selective client-side JavaScript for performance |
| **Contract API** | Type-safe API contracts with Zod schema validation |
| **SEO Module** | Next.js Metadata API compatible, sitemap/robots generation, JSON-LD helpers |
| **MCP Server** | 35+ tools for AI agents to directly manipulate the framework |
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

## Configuration

Mandu loads configuration from `mandu.config.ts`, `mandu.config.js`, or `mandu.config.json`.
For guard-only overrides, `.mandu/guard.json` is also supported.

- `mandu dev` and `mandu build` validate the config and print errors if invalid
- CLI flags override config values

```ts
// mandu.config.ts
export default {
  server: {
    port: 3000,
    hostname: "localhost",
    cors: false,
    streaming: false,
  },
  dev: {
    hmr: true,
    watchDirs: ["src/shared", "shared"],
  },
  build: {
    outDir: ".mandu",
    minify: true,
    sourcemap: false,
  },
  guard: {
    preset: "mandu",
    srcDir: "src",
    exclude: ["**/*.test.ts"],
    realtime: true,
    // rules/contractRequired are used by legacy spec guard
  },
  seo: {
    enabled: true,
    defaultTitle: "My App",
    titleTemplate: "%s | My App",
  },
};
```

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
Client (FSD)               Shared (strict)              Server (Clean)
──────────────────         ───────────────              ─────────────────
client/app                 shared/contracts             server/api
  ↓                        shared/types                 ↓
client/pages               shared/utils/client          server/application
  ↓                        shared/schema (server-only)  ↓
client/widgets             shared/utils/server          server/domain
  ↓                        shared/env (server-only)     ↓
client/features                                          server/infra
  ↓                                                     ↓
client/entities                                         server/core
  ↓
client/shared
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

### Tools (35+)

| Category | Tools |
|----------|-------|
| **Routes** | `mandu_list_routes`, `mandu_get_route`, `mandu_add_route`, `mandu_delete_route`, `mandu_validate_manifest` |
| **Guard** | `mandu_guard_check`, `mandu_guard_heal`, `mandu_explain_rule` |
| **Decision Memory** | `mandu_search_decisions`, `mandu_save_decision`, `mandu_check_consistency`, `mandu_get_architecture` |
| **Semantic Slots** | `mandu_validate_slot`, `mandu_validate_slots` |
| **Negotiation** | `mandu_negotiate`, `mandu_generate_scaffold`, `mandu_analyze_structure` |
| **Generate** | `mandu_generate` |
| **Transaction** | `mandu_begin`, `mandu_commit`, `mandu_rollback` |
| **Slot** | `mandu_read_slot`, `mandu_write_slot` |
| **Hydration** | `mandu_build`, `mandu_list_islands`, `mandu_set_hydration` |
| **SEO** | `mandu_preview_seo`, `mandu_generate_sitemap_preview`, `mandu_generate_robots_preview`, `mandu_create_jsonld`, `mandu_write_seo_file`, `mandu_seo_analyze` |
| **Brain** | `mandu_doctor`, `mandu_watch_start` |

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

### v0.10.x (Current) — 74 features done

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

**SEO (Search Engine Optimization)**
- [x] Next.js Metadata API compatible types
- [x] Layout chain metadata merging
- [x] Open Graph & Twitter Cards
- [x] JSON-LD structured data (12 helpers)
- [x] Sitemap.xml & robots.txt generation
- [x] Google SEO optimization (viewport, theme-color, resource hints)
- [x] SSR integration

**AI Integration (RFC-001: From Guard to Guide)** 🆕
- [x] MCP server (35+ tools, 7 resources)
- [x] Brain (Doctor, Watcher, Architecture analyzer)
- [x] Transaction API with snapshots
- [x] Real-time push notifications
- [x] **Decision Memory** - ADR storage & consistency checking
- [x] **Semantic Slots** - Purpose & constraint validation for AI code
- [x] **Architecture Negotiation** - AI-Framework pre-implementation dialog
- [x] **Self-Healing Guard** - Auto-fix suggestions with explanations

**Security**
- [x] Path traversal prevention
- [x] Port validation
- [x] LFI vulnerability protection
- [x] ReDoS defense in custom rules

### v0.11.x (Next)

**Data Layer** *(Astro-inspired)*
- [ ] Loader API with LoaderContext (store, meta, logger, watcher)
- [ ] File Loader & API Loader implementations
- [ ] DataStore & MetaStore with digest tracking
- [ ] Cache Store adapter (Redis, in-memory)
- [ ] ISR (Incremental Static Regeneration)

**Realtime** *(Phoenix-inspired)*
- [ ] WebSocket Channels (join/handle_in/handle_out pattern)
- [ ] Channel/Socket separation model
- [ ] Serializer-based message protocol
- [ ] Server-sent events (SSE)

**Build & Integration** *(Astro/Fresh-inspired)*
- [ ] Build Hooks (start/setup/done lifecycle)
- [ ] Plugin API for build extensions
- [ ] Integration hooks with timeout warnings & dedicated logger
- [ ] Bundle analyzer with size reporting

**Observability**
- [ ] Performance benchmarks (routing, SSR, hydration)
- [ ] TTFB & TTI measurement
- [ ] Automated perf test suite

### v0.13.x (Future)

**AOT Optimization** *(Elysia-inspired)*
- [ ] AOT Handler Generation (runtime precompile)
- [ ] Sucrose-style context inference for minimal runtime
- [ ] JIT/AOT mode selection (`mandu build --aot`)

**Advanced Hydration** *(Qwik/Fresh-inspired)*
- [ ] Client Reviver (DOM marker-based restoration)
- [ ] Resumable POC / QRL-lite (lazy event handler loading)
- [ ] Serializer Registry (pluggable type serializers)
- [ ] Progressive Hydration improvements

**Developer Experience**
- [ ] Error overlay in development
- [ ] Enhanced TypeScript inference
- [ ] Project templates & scaffolding

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

MPL-2.0

---

<p align="center">
  <sub>Built with 🥟 by the Mandu Team</sub>
</p>
