---
phase: 10
track: R0.3
status: Design
audience: DX / Docs / Frontend
last_verified: 2026-04-18
bun_version: 1.3.12
target_site: mandujs.com
---

# Phase 10 R0.3 — Mandu 공식 docs 사이트 정보 아키텍처 (IA)

> 본 문서는 `mandujs.com/docs` 의 내비게이션·사이드바·학습 경로·i18n 전략·구현 우선순위를 정의한다. 기존 `docs/LANDING-SITE-PLAN.md` 의 "Starlight + Pagefind + ko/en" 결정은 승계하고, Phase 4c~9 에서 추가된 기능 (DB / Auth / HMR / Desktop) 을 체계적으로 수용하도록 IA 를 확장한다.

## 1. 경쟁 프레임워크 IA 벤치마크

| 프레임워크 | URL | 상단 네비 | 사이드바 1차 그룹 | 강점 | 약점 |
|---|---|---|---|---|---|
| **Next.js 15** | [nextjs.org/docs](https://nextjs.org/docs) | Docs · Learn · Showcase · Blog | Getting Started / Building / Guides / Deploying / Upgrading / API Reference | "Building" 에 concept+practice 통합 · Pages vs App Router 좌측 탭 전환 | App/Pages 이분법이 초심자에 혼란 |
| **Remix / React Router 7** | [reactrouter.com/start](https://reactrouter.com/start) | Start · Tutorial · Reference · Community | Quick Start / Framework / Library / API | 3-모드 (framework/library/declarative) 표기 명료 | 모드 이분이 문서량을 2배로 만듦 |
| **SvelteKit** | [svelte.dev/docs/kit](https://svelte.dev/docs/kit) | Docs · Tutorial · Playground · Blog | Introduction / Core concepts / Build & deploy / Advanced / Best practices / Appendix | Tutorial 전용 사이트 분리 (`learn.svelte.dev`) — 초심자 경로 최고 | Reference 가 얇음 |
| **Bun.sh** | [bun.com/docs](https://bun.com/docs) | Docs · Reference · Guides · Blog | Intro / Installation / Quickstart / Runtime / Package manager / Bundler / Test runner / Ecosystem / API | "Reference" 분리 — API 시그니처 독립 사이트 | Guides 깊이 편차 큼 |
| **Nuxt 4** | [nuxt.com/docs](https://nuxt.com/docs) | Docs · Modules · Examples · Blog | Getting Started / Guide / API / Examples / Community | Examples 카탈로그 (playground 임베드) 탁월 | 3-way (Getting/Guide/API) 경계 모호 |
| **Astro** | [docs.astro.build](https://docs.astro.build/en/getting-started/) | Docs · Integrations · Themes · Chat | Welcome / Concepts / Tutorial / Basics / Content / Routing / Integrations / Reference | Concepts → Tutorial → Basics 3단 학습 경로 · 길잡이형 서사 | 페이지 매우 많음 |

**공통 패턴**: 상단 네비 4~5 항 · 사이드바 1차 6~8 그룹 · "Getting Started → Concepts → Guides → Reference" 순서가 주류. **차별점**: Tutorial 분리 (Svelte/Astro), Examples 카탈로그 (Nuxt), Reference 독립 (Bun).

## 2. Mandu-specific 개념 문서화 수요

| 개념 | 모듈 경로 | 문서 유형 | 독자 | 우선순위 |
|---|---|---|---|---|
| **Filling** | `packages/core/src/filling/` (filling.ts · context.ts · auth.ts · session.ts · sse.ts · ws.ts) | Concept + Guide + Reference | 전원 | P0 |
| **Slot** | `packages/core/src/slot/` | Concept + Recipe | 중급 | P0 |
| **Contract** | `packages/core/src/contract/` (define · normalize · client · registry) | Concept + Guide + Reference | 중급 | P0 |
| **Island** | `packages/core/src/island/`, `@mandujs/core/client` | Concept + Cookbook | 중급 | P0 |
| **Resource** | `packages/core/src/resource/` (parser · schema · ddl · generator) | Guide + Reference + CLI | 전원 | P0 |
| **Guard** | `packages/core/src/guard/` (presets: fsd/clean/hexagonal/atomic/cqrs/mandu) | Architecture | 고급 | P1 |
| **Auth** | `packages/core/src/auth/` (password · login · verification · reset · tokens) + `middleware/oauth` | Guide (step-by-step) | 전원 | P0 |
| **DB & Migration** | `packages/core/src/db/` + `packages/core/src/resource/ddl/` | Guide + Reference | 중급 | P0 |
| **HMR / Fast Refresh** | `packages/core/src/bundler/`, `import.meta.hot` | Guide + Internals | 고급 | P1 |
| **Kitchen DevTools** | `packages/core/src/kitchen/`, `packages/core/src/devtools/` | Guide | 중급 | P1 |
| **ATE (Agent Test Engine)** | `DNA/ai/`, `packages/core/src/brain/` | Overview + CLI | 고급 | P2 |
| **Desktop (webview-bun)** | `packages/core/src/desktop/` (window.ts · worker.ts) | Guide + Download | 중급 | P1 |
| **MCP Tools** | `packages/mcp/src/` (85+ tools) | Reference | AI 에이전트 사용자 | P1 |
| **Observability** | `packages/core/src/observability/` (event-bus · sqlite-store) | Reference | 고급 | P2 |
| **Scheduler / Email / S3** | `scheduler/` · `email/` · `storage/s3/` | Reference + Recipe | 중급 | P1 |

## 3. Phase 별 커버리지 매트릭스

| Phase | 기능 | 문서 유형 | 1차 릴리즈 | 후속 |
|---|---|---|---|---|
| 0~3 | perf / id / safe-build / CookieMap / session-sqlite | Reference only | — | Reference 10p |
| 4a | Bun.sql 어댑터 | Guide | Guide 1p | — |
| 4b | Migration tooling (`mandu db`) | Guide + CLI | Guide 1p + CLI ref | Recipe |
| 4c | Resource DDL/migration 자동화 | Guide + Reference + Example | **Guide 1p + Example 1p** | — |
| 5 | OAuth + Email + Verify/Reset | Step-by-step Guide + Example | **Guide 1p + Example 1p** | Recipe |
| 6 | Rate-limit / Secure headers / DX | Reference + Recipe | Reference 2p | Recipe |
| 7a/7b | HMR / Fast Refresh / import.meta.hot | Guide + Internals | **Guide 1p** | Internals |
| 9a | CLI UX (Bun.markdown) | Guide (brief) | Included in CLI ref | — |
| 9b | `--compile` 단일 바이너리 | Guide + Download | **Guide 1p + Download 1p** | — |
| 9c | Desktop (webview-bun FFI) | Guide + Example | Guide 1p (후속) | Example |

## 4. 권장 최종 IA

### 4.1 상단 네비게이션

```
Docs  |  Tutorial  |  Examples  |  Blog  |  GitHub  |  Discord
```

- `/docs` → 본 사이드바
- `/tutorial` → Astro/Svelte 식 단일-경로 튜토리얼 (Todo 앱 30 분)
- `/examples` → Nuxt 식 카탈로그 (demo/* 재료 재사용)

### 4.2 사이드바 Hierarchy (Starlight `sidebar` 트리)

```
Getting Started
  ├─ What is Mandu?
  ├─ Why Mandu? (vs Next/Remix/Astro)
  ├─ Installation (npm · binary · mandu init)
  ├─ Quick Start (5 min)
  └─ Project Structure (.mandu/ · app/ · packages layout)

Core Concepts
  ├─ Filesystem-First Routing
  ├─ Filling (체이닝 핸들러 · 8-stage lifecycle)
  ├─ Slot (.slot.ts · .slot.tsx)
  ├─ Contract (Zod + normalize + OpenAPI)
  ├─ Island (선택적 하이드레이션 · @mandujs/core/client)
  ├─ Resource (.resource.ts · DDL 자동화)
  └─ Layout (body-wrapper 규약)

Guides
  ├─ Building a Todo App (30 min)
  ├─ Authentication
  │    ├─ Password + Session (Bun.password argon2id)
  │    ├─ OAuth (GitHub · Google)
  │    ├─ Email Verification
  │    └─ Password Reset
  ├─ Database & Resources
  │    ├─ Defining Resources
  │    ├─ Migrations (mandu db)
  │    └─ Query Patterns
  ├─ Realtime
  │    ├─ SSE (filling.sse)
  │    └─ WebSocket (filling.ws)
  ├─ API Design
  │    ├─ Contract-first Workflow
  │    ├─ OpenAPI Export
  │    └─ Type-safe Client
  ├─ Production
  │    ├─ Rate Limiting
  │    ├─ Secure Headers
  │    ├─ Session Stores (memory · sqlite)
  │    └─ Deployment (Docker · Cloudflare · Bun binary)
  └─ Desktop Distribution (webview-bun)

HMR & Dev Experience
  ├─ import.meta.hot API
  ├─ Fast Refresh (client islands)
  ├─ CSS HMR
  └─ Troubleshooting

DevTools
  ├─ Kitchen Overview
  ├─ Request Inspector
  ├─ State Browser
  └─ Event Bus

API Reference
  ├─ @mandujs/core
  │    (Mandu.filling · Mandu.contract · island · slot · resource · auth · middleware · scheduler · email · storage)
  ├─ @mandujs/cli (40+ commands)
  ├─ @mandujs/mcp (85+ tools)
  └─ mandu.config.ts schema

Architecture
  ├─ Design Philosophy
  ├─ Filesystem-First
  ├─ Router v5 (Hybrid Trie)
  ├─ Guard Presets (fsd · clean · hexagonal · atomic · cqrs · mandu)
  └─ Security Model

Agent & AI
  ├─ ATE Overview
  ├─ Claude Code Skills
  └─ MCP Integration

Appendix
  ├─ Migration (Next.js → Mandu)
  ├─ FAQ
  ├─ Glossary
  └─ Changelog
```

## 5. 학습 경로

- **초심자 (1 일 미만)**: `Quick Start (5 min)` → `Project Structure` → `Tutorial /tutorial` (30 min Todo) → `Filling` concept → `Deployment`.
- **중급자 (1 주)**: `Contract` → `Slot` → `Resource` → `Authentication (Password)` → `OAuth` → `Realtime` → `Kitchen DevTools`.
- **전문가 (상시 참조)**: `API Reference` → `Architecture/Router v5` → `Guard Presets` → `HMR Internals` → `MCP Reference` → `ATE`.

각 경로는 사이드바 상단에 "Path: 초심자" 칩으로 진입 유도 (Svelte tutorial 방식).

## 6. i18n 전략

- **1차 (Phase 10 R1)**: `ko` + `en` 만 full translation. 문서량 약 60 페이지 x 2 = 120 페이지 관리.
- **2차 (Phase 10 R2 이후, 선택적)**: 핵심 10 페이지 (Quick Start · Filling · Contract · Island · Resource · Auth · DB · Deploy · Download · FAQ) 를 ja · zh-CN · es 로 확장.
- **기존 23 언어 랜딩**: `/` (루트) 만 유지. `/docs/*` 는 ko/en 외 언어는 영어 fallback + 최상단에 "Translation pending" 배너.
- 번역 거버넌스: Starlight `i18n.defaultLocale = "en"` · 미번역 파일 자동 fallback · 기여 가이드 (`CONTRIBUTING.ko.md` 에 번역 워크플로우).

## 7. 콘텐츠 포맷 · 툴체인

- **MDX**: Starlight 기본 지원. 인터랙티브 데모 삽입 가능 (`<MiniPlayground />`).
- **Syntax highlight**: Shiki (Starlight 기본). `ts` / `tsx` / `bash` / `toml` 프리셋. Bun.markdown 은 CLI UX (Phase 9a) 전용으로 유지.
- **Interactive playground**: `/examples/*` 에서 iframe 으로 `demo/todo-app`, `demo/auth-starter`, `demo/ai-chat` 빌드 결과 임베드. StackBlitz 연동은 2차.
- **Copy-to-clipboard**: Starlight `<Code />` 기본.
- **Edit on GitHub**: `editLink.baseUrl = "github.com/...docs/src/content/docs/"`.
- **검색**: **Pagefind 내장** (무료 · 로컬 인덱스 · `LANDING-SITE-PLAN.md` 결정 승계). Cmd+K 팔레트는 Starlight `<Search />` 커스텀 스타일링.
- **API Reference 자동 생성**: `@mandujs/core` public API 는 `typedoc` + `typedoc-plugin-markdown` 으로 `src/content/docs/en/reference/core/` 자동 export. CLI 는 `mandu --help` 스크립트화. MCP 는 `packages/mcp/src/registry/` 메타데이터 기반 빌드 스크립트.

## 8. Phase 10 구현 우선순위

### 먼저 구축할 10 페이지 (Phase 10 R1)

1. `getting-started/what-is-mandu` — 1 분 소개 + 차별점
2. `getting-started/installation` — npm · `bun create` · Phase 9b 바이너리
3. `getting-started/quick-start` — 5 분 Hello Mandu
4. `getting-started/project-structure` — `.mandu/` · `app/` · config
5. `core-concepts/filling` — 8-stage lifecycle + 체이닝
6. `core-concepts/contract` — Zod + normalize + OpenAPI
7. `core-concepts/island` — hydration 전략 + `@mandujs/core/client`
8. `core-concepts/resource` — `.resource.ts` + DDL 자동화
9. `guides/tutorial-todo-app` — 30 분 Todo (Resource + Contract + Slot + Island 통합)
10. `guides/authentication/password-session` — `demo/auth-starter` 기반 step-by-step

### 2차 구축 20 페이지 (Phase 10 R2)

11~15. Auth 후속: OAuth · Email Verification · Password Reset · Session Stores · CSRF
16~18. DB: Migrations · Query Patterns · Resource Repo API
19~20. Realtime: SSE · WebSocket
21~22. Production: Rate Limit · Secure Headers
23. Deployment: Docker / Cloudflare / Binary 3-way
24. Desktop: webview-bun (Phase 9c 산출물 반영)
25. HMR: `import.meta.hot` + Fast Refresh
26. Kitchen DevTools Overview
27~30. Reference: `@mandujs/core` API (auto) · CLI · MCP · `mandu.config.ts`

### 3차 구축 (Phase 10 R3+, optional)

Architecture 심화 · Agent/ATE · Migration · Glossary · 다국어 확장 (ja/zh-CN/es).

---

## 출처

- 본체 모듈 구조 확인: `packages/core/src/{filling,contract,island,slot,resource,auth,db,middleware,kitchen,desktop,observability,scheduler,email,storage}/` 디렉터리 실측 (2026-04-18).
- CLI 명령 목록: `packages/cli/src/commands/*.ts` (40+).
- 기존 기획 승계: `docs/LANDING-SITE-PLAN.md` (Starlight + Pagefind + ko/en 결정).
- 경쟁사 링크: Next.js, React Router 7, SvelteKit, Bun.sh, Nuxt 4, Astro 공식 docs (2026-04-18 확인).
- Phase 의존성: `docs/bun/phase-9-team-plan.md`, `phases-4-plus.md` §Phase 4/5/6/7/9.
