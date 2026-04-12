# Mandu

A Bun-based fullstack React framework with island architecture, AI-native tooling, and architectural guardrails.

Mandu gives you SSR and streaming out of the box, ships only the JavaScript your page actually needs through islands, and integrates directly with AI coding agents through 85 MCP tools and 9 skill files.

## Quick Start

```bash
bunx @mandujs/cli init my-app
cd my-app
bun run dev
```

Your app is running at `http://localhost:3333`.

## Feature Overview

### Island Architecture

Every interactive component is an island. You choose when it hydrates.

```tsx
import { island } from "@mandujs/core";

export default island("visible", ({ name }) => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((c) => c + 1)}>{name}: {count}</button>;
});
```

Five hydration strategies: `load` (immediate), `idle` (requestIdleCallback), `visible` (IntersectionObserver), `media` (media query match), `never` (SSR-only, zero JS).

### Filling API

Type-safe HTTP handlers with an 8-stage lifecycle.

```
onRequest -> onParse -> beforeHandle -> handler -> afterHandle -> mapResponse -> onError -> afterResponse
```

```ts
export const api = filling({
  method: "POST",
  path: "/users",
  contract: { body: UserSchema },
  handler: async ({ body }) => ({ id: crypto.randomUUID(), ...body }),
});
```

Supports WebSocket via `filling.ws()` with the same lifecycle model.

### Contract API

Zod-based schemas that power runtime validation and OpenAPI generation simultaneously.

```ts
import { contract } from "@mandujs/core";

export const UserContract = contract({
  body: z.object({ name: z.string(), email: z.string().email() }),
  response: z.object({ id: z.string(), name: z.string() }),
});
```

Run `mandu contract` to validate all contracts. Run `mandu openapi` to generate a spec.

### Guard System

Enforce project structure conventions at the filesystem level. Six presets available.

| Preset | Architecture |
|--------|-------------|
| `fsd` | Feature-Sliced Design |
| `clean` | Clean Architecture |
| `hexagonal` | Hexagonal / Ports & Adapters |
| `atomic` | Atomic Design |
| `cqrs` | Command Query Responsibility Segregation |
| `mandu` | Mandu default conventions |

```bash
mandu guard-check          # validate structure
mandu guard-check --fix    # auto-fix violations
```

### Rendering

- **SSR** -- server-side rendering with automatic `<head>` management
- **Streaming SSR** -- progressive HTML streaming for large pages
- **ISR / SWR** -- incremental static regeneration with `revalidatePath()` and `revalidateTag()`
- **View Transitions** -- automatic transitions between route navigations

### Data Loading

**Slots** are server-side data loaders that run before render and inject typed props into pages. Define `page.slot.ts` next to any route and the data is available as props. **Middleware** runs globally via the `middleware.ts` convention at the project root.

### Sessions and Auth

Cookie-based sessions via `createCookieSessionStorage`. Scaffold auth boilerplate with `mandu auth` and session handling with `mandu session`.

### Client Hooks

| Hook | Purpose |
|------|---------|
| `useMandu()` | Framework context (route, params, navigation) |
| `useLoaderData()` | Access slot data |
| `useActionData()` | Access form action results |
| `useSubmit()` | Programmatic form submission |
| `useFetch()` | Data fetching with SWR semantics |
| `useHead()` | Document head management |
| `useSeoMeta()` | SEO meta tags |

Progressive enhancement with the `<Form>` component. Type-safe server calls with `createClient` RPC.

### Additional Features

- **Image optimization** -- `/_mandu/image` endpoint with sharp, automatic format conversion
- **Content Collections** -- Markdown and MDX with frontmatter, used via `mandu collection`
- **Adapter system** -- `adapterBun` built-in, extensible for other runtimes

## CLI

38 commands organized by domain.

| Category | Commands |
|----------|---------|
| **Core** | `dev`, `build`, `start`, `preview`, `clean`, `info` |
| **Quality** | `guard-check`, `contract`, `doctor`, `explain`, `fix` |
| **Scaffolding** | `init`, `scaffold`, `add`, `middleware`, `session`, `ws`, `auth`, `collection` |
| **AI** | `ask`, `review`, `generate --ai`, `mcp` |
| **Ops** | `deploy`, `upgrade`, `completion`, `cache`, `lock`, `monitor` |

Run `mandu --help` for the full list.

## MCP Integration

Mandu ships an MCP server (`@mandujs/mcp`) with 85 tools across 18 categories.

```bash
mandu mcp                # start the MCP server
mandu mcp --profile full # all 85 tools
mandu mcp --profile minimal # essential subset
```

Tool categories use dot notation: `guard.check`, `contract.validate`, `slot.create`, `seo.audit`, `brain.explain`, `runtime.status`, and more.

Includes 3 prompts, 3 resources, and transaction locking for safe multi-agent operation.

## Skills

The `@mandujs/skills` npm package provides 9 SKILL.md files that plug into Claude Code as a plugin with hooks.

| Skill | Scope |
|-------|-------|
| `mandu-create-api` | API route scaffolding |
| `mandu-create-feature` | Feature module generation |
| `mandu-debug` | Debugging guidance |
| `mandu-deploy` | Deployment workflows |
| `mandu-explain` | Codebase explanation |
| `mandu-fs-routes` | File-system routing |
| `mandu-guard-guide` | Guard configuration |
| `mandu-hydration` | Island hydration patterns |
| `mandu-slot` | Data loader patterns |

## Project Structure

```
app/                  # pages, layouts, islands
  page.tsx            # route component
  page.slot.ts        # server-side data loader
  layout.tsx          # layout wrapper
  *.island.tsx        # interactive island
middleware.ts         # global middleware
mandu.config.ts       # framework configuration
.mandu/               # build output (generated)
```

## Configuration

Configure via `mandu.config.ts` at the project root. Supports server, dev, build, and guard settings. CLI flags override config values. See `docs/guides/01_configuration.md` for full reference.

## Documentation

| Document | Path |
|----------|------|
| Configuration Guide | `docs/guides/01_configuration.md` |
| API Reference | `docs/api/api-reference.md` |
| Implementation Status | `docs/status.md` |
| Technical Architecture | `docs/architecture/02_mandu_technical_architecture.md` |
| FS Routes Spec | `docs/specs/05_fs_routes_system.md` |
| Guard Spec | `docs/specs/06_mandu_guard.md` |
| SEO Module | `docs/specs/07_seo_module.md` |

## License

MPL-2.0. Modified files must be shared. Applications built with Mandu remain under your own license.
