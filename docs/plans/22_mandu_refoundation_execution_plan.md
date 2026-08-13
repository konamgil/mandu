# 22. Mandu Refoundation Execution Plan

작성일: 2026-08-13
상태: Active — Phase 1~5 implementation complete, beta release pending
기준 문서: `docs/product/03_agent_safe_refoundation_strategy.md`

---

## 0. 목적

이 계획은 Mandu를 기능이 많은 v0.x 프레임워크에서 **Agent-Safe Fullstack Framework**로 재창립한다.

전면 개편의 의미는 전체 코드를 한 번에 다시 쓰는 것이 아니다.

- 제품 범위는 즉시 다시 정한다.
- 공개 표면은 호환 계층을 두고 단계적으로 줄인다.
- 기존 runtime과 테스트 자산은 새 경계 뒤로 이동한다.
- 각 단계는 사용자 관점의 exit gate를 통과해야 한다.

기능 추가는 이 계획의 Phase 3 exit 전까지 동결한다. 허용되는 변경은 reliability, security, migration, removal, test infrastructure뿐이다.

---

## 1. 확인된 현재 상태

2026-08-13 저장소 기준:

| 항목 | 현재 상태 | 판단 |
|---|---:|---|
| Published workspace packages | 6개 + private runner 1개 | 독립 제품이 너무 많음 |
| CLI top-level commands | 52개 | Golden Path 식별이 어려움 |
| Core export map entries | 112개 | 장기 호환 계약이 과도함 |
| Core stable entries | 68개 | v1 이전에 안정 범위가 너무 넓음 |
| MCP tool definitions | 약 137개 / 47 modules | 기본 agent action보다 내부 도구가 큼 |
| MCP default `agent-core` | 8개 | 기본 profile 축소 방향은 적절함 |
| Skills | 두 source tree에 28 directories | 내용 drift 위험 |
| Package TS/TSX files | 1,378개 | 기능 폭이 유지보수 역량보다 큼 |
| Test files | 492개 | 개편 시 보존해야 할 강한 자산 |
| Docs markdown files | 194개 | 현재 계약과 역사 계획이 혼재 |

추가 사실:

- CLI는 Core 외에 MCP, ATE, Edge, Skills를 직접 dependency로 가진다.
- `mandu.agent.apply`는 현재 dry-run action report다.
- Cloudflare Playground adapter는 scaffold이며 Worker proxy는 501을 반환한다.
- deploy와 Edge target이 CLI build/help/MCP/skills 전반에 걸쳐 있다.
- Phase 1 이전 성능 gate는 일부 hydration `0ms`, JS bundle `0KB`를 측정 증거 없이 pass로 받아들였다. 현재는 scenario expectation과 asset/island evidence를 함께 검증한다.
- Phase 1 이전에는 build/Guard 실패 후 stale 또는 partial client bundle을 서빙할 수 있다는 열린 이슈가 있었다. 현재 client artifact는 immutable generation으로 staging/publish된다.

이 상태는 기술 자산이 부족한 것이 아니라 제품 계약보다 구현 표면이 앞선 상태다.

---

## 2. 패키지 이행 매트릭스

| 패키지 | Phase 1 | Phase 2~3 | v1 beta |
|---|---|---|---|
| `@mandujs/core` | 내부 경계와 generation 정리 | action API 도입, export 축소 shim | 유일한 runtime/safety 구현 |
| `@mandujs/cli` | dependency graph 분리 | 공식 help 축소, action adapter화 | Core에만 의존하는 Golden Path CLI |
| `@mandujs/mcp` | default profile 8개 유지 | 저수준 tool 내부화 | action API의 얇은 MCP adapter |
| `@mandujs/skills` | 두 skill source 차이 검사 | canonical source에서 생성 | 독립 product logic 없음 |
| `@mandujs/ate` | feature freeze | CLI/MCP 기본 dependency 제거 | Labs package |
| `@mandujs/edge` | feature freeze | CLI build target에서 분리 | Labs/optional adapter |
| Playground runner | private status 유지 | Cloudflare live claim 제거 | 별도 완료 기준 전까지 Labs |

### 2.1 목표 dependency graph

```text
@mandujs/cli ---> @mandujs/core
@mandujs/mcp ---> @mandujs/core
@mandujs/ate - - > @mandujs/core       (Labs)
@mandujs/edge - -> @mandujs/core       (Labs)
skills ----------> generated metadata  (build-time only)
```

검증 gate:

- CLI package manifest에 `@mandujs/mcp`, `@mandujs/ate`, `@mandujs/edge`, `@mandujs/skills` runtime dependency가 없어야 한다.
- MCP package manifest에 `@mandujs/ate`, `@mandujs/skills` runtime dependency가 없어야 한다.
- package boundary test가 금지된 역방향 import를 실패시켜야 한다.

---

## 3. CLI 52개 분류

### 3.1 Official v1 surface: 유지

| 명령 | 역할 |
|---|---|
| `create` | 새 프로젝트 생성 |
| `dev` | 일관된 development runtime |
| `build` | 재현 가능한 Bun artifact 생성 |
| `start` | production artifact 로컬 검증 |
| `check` | Guard, contract, targeted test, build readiness 집계 |
| `agent` | context, plan, apply, verify, repair, sync |

### 3.2 Compatibility/domain surface: 한시 유지

다음 명령은 동작을 유지하지만 global help와 Quickstart에서 숨기고 공식 명령의 내부 action으로 흡수한다.

```text
init
info
diagnose
guard
routes
contract
openapi
change
lock
lint
test
generate
mcp
```

이행 대상:

- `info`, `diagnose` -> `agent context`, `agent verify`
- `guard`, `contract`, `lint`, `test` -> `check`, `agent verify`
- `routes`, `generate`, `openapi` -> typed apply operation
- `change`, `lock` -> action transaction 내부
- `mcp register` -> `agent sync`
- `init` -> `create --existing` 또는 migration utility

### 3.3 공식 action으로 통합 후 폐기

```text
preview          -> start/verify
doctor           -> agent repair
fix              -> agent repair
review           -> agent verify
explain          -> structured diagnostic
ask              -> agent plan
scaffold         -> agent apply
new              -> agent apply
skills:generate  -> agent sync
skills:list      -> agent context
test:auto        -> agent verify (Labs ATE opt-in)
test:watch       -> dev/test runner 직접 사용
test:heal        -> agent repair (Labs ATE opt-in)
```

### 3.4 Labs/extension 이동

```text
design
brain
watch
monitor
ate
add
middleware
session
auth
ws
collection
db
desktop
ai
```

Labs command는 기본 바이너리와 global help에서 제외한다. 유지할 경우 별도 package나 opt-in plugin이 owner가 된다.

### 3.5 내부 utility로 숨김

```text
clean
cache
upgrade
completion
```

이 명령은 제품 핵심이 아니며 공식 command budget에 포함하지 않는다. human utility namespace 또는 package script로 이동한다.

### 3.6 제거

```text
deploy
deploy:plan
```

대체 계약:

- `mandu build`가 Bun artifact manifest를 생성한다.
- 공식 Dockerfile 예제를 제공한다.
- provider adapter, token, remote deployment는 외부 도구가 담당한다.

---

## 4. Core 공개 API 분류

### 4.1 v1 stable 후보

```text
.
./client
./config
./contract
./error
./guard
./middleware
./plugins
./router
./runtime
./testing
```

원칙:

- root는 page/API authoring에 필요한 primitive만 export한다.
- subpath는 target boundary 또는 명확한 사용자 역할이 있을 때만 만든다.
- CLI가 필요하다는 이유만으로 app-facing public export를 만들지 않는다.

### 4.2 Extension/recipe 이동 후보

```text
auth
content
db
email
i18n
logging
observability
openapi/generator
perf
resource
scheduler
storage/s3
components/Image
```

초기에는 compatibility export를 유지할 수 있다. v1 stable로 승격하지 않으며 root에서 제거한다.

### 4.3 Labs 이동 후보

```text
a11y
agent UI helpers
brain
deploy
design
desktop
diagnose
kitchen
experimental
```

### 4.4 Internal-only

```text
bundler/**
change internals
dev-error-overlay internals
generator
lockfile
paths
resource/ddl/**
runtime/server
runtime/cache
runtime/router
watcher
guard/tsgolint-bridge
plugin runner internals
```

`internal` export는 compatibility 기간 이후 package export map에서 제거한다. CLI가 필요한 compiler 기능은 private workspace boundary 또는 Core의 비공개 application service로 이동한다.

---

## 5. MCP와 Skills 분류

### 5.1 공식 MCP

기본 profile은 다음 8개만 노출한다.

```text
mandu.agent.context
mandu.agent.plan
mandu.agent.apply
mandu.agent.verify
mandu.agent.repair
mandu.agent.sync
mandu.docs.search
mandu.docs.get
```

현재 `agent-full`의 저수준 tool은 다음처럼 처리한다.

| 분류 | MCP categories |
|---|---|
| Action 내부 handler | spec, generate, slot, hydration, contract, guard, lint, run-tests, transaction, history |
| Labs profile | ATE 전체, brain, kitchen, design, SEO, component, resource, runtime mutation, refactor |
| 제거 | deploy-plan, deploy-preview |
| 중복 통합 | negotiate, ai-brief, loop-close, composite, project lifecycle |

write operation은 가능한 한 `agent.apply`와 제한된 `agent.repair` 두 entry point로 집중한다.

### 5.2 Skills

공식 skill은 6개 이하로 축소한다.

```text
mandu-agent-workflow
mandu-fs-routes
mandu-contract
mandu-hydration
mandu-guard
mandu-testing
```

처리:

- `mandu-deployment`/`mandu-deploy` 제거
- composition, UI, styling, performance, security는 canonical docs/recipe로 이동
- create-api/create-feature/debug/explain은 agent workflow 또는 domain skill로 통합
- MCP용 skill과 package skill의 source를 하나로 합치고 빌드 시 복사/생성
- generated skill drift check를 release gate에 추가

---

## 6. 구현 트랙

### Phase 0. Freeze and baseline — 1주

작업:

- 이 전략과 실행 계획을 active source of truth로 연결한다.
- 신규 package, CLI command, export, MCP tool 추가를 금지하는 review rule을 추가한다.
- 세 reference app과 20개 agent task benchmark를 고정한다.
- 기존 API/command 사용량을 demos/tests에서 수집한다.
- 기존 계획 문서에 Current/Superseded/Archived 상태를 붙인다.

Exit gate:

- 모든 신규 surface PR은 constitution 예외 승인을 요구한다.
- 기준 앱과 agent task가 CI에서 실행 가능하다.
- 현재 flaky rate와 perf measurement validity가 기록된다.

### Phase 1. Runtime confidence — 2주

우선 이슈:

1. port bind preflight와 fatal summary
2. build generation staging
3. manifest/chunk/HTML generation ID
4. successful validation 후 atomic publish
5. failed build state와 browser error overlay 연결
6. 성능 측정의 missing/zero validity rule

Exit gate:

- 실패 주입 100회에서 mixed generation 0건
- stale/partial bundle 재현 테스트 통과
- port collision이 route scan 이전 또는 최종 fatal summary로 노출
- 기대되는 asset/hydration 측정의 0값은 invalid로 실패

구현 상태 (2026-08-13): **Complete**

- client build를 staging generation에서 수행하고 검증 성공 후 active pointer를 atomic publish한다.
- SSR, streaming SSR, hydration boundary, runtime/vendor/router/DevTools asset을 response-local generation ID로 고정한다.
- 이전 generation HTML은 새 build publish 이후에도 자신의 immutable asset을 받으며, 실패한 generation URL은 active generation으로 fallback하지 않는다.
- 100회 build failure injection에서 mixed generation 0건을 확인했다.
- build error를 terminal/HMR/브라우저 overlay에 동일한 구조로 전달하고, 새 연결에도 마지막 오류를 recovery 전까지 replay한다.
- 연속 10개 port 충돌 시 시도 범위와 `--port` 해결책이 포함된 최종 fatal summary를 출력한다.
- 성능 scenario가 `initialJs: required|zero`, `hydration: required|none` expectation을 선언하며, 발견/다운로드 asset 수와 island hydration sample이 expectation을 증명해야 한다.
- 실제 active perf 4개 scenario 결과: 9 pass, 5 warn, 0 fail, 0 unsupported. 의도된 zero-JS/무 hydration만 0값으로 통과했다.

검증 메모:

- 관련 runtime/bundler/SSR/HMR/port/hydration suite와 typecheck/lint는 통과했다.
- 전체 병렬 `bun test`에서는 CSS HMR timing test 2건이 실패했으나 동일 파일 단독 실행은 38 pass, 0 fail이었다. Phase 2에서 flaky-rate 기준과 함께 추적한다.
- `check:publish`의 코드·hydration·package 검사는 통과하며, npm에 선점된 patch version과 local version drift는 Changesets version 단계에서 별도로 해소한다.

### Phase 2. Dependency and package boundaries — 2주

작업:

- CLI에서 MCP/ATE/Edge/Skills 직접 dependency 제거
- MCP에서 ATE/Skills 직접 runtime dependency 제거
- Core 내부를 `runtime`, `safety`, `actions` owner로 재배치
- package target boundary CI 추가
- Labs package에 status와 release policy 명시

Exit gate:

- 목표 dependency graph 강제 테스트 통과
- Core/CLI/MCP만으로 Golden Path 통과
- Labs 실패가 Core release를 막지 않음

구현 상태 (2026-08-13): **Complete**

- CLI의 제품 진입점은 Core만 runtime dependency로 사용한다. ATE/Edge 기능은 Labs 안내로 전환하고, MCP 실행은 독립 `mandu-mcp` 바이너리로 분리했으며, Skills 동기화는 Core agent plan을 사용한다.
- MCP의 제품 진입점에서 ATE/Skills runtime dependency와 tool registration을 제거했다. 기본 agent action과 docs surface는 Core 위의 얇은 adapter로 유지한다.
- Core source를 `runtime`, `safety`, `actions` 논리 owner로 분류했다. runtime/safety에서 actions로 향하는 import를 금지하며, 실패 fixture를 포함한 boundary test로 규칙을 강제한다.
- `check:package-boundaries`가 package manifest뿐 아니라 CLI/MCP entrypoint에서 도달 가능한 정적 import, 동적 import, `require` graph까지 검사한다.
- ATE, Edge, Playground Runner는 Labs로, Skills는 generated compatibility package로 명시했다. 제품과 Labs의 test/typecheck/lint/release train을 분리하고 Labs job은 제품 release의 비차단 검증으로 운영한다.
- 제품 release workflow는 Core/MCP/CLI만 검증하고 publish한다. Labs 승격 기준과 독립 릴리스 원칙은 `docs/product/04_labs_policy.md`에 고정했다.

검증 메모:

- `test:smoke`의 create → install → generate → dev → build → start Golden Path가 통과했다.
- Core 전체 suite가 통과했고 CLI는 834 pass, 2 skip, 0 fail, MCP는 342 pass, 0 fail이었다.
- 제품 typecheck/lint, public API/target/package boundary, hydration/browser E2E, tarball dependency/subpath 검사가 통과했다.
- `check:product-release`는 코드와 package 구조 검사를 모두 통과한 뒤, 로컬 버전이 이미 npm에 게시된 patch slot보다 낮거나 같은 상태만 정확히 차단했다. 실제 릴리스에서는 Changesets version 단계가 새 minor version을 만든 후 publish gate를 다시 실행한다.

### Phase 3. Surface convergence — 2~3주

작업:

- global CLI help를 공식 6개 중심으로 재작성
- compatibility command warning/telemetry-free local notice 추가
- Core root export 축소와 migration codemod 작성
- MCP 저수준 tool을 내부 action handler로 전환
- Skills canonical source와 generator 구축
- deploy surface 제거 및 artifact contract 문서화

Exit gate:

- CLI official surface 6개
- Core v1 candidate export 10~12개
- MCP default profile 8개 이하
- skill source 1개, official skill 6개 이하
- 기존 demo는 compatibility shim 또는 codemod 후 통과

완료 기록 (2026-08-13):

- global help는 `create`, `dev`, `build`, `start`, `check`, `agent` 여섯
  command만 노출하며 나머지는 compatibility/Labs/internal/retired로 분류했다.
- Core export map은 stable 11개와 `./compat/*` 한 개로 축소했고
  `mandu-codemod core-v1` 및 CI drift gate를 추가했다.
- MCP 기본 profile은 여섯 `mandu.agent.*` action과 두 docs action, 총
  8개로 고정했다. 저수준 domain tool은 internal profile에만 남겼다.
- 공식 skill은 `skills/official/`의 6개를 단일 원본으로 삼고 Skills
  package와 MCP resource를 생성한다. 이전 두 catalog는 archive로 이동했다.
- CLI/MCP deploy 실행 표면을 retire하고 provider-neutral production
  artifact contract를 공식 경계로 문서화했다.
- Core 4,264 pass/176 skip와 race gate 7 pass, CLI 839 pass/2 skip, MCP
  343 pass, Skills 106 pass, hydration browser E2E와 Golden Path smoke가
  통과했다.
- product release gate는 tarball, subpath, boundary, docs 검사를 통과했고
  Changesets version 전의 기존 npm version/metadata drift 3건만 차단했다.

### Phase 4. Typed apply — 3주

작업:

- `AgentPlan`, `AgentOperation`, `ApplyReceipt` schema 확정
- content hash/base revision precondition 구현
- touched-file snapshot과 rollback 연결
- route/API/contract/guard safe-fix operation부터 구현
- idempotency key와 재실행 정책 구현
- verify result를 receipt에 포함

Exit gate:

- 대표 agent task 성공률 85% 이상
- scope 밖 write 0건
- precondition 불일치 시 사용자 변경 보존 100%
- 실패 task rollback 성공률 100%
- CLI와 MCP receipt schema parity 100%

완료 기록 (2026-08-13):

- Core가 실행 가능한 `AgentPlan`, 7개 `AgentOperation` kind, 공통
  `ApplyReceipt`를 소유하며 CLI와 MCP는 같은 apply 함수를 호출한다.
- 모든 target은 exact scope와 write permission 안에 있어야 하며 project
  base revision, 존재 여부, 기존 파일 SHA-256 hash를 쓰기 전에 재검증한다.
- 쓰기 전에 touched-file snapshot을 만들고 UTF-8 effect를 atomic rename으로
  적용한다. 기본 automatic policy는 operation/필수 verify 실패 시 적용된
  파일을 역순 복원한다.
- receipt는 operation 결과, changed files, verify checks/diagnostics,
  rollback ID를 기록한다. 같은 plan/idempotency key는 저장된 receipt를
  replay하며 중복 write를 만들지 않는다.
- `agent repair --rollback <id> --apply`가 성공 receipt를 복원한다. apply 후
  달라진 파일은 conflict로 남기고 사용자 변경을 보존한다.
- release gate의 20개 route/API/contract/guard/file/generated task는 20/20
  성공했고 scope 밖 write 0건이었다. 실패 주입 rollback 5/5, stale
  precondition 사용자 변경 보존 5/5를 확인했다.

### Phase 5. Evidence and v1 beta — 2주

작업:

- SaaS dashboard, contract CRUD, interactive app 세 reference app 완성
- Getting Started와 Agent-Safe Workflow 중심으로 docs IA 재작성
- compatibility removal guide와 codemod 공개
- fresh install, frozen install, Windows/Linux/macOS matrix 실행
- release/version drift를 0으로 만든 뒤 beta release

Exit gate:

- 세 reference app Golden Path 통과
- clean checkout `check:publish` green
- CI flaky rate 0.5% 미만
- 문서의 command/tool/export 수치 drift 0
- 공개 beta에서 알려진 P0 correctness issue 0

구현 완료 기록 (2026-08-13):

- `auth-starter`, `todo-app`, public `realtime-chat` template을 각각 SaaS
  dashboard, contract CRUD, interactive realtime reference로 고정했다.
- `test:reference-apps`가 격리된 app에서 build → check → start 후 auth
  redirect, CRUD JSON, realtime health/messages 계약을 검증하며 3/3 통과했다.
- reference 복사본은 `.env`, DB, generated output을 제외한다. realtime은
  public create 경로와 fresh third-party install을 사용한다.
- production handler registration과 prerender HTTP 오류가 build 성공으로
  오인되던 경로를 차단했다. auth demo의 generated repo 직접 import와
  realtime template Guard cross-slice 오류도 제거했다.
- CI는 Linux/Windows/macOS에서 frozen workspace install 후 fresh smoke와
  세 reference gate를 실행한다. stable test retry를 제거해 flaky failure를
  숨기지 않는다.

릴리스 보류 항목:

- Changesets version 적용 전이라 npm version/metadata drift 3건이 남아 있다.
- clean-checkout 다중 OS CI와 누적 flaky rate는 원격 CI 결과로 확인해야 한다.
- 따라서 실제 `version`, beta tag, npm publish는 별도 릴리스 권한 단계다.

---

## 7. 호환성과 릴리즈 정책

빅뱅 삭제를 피하기 위해 세 단계로 이행한다.

### R1 — Freeze

- 새 surface 추가 금지
- deprecated 대상에 status metadata 추가
- 기존 동작 유지

### R2 — Converge

- 공식 docs/help에서 제거
- 새 action으로 forwarding하고 warning 출력
- migration codemod 제공
- Labs dependency optional화

### v1 beta — Remove

- deprecated command/export/tool 제거
- Labs를 별도 설치로 분리
- migration guide와 명시적인 breaking changes 제공

각 package의 현재 버전이 다르므로 날짜가 아닌 compatibility manifest로 제거 대상을 추적한다.

```json
{
  "schemaVersion": 1,
  "surface": "cli:deploy",
  "replacement": "artifact-contract",
  "state": "deprecated",
  "removeIn": "v1-beta"
}
```

---

## 8. 품질 Scorecard

| 영역 | Metric | v1 beta gate |
|---|---|---:|
| Build consistency | mixed generation under injected failures | 0 / 100 |
| Agent safety | writes outside approved scope | 0 |
| Agent execution | representative task success | >= 85% |
| Recovery | rollback success after failed apply | 100% |
| Release | clean checkout publish gate | green |
| Install | supported OS frozen install | green |
| Flakiness | CI flaky rate | < 0.5% |
| API surface | Core export entries | 10~12 |
| CLI surface | official commands | 6 |
| MCP surface | default tools | <= 8 |
| Docs | known command/tool/export drift | 0 |
| Performance | missing/invalid measurements marked pass | 0 |

기능 완료 체크박스는 위 scorecard를 대체하지 못한다.

---

## 9. 첫 구현 배치

Phase 1의 첫 PR 묶음은 다음 순서를 따른다.

1. `BuildGeneration` 상태 모델과 failure-injection test
2. client build staging directory와 generation manifest
3. 검증 성공 후 publish/swap
4. dev server가 active generation만 서빙하도록 변경
5. Guard/build diagnostic을 overlay와 terminal에 동일하게 전달
6. port collision preflight/fatal summary
7. performance measurement validity gate

첫 배치에는 package 이동, command 삭제, 새 기능을 섞지 않는다. reliability가 green이 된 뒤 surface convergence를 시작한다.

---

## 10. 기존 계획과의 관계

| 문서 | 처리 |
|---|---|
| `02_agent_native_framework_strategy.md` | 정체성의 역사적 근거. 범위와 우선순위는 새 constitution이 대체 |
| `17_agent_native_launch_plan.md` | launch보다 refoundation을 먼저 수행하므로 Superseded |
| `19_code_quality_upgrade_plan.md` | 완료된 기술 자산의 증거로 유지. 새 scorecard가 완료 판단을 대체 |
| `20_agent_surface_consolidation_plan.md` | safe v1 agent surface의 기반. dry-run apply를 Phase 4에서 완성 |
| `21_hydration_runtime_quality_plan.md` | Phase 1 Runtime Confidence 하위 계획으로 유지 |

새로운 active roadmap은 이 문서 하나다. 세부 RFC는 반드시 이 문서의 Phase와 exit gate를 참조해야 한다.
