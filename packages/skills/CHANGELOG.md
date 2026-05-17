# @mandujs/skills

## 0.20.1

### Patch Changes

- Fix issue #273 dogfooding regressions across SSR data documentation, island guidance, dev routing, generators, diagnostics, deploy inference, generated import guards, metadata routes, and JSX title hoisting.

## 1.0.0

### Patch Changes

- Updated dependencies [[`b96f439`](https://github.com/konamgil/mandu/commit/b96f439a246a26edaf50104522cacb4d49a533e8), [`48743ed`](https://github.com/konamgil/mandu/commit/48743edec9708e16e73a57e0b11061fe452f04eb)]:
  - @mandujs/core@0.54.0

## 0.19.1

### Patch Changes

- [`72345c3`](https://github.com/konamgil/mandu/commit/72345c38c55ec2418a94ec686de49700e6f5b8bd) Thanks [@konamgil](https://github.com/konamgil)! - Fix MCP boot regressions and DevTools dev-mode UX.

  - `mandu diagnose` adds a `nested_internal_core` check that flags stale `@mandujs/core` installs nested under sibling `@mandujs/*` packages, the root cause behind `Cannot find module @mandujs/core/...` boot failures (#261). Emits a copy-pastable `rm -rf` fix.
  - Dev-mode SSR now injects `_devtools.js` even on SSR-only pages so Kitchen panels work on island-free landing/marketing routes; production builds remain 0 bytes (#259). Explicit `dev.devtools: false` still opts out.
  - `@mandujs/skills` `peerDependencies.@mandujs/core` narrowed from the effectively-wildcard `">=0.1.0"` to `^0.53.0`, and `@mandujs/ate` now declares the same peer (it imports `@mandujs/core/observability` at runtime) — both contributed to package-manager resolver decisions that kept stale cores around (#262).
  - `mandu` project templates make the `prepare` script git-tolerant so `bun install` no longer fails on machines without git in PATH (e.g. GitHub Desktop users on Windows) (#258).

## 0.19.0

### Minor Changes

- [`fe765d1`](https://github.com/konamgil/mandu/commit/fe765d1c5c0d054ea890f5c38a1c6f3751226dba) Thanks [@konamgil](https://github.com/konamgil)! - feat: lint as default guardrail across CLI, MCP, and skills

  Positions oxlint as the third guardrail axis alongside `mandu guard`
  (architecture) and `tsgo` (types). Every Mandu surface now treats
  lint as a first-class default:

  - **`mandu check`** — runs oxlint when available, adds the result to
    the health score. Errors flip exit; warnings are reported.
  - **`mandu build`** — pre-build lint gate. Errors block the build;
    `--no-lint` opts out for emergency deploys.
  - **`mandu init` templates** — `default` / `auth-starter` /
    `realtime-chat` ship `lefthook.yml` (pre-push: typecheck + lint
    in parallel), `lefthook` devDep, and `prepare: "lefthook install"`.
  - **MCP tools** — new `mandu.lint` (read-only runner) and
    `mandu.lint.setup` (destructive installer wrapping the CLI
    command). `dryRun: true` previews.
  - **Skills** — new `mandu-lint` SKILL.md covering guardrail
    positioning, setup, type-aware, safe-autofix pattern, and
    anti-patterns. `mandu-guard-guide` gains a 3-axis header.
    `mandu-mcp-verify` fast path becomes 4-parallel (lint joins
    ate/guard/doctor) with a new lint drill-down branch.
    `mandu-mcp-safe-change` Step 4 explicitly includes lint.

## 0.18.0

### Minor Changes

- [`6ded2af`](https://github.com/konamgil/mandu/commit/6ded2af0bed3eaec90aafa0e0d7b077099d07ecc) Thanks [@konamgil](https://github.com/konamgil)! - feat(skills): #234 workflow-oriented MCP recipe skills

  Adds 6 workflow-oriented skills to `@mandujs/skills` that orchestrate
  combinations of the 108 MCP tools exposed by `@mandujs/mcp`:

  - `mandu-mcp-index` — always-on router + tiered hierarchy + anti-pattern catalog
  - `mandu-mcp-orient` — session start / state assessment (ai.brief aggregate)
  - `mandu-mcp-create-flow` — spec-first creation (contract before generate)
  - `mandu-mcp-verify` — post-edit verification loop (ate.auto_pipeline + guard_check + doctor)
  - `mandu-mcp-safe-change` — transactional safety wrapper (history.snapshot + tx.begin)
  - `mandu-mcp-deploy` — fail-fast build/deploy pipeline (deploy.check gate)

  Complements existing task-shaped skills (`mandu-create-feature`,
  `mandu-debug`, `mandu-guard-guide`, etc.) — domain knowledge stays,
  tool orchestration is added on top. Each workflow skill codifies
  aggregate-first priority (`ate.auto_pipeline` over individual ate tools),
  ordering rules (`create_contract` before `generate`), and safety gates
  (`history.snapshot` before `refactor_*`). Existing skills gain one-line
  "See also" links to the relevant workflow skill.

## 0.17.0

### Version reset (2026-04-22)

- Reset from `17.0.0` → `0.17.0` to realign with sibling packages (all 0.x).
  The 12 → 17 climb was caused by Changesets' default "major-bump on any
  peer-dep update" policy combined with a tight `@mandujs/core` peer
  range. Neither reflected actual breaking changes.
- 17.x line deprecated on npm with a pointer to 0.17.x.
- Going forward: Changesets is configured with
  `onlyUpdatePeerDependentsWhenOutOfRange: true`, and the core peer is
  relaxed to `">=0.1.0"` — future peer-dep bumps stay on the patch track.

## 17.0.0 (deprecated — see 0.17.0 reset note above)

### Patch Changes

- Updated dependencies [[`e77b035`](https://github.com/konamgil/mandu/commit/e77b035dd28cc256a596fe5221f781c5609645e9)]:
  - @mandujs/core@0.39.0

## 16.0.0

### Patch Changes

- Updated dependencies [[`8e53ca0`](https://github.com/konamgil/mandu/commit/8e53ca007cd588ce3cba0866222f5eb1982d01bd)]:
  - @mandujs/core@0.37.0

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
