# @mandujs/skills

## 15.0.0

### Patch Changes

- Updated dependencies [[`88d597a`](https://github.com/konamgil/mandu/commit/88d597ad50d5ac219e68f458e746f4f649de2c50)]:
  - @mandujs/core@0.36.0

## 14.0.0

### Patch Changes

- Updated dependencies [[`5c9bac1`](https://github.com/konamgil/mandu/commit/5c9bac1afd3d769ec5889ec5ac65b6d587ff9f51)]:
  - @mandujs/core@0.35.0

## 13.0.0

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.34.0

## 12.0.0

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.33.0

## 11.0.0

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.32.0

## 10.0.0

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.31.0

## 9.0.0

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.30.0

## 6.0.0

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.29.0

## 5.0.0

### Patch Changes

- Wave D — 8 GitHub issues + Phase 17 memory/observability:

  - **#193 (BREAKING)** — SPA navigation is opt-out by default. Plain
    `<a href="/about">` now triggers client-side nav with View
    Transitions. Opt-out per link: `data-no-spa`. Opt-out global:
    `mandu.config.ts` `spa: false`. Legacy `data-mandu-link` still works.

  - **#194** — `@mandujs/core` exports map exposes `./kitchen` so
    `@mandujs/mcp` can import `computeAgentStats`.

  - **#195** — `mandu dev` prints a synchronous boot banner before any
    `await`, so a hang is always observable. `MANDU_DEBUG_BOOT=1` emits
    a phase trace.

  - **#196** — `mandu dev` auto-discovers and runs `scripts/prebuild-*.
{ts,tsx,js,mjs}` before serving. In watch mode, `content/` changes
    re-execute prebuild (500ms debounced) and broadcast HMR reload.
    Opt-out: `dev.autoPrebuild: false`.

  - **#197** — `@mandujs/skills` now writes every skill as
    `.claude/skills/<name>/SKILL.md` (Claude Code spec). All three
    installer paths (dev, CLI binary mode, per-project generator)
    corrected.

  - **#198** — SSR resolves `async function` components. `export default
async function Page()` / async layouts / async generateMetadata work.
    4 callsites pre-resolve via `resolveAsyncElement()`.

  - **#199 (MVP)** — `@mandujs/core/content`: `defineCollection`,
    frontmatter parser (no new runtime deps), `slugFromPath`,
    `generateSidebar`, `generateLLMSTxt`, content-types.d.ts emitter.
    Legacy `defineCollection({ loader })` preserved.

  - **#200** — runtime registry: `getGenerated`, `getManifest`,
    `registerManifest` at `@mandujs/core/runtime`. Guard
    `INVALID_GENERATED_IMPORT` message now points at
    `mandujs.com/docs/architect/generated-access`.

  - **Phase 17** — bounded LRU (patternCache/fetchCache/perFileTimers),
    `/_mandu/heap` + `/_mandu/metrics` endpoints (dev auto-on, prod
    gated), MCP heap heartbeat, long-run smoke harness.

  Quality: 6 packages typecheck clean, 200+ new regression tests, zero
  new runtime deps.

- Updated dependencies []:
  - @mandujs/core@0.25.0

## 4.0.0

### Patch Changes

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

- Updated dependencies []:
  - @mandujs/core@0.24.0
