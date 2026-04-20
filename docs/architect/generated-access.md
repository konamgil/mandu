---
title: "Accessing generated content"
description: "The official pattern for reading .mandu/generated/ artifacts from user code — runtime registry, not direct imports."
stable-since: v0.24
order: 8
---

# Accessing generated content

User code **must not** import anything under `.mandu/generated/`, `__generated__/`,
or any path that contains `/generated/`. The guard rule `INVALID_GENERATED_IMPORT`
catches this at build time with:

```text
Direct __generated__/ imports are forbidden: <path>.
Use the runtime registry: see https://mandujs.com/docs/architect/generated-access
```

This page explains **why** the restriction exists and **what to do instead**.

## Enforcement

As of **Mandu 0.28** (issue #207), the `mandu:block-generated-imports` Bun
plugin is **installed by default** on every `mandu dev`, `mandu build`, and
`mandu start` run. Any import whose specifier contains `__generated__`
causes the build to hard-fail with a structured error:

```text
Direct __generated__/ imports are forbidden: ./__generated__/routes.
Use the runtime registry: see https://mandujs.com/docs/architect/generated-access
  Importer: /your-repo/src/app/page.tsx
  Replacement: import { getGenerated } from "@mandujs/core/runtime";
  Then: const data = getGenerated(<key>);
  Docs: https://mandujs.com/docs/architect/generated-access
```

### Three lines of defence

| Layer | Tool | When it fires |
|---|---|---|
| IDE | `tsconfig.json` `paths` mapping | Typing, before save |
| Static | `mandu guard check` | Explicit lint run |
| **Bundler** | `mandu:block-generated-imports` plugin | **Every build** |

The bundler layer is the one Mandu 0.28 adds. The first two already existed
but were trivially bypassed — autonomous agents kept writing direct imports
despite the Guard warning. The bundler layer makes the failure physical.

### Opt-out (emergency escape hatch)

```ts
// mandu.config.ts
export default {
  guard: {
    blockGeneratedImport: false, // default: true
  },
};
```

Use only when a migration path literally requires the legacy barrel
re-export pattern. Open an issue before disabling — in every case we've
measured, the fix is "use `getGenerated()`."

### Allowed importers

The plugin exempts `@mandujs/core/runtime` internals (the file that
*wires* the global registry is allowed to touch generated content). No
other exemption paths exist.

### Legacy projects

Existing `mandu init` projects pick up the new bundler enforcement on
upgrade without any config change. New `mandu init` projects additionally
get a TypeScript `paths` entry that turns direct imports into an IDE
type error on day one.

## Why direct imports are forbidden

1. **Hot reload** — in dev, generated modules are rebuilt and re-imported on
   every file change. A direct ESM import caches the first version; your code
   reads stale data until the process restarts.
2. **Determinism in compiled binaries** — `bun build --compile` embeds a
   fixed manifest into the binary. Direct imports bypass the embedded copy
   and fail at runtime with "module not found."
3. **ESM cache invalidation** — transitive generated modules used to get
   stuck on stale copies during hot reload (see issue #184). The runtime
   registry is the single choke point that the bundled importer invalidates
   cleanly.
4. **Path portability** — generated paths change across versions. The
   registry API is stable; the on-disk layout is not.

## The official API

### `getGenerated<K>(key)` — typed accessor

```ts
import { getGenerated } from "@mandujs/core/runtime";

const manifest = getGenerated("routes");
for (const route of manifest.routes) {
  console.log(route.id, route.pattern);
}
```

`getGenerated()` throws a clear error if the manifest has not been registered
yet. In normal app boot, `registerManifestHandlers()` from `@mandujs/cli`
registers the manifest for you — the throw only fires in tests that forgot
to seed fixtures or in broken boot sequences.

### `tryGetGenerated<K>(key)` — optional variant

```ts
import { tryGetGenerated } from "@mandujs/core/runtime";

const collections = tryGetGenerated("collections");
if (!collections) {
  // no collections emitted — that's fine
  return [];
}
```

Use `tryGetGenerated()` for artifacts that might not be emitted (e.g.
optional features). For required artifacts, prefer `getGenerated()` so the
boot order error surfaces immediately.

### `getManifest()` — convenience wrapper

```ts
import { getManifest } from "@mandujs/core/runtime";

const manifest = getManifest(); // same as getGenerated("routes")
```

### `getRouteById(id)` — targeted lookup

```ts
import { getRouteById } from "@mandujs/core/runtime";

const route = getRouteById("users-list");
if (route) {
  console.log(route.pattern); // "/api/users"
}
```

## Decision tree

| "I need to access…" | Use |
|---|---|
| The route manifest at runtime | `getManifest()` or `getGenerated("routes")` |
| A specific route by ID | `getRouteById("my-route")` |
| An optional/conditional artifact | `tryGetGenerated("my-key")` |
| Generated content in tests | `registerManifest("routes", fixture)` in `beforeEach` |
| A generated type (not runtime value) | `import type` from `.mandu/generated/types/**` is **allowed** — types are erased at build time |
| A dev-only shim | Explicit re-export from `src/shared/**/index.ts` — the barrel surfaces the shim and Guard's preset accepts it |

## Extending the registry

`GeneratedRegistry` is an interface you can augment. If you emit your own generated
artifact (e.g. a collection index), declare the key shape in a `.d.ts` and
register it during boot:

```ts
// src/shared/types/generated.d.ts
declare module "@mandujs/core/runtime" {
  interface GeneratedRegistry {
    collections: Record<string, { entries: string[] }>;
  }
}
```

```ts
// boot code — typically an adapter plugin
import { registerManifest } from "@mandujs/core/runtime";
import collections from ".mandu/generated/collections"; // allowed HERE — this file IS the generator output

registerManifest("collections", collections);
```

The one file that **is** allowed to import from `.mandu/generated/` is the
glue that wires the registry during boot — the framework provides this for
`routes` via `registerManifestHandlers()`. Third-party generators emit their
own glue.

## Testing

Seed the registry in `beforeEach` and clear it in `afterEach`:

```ts
import { beforeEach, afterEach } from "bun:test";
import { registerManifest, clearGeneratedRegistry } from "@mandujs/core/runtime";

beforeEach(() => {
  clearGeneratedRegistry();
  registerManifest("routes", {
    version: 1,
    routes: [
      { id: "home", pattern: "/", kind: "page", module: "stub" },
    ],
  });
});

afterEach(() => clearGeneratedRegistry());
```

## FAQ

### "I just want to read one file from `.mandu/generated/`. Is there no escape hatch?"

No. Every case we have measured either (a) wants a typed view of the route
manifest — use `getManifest()` — or (b) wants a feature that should live in
its own registry key via module augmentation. If you think you have a third
case, open an issue before adding a workaround.

### "Can I use `import.meta.resolve(...)` to get the generated path?"

Yes, for **non-import** use cases: static analysis, cli tools, debug output.
`import.meta.resolve()` returns a URL string and does not trigger the ESM
graph, so it sidesteps the hot-reload problem. The guard rule only flags
literal `import ... from '...generated...'` statements.

### "What about the existing barrel re-export workaround?"

Re-exporting generated modules through a `src/shared/**/index.ts` barrel
technically bypasses the guard. **This is a workaround, not an endorsement.**
It hits all four failure modes above (hot reload staleness, compile-time
lookup, ESM cache, path brittleness). Migrate to `getGenerated()`.

## Related

- [Guard](/docs/architect/guard) — the invariant catalog that owns
  `INVALID_GENERATED_IMPORT`
- Source: `packages/core/src/runtime/registry.ts`
- Source: `packages/core/src/guard/check.ts` (rule impl)
- Issue: [#200](https://github.com/konamgil/mandu/issues/200)
