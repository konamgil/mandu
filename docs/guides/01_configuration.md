# Configuration

Mandu reads project settings from a single config file and applies them to the CLI and runtime.

## Supported Files

Mandu searches in this order and uses the first file found:

1. `mandu.config.ts`
2. `mandu.config.js`
3. `mandu.config.json`
4. `.mandu/guard.json` (guard-only overrides)

## Precedence

- CLI flags override config values
- Config values override defaults

`mandu dev`, `mandu build`, and `mandu routes` validate the config and exit with an error if it is invalid.

## Lockfile & Integrity (ont-run adoption)

Mandu can track approved configuration changes using a lockfile.

- **Lockfile path**: `.mandu/lockfile.json`
- **Generate/Update**: `mandu lock`
- **Verify**: `mandu lock --verify`
- **Diff**: `mandu lock --diff` (secrets are redacted by default)
- **Show secrets**: `mandu lock --diff --show-secrets`

**Policy (recommended)**:
- dev: warn on mismatch
- build/ci: fail on mismatch (can be relaxed)
- prod: block server start on mismatch  
  → emergency bypass: `MANDU_LOCK_BYPASS=1`

Lockfile covers `mandu.config.*` by default and may optionally include `.mcp.json`.

## MCP Configuration

MCP server settings live in `.mcp.json` and are **separate** from `mandu.config.*`.
They can be diffed/hashed independently and (optionally) included in lockfile validation.

## Schema Overview

### `server`
- `port`: number (1-65535)
- `hostname`: string
- `cors`: boolean or `{ origin?, methods?, credentials? }`
- `streaming`: boolean

### `dev`
- `hmr`: boolean
- `watchDirs`: string[] (extra directories watched by the dev bundler)

### `build`
- `outDir`: string (default `.mandu`)
- `minify`: boolean
- `sourcemap`: boolean
- `splitting`: boolean (reserved for future use)

### `guard`
- `preset`: `"mandu" | "fsd" | "clean" | "hexagonal" | "atomic"`
- `srcDir`: string
- `exclude`: string[] (glob patterns)
- `realtime`: boolean
- `rules`, `contractRequired`: legacy spec-guard controls

### `fsRoutes`
- `routesDir`: string (default `"app"`)
- `extensions`: string[]
- `exclude`: string[] (glob patterns)
- `islandSuffix`: string (default `".island"`)

### `seo`
- `enabled`: boolean
- `defaultTitle`: string
- `titleTemplate`: string

## Example

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
  },
  fsRoutes: {
    routesDir: "app",
    extensions: [".tsx", ".ts"],
    exclude: ["**/*.spec.ts"],
    islandSuffix: ".island",
  },
  seo: {
    enabled: true,
    defaultTitle: "My App",
    titleTemplate: "%s | My App",
  },
};
```

## Notes

- `guard` in `mandu.config` provides defaults for `mandu guard arch` (preset/srcDir/exclude). CLI flags still override those values; advanced options (layers, overrides, severity) remain CLI-driven.
- `fsRoutes` settings are applied in `mandu dev` and `mandu routes`.
