---
title: Plugin API
phase: 18.τ
status: stable
---

# Mandu Plugin API

Mandu plugins are plain objects that hook into specific lifecycle events in the
framework's build / dev / prerender / runtime pipelines. A plugin is nothing
more than a `name`, an optional `hooks` map, and an optional one-shot `setup`
function.

```ts
// mandu.config.ts
import type { ManduConfig } from "@mandujs/core";
import { definePlugin } from "@mandujs/core/plugins/define";

const myPlugin = definePlugin({
  name: "my-plugin",
  hooks: {
    async onRouteRegistered(route) { console.log("found", route.id); },
    async onManifestBuilt(manifest) { return { ...manifest, version: 2 }; },
  },
});

export default {
  plugins: [myPlugin],
} satisfies ManduConfig;
```

The list below is the **complete** set of hooks available in Phase 18.τ. Every
hook is optional; omitting a hook is strictly a zero-overhead no-op.

## Hook matrix

| Hook | Context / args | Return | Merge semantics | Fired from |
| --- | --- | --- | --- | --- |
| `onBeforeBuild` | — | `void` | — | `mandu build` |
| `onAfterBuild` | `{ success, duration }` | `void` | — | `mandu build` |
| `onDevStart` | `{ port, hostname }` | `void` | — | `mandu dev` |
| `onDevStop` | — | `void` | — | `mandu dev` |
| `onRouteChange` | `{ routeId, pattern, kind }` | `void` | — | `mandu dev` watcher |
| `onBeforeStart` | — | `void` | — | `mandu start` |
| `onRouteRegistered` | `RouteSpec` | `void` | — | `generateManifest()` |
| `onManifestBuilt` | `RoutesManifest` | `RoutesManifest \| void` | Pipe — last non-void wins | `generateManifest()` |
| `defineBundlerPlugin` | — | `BunPlugin \| BunPlugin[]` | Concat across plugins | every `safeBuild()` call-site |
| `onBundleComplete` | `BundleStats` | `void` | — | `buildClientBundles()` |
| `definePrerenderHook` | `PrerenderContext` | `PrerenderOverride \| void` | Object spread — last write wins | `prerenderRoutes()` |
| `defineMiddlewareChain` | `PluginContext` | `Middleware[]` | Concat, **prepended** to user middleware | `startServer()` boot |
| `defineTestTransform` | `{ testFile, source }` | `string` | Pipe — each plugin sees previous output | `mandu test` loader |

Dispatch order for every hook: config-level hooks (`ManduConfig.hooks`) run
FIRST, then plugin hooks in declaration order.

**Error isolation** is enforced by `@mandujs/core/plugins/runner`: one plugin
throwing does not abort the chain, and failures are surfaced through
`HookRunReport.errors` at each integration point (warnings on the manifest
builder, `errors` array on the bundle result, etc.).

## Plugin anatomy

```ts
export interface ManduPlugin {
  name: string;                    // Unique; shown in diagnostics.
  hooks?: Partial<ManduHooks>;     // The hooks matrix above.
  setup?: (config: Record<string, unknown>) => void | Promise<void>;
}
```

Use `definePlugin()` (from `@mandujs/core/plugins/define`) at export time. It
is a typed passthrough that validates the shape and catches hook-name typos at
definition time.

## Context objects

Every hook that transforms or contributes receives a `PluginContext` (or a
subtype). The context is intentionally small so plugins do not couple to
framework internals outside the stable surface:

```ts
export interface PluginContext {
  rootDir: string;
  mode: "development" | "production";
  logger: {
    debug(msg: string, data?: unknown): void;
    info (msg: string, data?: unknown): void;
    warn (msg: string, data?: unknown): void;
    error(msg: string, data?: unknown): void;
  };
}
```

`PrerenderContext extends PluginContext` adds `pathname`, `pattern?`,
`params?`, `html`. `TestTransformContext` is a plain `{ testFile, source }`.

## Middleware integration

The request-level middleware chain is composed SYNCHRONOUSLY at
`startServer()` time (the function is sync, so hooks cannot be awaited inside
it). Drivers (CLI) resolve plugin middleware first, then pass it in as a
prefix to `options.middleware`:

```ts
import {
  resolvePluginMiddleware,
} from "@mandujs/core/plugins/runner";

const pluginMiddleware = await resolvePluginMiddleware({
  plugins: config.plugins ?? [],
  configHooks: config.hooks,
  rootDir: process.cwd(),
  mode: isDev ? "development" : "production",
});

startServer(manifest, {
  ...serverOptions,
  middleware: [...pluginMiddleware, ...(config.middleware ?? [])],
});
```

## Migration recipes

### Astro integration-like

```ts
definePlugin({
  name: "integration",
  async setup() { /* one-shot boot */ },
  hooks: {
    async onRouteRegistered(route) { /* inspect route before build */ },
    async onManifestBuilt(m) { /* augment manifest */ },
    async onBundleComplete(stats) { /* post-build report */ },
  },
});
```

### Vite-plugin-like

```ts
definePlugin({
  name: "vite-style",
  hooks: {
    defineBundlerPlugin: () => [
      { name: "my-transform", setup(build) { /* BunPlugin body */ } },
    ],
  },
});
```

### Next.js extension-like

```ts
definePlugin({
  name: "next-style",
  hooks: {
    definePrerenderHook: (ctx) => {
      if (ctx.pathname.startsWith("/admin")) return { skip: true };
      return { html: ctx.html.replace("</head>", "<meta name='generator' content='mandu'></head>") };
    },
    defineMiddlewareChain: (ctx) => [requestIdMiddleware, authGateMiddleware],
  },
});
```

## Example plugins

See `packages/core/src/plugins/examples/`:

- `sitemap-plugin.ts` — emits `sitemap.xml` on `onManifestBuilt`.
- `dep-check-plugin.ts` — warns on `onRouteRegistered` when a route imports a forbidden package.
- `prerender-cache-plugin.ts` — caches prerender output via `definePrerenderHook` + prunes stale entries on `onBundleComplete`.

They are educational (not published) — copy into your project and adapt.

## Error handling

Every runner returns a `HookRunReport` with a typed `errors` array. The CLI
integrations surface these as warnings (router scanner, manifest builder) or
as `BundleResult.errors` entries (bundler). Use `formatHookErrors(report)` to
render a human-readable summary:

```ts
import { formatHookErrors } from "@mandujs/core/plugins";

const rollup = formatHookErrors(report);
if (rollup) console.error(rollup);
```

A plugin that throws does NOT abort the remaining plugins in the chain. This
is a deliberate design choice — in a multi-plugin composition, one bad plugin
should not brick the whole build. For truly fatal conditions, a plugin should
either `process.exit(1)` in `setup` (clear fail-fast intent) or emit an error
through the framework's error overlay channel.
