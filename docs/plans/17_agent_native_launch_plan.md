# 17. Agent-Native Framework Launch Plan

작성일: 2026-05-01  
상태: Superseded by `22_mandu_refoundation_execution_plan.md`
기준 문서: `docs/product/02_agent_native_framework_strategy.md`

> 2026-08-13: 공개 launch보다 제품 범위 축소와 reliability 복구를 먼저 수행한다. 완료된 항목의 역사적 기록으로만 유지한다.

---

## 0. 목표

Mandu를 "기능이 많은 Bun 프레임워크"가 아니라 **에이전트 네이티브 개발 프레임워크**로 보이게 만든다.

이 계획의 완료 상태:

1. 사용자는 Mandu의 한 줄 가치를 바로 이해한다.
2. `mandu init` 후 10분 안에 공식 golden path를 경험한다.
3. 에이전트 작업 흐름이 문서, CLI, MCP, Guard, ATE, Kitchen으로 연결된다.
4. 릴리즈 전 품질 게이트가 명확하다.
5. 데모/문서/CI/perf가 같은 기준 앱과 같은 메시지를 바라본다.

---

## 1. P0 Workstreams

### P0-A. Product Message Unification

목표: 모든 첫 화면이 같은 포지션을 말한다.

작업:

1. `README.md` 첫 설명을 "Agent-Native Fullstack Framework" 기준으로 정리한다.
2. `README.ko.md`도 같은 메시지로 맞춘다.
3. `docs/README.md`, `docs/README.ko.md`에 product strategy와 launch plan을 연결한다.
4. `packages/cli/README.md`와 CLI help의 용어를 점검한다.
5. `AI-native`와 `Agent-native` 표현을 정리한다.

완료 기준:

- 루트 README, docs README, CLI README가 같은 한 줄 정의를 사용한다.
- "공식 경로"와 "확장 경로"가 문서에서 분리된다.
- `rg "AI-native|AI native|Agent-native|Agent-Native"` 결과가 의도된 표현으로 정리된다.

검증:

```bash
rg "AI-native|AI native|Agent-native|Agent-Native" README.md README.ko.md docs packages/cli
```

### P0-B. Golden Path Quickstart

목표: 신규 사용자가 10분 안에 "Mandu는 agent-native다"를 경험한다.

공식 흐름:

```text
install -> init -> dev -> page -> API/contract -> island -> guard -> build -> start -> smoke/perf note
```

작업:

1. `docs/guides/00_quickstart.md` 또는 기존 quickstart를 이 흐름으로 정리한다.
2. 한국어 문서 `docs/guides/00_quickstart.ko.md`를 추가하거나 `README.ko.md`와 연결한다.
3. `demo/starter`가 quickstart와 같은 구조를 대표하는지 확인한다.
4. `mandu init` 기본 템플릿 README가 같은 흐름을 말하게 한다.
5. Quickstart 마지막에 "에이전트에게 맡길 다음 작업" 예시를 넣는다.

완료 기준:

- Quickstart 명령을 새 폴더에서 그대로 실행할 수 있다.
- 명령, 포트, 파일 경로가 루트 README와 일치한다.
- page/API/island/build/start까지 이어진다.

검증:

```bash
bun run test:smoke
```

### P0-C. Agent Workflow Guide

목표: 에이전트가 Mandu 프로젝트에서 따라야 할 공식 작업 루프를 만든다.

Canonical guide: `docs/guides/07_agent_workflow.md`

공식 루프:

```text
plan -> scoped edit -> guard/contract -> test/smoke -> perf if relevant -> report -> human approval
```

작업:

1. `docs/guides/agent-workflow.md`를 추가한다.
2. MCP 사용 경로와 직접 CLI 사용 경로를 나눠 설명한다.
3. Guard violation, contract mismatch, hydration failure의 대응 순서를 문서화한다.
4. ATE가 언제 개입하는지 명확히 한다.
5. Kitchen은 "감독자 대시보드"로 설명한다.

완료 기준:

- 에이전트에게 그대로 줄 수 있는 workflow prompt가 있다.
- 각 단계마다 실행 명령과 기대 산출물이 있다.
- 실패 시 다음 행동이 명확하다.

검증:

```bash
bun run lint
bun run typecheck
```

### P0-D. Release Confidence

목표: 다음 release가 제품 메시지와 품질 게이트를 함께 싣는다.

작업:

1. 최근 changeset을 기준으로 릴리즈 노트 초안을 작성한다.
2. `bun run version` 전에 실행할 release checklist를 문서화한다.
3. `perf:ci` 결과를 release confidence에 포함한다.
4. pre-publish check 결과가 릴리즈 문서에 반영되도록 한다.
5. 릴리즈 전 demo smoke를 필수로 둔다.

완료 기준:

- release checklist가 문서로 있다.
- `changeset status`에서 의도한 patch bump가 보인다.
- release 전 검증 명령 세트가 명확하다.

권장 release gate:

```bash
bun changeset status
bun run lint
bun run typecheck
bun run test:smoke
bun run test:packages
bun run perf:ci
bun run check:publish
```

### P0-E. Golden Demo

목표: Mandu의 대표 데모를 기능 나열이 아니라 agent-native loop로 재구성한다.

작업:

1. `demo/starter`를 공식 golden demo 후보로 고정할지 결정한다.
2. 데모가 page/API/island/contract/guard/build/start를 모두 보여주는지 점검한다.
3. `tests/perf/perf-baseline.json` active scenario와 demo 설명을 맞춘다.
4. Kitchen/MCP/ATE 중 최소 하나를 데모 흐름에 연결한다.
5. landing/docs에서 이 데모를 첫 번째 예시로 사용한다.

완료 기준:

- 데모 하나가 README, docs, smoke, perf 중 최소 세 곳에서 동일하게 참조된다.
- 데모 실행 결과가 신규 사용자에게 agent-native 가치를 보여준다.

검증:

```bash
bun run perf:ci
bun run test:smoke
```

---

## 2. P1 Workstreams

### P1-A. Agent Evaluation Evidence

목표: "Mandu는 AI 에이전트 작업을 더 안전하게 만든다"를 증거로 보여준다.

작업:

1. ATE로 대표 task suite를 만든다.
2. 에이전트가 만든 변경에 대해 guard/test/contract/perf가 잡은 문제를 report로 저장한다.
3. 실패 유형을 architecture, contract, runtime, test gap, perf regression으로 분류한다.
4. public 가능한 sample report를 만든다.

지표:

- 에이전트 작업 10개 중 guard/test가 발견한 실제 문제 수
- 자동 수정 또는 guided fix 성공률
- human review 전에 차단된 regression 수

### P1-B. Kitchen as Supervisor UI

목표: Kitchen을 devtools가 아니라 감독자 경험으로 정리한다.

Direction: `docs/devtools/AGENT_DEVTOOLS_PLAN.md`

작업:

1. Kitchen 문서 첫 문장을 supervisor dashboard로 바꾼다.
2. route, diff, guard, metrics, activity를 하나의 review flow로 묶는다.
3. timeout/error 상태를 명확하게 표시한다.
4. Kitchen 관련 smoke 또는 targeted tests를 보강한다.
5. AI OAuth brain status, prompt builder, next safe action을 Agent DevTools 방향으로 설계한다.

지표:

- Kitchen 관련 flaky test 0
- diff/guard/activity API response time budget 문서화
- DevTools가 관련 skill/MCP tool/validation command를 추천하는 category coverage

### P1-C. Docs IA Cleanup

목표: 기능 문서가 많아도 신규 사용자가 길을 잃지 않게 한다.

작업:

1. docs index를 Learn / Build / Agent Workflow / Reference / Operations로 재분류한다.
2. legacy/experimental 문서에 status label을 붙인다.
3. duplicate roadmap을 current/archived로 나눈다.
4. 한국어/영어 핵심 문서의 우선순위를 정한다.

---

## 3. 4주 실행 순서

### Week 1: Message and Quickstart

- Product message unification
- Quickstart 작성
- Agent workflow guide 초안
- README/docs index 연결

Exit criteria:

- 신규 사용자가 공식 경로를 읽고 실행할 수 있다.
- "Agent-Native" 포지션이 모든 첫 화면에 보인다.

### Week 2: Demo and Release Confidence

- Golden demo 확정
- Release checklist 작성
- demo smoke/perf 연결 확인
- changeset/release note 정리

Exit criteria:

- release 전 검증 명령 세트가 고정된다.
- demo가 smoke/perf/docs와 연결된다.

### Week 3: Agent Evidence

- ATE task suite 초안
- agent workflow prompt 정리
- sample report 생성
- MCP workflow 문서화

Exit criteria:

- "agent-native" 주장을 보여주는 report artifact가 있다.

### Week 4: Supervisor Experience

- Kitchen supervisor 문서화
- Kitchen targeted test 안정화
- docs IA cleanup 1차
- landing/product copy 초안
- Agent DevTools context pack / prompt builder 설계 확정

Exit criteria:

- Mandu가 프레임워크 + agent control plane으로 설명된다.
- DevTools가 상황별 지식, 프롬프트, next action을 전달하는 제품 방향으로 정리된다.

---

## 4. 지금 바로 할 다음 작업

우선순위:

1. `docs/guides/00_quickstart.md` 작성
2. `docs/guides/agent-workflow.md` 작성
3. README/docs index에 product strategy 연결
4. release checklist 작성
5. golden demo 후보 검증
6. Agent DevTools context pack과 prompt builder 설계 구체화

권장 다음 커밋 단위:

```text
docs: define agent-native product direction
docs: add agent workflow and quickstart
docs: add release confidence checklist
```

---

## 5. 리스크와 대응

| 리스크 | 영향 | 대응 |
---|---|---|
| 기능이 많아 메시지가 흐려짐 | 신규 사용자 이탈 | golden path를 첫 화면에 고정 |
| agent-native가 추상 문구로 보임 | 차별점 약화 | Guard/MCP/ATE/Kitchen/perf 결과를 데모에 연결 |
| docs가 오래된 roadmap과 충돌 | 신뢰 하락 | current/archived status를 붙이고 index 재정리 |
| release가 품질 게이트와 분리됨 | 프레임워크 신뢰 하락 | release checklist에 smoke/perf/publish check 포함 |
| 데모가 실제 CI와 다름 | 재현성 약화 | demo, smoke, perf scenario를 같은 기준 앱으로 맞춤 |
