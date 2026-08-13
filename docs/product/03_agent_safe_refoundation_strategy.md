# Mandu Agent-Safe Refoundation Strategy

작성일: 2026-08-13
상태: Accepted product constitution
대상: Mandu v0.x -> focused v1 beta
실행 계획: `docs/plans/22_mandu_refoundation_execution_plan.md`

이 문서는 `02_agent_native_framework_strategy.md`의 정체성을 계승하되 제품 범위와 우선순위를 다시 정의한다. 기존 문서와 충돌할 때 이 문서가 우선한다.

---

## 0. 결정

Mandu의 제품 정체성은 **Agent-Safe Fullstack Framework**다.

> Mandu is the Bun and React fullstack framework that keeps architecture, contracts, and build state safe while AI agents change code.

한국어 정의:

> Mandu는 AI 에이전트가 반복적으로 코드를 수정해도 아키텍처, 계약, 빌드 상태가 무너지지 않도록 설계된 Bun+React 풀스택 프레임워크다.

`Fullstack`은 제품의 기반이고 `Agent-Safe`가 선택 이유다. Mandu는 기능 수, 배포 플랫폼 수, MCP tool 수로 경쟁하지 않는다.

### 0.1 사용자가 고용하는 일

감독자형 개발자가 에이전트에게 실제 애플리케이션 변경을 맡기면서 다음 질문에 확실히 답하게 한다.

1. 에이전트가 무엇을 이해하고 어떤 변경을 계획했는가?
2. 허용된 파일과 계약만 변경했는가?
3. 변경 후 아키텍처, 런타임, 테스트가 여전히 유효한가?
4. 실패하면 이전의 일관된 상태로 돌아갈 수 있는가?

### 0.2 v1 비목표

Mandu v1은 다음 제품이 아니다.

- 클라우드 배포 플랫폼 또는 배포 오케스트레이터
- 모든 런타임과 모든 Edge provider를 지원하는 범용 adapter 모음
- 범용 테스트 자동화 제품
- 범용 AI 채팅 또는 로컬 LLM 제품
- 비개발자가 완전 자율 에이전트로 앱을 만드는 no-code 제품
- 인증, DB, 이메일, CMS, SEO 기능을 모두 내장한 application suite

---

## 1. v1 제품 보장

Mandu v1은 기능 목록 대신 아래 보장을 판매한다.

### 1.1 Valid build only

- 빌드 산출물은 generation 단위로 생성하고 검증 후 교체한다.
- HTML, client chunk, manifest는 항상 같은 generation을 가리킨다.
- Guard 또는 build 실패 중에 반쪽 산출물이나 서로 다른 generation을 섞어 서빙하지 않는다.
- 실패 원인은 터미널과 브라우저에서 같은 diagnostic으로 보인다.

### 1.2 Architecture and contract preservation

- 파일시스템 route가 애플리케이션 구조의 원천이다.
- import boundary와 API contract는 machine-readable 규칙으로 검증한다.
- 위반은 `code`, `file`, `range`, `reason`, `suggestedAction`을 가진 structured diagnostic으로 반환한다.
- generated artifact는 직접 수정하지 않고 항상 재생성 가능해야 한다.

### 1.3 Controlled agent mutation

- 공식 흐름은 `context -> plan -> apply -> verify -> repair`다.
- `apply`는 자유 형식 shell 실행이 아니라 typed operation을 실행한다.
- 각 operation은 범위, precondition, 예상 effect, 검증, rollback 정보를 가진다.
- 변경 결과는 사람이 검토할 수 있는 receipt로 남는다.

### 1.4 Standard production artifact

- `mandu build`는 재현 가능한 Bun 애플리케이션 산출물을 만든다.
- `mandu start`로 동일 산출물을 로컬에서 검증할 수 있다.
- Dockerfile 예제와 artifact contract는 제공한다.
- provider 인증, 배포 실행, 배포 상태 관리는 Mandu core의 책임이 아니다.

---

## 2. 공식 Golden Path

v1의 공식 사용자 여정은 하나다.

```text
create -> dev -> page/API -> agent change -> verify -> build -> start
```

세부 흐름:

1. `mandu create app`
2. `mandu dev`
3. 일반 파일 규약으로 page와 API를 작성한다.
4. `mandu agent context`와 `mandu agent plan`으로 변경 범위를 만든다.
5. `mandu agent apply`가 승인된 typed operation을 실행한다.
6. `mandu agent verify`가 Guard, contract, targeted test, build 상태를 검증한다.
7. 실패 시 `mandu agent repair`가 제한된 수정 또는 rollback을 제안한다.
8. `mandu build && mandu start`로 production artifact를 확인한다.

다음 항목은 Golden Path에 들어가지 않는다.

- provider deploy
- ATE test generation/heal
- Kitchen supervisor UI
- AI chat/brain
- desktop target
- DB migration framework
- resource/slot/codegen 고급 흐름

---

## 3. 목표 아키텍처

```text
Application files
      |
      v
+---------------- Mandu Product ----------------+
| Runtime kernel                                |
|   router | SSR/islands | API | middleware     |
|                                               |
| Safety kernel                                 |
|   contract | guard | build generation | tx    |
|                                               |
| Agent action API                              |
|   context | plan | apply | verify | repair    |
+---------------------+-------------------------+
                      |
          +-----------+-----------+
          |           |           |
         CLI         MCP      generated skills

Labs: ATE | Kitchen | Playground | Edge | AI Brain
External: cloud deployment providers
```

핵심 규칙은 **같은 동작을 CLI, MCP, Skill에서 각각 구현하지 않는 것**이다. 제품 로직은 Runtime/Safety/Agent action API에 있고 CLI와 MCP는 adapter다.

### 3.1 의존 방향

허용:

```text
cli    -> core action/runtime APIs
mcp    -> core action APIs
labs   -> core public APIs
skills -> generated action catalog and docs
```

금지:

```text
core -> cli/mcp/ate/edge/skills
cli  -> mcp/ate/edge/skills
mcp  -> ate/skills runtime implementation
```

CLI는 Golden Path를 실행하는 독립 제품이어야 하며 MCP, ATE, Edge가 없어도 설치·개발·빌드·검증이 가능해야 한다.

---

## 4. 패키지 결정

| 현재 패키지 | 결정 | v1 역할 |
|---|---|---|
| `@mandujs/core` | 유지·축소 | Runtime, Safety, Agent action의 단일 구현 |
| `@mandujs/cli` | 유지·축소 | Golden Path와 agent action의 human adapter |
| `@mandujs/mcp` | 유지·박형화 | 같은 agent action을 MCP로 노출 |
| `@mandujs/skills` | 통합 | 독립 로직 없이 action catalog/docs에서 생성되는 배포물 |
| `@mandujs/ate` | Labs 이동 | 독립 실험 제품. CLI/MCP 기본 의존성에서 제거 |
| `@mandujs/edge` | Labs/adapter 이동 | v1 core 지원 범위에서 제거. 별도 호환성 정책 적용 |
| `@mandujs/playground-runner` | Labs 유지 | 공개 제품 약속에서 제외. backend 완성 전 private 유지 |

Labs 이동은 즉시 삭제를 뜻하지 않는다. 다음을 뜻한다.

- 기본 설치와 Golden Path에서 제외
- 공식 안정성 약속과 release gate에서 제외
- 별도 status label과 opt-in 설치
- maintainer와 성공 지표가 없으면 archive 후보

---

## 5. 공개 표면 예산

공개 표면은 기능이 아니라 유지해야 하는 장기 계약이다.

| 표면 | 현재 기준선 | v1 목표 |
|---|---:|---:|
| CLI top-level commands | 52 | 공식 help 6개 |
| Core export map entries | 112 | 10~12개 |
| Core stable exports | 68 | 최소 앱 작성 표면만 stable |
| MCP tool definitions | 약 137 | 기본 profile 8개 이하 |
| Skills | 두 트리에 28개 | 공식 6개 이하, 한 source에서 생성 |

목표 수치는 품질 게이트다. 새 표면을 추가하려면 기존 표면 통합 또는 명시적인 product constitution 변경이 필요하다.

### 5.1 Core export 목표

v1 후보:

```text
@mandujs/core
@mandujs/core/client
@mandujs/core/config
@mandujs/core/contract
@mandujs/core/error
@mandujs/core/guard
@mandujs/core/middleware
@mandujs/core/plugins
@mandujs/core/router
@mandujs/core/runtime
@mandujs/core/testing
```

root export는 app author가 일상적으로 사용하는 primitive만 제공한다. compiler, bundler, generator, lockfile, watcher, runtime server 내부 구현은 공개하지 않는다.

### 5.2 기능 등급

| 등급 | 기능 |
|---|---|
| Core | routes, SSR/islands, API, middleware, dev/build/start, config |
| Safety | contract, Guard, structured diagnostics, transaction, atomic build generation |
| Agent | context, plan, typed apply, verify, repair, receipt/rollback |
| Extension/recipe | auth, session, DB, realtime, content, email, i18n, SEO, storage, observability |
| Labs | ATE, Kitchen, Playground, Edge, desktop, design copilot, AI brain/chat |
| Retire | deploy execution, deploy planning, provider credential management |

Extension 코드는 당장 제거하지 않아도 되지만 root export, Quickstart, 기본 CLI help에서 빠져야 한다.

---

## 6. Agent Action Contract

CLI와 MCP가 공유할 최소 계약은 다음과 같다.

```ts
interface AgentPlan {
  schemaVersion: 1;
  id: string;
  intent: string;
  baseRevision: string;
  scope: string[];
  permissions: AgentPermission[];
  operations: AgentOperation[];
  verification: VerificationStep[];
}

interface AgentOperation {
  id: string;
  kind: OperationKind;
  target: string;
  precondition: { contentHash?: string; exists?: boolean };
  effect: Record<string, unknown>;
  rollback: RollbackDescriptor;
}

interface ApplyReceipt {
  schemaVersion: 1;
  planId: string;
  baseRevision: string;
  startedAt: string;
  completedAt: string;
  operations: OperationReceipt[];
  changedFiles: string[];
  verification: VerificationResult[];
  rollbackId: string;
}
```

초기 `OperationKind`는 작게 시작한다.

```text
file.create
file.patch-with-hash
route.create
api.create
contract.update
guard.safe-fix
generated.refresh
```

임의 shell command, provider deploy, arbitrary recursive delete는 v1 typed apply에 포함하지 않는다.

### 6.1 Apply 불변 조건

1. plan의 `baseRevision`과 현재 project revision이 다르면 중단한다.
2. target이 plan scope 밖이면 중단한다.
3. precondition hash가 다르면 사용자 변경으로 간주하고 중단한다.
4. 모든 write 전에 rollback snapshot을 만든다.
5. write 후 지정된 verification을 실행한다.
6. verification 실패 시 receipt에 실패를 기록하고 자동 rollback 여부를 정책에 따라 결정한다.
7. 같은 plan과 idempotency key의 재실행은 중복 변경을 만들지 않는다.

---

## 7. CLI와 MCP 목표 표면

### 7.1 공식 CLI

```text
mandu create
mandu dev
mandu build
mandu start
mandu check
mandu agent <context|plan|apply|verify|repair|sync>
```

고급 명령은 호환 기간 동안 동작할 수 있지만 global help와 Quickstart에는 나오지 않는다. `guard`, `contract`, `routes`, `test` 같은 저수준 동작은 `check`와 `agent`가 내부적으로 호출한다.

### 7.2 기본 MCP profile

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

저수준 domain tool은 내부 handler 또는 opt-in Labs profile로 이동한다. tool 수가 제품 가치를 나타내지 않는다.

### 7.3 공식 Skills

```text
mandu-agent-workflow
mandu-fs-routes
mandu-contract
mandu-hydration
mandu-guard
mandu-testing
```

Skills는 action catalog와 canonical docs에서 생성한다. `packages/skills/skills`와 MCP resource skill을 독립적으로 편집하지 않는다.

---

## 8. 문서 정보 구조

공식 문서는 사용자 여정과 안정성 순으로 구성한다.

```text
Getting Started
Agent-Safe Workflow
Core Concepts
  Routes and API
  SSR and Islands
  Contracts
  Guard
Reference
Recipes
Labs
Migration
Archive
```

로드맵과 phase 문서는 공식 기능 문서에서 분리한다. 완료된 계획은 역사 기록이지 현재 제품 계약이 아니다.

---

## 9. Definition of Done

Mandu v1 beta는 다음 조건을 모두 만족할 때만 선언한다.

- Golden Path가 세 reference app에서 재현된다.
- Guard/build 실패 주입 100회에서 mixed generation이 0건이다.
- fresh install과 frozen lockfile install이 지원 OS에서 통과한다.
- 기본 CLI help가 공식 명령 6개만 강조한다.
- Core export map이 10~12개로 축소되고 migration guide가 있다.
- 기본 MCP profile이 8개 이하이며 write는 `agent.apply/repair`로 집중된다.
- 20개 대표 agent task에서 apply 성공률 85% 이상이다.
- 실패 task의 rollback 성공률은 100%다.
- 승인 scope 밖 write는 0건이다.
- 성능 측정 누락 또는 비정상 0값이 pass로 처리되지 않는다.
- release gate가 버전/의존성 drift 없이 green이다.

---

## 10. 결정 로그

| 날짜 | 결정 | 이유 |
|---|---|---|
| 2026-08-13 | Agent-Native를 Agent-Safe 제품 보장으로 구체화 | 기능 명칭보다 사용자가 신뢰할 수 있는 결과가 필요함 |
| 2026-08-13 | 배포 실행을 v1 비목표로 지정 | 표준 artifact 생성과 provider 운영은 다른 제품 책임임 |
| 2026-08-13 | ATE, Kitchen, Playground, Edge를 Labs로 격리 | core 완성도보다 확장 표면이 먼저 커진 상태를 교정 |
| 2026-08-13 | CLI/MCP/Skills를 단일 Agent Action API의 adapter로 정의 | 중복 구현과 문서 drift 제거 |
| 2026-08-13 | 빅뱅 rewrite 대신 단계적 치환 채택 | 기존 테스트 자산을 유지하면서 제품 경계를 바꾸기 위함 |
