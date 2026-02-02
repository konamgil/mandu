<p align="center">
  <img src="https://raw.githubusercontent.com/konamgil/mandu/main/mandu_only_simbol.png" alt="Mandu" width="200" />
</p>

<h1 align="center">@mandujs/core</h1>

<p align="center">
  <strong>Mandu Framework Core</strong><br/>
  Runtime, FS Routes, Guard, Bundler, Contract, Filling
</p>

<p align="center">
  English | <a href="./README.ko.md"><strong>한국어</strong></a>
</p>

## Installation

```bash
bun add @mandujs/core
```

> Typically used through `@mandujs/cli`. Direct usage is for advanced use cases.

## Quick Start

### Basic API Handler (Filling)

```typescript
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
    const body = await ctx.body<{ name: string }>();
    const user = await db.users.create({ data: body });
    return ctx.created({ data: user });
  });
```

### Type-Safe Contract

```typescript
import { Mandu } from "@mandujs/core";
import { z } from "zod";

const userContract = Mandu.contract({
  request: {
    GET: { query: z.object({ id: z.string() }) },
    POST: { body: z.object({ name: z.string() }) }
  },
  response: {
    200: z.object({ data: z.any() }),
    400: z.object({ error: z.string() })
  }
});

const handlers = Mandu.handler(userContract, {
  GET: (ctx) => ({ data: fetchUser(ctx.query.id) }),
  POST: (ctx) => ({ data: createUser(ctx.body) })
});
```

---

## Module Overview

```
@mandujs/core
├── router/      # FS Routes - file-system based routing
├── guard/       # Mandu Guard - architecture enforcement
├── runtime/     # Server, SSR, streaming
├── filling/     # Handler chain API (Mandu.filling())
├── contract/    # Type-safe API contracts
├── bundler/     # Client bundling, HMR
├── client/      # Island hydration, client router
├── brain/       # Doctor, Watcher, Architecture analyzer
├── change/      # Transaction & history
└── spec/        # Manifest schema & validation
```

---

## FS Routes

File-system based routing system.

```typescript
import { scanRoutes, generateManifest, watchFSRoutes } from "@mandujs/core/router";

// Scan routes from app/ directory
const result = await scanRoutes("/path/to/project");
console.log(result.routes);

// Generate manifest
const { manifest } = await generateManifest("/path/to/project", {
  outputPath: ".mandu/manifest.json"
});

// Watch for changes
const watcher = await watchFSRoutes("/path/to/project", {
  onChange: (result) => console.log("Routes updated!", result.routes.length)
});
```

### Route Patterns

```typescript
import { pathToPattern, parseSegments } from "@mandujs/core/router";

// Convert path to URL pattern
pathToPattern("users/[id]/posts");     // → "/users/:id/posts"
pathToPattern("docs/[...slug]");       // → "/docs/:slug*"
pathToPattern("(auth)/login");         // → "/login" (group ignored)

// Parse segments
parseSegments("[id]");                 // → [{ type: "dynamic", name: "id" }]
parseSegments("[...slug]");            // → [{ type: "catch-all", name: "slug" }]
```

---

## Mandu Guard

Real-time architecture enforcement with preset support.

```typescript
import {
  createGuardWatcher,
  checkDirectory,
  getPreset,
  listPresets
} from "@mandujs/core/guard";

// One-time check
const report = await checkDirectory(
  { preset: "mandu" },
  process.cwd()
);
console.log(`Violations: ${report.totalViolations}`);

// Real-time watching
const watcher = createGuardWatcher({
  config: { preset: "mandu", srcDir: "src" },
  rootDir: process.cwd(),
  onViolation: (v) => console.log(`${v.filePath}: ${v.ruleDescription}`),
});
watcher.start();

// List available presets
listPresets().forEach(p => console.log(p.name, p.description));
```

### Presets

| Preset | Layers | Use Case |
|--------|--------|----------|
| `mandu` | app, pages, widgets, features, entities, api, application, domain, infra, core, shared | Fullstack (default) |
| `fsd` | app, pages, widgets, features, entities, shared | Frontend |
| `clean` | api, application, domain, infra, shared | Backend |
| `hexagonal` | adapters, ports, application, domain | DDD |
| `atomic` | pages, templates, organisms, molecules, atoms | UI |

### AST-based Analysis

```typescript
import { extractImportsAST, analyzeModuleAST } from "@mandujs/core/guard";

// Extract imports with AST (more accurate than regex)
const imports = extractImportsAST(code);
// → [{ path: "./utils", type: "static", line: 1, namedImports: ["foo"] }]

// Full module analysis
const analysis = analyzeModuleAST(code, "src/features/user/api.ts");
```

### Statistics & Trends

```typescript
import {
  createScanRecord,
  addScanRecord,
  analyzeTrend,
  generateMarkdownReport
} from "@mandujs/core/guard";

// Save scan for trend analysis
const record = createScanRecord(report, "mandu");
await addScanRecord(rootDir, record);

// Analyze improvement trend
const trend = analyzeTrend(records, 7); // 7 days
console.log(trend.trend); // "improving" | "stable" | "degrading"

// Generate reports
const markdown = generateMarkdownReport(report, trend);
```

---

## Filling API

Handler chain for business logic.

```typescript
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  // Lifecycle hooks
  .onRequest((ctx) => {
    ctx.set("requestId", crypto.randomUUID());
  })

  // Guard (return Response to block)
  .guard((ctx) => {
    if (!ctx.get("user")) return ctx.unauthorized("Login required");
  })

  // Handlers
  .get(async (ctx) => {
    return ctx.ok({ users: await fetchUsers() });
  })

  .post(async (ctx) => {
    const body = await ctx.body();
    return ctx.created({ user: await createUser(body) });
  })

  // After response
  .afterResponse((ctx) => {
    console.log("Request completed:", ctx.get("requestId"));
  });
```

### Middleware (Compose-style)

```typescript
export default Mandu.filling()
  .middleware(async (ctx, next) => {
    console.log("before");
    await next();
    console.log("after");
  })
  .get((ctx) => ctx.ok({ ok: true }));
```

### Context API

| Method | Description |
|--------|-------------|
| `ctx.ok(data)` | 200 OK |
| `ctx.created(data)` | 201 Created |
| `ctx.noContent()` | 204 No Content |
| `ctx.error(message)` | 400 Bad Request |
| `ctx.unauthorized(message)` | 401 Unauthorized |
| `ctx.forbidden(message)` | 403 Forbidden |
| `ctx.notFound(message)` | 404 Not Found |
| `ctx.fail(message)` | 500 Internal Server Error |
| `ctx.body<T>()` | Parse request body |
| `ctx.params` | Route parameters |
| `ctx.query` | Query parameters |
| `ctx.set(key, value)` | Store in context |
| `ctx.get<T>(key)` | Retrieve from context |

---

## Contract API

Type-safe API contracts with Zod.

```typescript
import { Mandu } from "@mandujs/core";
import { z } from "zod";

// Define contract
const userContract = Mandu.contract({
  request: {
    GET: { query: z.object({ id: z.string() }) },
    POST: { body: z.object({ name: z.string() }) }
  },
  response: {
    200: z.object({ data: z.any() }),
    400: z.object({ error: z.string() })
  }
});

// Create typed handlers
const handlers = Mandu.handler(userContract, {
  GET: (ctx) => ({ data: fetchUser(ctx.query.id) }),
  POST: (ctx) => ({ data: createUser(ctx.body) })
});

// Type-safe client
const client = Mandu.client(userContract, { baseUrl: "/api/users" });
const result = await client.GET({ query: { id: "123" } });
```

---

## Runtime

Server and SSR.

```typescript
import { startServer, registerApiHandler, registerPageLoader } from "@mandujs/core";

// Register handlers
registerApiHandler("getUsers", async (req) => ({ users: [] }));
registerPageLoader("home", () => import("./pages/Home"));

// Start server
const server = startServer(manifest, { port: 3000 });
```

### Streaming SSR

```typescript
import { renderToStream } from "@mandujs/core";

const stream = await renderToStream(<App />, {
  bootstrapScripts: ["/client.js"],
  onError: (err) => console.error(err)
});
```

---

## Client (Islands & Router)

### Island Hydration

```typescript
import { createIsland, partial } from "@mandujs/core/client";

// Define island
const CounterIsland = createIsland({
  name: "counter",
  component: Counter,
  priority: "visible"
});

// Partial (smaller than island)
const ButtonPartial = partial("submit-btn", SubmitButton);
```

### Client Router

```typescript
import { useRouter, useParams, Link, NavLink } from "@mandujs/core/client";

function Navigation() {
  const router = useRouter();
  const params = useParams();

  return (
    <nav>
      <NavLink href="/users" activeClass="active">Users</NavLink>
      <button onClick={() => router.push("/settings")}>Settings</button>
    </nav>
  );
}
```

---

## Brain (AI Assistant)

Doctor and architecture analyzer.

```typescript
import {
  initializeBrain,
  getBrain,
  analyzeViolations,
  initializeArchitectureAnalyzer
} from "@mandujs/core";

// Initialize
await initializeBrain();
const brain = getBrain();

// Analyze violations with suggestions
const analysis = await analyzeViolations(violations, { useLLM: true });
console.log(analysis.patches); // Suggested fixes

// Architecture analyzer
const analyzer = initializeArchitectureAnalyzer(rootDir);
const locationResult = await analyzer.checkLocation({ path: "src/features/user.ts" });
const importResult = await analyzer.checkImports({
  sourceFile: "src/features/user.ts",
  imports: ["../entities/product"]
});
```

---

## Bundler

Client bundling with HMR.

```typescript
import { buildClientBundle, createDevBundler } from "@mandujs/core/bundler";

// Production build
const result = await buildClientBundle(manifest, {
  outDir: ".mandu/client",
  minify: true,
  sourcemap: true
});

// Development with HMR
const devBundler = await createDevBundler(manifest, {
  rootDir: process.cwd(),
  isDev: true
});
```

---

## Transaction API

Atomic changes with rollback.

```typescript
import { beginChange, commitChange, rollbackChange } from "@mandujs/core";

// Start transaction
const { changeId, snapshotId } = await beginChange(rootDir, "Add user API");

// Make changes...

// Commit or rollback
await commitChange(rootDir);
// or
await rollbackChange(rootDir);
```

---

## Types

```typescript
import type {
  // Spec
  RoutesManifest,
  RouteSpec,

  // Guard
  GuardPreset,
  GuardConfig,
  Violation,
  ViolationReport,

  // Router
  ScanResult,
  FSRouteConfig,

  // Contract
  ContractDefinition,
  ContractHandlers,

  // Filling
  ManduContext,
} from "@mandujs/core";
```

---

## Requirements

- Bun >= 1.0.0
- React >= 18.0.0
- Zod >= 3.0.0

## Related Packages

- [@mandujs/cli](https://www.npmjs.com/package/@mandujs/cli) - CLI tool
- [@mandujs/mcp](https://www.npmjs.com/package/@mandujs/mcp) - MCP server for AI agents

## License

MIT
