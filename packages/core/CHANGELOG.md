# @mandujs/core

## 0.31.0

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

## 0.30.0

### Minor Changes

- Phase 18 Wave E2 — runtime depth (ISR + bundle analyzer + OTel tracing).

  **ζ ISR + cache tags** — filling loader가 `{ _cache: { tags, maxAge, staleWhileRevalidate } }` 반환 or `ctx.cache.tag('x').maxAge(10).swr(3600)` fluent API. `revalidate(tag)` tag-based invalidation. `Cache-Control` + `X-Mandu-Cache` 헤더 자동. Next.js ISR parity.

  **η Bundle analyzer** — `mandu build --analyze` → `.mandu/analyze/report.html` (self-contained SVG treemap, dark theme, click-to-drill) + `report.json`. Per-island raw+gz, shared chunk dedupe detection, top-20 heaviest modules. 외부 dep 없음.

  **θ Request tracing** — W3C Trace Context + AsyncLocalStorage propagation, Console + OTLP HTTP exporters. `ctx.span` + `ctx.startSpan(name, fn)` filling integration. Hand-rolled OTLP JSON encoding (opentelemetry-js dep 없음). Honeycomb / Jaeger / Tempo 호환.

  Quality: 7 packages typecheck clean, +84 regression tests, zero new
  runtime deps.

## 0.29.1

### Patch Changes

- fix: resolve #210 — `./bundler/plugins` + 6 sibling subpath exports for
  Wave E1 new modules (bundler/generate-static-params, dev-error-overlay,
  middleware/compose|define|bridge, client/hydrate). 같은 패턴 3회차
  (#194 kitchen / #202 content/prebuild 에 이어).

## 0.29.0

### Minor Changes

- Phase 18 Wave E1 — convention parity with Next.js / Astro / SvelteKit
  (5 orthogonal capabilities, 210+ regression tests).

  **α Dev Error Overlay** — 풀스크린 dev 에러 UI (`@mandujs/core/dev-error-overlay`). SSR + client 에러 양쪽, 4.4 KB gz client IIFE, 500-response에도 payload 임베드. Config `dev.errorOverlay` (default `true`, prod 3중 gate).

  **β Route conventions** — `app/<route>/{loading,error,not-found}.tsx` per-route + `(group)/` route groups + `[[...slug]]` optional catch-all. 런타임이 page를 `Suspense(loading)` + `ErrorBoundary(error)` 로 자동 감싸고, 404는 nearest-ancestor `not-found.tsx` 우선.

  **γ generateStaticParams** — Next.js-style build-time SSG. `.mandu/prerendered/` + `_manifest.json`, path-traversal-safe, 런타임 첫 dispatch check에서 `Cache-Control: immutable`로 serve. Nested dynamic / catch-all / optional catch-all 전부 지원.

  **δ Hydration strategy per-island** — `data-hydrate="load|idle|visible|interaction|media(<query>)"` 선언 spec. 1.07 KB gz runtime, public disposer contract, Astro parity + `interaction` 은 Mandu 고유.

  **ε Middleware composition API** — `defineMiddleware({ name, match?, handler })` + `compose(...)`. Onion model, short-circuit, error propagation, `ManduConfig.middleware[]` config. 기존 csrf/session/secure/rate-limit bridge adapter로 backward compat.

  Quality: 7 packages typecheck clean, 3211 core pass / 0 fail, 210+ new
  tests, zero new runtime deps.

## 0.28.0

### Minor Changes

- feat(core,cli): hard-fail `__generated__/` imports at bundler level.

  `mandu dev` / `mandu build` / `mandu start` 는 이제 bundler plugin
  레이어에서 직접 `__generated__/` import를 감지하면 번들링 자체를
  실패시킵니다. Guard rule만으로 부족했던 agent bypass 패턴의 원천 차단.

  에러 메시지는 importer 파일 경로 + `getGenerated()` 사용 예시 +
  docs URL을 포함합니다. `@mandujs/core/runtime` 내부 `__generated__`
  접근은 기본 allowlist로 제외됩니다.

  - `packages/core/src/bundler/plugins/block-generated-imports.ts` 신규
  - `defaultBundlerPlugins(config)` 헬퍼 — 단일 설치 포인트
  - `safeBuild` 6개 callsite + CLI SSR bundler 경로 자동 장착
  - `ManduConfig.guard.blockGeneratedImport` (Zod, default `true`) opt-out
  - `MANDU_DISABLE_BUNDLER_PLUGINS=1` 비상 탈출구
  - `mandu init` 3개 템플릿 `tsconfig.json` paths 봉쇄 (IDE defense)
  - 마이그레이션 가이드 `docs/migration/0.28-generated-block.md`
  - `docs/architect/generated-access.md` Enforcement 섹션 추가

  18 regression tests (15 unit + 3 integration). No new runtime deps.

## 0.27.0

### Minor Changes

- fix: #207 view-transition injection hardening + #208 inline SPA-nav
  helper for `hydration: "none"` projects.

  - **#207**: No code defect; `@view-transition` CSS was already injected
    across all SSR paths. Locked it down with 12-case regression suite
    covering streaming SSR / prerender / 404 / error / opt-out.
  - **#208**: Genuine defect. `ssr.spa: true` was documented default but
    intercept lived in client bundle that `hydration: "none"` projects
    never ship. New `client/spa-nav-helper.ts` inline IIFE (~2.7 KB)
    injected into `<head>` alongside the prefetch helper. Full 10-case
    exclusion parity with `handleLinkClick`. pushState + fetch +
    View-Transitions DOM-swap. Early-exits when full router present so
    hydrated pages unaffected.

  Wired through `ServerOptions.spa` to all 5 renderSSR/
  renderStreamingResponse call-sites. CLI dev + start pass `config.spa`.

  +66 regression tests (12 #207 + 54 #208). No new runtime deps.

## 0.26.0

### Minor Changes

- content + routes follow-ups (Closes #204, #205, #206):

  - **#204** — `Collection.all()/get()/getCompiled()` guaranteed
    watcher-free. Script chains exit cleanly. Watching via
    `collection.watch(cb)` opt-in. `dispose()` + `Symbol.asyncDispose`.
  - **#205** — `generateSidebar` reads `_meta.json` (title/icon/order/
    pages[]). New `generateCategoryTree`. `generateLLMSTxt` baseUrl +
    groupByCategory. `getCompiled` accepts `CompileOptions` (remark/
    rehype plugins + silent).
  - **#206** — Metadata Routes auto-discovery: `app/sitemap.ts`,
    `app/robots.ts`, `app/llms.txt.ts`, `app/manifest.ts` →
    `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/manifest.webmanifest`.
    New `@mandujs/core/routes` export with typed contracts + dispatcher.
    Default `Cache-Control: public, max-age=3600`.

  No new runtime deps. Existing `renderSitemap`/`renderRobots` helpers
  and `public/*.xml` workflow remain untouched (auto-discovery is
  additive). `app/` > `public/` precedence with warning.

  +74 regression tests. 7 packages typecheck clean.

## 0.25.3

### Patch Changes

- fix: resolve #203 — configurable prebuild timeout + preserve inner errors.

  - `mandu.config.ts` `dev.prebuildTimeoutMs` (default 120_000 ms) +
    `MANDU_PREBUILD_TIMEOUT_MS` env override.
  - New `PrebuildTimeoutError` (subclass of `PrebuildError`) names the
    failing script + limit + both override paths.
  - Inner error message + stack preserved via `.cause`. No more opaque
    "non-Error thrown" surface.
  - stdout/stderr tail (last 10 lines each) appended to
    `PrebuildError.message` on non-zero exit.
  - CLI `mandu dev` prints `err.message` + `cause.stack` on abort.

## 0.25.2

### Patch Changes

- fix: resolve #202 — add `./content/prebuild` + sibling subpath exports
  (collection / sidebar / slug / llms-txt / schema). Same pattern as #194
  kitchen export. `mandu dev` no longer fails with "Cannot find module
  '@mandujs/core/content/prebuild'".

## 0.25.1

### Patch Changes

- fix(runtime): DX-1 — loud 5xx for malformed page default exports.
  `export default function Page()` now works (bare function auto-wrapped).
  Missing / primitive / non-function default surfaces a clear error with
  route id + pattern instead of a silent 404.

## 0.25.0

### Minor Changes

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

## 0.24.0

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

## 0.13.2

### Patch Changes

- SSE reconnect improvements and critical bug fixes

  ## @mandujs/core

  - **Feature**: SSE reconnect with exponential backoff and jitter
  - **Feature**: Connection state tracking (connecting, connected, reconnecting, failed, closed)
  - **Fix**: Critical race condition in SSE snapshot/fetchChatHistory

  ## @mandujs/cli

  - **Template**: Add SSE reconnect logic to realtime-chat template
  - **Template**: Fix race condition in chat initialization
  - **Template**: Improve type clarity with ReconnectOptions alias
  - **Docs**: Add demo-first validation loop guide
  - **Docs**: Update CLI command examples

## 0.13.1

### Patch Changes

- Security and stability improvements

  ## @mandujs/core

  - **Security**: Fix rate limiting DoS vulnerability - prevent single user from blocking all users
  - **Fix**: Prevent SSE event ordering race condition in subscribeWithSnapshot
  - **Test**: Add comprehensive SSE stream integration tests

  ## @mandujs/cli

  - **Refactor**: Deduplicate lockfile validation flow in dev/start commands
  - **Fix**: Remove magic numbers in backup suffix retry logic
  - **Template**: Add SSE reconnect strategy with exponential backoff
  - **Template**: Add ARIA labels for accessibility (WCAG 2.1 AA)
  - **Template**: Improve error feedback in realtime-chat and ai-chat
  - **Template**: Optimize Date object creation in message rendering

## 0.13.0

### Minor Changes

- feat: manifest를 generated artifact로 전환 (Option D)

  - `spec/routes.manifest.json` → `.mandu/routes.manifest.json` (generated artifact)
  - `spec/spec.lock.json` → `.mandu/spec.lock.json`
  - `app/` (FS Routes)가 유일한 라우트 소스
  - legacy merge 로직 제거, auto-linking 추가
  - MCP tools FS Routes 기반으로 재작성

## 0.12.2

### Patch Changes

- fix: publish 스크립트를 bun publish로 변경하여 workspace:\* 의존성 자동 변환

## 0.12.1

### Patch Changes

- chore: change license from MIT to MPL-2.0 and fix workspace dependency
