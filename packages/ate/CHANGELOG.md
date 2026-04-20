# @mandujs/ate

## 0.21.0

### Minor Changes

- [`2013674`](https://github.com/konamgil/mandu/commit/20136745bcc3d5758d7221608e15e24cafb31239) Thanks [@konamgil](https://github.com/konamgil)! - feat(ate,mcp): Phase A.2 — structured diagnostics, flake detection, artifacts, graph freshness

  Ships ATE v2 Phase A.2 per `docs/ate/roadmap-v2-agent-native.md` §7 and the 2026-04-21 senior-grade extension block:

  - `failure.v1` Zod schema + TypeScript type (`FailureV1`) with 8 discriminated kinds: `selector_drift`, `contract_mismatch`, `redirect_unexpected`, `hydration_timeout`, `rate_limit_exceeded`, `csrf_invalid`, `fixture_missing`, `semantic_divergence`. Every failure carries `flakeScore`, `lastPassedAt`, `graphVersion`, and `trace: { path?, screenshot?, dom? }`.
  - `runSpec()` — unified spec runner that auto-detects Playwright vs bun:test from the path, forwards `shard: { current, total }` (Playwright `--shard=c/t`, bun hash partition), captures trace/screenshot/dom artifacts into `.mandu/ate-artifacts/<runId>/` before they can be garbage-collected, and translates raw runner output into deterministic `failure.v1` JSON (Playwright error objects are translated, not pass-through).
  - Deterministic selector-drift auto-heal (`autoHeal`) — similarity = 0.5·text + 0.3·role + 0.2·DOM-proximity. Threshold precedence: explicit arg → `.mandu/config.json` → `MANDU_ATE_AUTO_HEAL_THRESHOLD` env → 0.75 default. Dry-run only; `applyAutoHeal()` is a separate, opt-in call.
  - Flake detector — `.mandu/ate-run-history.jsonl` append-only log, rolling pass/fail transition score over the last `windowSize` runs. Alternating PFPF scores 1.0; pure PPPPP and pure FFFFF both score 0 (broken ≠ flaky). Auto-prune amortized at 10k entries.
  - Artifact store — `.mandu/ate-artifacts/<runId>/`, keep-last-N policy (default 10, override via `MANDU_ATE_ARTIFACT_KEEP`).
  - `graphVersion` freshness signal — `sha256(sorted routeIds + sorted contractIds + extractor version)` stamped on every context response and every failure payload. Agent cache invalidation key.
  - `mandu_ate_run` MCP tool — `{ repoRoot, spec, headed?, trace?, shard? }` → `RunResult` (validated against `failureV1Schema` at the MCP boundary).
  - `mandu_ate_flakes` MCP tool — `{ repoRoot, windowSize?, minScore? }` → `{ flakyTests: Array<{ specPath, flakeScore, lastRuns, lastPassedAt }> }`.

  Resolves #229 (heal step returned empty suggestions — selector-drift now produces ranked deterministic candidates with confidence scores). 28 new tests across ate + mcp, zero runtime dependencies added.

- [`2013674`](https://github.com/konamgil/mandu/commit/20136745bcc3d5758d7221608e15e24cafb31239) Thanks [@konamgil](https://github.com/konamgil)! - feat(ate,mcp,cli): Phase A.3 — prompt catalog v1 + exemplar system

  Ships ATE v2 Phase A.3 per `docs/ate/roadmap-v2-agent-native.md` §7 and the 2026-04-21 extension block.

  - **Prompt catalog** — 3 Markdown prompts in `packages/ate/prompts/`: `filling_unit.v1.md`, `filling_integration.v1.md`, `e2e_playwright.v1.md`. Each under 2000 tokens, English body, Korean intent comments allowed. YAML frontmatter carries `kind`, `version`, `base`, `audience`, `mandu_min`. Every prompt documents MUST-USE primitives, NEVER-DO anti-patterns, the Mandu `data-route-id` / `data-island` / `data-slot` / `data-action` selector convention, 127.0.0.1-over-localhost rule, and a `<!-- EXEMPLAR_SLOT -->` injection point.
  - **`prompt-loader`** — reads `.vN.md` files, parses frontmatter, returns `{frontmatter, body, sha256}` with a stable sha256 cache key. Also accepts un-versioned alias files.
  - **`exemplar-scanner`** — walks `.ts`/`.tsx` with ts-morph, captures the full source of the `test()`/`it()`/`describe()` call following every `@ate-exemplar:` or `@ate-exemplar-anti:` marker. Distinguishes real comment markers from string-literal fixtures + JSDoc examples. Manually curated per §11 decision #2 (no auto-heuristic).
  - **`prompt-composer`** — end-to-end helper that loads a template, selects 2-3 matching positive exemplars + (up to) 1 anti-exemplar, replaces `<!-- EXEMPLAR_SLOT -->` with a formatted Examples / Anti-examples section, and appends a JSON-serialized context block. Returns ready-to-send-to-LLM string + `tokenEstimate`.
  - **`spec-linter`** (ate barrel) — shared lint pass for agent-generated test content: ts-morph syntax parse, banned import typos (e.g. `@mandu/core` → `@mandujs/core`), unknown `@mandujs/*` barrels, unused/unresolved imports, bare `localhost` URLs (blocks — prefer 127.0.0.1 per roadmap §9.2), hand-rolled CSRF cookies when `createTestSession` is available, DB mocks when `createTestDb` is available.
  - **3 new MCP tools** (snake_case per §11 #4):
    - `mandu_ate_prompt` — when `context` is passed, returns the fully composed prompt (template + matched exemplars + serialized context); otherwise returns the raw template + sha256 + an exemplar peek so the agent composes.
    - `mandu_ate_exemplar` — returns the `@ate-exemplar:` tagged tests for a kind, with code + metadata; `includeAnti:true` opt-in for negative examples.
    - `mandu_ate_save` — lint-before-write persister. Runs `spec-linter`; any blocking diagnostic aborts the write with a structured list the agent can address and retry against.
  - **CLI** — new `mandu ate lint-exemplars` subcommand. Scans the repo, flags orphan markers (no following test block), anti-markers missing `reason=`, and unknown kinds. Exits 1 on any problem (CI-friendly). `--json` for machine output.
  - **Prompt goldens** — `packages/ate/tests/prompts/<kind>.golden.md` captures the canonical composer output per kind; re-generate with `UPDATE_GOLDEN=1 bun test`.
  - **Exemplar tagging sprint** — 18 positive + 2 anti-exemplars tagged across core filling tests, core server integration tests, and the demo auth-starter E2E suite.

  35 new tests across `@mandujs/ate`, `@mandujs/mcp`, and `@mandujs/cli`. Typecheck clean across all 7 packages. No new runtime dependencies (ts-morph + zod already present).

## 0.20.0

### Minor Changes

- [`81b4ff7`](https://github.com/konamgil/mandu/commit/81b4ff7adfbba4daeb070fdc6ff41a2e851c53fd) Thanks [@konamgil](https://github.com/konamgil)! - feat(ate,mcp): Phase A.1 — `mandu_ate_context` + 5-kind extractor expansion

  First deliverable of the agent-native ATE v2 roadmap
  (`docs/ate/roadmap-v2-agent-native.md` §7 Phase A.1).

  **ATE extractor** now scans seven node kinds (was route-only): `route`,
  `filling`, `slot`, `island`, `action`, `form`, `modal`. `InteractionNode`
  stays backwards compatible — existing route-only consumers keep working.
  Also ingests `generateStaticParams` array literals statically (for the
  Phase B boundary probe) and surfaces contract `examples` from
  `.contract.ts` files.

  **New `mandu_ate_context` MCP tool** (`scope: project | route | filling
| contract`, optional `id` / `route` arg). Returns a single JSON blob
  containing route metadata + contract + middleware chain + guard preset

  - suggested `[data-route-id]` selectors + fixture recommendations +
    existing specs + related routes. This is the context an agent reads
    _before_ writing a test. Snake_case name per roadmap §11 decision 4.

  **Existing-spec indexer** (`spec-indexer.ts`) fast-globs
  `tests/**/*.spec.ts` + `packages/**/tests/**/*.test.ts`, classifies each
  file as `user-written` vs `ate-generated`, resolves coverage targets via
  `@ate-covers` comments OR static import resolution, and attaches
  last-run status from `.mandu/ate-last-run.json` when present.

  Acceptance: integration test loads `demo/auth-starter/` and asserts the
  returned context contains the signup route, csrf + session middleware,
  recommended `createTestSession` + `createTestDb` + `testFilling`
  fixtures, `[data-route-id=api-signup]` selector, and the UI entry-point
  sibling.

## 0.19.2

### Patch Changes

- [`927544c`](https://github.com/konamgil/mandu/commit/927544c265a0eceff9143e5e5991d5365208ea85) Thanks [@konamgil](https://github.com/konamgil)! - fix(ate): #224 ssr-verify spec no longer crashes on redirect routes

  The `mandu test:auto` generated `ssr-verify` Playwright spec called
  `page.content()` immediately after `page.goto(url)`. On any route that
  performs a page-level redirect (meta-refresh, `return redirect(...)`,
  `/` → `/<defaultLocale>`, etc.) this raised:

  > Error: page.content: Unable to retrieve content because the page is
  > navigating and changing the content.

  Three changes:

  1. **`waitUntil: "networkidle"`** — all page-oriented spec templates
     (`route-smoke`, `ssr-verify`, `island-hydration`) now wait for network
     idle on `goto`, so downstream inspections see the final settled page.
  2. **Redirect detection** — the extractor now flags a route as
     `isRedirect` when the page source emits
     `<meta httpEquiv="refresh" ...>` or returns `redirect(...)`. The
     `ssr-verify` spec for redirect routes skips `page.content()` and the
     `<!DOCTYPE html>` / `data-mandu-island` assertions, instead asserting
     that navigation settled to a different URL. `island-hydration` specs
     are not emitted for redirect origins (the page navigates away before
     any island could hydrate).
  3. **IPv4 baseURL fallback (#223)** — the emitted specs and the
     generated `playwright.config.ts` now default to
     `http://127.0.0.1:3333` instead of `http://localhost:3333`, avoiding
     Windows Node fetch failures when IPv6 `::1` resolves first but the
     dev server binds IPv4 only.

## 0.19.1

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

## 0.2.0

### Minor Changes

- ATE Production Release v0.16.0

  ## 🎉 Major Features

  ### New Package: @mandujs/ate

  - **Automation Test Engine** - Complete E2E testing automation pipeline
  - Extract → Generate → Run → Report → Heal workflow
  - 195 tests, 100% pass rate

  ### ATE Core Features

  - **Trace Parser & Auto-Healing**: Playwright trace 분석 및 자동 복구
  - **Import Dependency Graph**: TypeScript 의존성 분석 (ts-morph 기반)
  - **Domain-Aware Assertions**: 5가지 도메인 자동 감지 (ecommerce, blog, dashboard, auth, generic)
  - **Selector Fallback System**: 4단계 fallback chain (mandu-id → text → class → role → xpath)
  - **Impact Analysis**: Git diff 기반 subset 테스트 자동 선택

  ### Performance Optimizations

  - **ts-morph Lazy Loading**: Dynamic import로 초기 로드 70% 감소
  - **Tree-shaking**: sideEffects: false 설정
  - **Bundle Size**: 최적화 완료

  ### Documentation

  - 2,243 lines 완전한 문서화
  - README.md (1,034 lines)
  - architecture.md (778 lines)
  - 8개 사용 예제

  ### Testing

  - 195 tests / 503 assertions
  - 13개 테스트 파일
  - 단위/통합 테스트 완비

  ### Error Handling

  - ATEFileError 커스텀 에러 클래스
  - 모든 file I/O에 try-catch
  - Graceful degradation
  - 한국어 에러 메시지

  ## 🔧 MCP Integration

  - 6개 ATE 도구 추가 (mandu.ate.\*)
  - extract, generate, run, report, heal, impact

  ## 📦 Breaking Changes

  None - 모든 기존 API 유지

  ## 🙏 Credits

  Developed by ate-production-team:

  - heal-expert: Trace parser, Error handling
  - impact-expert: Dependency graph
  - oracle-expert: Oracle L1 assertions
  - selector-expert: Selector fallback map
  - doc-expert: Documentation, Testing
  - bundle-optimizer: Performance optimization
