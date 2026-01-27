<p align="center">
  <img src="https://raw.githubusercontent.com/konamgil/mandu/main/mandu_only_simbol.png" alt="Mandu" width="200" />
</p>

<h1 align="center">@mandujs/cli</h1>

<p align="center">
  <strong>Agent-Native Fullstack Framework CLI</strong><br/>
  A development OS where architecture stays intact even when AI agents write your code
</p>

<p align="center">
  English | <a href="./README.ko.md"><strong>한국어</strong></a>
</p>

## Installation

```bash
# Bun required
bun add -D @mandujs/cli
```

## Quick Start

```bash
# Create a new project
bunx @mandujs/cli init my-app
cd my-app

# Start development server
bun run dev
```

## Commands

### `mandu init <project-name>`

Creates a new Mandu project.

```bash
bunx @mandujs/cli init my-app
```

Generated structure:
```
my-app/
├── apps/
│   ├── server/main.ts    # Server entry point
│   └── web/entry.tsx     # Client entry point
├── spec/
│   └── routes.manifest.json  # SSOT - Route definitions
├── tests/                # Test templates
├── package.json
└── tsconfig.json
```

### `mandu dev`

Starts the development server (with HMR support).

```bash
bun run dev
# or
bunx mandu dev
```

### `mandu spec`

Validates the spec file and updates the lock file.

```bash
bun run spec
```

### `mandu generate`

Generates code based on the spec.

```bash
bun run generate
```

### `mandu guard`

Checks architecture rules and auto-corrects violations.

```bash
bun run guard

# Disable auto-correction
bunx mandu guard --no-auto-correct
```

Auto-correctable rules:
- `SPEC_HASH_MISMATCH` → Updates lock file
- `GENERATED_MANUAL_EDIT` → Regenerates code
- `SLOT_NOT_FOUND` → Creates slot file

## Writing Spec Files

`spec/routes.manifest.json` is the Single Source of Truth (SSOT) for all routes.

```json
{
  "version": "1.0.0",
  "routes": [
    {
      "id": "getUsers",
      "pattern": "/api/users",
      "kind": "api",
      "module": "apps/server/api/users.ts"
    },
    {
      "id": "homePage",
      "pattern": "/",
      "kind": "page",
      "module": "apps/server/pages/home.ts",
      "componentModule": "apps/web/pages/Home.tsx"
    }
  ]
}
```

### Slot System (v0.2.0+)

Add `slotModule` to separate business logic:

```json
{
  "id": "getUsers",
  "pattern": "/api/users",
  "kind": "api",
  "module": "apps/server/api/users.generated.ts",
  "slotModule": "apps/server/api/users.slot.ts"
}
```

- `*.generated.ts` - Managed by framework (do not modify)
- `*.slot.ts` - Business logic written by developers

## Development Workflow

```bash
# 1. Edit spec
# 2. Validate spec and update lock
bun run spec

# 3. Generate code
bun run generate

# 4. Check architecture
bun run guard

# 5. Run tests
bun test

# 6. Start dev server
bun run dev
```

## Testing

Built-in support for Bun test framework.

```bash
bun test           # Run tests
bun test --watch   # Watch mode
```

## Requirements

- Bun >= 1.0.0
- React >= 18.0.0

## Related Packages

- [@mandujs/core](https://www.npmjs.com/package/@mandujs/core) - Core runtime

## License

MIT
