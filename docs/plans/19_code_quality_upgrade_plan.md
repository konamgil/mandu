# 19. Mandu 코드 레벨 상향 기획서

작성일: 2026-05-18
대상: Mandu v0.x -> Top-tier Agent-Native Web Framework
관점: CTO, 최상위 웹프레임워크 개발자, LLM 에이전트 개발자
범위: 아키텍처, 유지보수성, 완성도, 관심사 분리, 코드 품질, 성능

---

## 0. 핵심 결론

Mandu는 이미 기능 수가 부족한 프레임워크가 아니다.
현재의 핵심 과제는 "더 많은 기능"이 아니라 다음 4가지를 제품 수준으로 고정하는 것이다.

1. **항상 초록인 품질 게이트**
2. **런타임/CLI/Edge의 핵심 경로 안정화**
3. **core public API와 runtime 내부 결합도 축소**
4. **LLM 에이전트가 안전하게 변경할 수 있는 반복 가능한 개발 루프**

현재 코드 수준은 상위권 기반을 갖췄지만, top-tier로 선언하려면 red test, optional dependency 경계, runtime 과밀, CLI UX 불일치를 먼저 닫아야 한다.

---

## 1. 현재 스냅샷

### 1.1 확인된 품질 상태

| 항목 | 현재 상태 | 판단 |
|---|---|---|
| 타입체크 | `bun run typecheck` 통과 | Green |
| 린트 | `bun run lint` 통과, 0 warnings / 0 errors | Green |
| Core 테스트 | 4057 pass + gated bundler 7 pass, 176 skip, 0 fail | Green |
| CLI 테스트 | 806 pass, 2 skip, 0 fail | Green |
| MCP 테스트 | 288 pass | 좋음 |
| ATE 테스트 | 587 pass | 좋음 |
| Edge 테스트 | 107 pass, 0 fail | Green |
| Skills 테스트 | 통과 | 좋음 |
| Playground Runner 테스트 | 86 pass | 좋음 |

### 1.2 주요 리스크

| 리스크 | 영향 | 대표 증상 |
|---|---|---|
| Core FileAPI 테스트 실패 | 테스트 신뢰도 저하 | 해결: 미추적 루트가 빈 filePath로 노출되지 않음 |
| CLI help 라우팅 실패 | 첫 사용자 경험 저하 | 해결: `mandu ai chat --help`, `mandu ai eval --help`가 하위 help로 라우팅됨 |
| Realtime chat SSE 실패 | 데모/템플릿 신뢰도 저하 | 해결: `addEventListener`와 callback-property EventSource를 모두 지원 |
| Edge build optional dependency 누수 | edge 배포 신뢰도 저하 | 해결: a11y optional peer를 lazy import/external 처리 |
| Runtime server 과밀 | 유지보수성 저하 | server entry가 라우팅, SSR, 보안, 캐시, devtools, observability를 함께 담당 |
| Public export 표면적 과대 | API 안정성 저하 | core root export가 많은 내부 모듈을 한 번에 노출 |

---

## 2. 목표 상태

### 2.1 Top-tier 코드 레벨 정의

Mandu가 top-tier 코드 레벨에 도달했다는 선언은 아래 조건을 모두 만족할 때만 가능하다.

- [ ] `main`에서 typecheck, lint, package tests, smoke tests가 항상 통과한다.
- [ ] `init -> dev -> build -> start`가 기준 앱에서 재현 가능하다.
- [x] `core` public API가 stable, experimental, internal로 분류되어 있다.
- [ ] runtime server가 관심사별 모듈로 나뉘어 있다.
- [ ] optional dependency가 target별 build에 새지 않는다.
- [ ] CLI 도움말, 에러 메시지, scaffold 결과가 공식 문서와 일치한다.
- [ ] 성능 기준선과 bundle budget이 CI에서 회귀 감지된다.
- [ ] MCP/skills/Guard/ATE가 하나의 에이전트 개발 루프로 연결된다.
- [x] 문서의 상태 정보가 실제 테스트 결과와 일치한다.

### 2.2 성공 지표

| 지표 | 목표 |
|---|---:|
| Red test | 0 |
| Flaky test | 0 |
| TypeScript `any`/강제 cast 핵심 경로 사용 | 지속 감소, 신규 추가 금지 |
| Runtime server 책임 수 | 명확한 하위 모듈로 분리 |
| Public API breaking risk | release checklist에서 검증 |
| CLI help mismatch | 0 |
| Edge build optional dependency leak | 0 |
| 기준 앱 smoke success | 100% |
| 성능 회귀 허용치 | 기준선 대비 +10% 이내 |

---

## 3. 우선순위 로드맵

### Phase 0. 품질 게이트 복구

기간: 1~2주
목표: 현재 red 상태를 모두 green으로 돌리고, 상태 문서를 실제와 맞춘다.

### 실행 체크리스트

- [x] Core FileAPI 테스트 실패 원인을 분리한다.
- [x] git repo 외부/미추적 루트 시나리오가 빈 변경 경로를 만들지 않게 한다.
- [x] `mandu ai chat --help`가 chat 전용 help로 라우팅되게 수정한다.
- [x] `mandu ai eval --help`가 eval 전용 help로 라우팅되게 수정한다.
- [x] CLI subcommand help 라우팅 규칙을 테스트로 고정한다.
- [x] Realtime chat `EventSource` 어댑터 인터페이스를 명확히 정의한다.
- [x] SSE 테스트 mock이 실제 어댑터 계약과 동일하게 동작하도록 정리한다.
- [x] `addEventListener`가 없는 source에 대한 호환 계층 또는 명시적 오류를 추가한다.
- [x] Edge workers build에서 `axe-core`가 resolve되지 않도록 a11y audit import 경계를 분리한다.
- [x] optional peer dependency 사용 지점을 lazy import 또는 target guard로 보호한다.
- [x] `bun run typecheck`를 통과시킨다.
- [x] `bun run lint`를 통과시킨다.
- [x] `bun run test:core`를 통과시킨다.
- [x] `bun run test:cli`를 통과시킨다.
- [x] `bun run test:edge`를 통과시킨다.
- [x] `bun run test:packages`를 통과시킨다.
- [x] `docs/status.ko.md`와 `docs/status.md`의 테스트 수치를 실제 상태로 갱신한다.

### 완료 기준

- [x] 현재 확인된 red test가 0개다.
- [x] sandbox/권한 이슈와 실제 코드 실패가 문서에서 구분되어 있다.
- [x] 상태 문서가 실제 명령 결과와 일치한다.

### 검증 메모

- sandbox에서 CLI subprocess 테스트는 `uv_spawn 'bun'` EPERM으로 실패할 수 있다. 이 경우 코드 실패로 보지 않고, 승인된 외부 실행 결과를 기준으로 판단한다.
- 2026-05-18 기준 승인된 실행에서 `bun run typecheck`, `bun run lint`, `bun run test:core`, `bun run test:cli`, `bun run test:edge`, `bun run test:packages`가 통과했다.

---

### Phase 1. 아키텍처 경계 강화

기간: 2~6주
목표: package level 분리는 유지하면서, core runtime 내부의 과밀도를 낮춘다.

### 실행 체크리스트

- [x] `runtime/server` 책임을 inventory로 작성한다.
- [x] static file serving을 별도 모듈로 분리한다.
- [x] middleware composition을 별도 모듈로 분리한다.
- [x] SSR/streaming render orchestration을 별도 모듈로 분리한다.
- [x] dev overlay/Kitchen/devtools 연결부를 runtime adapter로 분리한다.
- [x] observability/tracing/perf mark 연결부를 별도 lifecycle hook으로 분리한다.
- [ ] image/a11y/openapi/scheduler/websocket 등 선택 기능을 target-safe plugin 경계로 이동한다.
- [x] `core/src/index.ts` root export를 stable API 중심으로 재검토한다.
- [ ] experimental API는 명시적인 subpath export로 이동한다.
- [ ] internal API는 root export에서 제거하거나 `internal` 네임스페이스로 격리한다.
- [x] public API 변경 체크리스트를 릴리즈 프로세스에 추가한다.
- [x] MCP tool registry의 수동 export/import 중복을 줄이는 생성 또는 검증 스크립트를 검토한다.
- [x] 강제 cast가 있는 MCP handler 등록부의 타입 계약을 좁힌다.

### 완료 기준

- [ ] runtime server entry가 orchestration 중심으로 작아진다.
- [ ] target별 build가 선택 기능에 의해 깨지지 않는다.
- [x] stable public API 목록이 문서화되어 있다.

### 진행 메모

- 2026-05-18: 정적 파일 서빙, MIME 타입, Cache-Control, ETag, path safety 로직을 `packages/core/src/runtime/static-files.ts`로 분리했다. `runtime/server.ts`는 `serveStaticFile`, `computeStrongEtag`, `computeStaticCacheControl`, `matchesEtag`를 호출하는 orchestration 경계로 축소했다.
- 검증: `bun test packages/core/tests/runtime/static-cache-control.test.ts packages/core/tests/runtime/prerender-cache-control.test.ts packages/core/tests/runtime/public-flat-fallback.test.ts packages/core/tests/security/path-traversal.test.ts`, `bun run typecheck`, `bun run lint`, `bun run test:core`, `git diff --check` 통과.
- 2026-05-18: `runtime/server` 책임 inventory를 `docs/architect/runtime-server-inventory.md`로 작성했다.
- 2026-05-18: request-level middleware chain 생성/실행 glue를 `packages/core/src/runtime/request-middleware.ts`로 분리하고, `packages/core/src/runtime/__tests__/request-middleware.test.ts`로 hot-path undefined, skip 재진입, composed dispatch를 고정했다.
- 검증: `bun test packages/core/src/runtime/__tests__/request-middleware.test.ts packages/core/tests/middleware/compose.test.ts packages/core/tests/middleware/chain-integration.test.ts`, `bun run typecheck`, `bun run lint`, `bun run test:core`, `bun run test:packages` 통과.
- 2026-05-18: SSR/streaming 응답 선택, async pre-resolution, render option assembly를 `packages/core/src/runtime/page-render-response.ts`로 분리했다. `runtime/server.ts`는 page element 구성, metadata, cache/save orchestration만 남기고 실제 HTML response 생성은 새 모듈에 위임한다.
- 검증: `bun test packages/core/src/runtime/__tests__/page-render-response.test.ts packages/core/tests/runtime/async-component.test.ts packages/core/tests/server/streaming-async-page.test.ts packages/core/tests/server/layout-cookie-ssr.test.ts packages/core/tests/server/redirect-loader.test.ts`, `bun run typecheck`, `bun run lint`, `bun run test:core`, `bun run test:packages` 통과.
- 2026-05-18: Kitchen/devtools 생성, dashboard path, devtools request dispatch, request recording 제외 규칙을 `packages/core/src/runtime/devtools-adapter.ts`로 분리했다. `runtime/server.ts`는 adapter start/stop과 request lifecycle 호출만 담당한다.
- 검증: `bun test packages/core/src/runtime/__tests__/devtools-adapter.test.ts packages/core/tests/kitchen/kitchen-handler.test.ts packages/core/tests/kitchen/agent-devtools-api.test.ts packages/core/tests/runtime/devtools-inject.test.ts`, `bun run typecheck`, `bun run lint`, `bun run test:core`, `bun run test:packages`, `git diff --check` 통과.
- 2026-05-18: EventBus stream/recent, heap/metrics endpoint, user perf snapshot composition, request tracing wrapper, HTTP metrics counter를 `packages/core/src/runtime/observability-lifecycle.ts`로 분리했다. `runtime/server.ts`는 lifecycle 생성, endpoint short-circuit, request wrapping 호출만 담당한다.
- 검증: `bun test packages/core/src/runtime/__tests__/observability-lifecycle.test.ts packages/core/tests/runtime/heap-endpoint.test.ts packages/core/tests/observability/tracing.test.ts packages/core/src/runtime/__tests__/devtools-adapter.test.ts`, `bun run typecheck`, `bun run lint`, `bun run test:core` 통과.
- 2026-05-18: `packages/core/src/index.ts`와 `packages/core/package.json` export map을 검토해 `docs/architect/public-api-boundary.md`에 stable/experimental/internal API 정책과 현재 surface 분류를 문서화했다.
- 2026-05-18: `docs/releases/public-api-change-checklist.md`를 추가해 root export, package subpath, CLI, MCP surface 변경 시 release/migration note와 검증 명령을 요구하도록 했다.
- 2026-05-18: `scripts/check-public-api-boundary.ts`를 추가해 `@mandujs/core` export map의 stable/experimental/internal 분류 누락을 release gate에서 실패시키도록 했다. `package.json`에 `check:public-api`를 추가하고 `scripts/pre-publish-check.ts` Step 5에 연결했다.
- 검증: `bun run check:public-api`, `bun test ./scripts/check-public-api-boundary.test.ts`, `bun run typecheck`, `bun run lint` 통과.
- 2026-05-18: `packages/mcp/src/tools/index.ts`의 builtin tool module registry에서 불필요한 `as ToolModule["handlers"]`와 `as unknown` cast를 제거했다. `brain`, `project`, `ate`, `ate-run`, `ate-phase5` handler는 기존 optional `Server`/`ActivityMonitor` 계약으로 직접 타입 검증된다.
- 검증: `bun run typecheck`, `bun run test:mcp` 통과.
- 2026-05-18: `validateBuiltinToolModules()`를 추가해 builtin MCP tool module의 중복 category, 중복 tool definition name, 비어 있는 definition category를 registration 전에 실패시키도록 했다. 검증 중 발견된 중복 `mandu.slot.validate` 정의는 제거했고, canonical slot content validator는 `slot` 모듈에 남겼다.
- 2026-05-18: `registerBuiltinTools()`의 server-required handler 분기에서 남아 있던 함수 캐스팅을 제거해 registry 등록 경로가 직접 타입 검증되도록 했다.
- 검증: `bun test packages/mcp/tests/tools-index.test.ts`, `bun run test:mcp`(288 pass), `bun run typecheck`, `bun run lint`, `bun run test:packages` 통과.
- 2026-05-18: `scripts/check-target-boundaries.ts`를 추가해 optional peer의 static import, edge source의 Node/Bun static import, browser client source의 Node/Bun import를 release 전에 감지하도록 했다. `node:async_hooks`는 edge adapter의 문서화된 lazy ALS probe만 허용한다.
- 2026-05-18: `package.json`에 `check:target-boundaries`를 추가하고 `scripts/pre-publish-check.ts` Step 6에 연결했다.
- 검증: `bun run check:target-boundaries`, `bun test ./scripts/check-target-boundaries.test.ts ./scripts/check-public-api-boundary.test.ts`, `bun run typecheck`, `bun run check:publish` 통과.

---

### Phase 2. 완성도와 DX 고정

기간: 4~8주
목표: 사용자가 Mandu를 처음 접해도 공식 경로를 따라 성공하게 만든다.

### 실행 체크리스트

- [ ] 공식 골든패스를 하나로 고정한다.
- [ ] `init -> page -> api -> contract(optional) -> dev -> build -> start` 흐름을 README와 CLI에 동일하게 반영한다.
- [ ] CLI help 출력과 문서의 명령 설명을 동기화한다.
- [ ] CLI 에러 메시지를 원인, 조치, 관련 문서 링크 구조로 표준화한다.
- [ ] 기준 앱 3개를 정의한다.
- [ ] Hello SSR 기준 앱 smoke test를 추가한다.
- [ ] Blog CRUD + Contract 기준 앱 smoke test를 추가한다.
- [ ] Dashboard + Island 기준 앱 smoke test를 추가한다.
- [ ] scaffold 템플릿이 기준 앱 구조와 일치하는지 검증한다.
- [ ] outdated 문서와 실제 코드의 차이를 추적하는 docs drift check를 추가한다.
- [ ] README, docs README, CLI README, template README의 포트/명령/경로를 통일한다.

### 완료 기준

- [ ] 신규 사용자가 10분 내 첫 페이지와 첫 API를 만들 수 있다.
- [ ] CLI help와 문서가 서로 다른 말을 하지 않는다.
- [ ] 기준 앱 smoke test가 CI에서 통과한다.

---

### Phase 3. 성능과 회귀 방지

기간: 6~10주
목표: 성능을 주장하는 수준이 아니라 예산과 회귀 감지로 관리한다.

### 실행 체크리스트

- [ ] SSR latency 기준선을 고정한다.
- [ ] cold start 기준선을 고정한다.
- [ ] HMR latency 기준선을 고정한다.
- [ ] hydration cost 기준선을 고정한다.
- [ ] route bundle size budget을 정의한다.
- [ ] island 없는 페이지의 zero-JS budget을 검증한다.
- [ ] edge target bundle에 Node-only/optional dependency가 포함되지 않는지 검사한다.
- [ ] performance benchmark 결과를 JSON artifact로 저장한다.
- [ ] PR에서 기준선 대비 +10% 초과 회귀를 감지한다.
- [ ] skip된 perf matrix test를 release gate용 job으로 분리한다.

### 완료 기준

- [ ] 성능 수치가 문서와 CI artifact로 남는다.
- [ ] 성능 회귀가 코드 리뷰 전에 자동 감지된다.
- [ ] edge, node, bun target별 bundle 경계가 테스트된다.

---

### Phase 4. Agent-Native 개발 루프 제품화

기간: 8~12주
목표: Mandu의 차별점인 MCP, Guard, ATE, Skills를 하나의 반복 가능한 개발 루프로 만든다.

### 실행 체크리스트

- [ ] 작업 도메인 분류표를 CLI/MCP/문서에서 동일하게 사용한다.
- [ ] route/page/API 생성은 MCP 또는 skill 우선 경로로 문서화한다.
- [ ] contract 변경은 contract MCP validation을 기본 경로로 문서화한다.
- [ ] slot/filling 변경은 관련 skill과 테스트 경로를 연결한다.
- [ ] guard 위반은 fix 제안과 architecture explanation으로 이어지게 한다.
- [ ] ATE가 agent 변경 전후 품질 점수를 비교할 수 있게 한다.
- [ ] MCP transaction lock이 실제 파일 변경 루프에서 안전하게 동작하는지 smoke test를 추가한다.
- [ ] agent용 prompt template을 최신 공식 경로와 동기화한다.
- [ ] "agent가 건드려도 되는 API"와 "직접 수정 금지 내부 API"를 문서화한다.
- [ ] agent workflow 결과를 재현 가능한 로그 또는 activity report로 남긴다.

### 완료 기준

- [ ] 사람이 CLI로 하는 골든패스와 LLM 에이전트가 MCP/skill로 하는 골든패스가 같다.
- [ ] 에이전트 변경은 Guard/ATE/test를 통해 자동 검증된다.
- [ ] 에이전트가 내부 경계를 침범했을 때 감지된다.

---

## 4. CTO 관점 개선점

CTO 관점의 핵심은 기술적 우수성보다 **릴리스 신뢰도, 팀 생산성, 장기 유지비**다.

### 체크리스트

- [ ] `main`을 항상 배포 가능한 상태로 유지한다.
- [ ] red test가 있는 상태에서는 새 기능을 merge하지 않는다.
- [ ] 품질 게이트를 PR 필수 조건으로 만든다.
- [ ] cross-platform CI를 Windows, macOS, Linux로 확장한다.
- [ ] Bun 최소 지원 버전과 최신 안정 버전을 CI matrix에 포함한다.
- [ ] 릴리즈 체크리스트에 typecheck, lint, package tests, smoke tests, docs sync를 포함한다.
- [x] public API 변경은 release note와 migration note를 요구한다.
- [x] "stable", "experimental", "internal" API 정책을 문서화한다.
- [ ] 핵심 모듈 owner를 지정한다.
- [ ] runtime, cli, mcp, edge, ate별 기술 부채 backlog를 유지한다.
- [ ] 신규 기능보다 red test 제거와 docs drift 제거를 우선한다.
- [ ] 성능/안정성 수치를 분기별 OKR로 관리한다.
- [ ] external ready 선언 기준을 문서화하고 충족 전에는 과장된 상태 문구를 제거한다.

### CTO 판단 기준

| 질문 | 통과 기준 |
|---|---|
| 지금 외부 사용자가 설치해도 되는가? | red test 0, quickstart 성공, docs 일치 |
| 팀원이 독립적으로 기능을 추가해도 되는가? | ownership, test gate, API boundary 명확 |
| 장애/회귀를 빠르게 감지할 수 있는가? | CI, smoke, perf baseline 존재 |
| 6개월 뒤 유지비가 폭증하지 않는가? | runtime 분리, public API 축소, docs drift 방지 |

---

## 5. 최상위 웹프레임워크 개발자 관점 개선점

웹프레임워크 개발자 관점의 핵심은 **런타임 경계, 번들 경계, API 일관성, 에러 복구성**이다.

### 체크리스트

- [ ] runtime server를 request lifecycle 중심으로 재구성한다.
- [ ] rendering, routing, middleware, static asset, devtools, observability를 독립 모듈로 분리한다.
- [ ] edge/node/bun target에서 import graph가 달라져도 안전하게 동작하게 한다.
- [x] optional peer dependency는 기능 호출 시점에만 로드한다.
- [ ] root export는 안정 API만 노출한다.
- [ ] framework internal helper는 subpath internal로 격리한다.
- [ ] route module contract를 타입과 런타임 검증 모두로 고정한다.
- [ ] loader/action/filling/contract의 책임 차이를 문서와 타입으로 분명히 한다.
- [ ] CLI scaffold 결과가 framework best practice를 자동으로 따르게 한다.
- [ ] 에러 메시지는 route id, file path, 원인, 해결책을 포함한다.
- [ ] zero-JS, island hydration, streaming SSR 각각의 benchmark를 유지한다.
- [ ] bundle analyzer와 budget을 release gate에 연결한다.
- [ ] Node-only API 사용을 edge target에서 정적으로 감지한다.
- [ ] filesystem route scanner의 캐싱과 invalidation 정책을 문서화한다.
- [ ] dev server HMR 경로를 cold start path와 분리해서 측정한다.

### 웹프레임워크 품질 기준

| 영역 | Top-tier 기준 |
|---|---|
| API | 작고 예측 가능하며 versioning이 명확함 |
| Runtime | target별 경계가 분명하고 optional 기능이 안전하게 격리됨 |
| DX | 오류가 발생해도 사용자가 다음 행동을 바로 알 수 있음 |
| Performance | benchmark가 있고 회귀가 자동 차단됨 |
| Stability | smoke/E2E가 실제 사용자 플로우를 검증함 |

---

## 6. LLM 에이전트 개발자 관점 개선점

LLM 에이전트 개발자 관점의 핵심은 **도구 선택 가능성, 변경 안전성, 검증 자동화, 컨텍스트 압축성**이다.

### 체크리스트

- [ ] 작업 도메인별 우선 도구를 명확히 문서화한다.
- [ ] MCP tool description이 서로 겹치지 않게 정리한다.
- [ ] route/API/contract/slot/guard/debug/deploy/release별 canonical workflow를 만든다.
- [ ] agent가 직접 편집하기 전 사용할 MCP/skill 경로를 문서화한다.
- [ ] MCP tool output은 다음 행동을 결정할 수 있는 구조화된 결과를 반환한다.
- [ ] Guard 위반은 machine-readable code와 human-readable explanation을 함께 제공한다.
- [ ] ATE score는 PR comment 또는 activity report로 남긴다.
- [ ] agent가 수정한 파일과 이유를 자동 기록할 수 있게 한다.
- [ ] internal API 직접 수정 시 guard warning을 제공한다.
- [ ] docs drift를 agent가 자동으로 감지하고 수정 제안할 수 있게 한다.
- [ ] 실패한 test output을 agent가 해석하기 쉬운 요약 포맷으로 제공한다.
- [ ] scaffold tool은 dry-run과 diff preview를 지원한다.
- [ ] MCP transaction lock과 rollback 정책을 사용자 문서에 포함한다.
- [ ] agent prompt template을 실제 CLI/MCP 명령과 동기화한다.
- [ ] "작업 전 분류 -> 도구 선택 -> 변경 -> 검증 -> 보고" 루프를 하나의 공식 프로토콜로 고정한다.

### LLM 에이전트 품질 기준

| 영역 | Top-tier 기준 |
|---|---|
| Tool Choice | 에이전트가 어떤 도구를 써야 하는지 혼동하지 않음 |
| Safety | 잘못된 파일/경계 변경을 감지하고 중단 가능 |
| Feedback | 실패 원인이 구조화되어 다음 수정으로 이어짐 |
| Repeatability | 같은 요청은 같은 루프와 유사한 산출물로 수렴 |
| Context Efficiency | 큰 코드베이스에서도 필요한 경계만 읽고 변경 가능 |

---

## 7. 통합 체크리스트

### P0. 지금 바로 해야 할 일

- [x] Core FileAPI red test 수정
- [x] CLI help routing red test 수정
- [x] Realtime chat SSE red tests 수정
- [x] Edge `axe-core` optional dependency leak 수정
- [x] 모든 package test green 확인
- [x] `docs/status.*` 실제 상태 반영

### P1. 2~6주 내 해야 할 일

- [ ] runtime server 책임 분해
- [ ] root export 안정 API 정리
- [x] optional dependency target guard 추가
- [ ] CLI help/error/scaffold 일관성 정리
- [ ] 기준 앱 smoke test 추가
- [ ] docs drift check 추가

### P2. 6~12주 내 해야 할 일

- [ ] 성능 기준선 고정
- [ ] bundle budget CI 연결
- [ ] edge/node/bun target import graph 검증
- [ ] MCP/Guard/ATE 통합 agent loop 구축
- [x] public API release gate 구축
- [ ] agent workflow report 자동화

---

## 8. 릴리즈 게이트

아래 항목을 모두 체크해야 "코드 레벨 A급" 또는 "external ready" 상태로 선언할 수 있다.

- [x] `bun run typecheck`
- [x] `bun run lint`
- [x] `bun run test:core`
- [x] `bun run test:cli`
- [x] `bun run test:mcp`
- [x] `bun run test:ate`
- [x] `bun run test:edge`
- [x] `bun run test:skills`
- [x] `bun run test:playground-runner`
- [x] `bun run test:packages`
- [ ] 기준 앱 `init -> dev -> build -> start` smoke
- [ ] edge target build smoke
- [x] docs status sync
- [x] public API review
- [ ] performance baseline comparison
- [ ] release note 작성

---

## 9. 최종 Definition of Done

이 기획서는 아래 조건이 충족되면 완료로 본다.

- [x] 현재 확인된 red test가 모두 해결되었다.
- [ ] runtime server가 관심사별로 분리되어 새 기능 추가 시 수정 범위가 줄었다.
- [x] core public API가 안정/실험/내부로 분류되었다.
- [ ] edge build가 optional dependency에 의해 깨지지 않는다.
- [ ] CLI help와 문서가 일치한다.
- [ ] 기준 앱 smoke test가 CI에서 통과한다.
- [ ] 성능 기준선과 bundle budget이 저장되고 회귀 감지된다.
- [ ] LLM 에이전트가 MCP/skill/Guard/ATE를 통해 안전하게 변경하는 공식 루프가 문서화되었다.
- [ ] CTO가 external ready를 판단할 수 있는 품질 지표가 문서와 CI에 남는다.
