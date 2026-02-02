<p align="center">
  <img src="https://raw.githubusercontent.com/konamgil/mandu/main/mandu_only_simbol.png" alt="Mandu" width="200" />
</p>

<h1 align="center">@mandujs/cli</h1>

<p align="center">
  <strong>Agent-Native Fullstack Framework CLI</strong><br/>
  Architecture stays intact even when AI agents write your code
</p>

<p align="center">
  English | <a href="./README.ko.md"><strong>한국어</strong></a>
</p>

## Installation

```bash
bun add -D @mandujs/cli
```

## Quick Start

```bash
# Create project
bunx @mandujs/cli init my-app
cd my-app && bun install

# Start development
bun run dev
```

That's it. Create pages in `app/` and start coding.

---

## Commands

### Core Commands

| Command | Description |
|---------|-------------|
| `mandu init [name]` | Create new project |
| `mandu dev` | Start dev server (FS Routes + HMR) |
| `mandu build` | Build for production |

### FS Routes Commands

| Command | Description |
|---------|-------------|
| `mandu routes list` | Show all routes |
| `mandu routes generate` | Generate routes manifest |
| `mandu routes watch` | Watch for route changes |

### Guard Commands

| Command | Description |
|---------|-------------|
| `mandu guard arch` | Run architecture check (default: mandu preset) |
| `mandu guard arch --watch` | Watch mode |
| `mandu guard arch --ci` | CI mode (exit 1 on errors) |
| `mandu guard arch --preset fsd` | Use specific preset |
| `mandu guard arch --output report.md` | Generate report |

### Transaction Commands

| Command | Description |
|---------|-------------|
| `mandu change begin` | Start transaction (creates snapshot) |
| `mandu change commit` | Finalize changes |
| `mandu change rollback` | Restore from snapshot |
| `mandu change status` | Show current state |
| `mandu change list` | View history |

### Brain Commands

| Command | Description |
|---------|-------------|
| `mandu doctor` | Analyze Guard failures + suggest patches |
| `mandu watch` | Real-time file monitoring |
| `mandu brain setup` | Configure sLLM (optional) |
| `mandu brain status` | Check Brain status |

### Contract & OpenAPI Commands

| Command | Description |
|---------|-------------|
| `mandu contract create <routeId>` | Create contract for route |
| `mandu contract validate` | Validate contract-slot consistency |
| `mandu openapi generate` | Generate OpenAPI 3.0 spec |
| `mandu openapi serve` | Start Swagger UI server |

---

## Workflow

### Modern Workflow (Recommended)

```bash
# 1. Create project
bunx @mandujs/cli init my-app
cd my-app && bun install

# 2. Create pages
# app/page.tsx        → /
# app/users/page.tsx  → /users
# app/api/users/route.ts → /api/users

# 3. Start development
bun run dev
```

### With Architecture Guard

```bash
# Development with Guard watching
bunx mandu dev --guard

# Or run Guard separately
bunx mandu guard arch --watch
```

### CI/CD Integration

```bash
# Build and check
bunx mandu build --minify
bunx mandu guard arch --ci --format json
```

---

## FS Routes

Create routes by adding files to `app/`:

```
app/
├── page.tsx              → /
├── layout.tsx            → Layout for all pages
├── users/
│   ├── page.tsx          → /users
│   ├── [id]/
│   │   └── page.tsx      → /users/:id
│   └── [...slug]/
│       └── page.tsx      → /users/*
├── api/
│   └── users/
│       └── route.ts      → /api/users
└── (auth)/               → Group (no URL segment)
    └── login/page.tsx    → /login
```

### Special Files

| File | Purpose |
|------|---------|
| `page.tsx` | Page component |
| `layout.tsx` | Shared layout |
| `route.ts` | API endpoint |
| `loading.tsx` | Loading state |
| `error.tsx` | Error boundary |
| `slot.ts` | Business logic |
| `client.tsx` | Interactive component (Island) |

---

## Guard Presets

| Preset | Description |
|--------|-------------|
| `mandu` | FSD + Clean Architecture (default) |
| `fsd` | Feature-Sliced Design |
| `clean` | Clean Architecture |
| `hexagonal` | Hexagonal Architecture |
| `atomic` | Atomic Design |

```bash
# List all presets
bunx mandu guard arch --list-presets

# Use specific preset
bunx mandu guard arch --preset fsd
```

---

## Options Reference

### `mandu dev`

| Option | Description |
|--------|-------------|
| `--port <n>` | Server port (default: 3000) |
| `--guard` | Enable Guard watching |
| `--guard-preset <p>` | Guard preset (default: mandu) |

### `mandu build`

| Option | Description |
|--------|-------------|
| `--minify` | Minify output |
| `--sourcemap` | Generate sourcemaps |
| `--watch` | Watch mode |

### `mandu guard arch`

| Option | Description |
|--------|-------------|
| `--preset <p>` | Preset: fsd, clean, hexagonal, atomic, mandu |
| `--watch` | Watch mode |
| `--ci` | CI mode (exit 1 on errors) |
| `--quiet` | Summary only |
| `--format <f>` | Output: console, agent, json |
| `--output <path>` | Report file path |
| `--report-format <f>` | Report: json, markdown, html |
| `--save-stats` | Save for trend analysis |
| `--show-trend` | Show trend analysis |

### `mandu doctor`

| Option | Description |
|--------|-------------|
| `--format <f>` | Output: console, json, markdown |
| `--no-llm` | Template mode (no LLM) |
| `--output <path>` | Output file path |

---

## Examples

```bash
# Initialize project
bunx @mandujs/cli init my-app

# Development
bunx mandu dev --port 3000
bunx mandu dev --guard

# Routes
bunx mandu routes list
bunx mandu routes generate

# Guard
bunx mandu guard arch
bunx mandu guard arch --watch
bunx mandu guard arch --ci --format json
bunx mandu guard arch --output report.md

# Transactions
bunx mandu change begin --message "Add users API"
bunx mandu change commit
bunx mandu change rollback

# Doctor
bunx mandu doctor
bunx mandu doctor --format json

# Build
bunx mandu build --minify --sourcemap
```

---

## Requirements

- Bun >= 1.0.0

## Related Packages

- [@mandujs/core](https://www.npmjs.com/package/@mandujs/core) - Core runtime
- [@mandujs/mcp](https://www.npmjs.com/package/@mandujs/mcp) - MCP server

## License

MIT
