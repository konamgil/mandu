---
title: Refactor MCP Tools
description: Agent-facing MCP tools for automated codebase migrations.
phase: 18.ι
---

# Refactor MCP Tools

Three agent-native MCP tools that automate the repetitive migrations that
otherwise trigger the same bugs on every retry. Each tool is dry-run by
default (`dryRun: true`) and carries `destructiveHint: true` so MCP hosts
can gate confirmation.

| Tool | Purpose |
|------|---------|
| `mandu.refactor.rewrite_generated_barrel` | Migrate `__generated__/*` re-exports to `getGenerated()` |
| `mandu.refactor.migrate_route_conventions` | Extract inline Suspense / ErrorBoundary / NotFound → route files |
| `mandu.refactor.extract_contract` | Lift inline Zod schemas in `app/api/**\/route.ts` into `contract/` |

---

## 1. `mandu.refactor.rewrite_generated_barrel`

**Problem.** User barrels that reach into `__generated__/*` trip the
`INVALID_GENERATED_IMPORT` guard + a bundler-level hard-fail (see
`packages/core/src/bundler/plugins/block-generated-imports.ts`). Agents
rewrite these manually and regress the same edge cases.

**Input**

```ts
{ dryRun?: boolean; patterns?: string[] }
```

Defaults: `dryRun: true`, `patterns: ["packages", "src"]`.

**Transform**

```ts
// BEFORE
export { items } from "../__generated__/items.data";

// AFTER
import { getGenerated } from "@mandujs/core/runtime";
declare module "@mandujs/core/runtime" {
  interface GeneratedRegistry {
    "items": typeof items;
  }
}
export const items = getGenerated("items");
```

Multi-symbol re-exports destructure off a shared registry key:

```ts
// BEFORE
export { a, b } from "./__generated__/feed.data";

// AFTER
import { getGenerated } from "@mandujs/core/runtime";
declare module "@mandujs/core/runtime" {
  interface GeneratedRegistry {
    "feed": { a: typeof a; b: typeof b; };
  }
}
const __feed = getGenerated("feed");
export const a = __feed.a;
export const b = __feed.b;
```

**Output shape**

```ts
{
  scanned: number;       // files walked
  matched: number;       // files with at least one rewrite
  rewritten: number;     // 0 when dryRun; === matched otherwise
  skipped: Array<{ file: string; reason: string }>;
  plan: Array<{
    file: string;
    before: string;
    after: string;
    rewrites: Array<{ name: string; key: string; source: string }>;
    appliedIf: "not-dry-run";
  }>;
  dryRun: boolean;
}
```

---

## 2. `mandu.refactor.migrate_route_conventions`

**Problem.** Teams migrating from Next.js paste inline `<Suspense
fallback={...}>` / `<ErrorBoundary>` / `<NotFound />` into page files.
Mandu's convention is file-system routes (`loading.tsx`, `error.tsx`,
`not-found.tsx`).

**Input**

```ts
{ dryRun?: boolean; routes?: string[] }
```

`routes` is an optional allowlist of route dirs relative to project root
(e.g. `["app/dashboard"]`).

**Behaviour**

- Walks `app/**/page.*`. Detects Suspense / ErrorBoundary / inline NotFound.
- Writes `loading.tsx` / `error.tsx` / `not-found.tsx` next to the page.
- **Never overwrites**. If the target exists, the entry is reported in
  `extracted` with `note: "already exists — skipped write"`.
- The page file is **left unchanged** — author removes the inline boundary.

**Output shape**

```ts
{
  routes: string[];
  extracted: Array<{
    route: string;
    convention: "loading" | "error" | "not-found";
    extractedPath: string;
    sourceFile: string;
    note?: string;
  }>;
  skipped: Array<{ route: string; reason: string }>;
  dryRun: boolean;
}
```

---

## 3. `mandu.refactor.extract_contract`

**Problem.** Ad-hoc inline `z.object(...)` schemas in `app/api/**\/route.ts`
prevent OpenAPI generation, typed client hooks, and contract-driven
tests. The canonical pattern is `defineContract()` in `contract/`.

**Input**

```ts
{ dryRun?: boolean; route?: string }
```

**Behaviour**

- Walks `app/api/**\/route.*`. For each file, detects
  `const X = z.object({ ... })` bindings using brace-depth balanced
  matching (nested `z.object` works).
- Emits `contract/<group>.contract.ts`:
  ```ts
  import { z } from "zod";
  import { defineContract } from "@mandujs/core";
  export const usersContract = defineContract({
    create: {
      method: "POST",
      path: "/api/users",
      input: z.object({ name: z.string() }),
      output: z.unknown(),
    },
  });
  ```
- Leaves the route handler untouched (manual follow-up: import the
  contract and replace ad-hoc `Schema.parse()` with contract validation).

**Output shape**

```ts
{
  extracted: Array<{
    route: string;
    contractFile: string;
    schemaName: string;
    sourceFile: string;
  }>;
  skipped: Array<{ route: string; reason: string }>;
  dryRun: boolean;
}
```

---

## Agent workflow — typical session

```
1. Agent runs guard check, discovers INVALID_GENERATED_IMPORT hits.
2. Agent calls mandu.refactor.rewrite_generated_barrel with dryRun: true.
3. Reviews `plan[]` — diffs each `before` → `after` in the host UI.
4. Agent re-invokes with dryRun: false; tool writes atomically.
5. Agent runs mandu.run.tests to confirm no regressions.
6. If user reports Next-style page inheritance, agent calls
   mandu.refactor.migrate_route_conventions.
7. For APIs without contracts, agent calls mandu.refactor.extract_contract
   and wires the result into the handler.
```

## Safety notes

- All three tools declare `destructiveHint: true`. Hosts should gate on
  user confirmation before a non-dry-run call.
- Dry-run is the default. Plans are deterministic — calling the tool
  twice returns the same `plan[]`.
- No new runtime dependencies. All tools are pure fs + string work.
