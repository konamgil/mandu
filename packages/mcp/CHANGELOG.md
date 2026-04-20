# @mandujs/mcp

## 0.27.0

### Minor Changes

- [`e77b035`](https://github.com/konamgil/mandu/commit/e77b035dd28cc256a596fe5221f781c5609645e9) Thanks [@konamgil](https://github.com/konamgil)! - feat(core,ate,mcp,cli): Phase C — primitives + mutation + RPC + oracle

  Ships ATE v2 Phase C (docs/ate/phase-c-spec.md, 364-line spec):

  - 5 Mandu-specific assertion primitives in @mandujs/core/testing:
    expectContract(strict/loose/drift-tolerant), expectNavigation,
    waitForIsland (data-hydrated polling), assertStreamBoundary
    (<!--$--> marker count + shell budget), expectSemantic
    (agent-delegated, CI non-blocking).
  - 9 contract-semantic mutation operators (remove_required_field,
    narrow_type, widen_enum, flip_nullable, rename_field,
    swap_sibling_type, skip_middleware, early_return,
    bypass_validation). runner writes tmpdir, kills/survives/timeout
    classification. mutationScore + severity report via
    mandu_ate_mutate + mandu_ate_mutation_report.
  - RPC parity: defineRpc extractor emits rpc_procedure nodes,
    context scope "rpc" with dot-notation id, boundary probe works
    automatically on input schemas.
  - Oracle queue: .mandu/ate-oracle-queue.jsonl, mandu_ate_oracle_pending /
    verdict / replay. Semantic judgments deferred to agent session,
    deterministic CI never blocked. promoteVerdicts regresses past
    fails on next run.
  - Prompt catalog +3: island_hydration, streaming_ssr, rpc_procedure.

  Test counts: ate 575 / mcp 220. Typecheck clean across 7 packages.
  ATE v2 core surface complete.

### Patch Changes

- Updated dependencies [[`e77b035`](https://github.com/konamgil/mandu/commit/e77b035dd28cc256a596fe5221f781c5609645e9)]:
  - @mandujs/core@0.39.0
  - @mandujs/ate@0.24.0
  - @mandujs/skills@17.0.0

## 0.25.0

### Minor Changes

- [`0aa24be`](https://github.com/konamgil/mandu/commit/0aa24be35be5db3774881da319fa04bf6dc72bcd) Thanks [@konamgil](https://github.com/konamgil)! - Phase B — boundary probe + memory + impact v2 + coverage

  Ships ATE v2 Phase B (docs/ate/phase-b-spec.md):

  - `mandu_ate_boundary_probe`: Zod contract → deterministic boundary set.
    18 type mappings (string/number/boolean/array/object/enum/union/literal
    plus min/max/email/uuid/regex/int/optional/nullable/nullish) —
    `expectedStatus` derived from contract response schema (400/422 for
    invalid, 200/201 for valid), depth-1 default with max 3,
    category+value dedup.
  - `mandu_ate_recall` + `mandu_ate_remember`: append-only
    `.mandu/ate-memory.jsonl`. 7 event kinds: intent_history,
    rejected_spec, accepted_healing, rejected_healing,
    prompt_version_drift, boundary_gap_filled, coverage_snapshot.
    Substring + token-overlap scoring; auto-rotate at 10 MB to
    `.mandu/ate-memory.<ts>.jsonl.bak`. Auto-record hooks on
    `mandu_ate_save` (intent_history), `applyAutoHeal`
    (accepted_healing), and first-of-day `mandu_ate_context`
    (coverage_snapshot).
  - `mandu_ate_impact` v2: git diff classification (additive / breaking /
    renaming via Levenshtein ≥ 0.8), affected spec/contract resolution,
    suggestion list keyed to re_run / heal / regenerate /
    add_boundary_test. Supports `since: "HEAD~1" | "staged" | "working"`.
    v1 output fields preserved for backwards compatibility.
    `mandu ate watch` CLI (fs.watch + 1 s debounce) streams impact v2 on
    working-tree changes.
  - `mandu_ate_coverage`: route × contract × invariant matrix.
    `withBoundaryCoverage` / `withPartialBoundary` / `withNoBoundary`
    derived from boundary-probe presence in covering specs; invariant
    detection for csrf / rate_limit / session / auth / i18n;
    severity-ranked `topGaps` (high / medium / low).
  - Prompt catalog +3: `property_based.v1`, `contract_shape.v1`,
    `guard_security.v1`. 12+ new `@ate-exemplar:` tags across
    `packages/core/tests/**` and `packages/ate/tests/exemplar-sources/`.
  - `mandu ate memory clear` / `mandu ate memory stats` CLI subcommands.

  Tests: +94 ate (429 → 523) + +10 mcp (194 → 204) + +3 cli.
  `NODE_OPTIONS=--max-old-space-size=8192 bun run typecheck` clean across
  all 7 packages.

### Patch Changes

- Updated dependencies [[`0aa24be`](https://github.com/konamgil/mandu/commit/0aa24be35be5db3774881da319fa04bf6dc72bcd)]:
  - @mandujs/ate@0.22.0

## 0.24.0

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

### Patch Changes

- Updated dependencies [[`2013674`](https://github.com/konamgil/mandu/commit/20136745bcc3d5758d7221608e15e24cafb31239), [`2013674`](https://github.com/konamgil/mandu/commit/20136745bcc3d5758d7221608e15e24cafb31239)]:
  - @mandujs/ate@0.21.0

## 0.23.0

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

### Patch Changes

- Updated dependencies [[`81b4ff7`](https://github.com/konamgil/mandu/commit/81b4ff7adfbba4daeb070fdc6ff41a2e851c53fd)]:
  - @mandujs/ate@0.20.0

## 0.22.4

### Patch Changes

- Updated dependencies [[`927544c`](https://github.com/konamgil/mandu/commit/927544c265a0eceff9143e5e5991d5365208ea85), [`8e53ca0`](https://github.com/konamgil/mandu/commit/8e53ca007cd588ce3cba0866222f5eb1982d01bd)]:
  - @mandujs/ate@0.19.2
  - @mandujs/core@0.37.0
  - @mandujs/skills@16.0.0

## 0.22.3

### Patch Changes

- Updated dependencies [[`88d597a`](https://github.com/konamgil/mandu/commit/88d597ad50d5ac219e68f458e746f4f649de2c50)]:
  - @mandujs/core@0.36.0
  - @mandujs/skills@15.0.0

## 0.22.2

### Patch Changes

- Updated dependencies [[`5c9bac1`](https://github.com/konamgil/mandu/commit/5c9bac1afd3d769ec5889ec5ac65b6d587ff9f51)]:
  - @mandujs/core@0.35.0
  - @mandujs/skills@14.0.0

## 0.22.1

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.34.0
  - @mandujs/skills@13.0.0

## 0.22.0

### Minor Changes

- Phase 18 Wave E6 + #214/#215.

  **π Guard dependency graph** — `mandu guard --graph` → `.mandu/guard/graph.html` (self-contained SVG, dark theme, click-to-drill, XSS-safe).

  **σ Test convergence** — `@mandujs/core/testing/reporter` (human/JSON/JUnit/lcov formats), `--reporter` CLI flag, per-metric coverage thresholds enforcement, unified watch-mode UX.

  **τ Plugin API 강화** — 7 new hook types (`onRouteRegistered`, `onManifestBuilt`, `definePrerenderHook`, `defineBundlerPlugin`, `defineMiddlewareChain`, `defineTestTransform`, `onBundleComplete`) + `definePlugin()` helper + 3 example plugins.

  **#214 dynamicParams route guard** — `export const dynamicParams = false` forces 404 on params outside `generateStaticParams` result (Next.js parity).

  **#215 diagnose 보강** — 5 new checks (`manifest_freshness`, `prerender_pollution`, `cloneelement_warnings`, `dev_artifacts_in_prod`, `package_export_gaps`) + new `mandu diagnose` CLI + MCP unified shape.

  Quality: 7 packages typecheck clean, +195 regression tests, zero new deps.

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.33.0
  - @mandujs/skills@12.0.0

## 0.21.1

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.32.0
  - @mandujs/skills@11.0.0

## 0.21.0

### Minor Changes

- Phase 18 Wave E3+E4 — Mandu 차별화 레이어 완성.

  **ι AI refactor MCP tools** (`@mandujs/mcp`):

  - `mandu.refactor.rewrite_generated_barrel` — `__generated__/*` → `getGenerated()` + `GeneratedRegistry` augmentation
  - `mandu.refactor.migrate_route_conventions` — 인라인 Suspense/ErrorBoundary/NotFound → per-route convention files
  - `mandu.refactor.extract_contract` — 인라인 Zod 스키마 → `contract/<group>.contract.ts`

  **κ Typed RPC** (`@mandujs/core`):

  - `defineRpc({ method: { input, output, handler } })` + `createRpcClient<typeof rpc>()` Proxy 기반 end-to-end type inference. Zod 검증. tRPC 의존 없음.

  **λ Bun.cron scheduler** (`@mandujs/core` + `@mandujs/cli`):

  - `defineCron({ name, schedule, timezone, runOn, handler })` Bun.cron 기반
  - `mandu build --target=workers` 시 `[triggers] crons = [...]` 자동 emission
  - Cron 표현식 + timezone Intl 검증

  Quality: 7 packages typecheck clean, +132 regression tests, zero new
  runtime deps.

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.31.0
  - @mandujs/skills@10.0.0

## 0.20.7

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.30.0
  - @mandujs/skills@9.0.0

## 0.20.3

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.29.0
  - @mandujs/skills@6.0.0

## 0.20.2

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
  - @mandujs/skills@5.0.0

## 0.20.1

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.24.0
  - @mandujs/ate@0.19.1
  - @mandujs/skills@4.0.0

## 0.14.0

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

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.14.0
  - @mandujs/ate@0.2.0

## 0.13.0

### Minor Changes

- feat: manifest를 generated artifact로 전환 (Option D)

  - `spec/routes.manifest.json` → `.mandu/routes.manifest.json` (generated artifact)
  - `spec/spec.lock.json` → `.mandu/spec.lock.json`
  - `app/` (FS Routes)가 유일한 라우트 소스
  - legacy merge 로직 제거, auto-linking 추가
  - MCP tools FS Routes 기반으로 재작성

### Patch Changes

- Updated dependencies []:
  - @mandujs/core@0.13.0

## 0.12.3

### Patch Changes

- docs: mention `.claude.json` as a valid MCP configuration location

## 0.12.2

### Patch Changes

- fix: publish 스크립트를 bun publish로 변경하여 workspace:\* 의존성 자동 변환

- Updated dependencies []:
  - @mandujs/core@0.12.2

## 0.12.1

### Patch Changes

- chore: change license from MIT to MPL-2.0 and fix workspace dependency

- Updated dependencies []:
  - @mandujs/core@0.12.1
