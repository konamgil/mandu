# @mandujs/edge

## 0.4.24

### Patch Changes

- Updated dependencies [[`8419ae1`](https://github.com/konamgil/mandu/commit/8419ae15a83180301383f995e36f42ed328de6ee)]:
  - @mandujs/core@0.39.3

## 0.4.23

### Patch Changes

- Updated dependencies [[`49353c7`](https://github.com/konamgil/mandu/commit/49353c70415c31fec1501bb39c16652dce47f80a)]:
  - @mandujs/core@0.39.2

## 0.4.22

### Patch Changes

- Updated dependencies [[`b13bfee`](https://github.com/konamgil/mandu/commit/b13bfeee9a2ce682cd71e99e5db89f701dfe557f)]:
  - @mandujs/core@0.39.1

## 0.4.21

### Patch Changes

- Updated dependencies [[`e77b035`](https://github.com/konamgil/mandu/commit/e77b035dd28cc256a596fe5221f781c5609645e9)]:
  - @mandujs/core@0.39.0

## 0.4.20

### Patch Changes

- Updated dependencies [[`8e53ca0`](https://github.com/konamgil/mandu/commit/8e53ca007cd588ce3cba0866222f5eb1982d01bd)]:
  - @mandujs/core@0.37.0

## 0.4.19

### Patch Changes

- Updated dependencies [[`88d597a`](https://github.com/konamgil/mandu/commit/88d597ad50d5ac219e68f458e746f4f649de2c50)]:
  - @mandujs/core@0.36.0

## 0.4.18

### Patch Changes

- Updated dependencies [[`5e68c57`](https://github.com/konamgil/mandu/commit/5e68c57565b5bfb611d781e445025e05e8288d2e)]:
  - @mandujs/core@0.35.1

## 0.4.17

### Patch Changes

- Updated dependencies [[`5c9bac1`](https://github.com/konamgil/mandu/commit/5c9bac1afd3d769ec5889ec5ac65b6d587ff9f51)]:
  - @mandujs/core@0.35.0

## 0.4.16

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.34.2

## 0.4.15

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.34.1

## 0.4.14

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.34.0

## 0.4.13

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.33.1

## 0.4.12

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.33.0

## 0.4.11

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.32.0

## 0.4.10

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.31.0

## 0.4.9

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.30.0

## 0.4.8

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.29.1

## 0.4.1

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.29.0

## 0.4.0

### Minor Changes

- Phase 15.2 — Edge adapter expansion:

  - **`@mandujs/edge/deno`** — `createDenoHandler()` + `deno.json`
    generator for Deno Deploy.
  - **`@mandujs/edge/vercel`** — `createVercelEdgeHandler()` +
    `vercel.json` generator with `runtime: "edge"` and catch-all
    rewrite to `/api/_mandu`.
  - **`@mandujs/edge/netlify`** — `createNetlifyEdgeHandler()` +
    `netlify.toml` generator with `edge_functions` block.
  - **CLI** — `mandu build --target=<deno|vercel-edge|netlify-edge>`
    produces platform entry + config artifact.

  All three adapters inherit Phase 15.1 R0 contract: per-request
  AsyncLocalStorage isolation, production error-body scrubbing,
  throwing Bun-only API shim with platform-specific signals.

  77 new tests (fetch + config + emitter smoke). Edge suite total
  107/0 pass. Zero new runtime deps; Phase 15.1 Workers bundle
  unchanged (1609.3 KB). Hono territory non-infringement preserved —
  adapters are polyfill + config only, never routing.

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.25.0

## 0.3.0

### Minor Changes

- Wave C — GitHub issue closures + R3 Low hardening + flake fixes:

  - **Issue #190** — `mandu dev/start` default hostname `0.0.0.0` (IPv4
    dual-stack). Fixes Windows `localhost` IPv4-resolve dead-page. Log
    now prints `http://localhost:PORT (also reachable at 127.0.0.1, [::1])`.

  - **Issue #191** — `_devtools.js` injected only when
    `bundleManifest.hasIslands === true`. Opt-in/out via
    `ManduConfig.dev.devtools`. URL gets `?v=<buildTime>` cache-bust +
    dev static `Cache-Control: no-cache, no-store, must-revalidate` so
    stale-bundle after HMR is impossible.

  - **Issue #192** — Zero-config smooth navigation: `@view-transition`
    CSS + ~500B hover prefetch IIFE auto-injected. Opt-out via
    `ManduConfig.transitions`/`prefetch` (default `true`) or per-link
    `data-no-prefetch`. Follow-up #193 tracks opt-in→opt-out SPA nav
    reversal (breaking change, deferred).

  - **Issue #189** — Transitive ESM cache: reverse-import-graph
    invalidation. Change a deep file → HMR now invalidates every
    transitive importer (barrel + static-map, deep re-export chain,
    singleton). Depth-capped BFS + HMR log shows invalidated count.

  - **R3 Low hardening** — AI chat `/save|/load|/system` containment
    under `./.mandu/ai-chat/`; skills generator `--out-dir` project-root
    guard; Workers `ctx` AsyncLocalStorage; Edge 500 body scrub in prod;
    `@mandujs/skills/loop-closure` subpath exports.

  - **DX** — Per-subcommand `--help` routing (8 commands); changeset
    CHANGELOG auto-update wired.

  - **Flake fixes** — dbPlan/dbApply path resolution; precommitCheck
    ts-morph pre-warm + 15s Windows ceiling; safe-build handoff-race.

  Quality: 6 packages typecheck clean, 97+ new tests, no new runtime
  deps, no production-code regressions.

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.24.0
