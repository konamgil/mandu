# Mandu CLI Roadmap v1.0

> 4명 전문가 (아키텍처, DX, 프레임워크, AI 에이전트) 분석 기반
> 
> 날짜: 2026-04-12

---

## 현재 상태: 28개 명령어, 16개 MCP 도구 카테고리

### 즉시 수정이 필요한 버그 (P0)

| # | 문제 | 위치 | 수정 |
|---|------|------|------|
| 1 | VERSION 하드코딩 `"0.10.0"` — 실제 `0.20.0` | `main.ts:15` | `package.json`에서 동적 로딩 |
| 2 | `--port` 플래��� 무시됨 | `registry.ts:108-135` | `ctx.options.port`를 dev/start에 전달 |
| 3 | `build.ts` 상대경로 import | `build.ts:18` | `@mandujs/core` 패키지 경로로 변경 |
| 4 | `doctor.ts` 상대경로 import | `doctor.ts` | 동일 |
| 5 | fsRoutes Guard 규칙 중복 | `dev.ts`, `check.ts` | 공통 상수로 추출 |

---

## Phase A: 기본 품질 + 핵심 편의 기능

### A-1. `mandu dev` 시작 시간 표시 + 키보드 단���키

```
🥟 Mandu v0.20.0  ready in 420ms

  ➜ Local:   http://localhost:3333
  ➜ HMR:     ws://localhost:3334
  ➜ Guard:   mandu (watching)
  ➜ Routes:  12 pages, 5 API, 1 WebSocket

  press o to open, r to restart, q to quit
```

키보드: `o` 브라우저 열기, `r` 재시작, `c` 클리어, `q` 종료

### A-2. `mandu build` 테이블 출력

```
  Bundle              Size      Gzip     Strategy
  ─���────────────────────────────────────────────────
  /                   12.3 kB   4.1 kB   island/visible
  /dashboard          28.7 kB   9.2 kB   island/idle
  runtime.js           3.1 kB   1.4 kB   shared
  vendor.js           45.2 kB  14.8 kB   shared
  ──────────────────────────────────────────────────
  Total               89.3 kB  29.5 kB   420ms

  Next: mandu start (or mandu preview)
```

### A-3. `mandu clean`

```bash
mandu clean          # .mandu/client/, .mandu/static/ 삭제
mandu clean --all    # + .mandu/generated/, node_modules/.cache
```

### A-4. `mandu info`

```bash
mandu info
# Mandu:    v0.20.0
# Bun:      v1.3.10
# OS:       Windows 10 (x64)
# Node:     v22.0.0 (compat)
# Config:   mandu.config.ts ✓
# Guard:    mandu preset
# Adapter:  adapter-bun (default)
# Cache:    ISR enabled (1000 entries)
```

### A-5. `mandu preview`

```bash
mandu preview            # = mandu build && mandu start
mandu preview --port 4000
```

### A-6. `mandu dev --open`

```bash
mandu dev --open         # 서버 시작 후 브라우저 자동 ��기
```

---

## Phase B: 스캐폴딩 + 워크플로우 자동화

### B-1. `mandu cache` — ISR 캐시 관리

```bash
mandu cache stats                    # 캐시 상태 조회
# Entries: 42/1000 | Hit rate: 87% | Stale: 3

mandu cache clear /products          # 경로 무효화
mandu cache clear --tag=users        # 태그 무효화
mandu cache clear --all              # 전체 캐시 삭제
```

### B-2. `mandu middleware init`

```bash
mandu middleware init --preset=jwt
# ✓ Created middleware.ts with JWT authentication
# ✓ Added SESSION_SECRET to .env.example
# 
# Next: Set SESSION_SECRET in .env
```

```bash
mandu middleware init --preset=all
# ✓ Created middleware.ts with: cors, jwt, compress, logger
```

### B-3. `mandu auth init`

```bash
mandu auth init --strategy=jwt
# ✓ Created src/server/auth.ts (JWT verify + guard)
# ✓ Created middleware.ts (auth middleware)
# ✓ Created app/api/auth/login/route.ts
# ✓ Created app/api/auth/register/route.ts
# ✓ Added JWT_SECRET to .env.example
```

### B-4. `mandu session init`

```bash
mandu session init
# ✓ Created src/server/session.ts (cookie session storage)
# ✓ Generated SESSION_SECRET
# ✓ Added to .env
```

### B-5. `mandu ws` — WebSocket 라우트 생성

```bash
mandu ws chat
# ✓ Created app/api/chat/route.ts (WebSocket handler)
#   - open: subscribe("chat")
#   - message: publish("chat", msg)
#   - close: cleanup
```

### B-6. `mandu collection create`

```bash
mandu collection create blog --schema=markdown
# ✓ Created content/blog/ directory
# ✓ Created content/config.ts with blog schema
# ✓ Created content/blog/hello-world.md (example)
```

---

## Phase C: AI 에이전트 통합 (Mandu 차별화 핵심)

### C-1. `mandu mcp <tool>` — MCP 도구 CLI 브리지

```bash
mandu mcp list                                    # 등록된 도구 목록
mandu mcp mandu_list_routes                       # 라우트 조회
mandu mcp mandu_guard_check --autoCorrect         # Guard 자동 수정
mandu mcp mandu_check_location --path src/ui/btn  # 위치 검증
mandu mcp mandu_kitchen_errors                    # 브라우저 에러 조회

# JSON 출력 (CI/CD 파이프라인용)
mandu mcp mandu_list_routes --json | jq '.routes[]'
```

**구현**: `registerBuiltinTools()`로 모든 도구를 레지스트리에 등록 → CLI에서 도구 이름으로 조회 → 인자 파싱 → 직접 호출. 기존 MCP 인프라 100% 재활용.

### C-2. `mandu fix` — AI 자동 수정

```bash
mandu fix
# 🔍 빌드 에러 감지: 3건
#   1. GUARD_IMPORT_001: src/client/features/auth → src/server/db
#   2. CONTRACT_MISMATCH: api-users response 타입 불일치
#   3. ISLAND_WRONG_IMPORT: dashboard.island.tsx → @mandujs/core (should be /client)
#
# 🔧 자동 수정 중...
#   ✓ 1. import 경로를 src/shared/types로 변경
#   ✓ 2. contract response에 email 필드 추가
#   ✓ 3. import를 @mandujs/core/client로 변경
#
# ✅ 3/3 수정 완료. 재빌드 성공.
```

**구현**: `bun build` → 에러 캡처 → `ErrorClassifier` 분류 → `healAll()` / `applyHealing()` 실행 → 재빌드 확인. 기존 `guard_heal`, `ate_heal` MCP 도구 재활용.

### C-3. `mandu generate --ai` — AI 스캐폴딩

```bash
mandu generate page dashboard --ai "사용자 대시보드: 매출 차트, 주문 테이블, 실시간 알림"
# 🤖 AI 분석 중...
#   기능: 차트(island), 테이블(island), 알림(SSE)
#   아키텍처: FSD widgets/dashboard + features/chart
#
# 📂 생성:
#   app/dashboard/page.tsx
#   app/dashboard/chart.island.tsx
#   app/dashboard/table.island.tsx
#   spec/slots/dashboard.slot.ts
#   spec/contracts/api-dashboard.contract.ts
```

**구현**: `negotiate()` 파이프라인에 LLM 변환 레이어 추가. 자연어 → `NegotiationRequest` → `generateScaffold()`.

### C-4. `mandu explain <error-code>`

```bash
mandu explain GUARD_IMPORT_001
# 📋 GUARD_IMPORT_001: 레이어 의존성 위반
#
# 원인: client 레이어에서 server 레이어를 직접 import
# 규칙: client → shared (O), client → server (X)
#
# 수정 방법:
#   1. 공유 타입을 src/shared/types/로 이동
#   2. 서버 로직은 slot loader에서 처리
#
# 참고: https://mandujs.dev/docs/guard/rules#import-001
```

### C-5. `mandu review` — AI 코드 리뷰

```bash
mandu review
# 🔍 변경된 파일 5개 분석 중...
#
# ⚠️  app/api/users/route.ts
#   - SQL injection 위험: 직접 문��열 보간 사용
#   - 제안: parameterized query 사용
#
# ✅ app/dashboard/page.tsx
#   - Island 전략 적절 (visible)
#   - Contract 타입 일치
#
# �� 점수: 85/100 (보안 -10, 나머�� 양호)
```

### C-6. `mandu ask` — 대화형 AI 질의

```bash
mandu ask "이 라우트에 rate limiting을 어떻게 추가해?"
# 💡 Mandu에서 rate limiting을 추가하는 방법:
#
# 1. 글로벌 (서버 레벨):
#    startServer(manifest, { rateLimit: { max: 100, windowMs: 60000 } })
#
# 2. 라우트 레벨 (filling):
#    import { timeout } from "@mandujs/core/middleware";
#    export default Mandu.filling()
#      .use(timeout({ ms: 5000 }))
#      .beforeHandle(async (ctx) => {
#        // 커스텀 rate limit 로직
#      })
```

---

## Phase D: 인프�� 고도화

### D-1. Help 시스�� 리팩토링

`renderHelp(MANDU_HELP)` 함수가 이미 `terminal/help.ts`에 존재하지만 미사용. 카테고리별 그룹핑:

```
🥟 Mandu CLI v0.20.0

  Development
    dev          Start dev server with HMR
    build        Build client bundles
    start        Start production server
    preview      Build + start (preview production)

  Scaffolding
    init         Create new Mandu project
    generate     Generate routes, components, resources
    add          Add dependencies to project
    ws           Create WebSocket route

  Architecture
    guard-check  Check architecture violations
    guard-arch   View architecture rules
    check        Full project validation

  AI & MCP
    mcp          Run MCP tools from terminal
    fix          Auto-fix build errors
    explain      Explain error codes
    review       AI code review
    ask          Ask AI about Mandu

  Data & Cache
    cache        Manage ISR/SWR cache
    contract     Manage API contracts
    collection   Manage content collections

  Utilities
    info         Show environment info
    clean        Remove build artifacts
    doctor       Diagnose project health
    upgrade      Update Mandu packages
```

### D-2. Tab Completion

```bash
mandu completion bash >> ~/.bashrc
mandu completion zsh >> ~/.zshrc
mandu completion fish >> ~/.config/fish/completions/mandu.fish
```

### D-3. Plugin/Hook 시스템

```typescript
// mandu.config.ts
export default {
  plugins: [
    sentryPlugin({ dsn: "..." }),
    analyticsPlugin(),
  ],
  hooks: {
    onBeforeBuild: async () => { /* 빌드 전 처리 */ },
    onAfterDev: async (server) => { /* dev 시작 후 */ },
    onRouteChange: async (route) => { /* 라우트 변경 시 */ },
  },
};
```

### D-4. `mandu deploy`

```bash
mandu deploy --target docker
# ✓ Dockerfile 생성
# ✓ .dockerignore ��데이트
# ✓ docker build -t mandu-app .
# ✓ 이미지 ��기: 45MB (Bun alpine)

mandu deploy --target fly
# ✓ fly.toml 생성
# ✓ fly deploy
```

### D-5. `mandu upgrade`

```bash
mandu upgrade --check
# @mandujs/core:  0.20.0 → 0.21.0 (minor)
# @mandujs/cli:   0.20.0 → 0.21.0 (minor)
# @mandujs/mcp:   0.18.4 → 0.19.0 (minor)
#
# Run: mandu upgrade

mandu upgrade
# ✓ Updated 3 packages
# ⚠️  Breaking changes in @mandujs/core@0.21.0:
#   - filling.loader() signature changed
#   See: https://mandujs.dev/changelog/0.21.0
```

---

## 우선순위 매트릭스

```
임팩트 ↑
극대  │  mcp bridge(C-1)    fix(C-2)
      │  generate --ai(C-3)
      │
 대   │  dev UX(A-1,A-6)    cache(B-1)
      │  build UX(A-2)      auth init(B-3)
      │
 높   │  clean(A-3)         middleware(B-2)
      │  info(A-4)          review(C-5)
      │  preview(A-5)       explain(C-4)
      │
 중   │  ws(B-5)            ask(C-6)
      │  collection(B-6)    deploy(D-4)
      │  session(B-4)       upgrade(D-5)
      │
      └─────────────────────────────────→ 난이도
           하                중          상
```

---

## Mandu CLI 차별화 핵심

> **기존 MCP 도구를 CLI로 표면화하는 것이 가장 높은 ROI**
>
> Mandu는 MCP 레이어에 이미 16개 카테고리 50+ 도구가 구현되어 있다.
> 이것은 AI 에이전트만 접근 가능한 상태이다.
> `mandu mcp <tool>` 브리지 하나로 ��간 개발자에게도 개방하면
> 별도 구현 없이 CLI 기능이 50개 이상 즉시 추가된다.
