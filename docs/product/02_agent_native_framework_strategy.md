# Mandu Agent-Native Framework Strategy v1

작성일: 2026-05-01  
상태: Superseded by `03_agent_safe_refoundation_strategy.md`
대상: Mandu v0.x -> agent-native fullstack framework

> 2026-08-13: 이 문서는 Agent-Native 정체성의 역사적 근거로 유지한다. 현재 제품 범위, 비목표, 공개 표면 예산은 `03_agent_safe_refoundation_strategy.md`가 대체한다.

---

## 0. 결정

Mandu의 제품 정체성은 **Agent-Native Fullstack Framework**다.

한 줄 정의:

> Mandu is the fullstack framework for building production apps with AI agents without losing architecture, contracts, runtime safety, or release confidence.

한국어 정의:

> Mandu는 AI 에이전트가 코드를 작성해도 아키텍처, 계약, 런타임 안정성, 릴리즈 신뢰도가 무너지지 않도록 설계된 풀스택 프레임워크다.

이 정의는 단순한 마케팅 문구가 아니다. Mandu의 우선순위, 문서, CLI, MCP, ATE, Guard, Kitchen, 성능 게이트가 모두 이 문장으로 수렴해야 한다.

---

## 1. 문제

AI 코딩은 빠르지만, 프로젝트의 장기 품질을 자동으로 지켜주지 않는다.

현재 일반적인 AI 개발 흐름의 문제:

1. 에이전트가 파일을 빠르게 만들지만, 구조 경계와 import 규칙을 자주 흔든다.
2. API contract, runtime behavior, docs, tests가 서로 따로 drift된다.
3. 수정은 빠른데 검증 루프가 약해서 "될 것 같은 코드"가 main에 들어간다.
4. 감독자는 에이전트가 무엇을 바꿨고 무엇을 검증했는지 추적하기 어렵다.
5. 프레임워크는 앱을 만드는 도구일 뿐, 에이전트를 안전하게 운용하는 개발 시스템은 아니다.

Mandu가 해결할 본질:

> AI가 코드를 쓰는 속도보다, AI가 작업해도 프로젝트가 망가지지 않는 구조를 제공한다.

---

## 2. 타깃 사용자

### Primary: 감독자형 개발자

사람은 방향, 리뷰, 릴리즈 판단을 맡고, 에이전트는 반복 구현과 검증 루프를 맡는 팀.

대표 사용자:

- 1인 창업자 또는 작은 제품팀
- AI 코딩 도구를 매일 쓰는 풀스택 개발자
- 내부 도구, SaaS, 운영 대시보드를 빠르게 만들지만 구조 붕괴를 싫어하는 팀
- 에이전트에게 작업을 맡기되 main branch와 배포 품질은 직접 책임지는 기술 리드

### Secondary: 프레임워크 평가자

새 프레임워크를 도입할 때 다음을 보는 사람:

- Quickstart가 실제로 작동하는가
- 배포 가능한 앱이 만들어지는가
- 테스트/성능/보안 기본기가 있는가
- Next.js, Remix, Astro, Hono 대신 쓸 이유가 명확한가

### Non-goal

Mandu v1의 목표는 "비개발자가 완전 자율 에이전트로 앱을 만든다"가 아니다. v1의 현실적인 목표는 **숙련 개발자가 에이전트를 안전하게 감독할 수 있는 프레임워크**다.

---

## 3. 제품 원칙

### 3.1 Architecture Preservation

에이전트가 코드를 생성해도 구조가 유지되어야 한다.

관련 자산:

- Guard presets
- custom guard rules
- generated/source boundary
- filesystem route conventions
- package-level lint/typecheck/test gates

제품 요구:

- 구조 위반은 빠르게 탐지되어야 한다.
- 에러는 rule id, file, reason, fix hint를 가져야 한다.
- "어디에 코드를 써야 하는가"가 문서와 CLI에서 명확해야 한다.

### 3.2 Contract-First Confidence

API, resource, filling, client call은 런타임과 타입 양쪽에서 같은 계약을 봐야 한다.

관련 자산:

- `contract`
- `filling`
- OpenAPI generation
- typed RPC/client
- ATE contract prompt and test generation

제품 요구:

- 계약 변경이 docs/test/client/runtime 중 하나만 바꾸는 상태를 막아야 한다.
- Quickstart 안에서 첫 API route와 첫 contract validation까지 보여줘야 한다.

### 3.3 Agent Control Plane

Mandu는 에이전트가 직접 조작할 수 있는 프레임워크여야 한다.

관련 자산:

- `@mandujs/mcp`
- MCP tool profiles
- transaction locking
- `@mandujs/skills`
- ATE auto-heal and reports
- Kitchen supervisor UI

제품 요구:

- 에이전트가 "파일을 막 수정"하는 것이 아니라 Mandu의 공식 도구를 통해 작업하게 해야 한다.
- 감독자는 MCP/Guard/ATE/Kitchen 결과를 보고 승인할 수 있어야 한다.

### 3.4 Runtime Confidence

프레임워크는 런타임 실패를 예측 가능하게 다뤄야 한다.

관련 자산:

- runtime status-code policy
- static asset cache policy
- hydration benchmark
- `perf:ci`
- smoke tests
- pre-publish check

제품 요구:

- 404/500/static asset/cache/hydration failure 정책이 문서와 테스트로 고정되어야 한다.
- "빠르다"가 아니라 "회귀를 잡는다"가 제품 메시지여야 한다.

### 3.5 Golden Path First

Mandu의 기능은 넓지만, 외부 사용자는 하나의 공식 길을 먼저 경험해야 한다.

공식 경로:

```text
install -> init -> dev -> page -> api/contract -> guard -> test/smoke -> build -> start -> perf gate
```

확장 경로:

- MCP automation
- ATE test generation
- resource workflow
- Kitchen supervisor loop
- deploy targets
- custom guard presets

---

## 4. 포지셔닝

### Category

Mandu는 "Bun framework"만으로 설명하면 약하다. 더 정확한 카테고리는 다음이다.

> Agent-native fullstack framework for supervised AI development.

### Competitor framing

| 비교 대상 | 사용자가 기대하는 것 | Mandu가 이겨야 하는 지점 |
|---|---|---|
| Next.js | 가장 검증된 React fullstack | 에이전트 작업의 구조 보존, MCP/Guard/ATE 일체화 |
| Remix | 웹 표준과 data mutation | contract + guard + agent loop의 공식화 |
| Astro | island 기반 성능 | island 성능 + agent-safe fullstack workflow |
| Hono/Elysia | Bun/server API 속도 | API만이 아니라 앱/문서/검증/에이전트 제어까지 포함 |
| Rails/Laravel | 생산성 높은 규약 | AI 시대의 규약: agent가 따라야 하는 구조와 검증 |

Mandu가 직접 경쟁하면 안 되는 영역:

- "Next.js보다 기능이 더 많다"
- "가장 빠른 HTTP router다"
- "비개발자가 클릭만으로 앱을 만든다"

Mandu가 이겨야 하는 메시지:

> You can delegate more code to agents because Mandu makes the architecture observable, enforceable, and testable.

---

## 5. 제품 표면

### 5.1 CLI

CLI는 사용자의 첫 제품 경험이다.

필수 메시지:

- `mandu init`: 공식 golden path의 시작
- `mandu dev`: Kitchen 포함 supervisor mode
- `mandu guard-check`: architecture preservation
- `mandu contract`: contract confidence
- `mandu test` 또는 documented test path: generated verification
- `mandu build`: production bundle and prerender
- `mandu start`: production runtime
- `mandu mcp`: agent control plane

### 5.2 Docs

문서 구조는 "기능 목록"보다 "사용자 여정"을 먼저 보여줘야 한다.

우선 문서:

1. Quickstart: 10분 안에 page + API + island + build
2. Agent Workflow: 에이전트에게 작업을 맡기는 공식 흐름
3. Architecture Guardrails: Guard가 무엇을 막는지
4. Contract Workflow: contract -> validation -> OpenAPI
5. Performance Gates: perf baseline/budget이 왜 필요한지
6. Release Confidence: smoke, typecheck, publish check

### 5.3 Demo

대표 데모는 기능 쇼케이스가 아니라 "Mandu가 왜 agent-native인지"를 보여줘야 한다.

10분 데모 플로우:

1. `mandu init agent-demo`
2. page 수정
3. API route 추가
4. contract validation
5. island 추가
6. guard check
7. build/start
8. perf/smoke result 확인
9. MCP/Kitchen으로 변경 내용 추적

완료 감각:

> "에이전트가 작업해도 이 프레임워크는 어디가 바뀌었고 무엇이 안전한지 보여준다."

### 5.4 Agent DevTools

Kitchen DevTools는 Mandu의 agent-native 포지션을 제품으로 체감하게 만드는 핵심 표면이다.

방향:

- Kitchen은 단순 디버깅 패널이 아니라 **Agent DevTools / Supervisor Console**로 진화한다.
- AI OAuth로 연결된 brain adapter는 상황별 diagnosis와 prompt generation을 강화한다.
- DevTools는 현재 route, error, island, network, guard, contract, diff, perf 상태를 하나의 context pack으로 묶는다.
- DevTools는 "관련 엔지니어링 지식", "에이전트에게 줄 프롬프트", "지금 해야 할 다음 안전한 액션"을 제안한다.

제품 계약:

- Observe: 상태와 context를 보여준다.
- Suggest: skill, MCP tool, validation command를 추천한다.
- Assist: read-only MCP tool과 local validation을 실행한다.
- Act with approval: scaffold, patch, OAuth login/logout 같은 write action은 supervisor approval을 요구한다.

상세 계획: `docs/devtools/AGENT_DEVTOOLS_PLAN.md`

---

## 6. 지금 필요한 것

### P0. 제품 일관성

- README, docs README, CLI help, template README가 같은 메시지를 말해야 한다.
- "AI-native"와 "Agent-native" 표현을 하나로 정리해야 한다.
- 공식 경로와 실험/확장 경로를 분리해야 한다.

### P0. 신뢰 가능한 릴리즈

- 최근 hydration/build/perf gate fixes는 changeset과 함께 릴리즈 준비가 되어야 한다.
- `version -> publish` 전 `typecheck`, `lint`, `test:smoke`, `test:packages`, `check:publish`, `perf:ci`가 통과해야 한다.
- changelog는 "agent-native reliability" 관점으로 묶어야 한다.

### P0. Agent Workflow 문서

- 에이전트가 Mandu 프로젝트에서 따라야 할 공식 workflow가 필요하다.
- 예: plan -> transaction -> edit -> guard -> test -> perf/smoke -> report.

### P0. Agent DevTools 방향 고정

- Kitchen을 DevTools가 아니라 Agent DevTools / Supervisor Console로 재정의해야 한다.
- AI OAuth brain status, context pack, prompt builder, next safe action이 제품 계약으로 정리되어야 한다.
- MCP와 skills를 DevTools가 상황별로 추천해야 한다.

### P0. Golden demo

- `demo/starter` 또는 새 reference app을 agent-native demo로 고정해야 한다.
- 데모는 README, docs, perf baseline, smoke test가 모두 같은 앱을 바라봐야 한다.

### P1. 평가 체계

- ATE가 생성한 테스트와 실제 회귀 발견 사례를 공개 가능한 report로 만들어야 한다.
- "Mandu가 에이전트 작업을 더 안전하게 만든다"는 주장을 수치화해야 한다.

---

## 7. 성공 지표

### Product

- 신규 사용자가 10분 안에 page + API + build를 완료한다.
- README, docs, CLI help 간 기본 명령/포트/경로 불일치가 0건이다.
- 공식 demo가 smoke/perf/doc에서 동일하게 사용된다.

### Quality

- `main`은 `lint`, `typecheck`, `test:packages`, `test:smoke`, `check:publish`, `perf:ci`가 green인 상태를 유지한다.
- hydration benchmark가 unsupported를 남기는 대신 성공 시 실제 hydration metric을 수집한다.
- release 전 changeset 누락이 없다.

### Agent-Native

- MCP로 수행 가능한 공식 작업 목록이 docs와 일치한다.
- Guard violation은 fix hint를 포함한다.
- ATE report는 에이전트가 작성한 변경의 테스트 커버리지 gap을 보여준다.
- Kitchen은 감독자가 변경/상태/성능/guard 결과를 확인하는 UI로 설명된다.

---

## 8. 메시지 가이드

### 써야 하는 표현

- Agent-Native Fullstack Framework
- supervised AI development
- architecture preservation
- contract confidence
- runtime confidence
- guardrails for AI-written code
- agent control plane

### 피해야 하는 표현

- AI가 모든 것을 자동으로 만든다
- Next.js 대체재
- 가장 빠른 프레임워크
- no-code builder
- magic

---

## 9. 결정 로그

| 날짜 | 결정 | 이유 |
---|---|---|
| 2026-05-01 | Mandu의 핵심 포지션을 Agent-Native Fullstack Framework로 고정 | Guard, MCP, ATE, Skills, Kitchen, perf gates가 모두 이 방향으로 수렴함 |
| 2026-05-01 | Primary target을 감독자형 개발자로 고정 | 완전 자율 AI 앱 빌더보다 현재 repo 자산과 신뢰성 목표에 맞음 |
| 2026-05-01 | 기능 추가보다 golden path와 release confidence를 P0로 둠 | 프레임워크 신뢰는 표면 기능 수보다 재현 가능한 첫 경험과 green main에서 나옴 |
