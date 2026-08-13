# 20. Agent Surface Consolidation Plan

작성일: 2026-05-19
상태: Completed safe-v1 foundation; typed apply follow-up moved to Refoundation Phase 4
기준 문서:

- `docs/product/02_agent_native_framework_strategy.md`
- `docs/plans/17_agent_native_launch_plan.md`
- `docs/plans/22_mandu_refoundation_execution_plan.md`

---

## 0. 결정

Mandu의 다음 agent-native 작업은 기능 추가가 아니라 **에이전트가 보는 표면을 줄이고 묶는 작업**이다.

현재 Mandu는 MCP tools, CLI commands, skills, Guard, Doctor, Diagnose, Review, Fix, ATE, Kitchen 등 agent-facing 자산이 많다. 문제는 기능 부족이 아니라 다음이다.

1. 에이전트가 어떤 기능을 먼저 써야 하는지 모른다.
2. 비슷한 역할의 명령이 여러 개라 선택 비용이 높다.
3. 저수준 진단/복구 기능이 상위 workflow로 묶이지 않았다.
4. Codex, Claude Code, Gemini CLI가 같은 루프를 따르도록 강제하는 공식 agent surface가 없다.

따라서 Mandu는 "기능 많은 프레임워크"가 아니라 **에이전트가 길을 잃지 않는 프레임워크**가 되어야 한다.

---

## 1. 목표

에이전트가 Mandu 프로젝트에서 항상 같은 순서로 작업하게 만든다.

공식 agent loop:

```text
context -> plan -> apply -> verify -> repair
```

목표 상태:

1. 에이전트는 작업 시작 시 `context` 하나로 프로젝트 상태를 이해한다.
2. 변경 전 `plan`이 파일, 도메인, 위험, 검증 명령을 정리한다.
3. 생성/수정은 가능한 한 intent-level MCP tool 또는 CLI wrapper를 통해 수행한다.
4. 변경 후 `verify` 하나가 guard, diagnose, contract, tests, build 관련 신호를 묶어준다.
5. 실패 시 `repair`가 다음 액션과 안전한 자동수정 후보를 제공한다.
6. 기존 저수준 도구는 삭제하지 않고 `agent-*` 상위 표면 뒤로 숨긴다.

---

## 2. Non-goals

이번 계획의 목표가 아닌 것:

1. 모든 기존 CLI/MCP/skill을 제거하지 않는다.
2. 모든 repair를 자동 적용하지 않는다.
3. 사람용 CLI UX를 agent용 JSON UX로 대체하지 않는다.
4. 새 프레임워크 기능을 많이 추가하지 않는다.
5. 완전 자율 개발자를 목표로 하지 않는다.

목표는 숙련 개발자가 Codex, Claude Code, Gemini CLI 같은 에이전트를 더 안정적으로 감독할 수 있게 만드는 것이다.

---

## 3. 기능 등급

모든 CLI command, MCP tool, skill을 네 등급으로 재분류한다.

| 등급 | 의미 | 에이전트 노출 |
|------|------|---------------|
| Official Agent Path | 에이전트가 기본으로 따라야 하는 공식 경로 | 기본 노출 |
| Domain Tool | route, slot, hydration, contract, deploy 등 도메인별 작업 도구 | 필요 시 노출 |
| Internal Plumbing | diagnose, doctor, low-level scan, loop-close 등 상위 workflow 내부 부품 | 기본 숨김 |
| Deprecated/Legacy | 중복되었거나 새 경로로 대체될 기능 | 문서에서 제거 또는 경고 |

첫 재검수 산출물:

```text
docs/audits/agent-surface-inventory.md
```

필수 컬럼:

```text
Name
Kind: CLI | MCP | Skill | Doc | Runtime
Current purpose
Agent value
Overlap
Risk level
Recommended tier
New owner workflow
Migration note
```

---

## 4. Official Agent Path

에이전트에게 기본으로 보여줄 공식 기능은 다섯 개다.

### 4.1 context

목적: 프로젝트를 읽고 현재 작업 가능한 상태인지 요약한다.

CLI:

```bash
mandu agent context --json
```

MCP:

```text
mandu.agent.context
```

내부에서 사용하는 기존 자산:

- `mandu info --json`
- `mandu diagnose --json`
- `mandu.ai.brief`
- route manifest
- package versions
- guard preset
- skills inventory
- recent git state

출력 핵심:

```json
{
  "project": {},
  "routes": [],
  "apis": [],
  "partials": [],
  "slots": [],
  "contracts": [],
  "guards": {},
  "commands": {},
  "warnings": [],
  "recommendedWorkflow": []
}
```

### 4.2 plan

목적: 자연어 요구사항을 Mandu 작업 계획으로 변환한다.

CLI:

```bash
mandu agent plan "add authenticated dashboard" --json
```

MCP:

```text
mandu.agent.plan
```

출력 핵심:

```json
{
  "intent": "add authenticated dashboard",
  "domains": ["route", "api", "guard", "hydration"],
  "filesToRead": [],
  "filesToCreate": [],
  "filesToModify": [],
  "mcpTools": [],
  "risk": [],
  "verification": []
}
```

### 4.3 apply

목적: plan을 기반으로 안전한 intent-level 작업을 실행한다.

CLI:

```bash
mandu agent apply --from .mandu/agent-plan.json
```

MCP:

```text
mandu.agent.apply
```

원칙:

1. route/API/slot/partial/contract 생성은 저수준 파일 편집보다 MCP/domain tool을 우선한다.
2. 파일 직접 수정이 필요한 경우 plan에 근거가 있어야 한다.
3. destructive edit는 dry-run diff를 먼저 제공한다.

### 4.4 verify

목적: 변경 후 실행해야 할 검증을 하나의 agent-facing 결과로 묶는다.

CLI:

```bash
mandu agent verify --changed --json
```

MCP:

```text
mandu.agent.verify
```

내부에서 사용하는 기존 자산:

- `mandu diagnose --json`
- `mandu review --json`
- `mandu guard`
- `mandu check`
- targeted tests
- build checks
- contract/slot/hydration validators

출력 핵심:

```json
{
  "ok": false,
  "checks": [],
  "diagnostics": [],
  "nextRepairInput": ".mandu/agent-verify.json"
}
```

### 4.5 repair

목적: verify 실패 결과를 다음 행동으로 바꾼다.

CLI:

```bash
mandu agent repair --from .mandu/agent-verify.json
mandu agent repair --from .mandu/agent-verify.json --apply
```

MCP:

```text
mandu.agent.repair
```

내부에서 사용하는 기존 자산:

- `mandu doctor`
- `mandu fix`
- `mandu.loop.close`
- domain repair helpers
- patch safety policy

원칙:

1. 기본값은 제안만 한다.
2. `--apply`는 안전한 patch type에만 허용한다.
3. repair 후 다시 `agent verify`를 권장한다.

---

## 5. Agent Manifest

공식 agent loop의 단일 context artifact를 만든다.

경로:

```text
.mandu/agent-manifest.json
```

목적:

1. 에이전트가 프로젝트 구조를 추측하지 않게 한다.
2. route manifest, bundle manifest, skills, guard, commands를 하나로 묶는다.
3. Codex/Claude/Gemini가 같은 프로젝트 지도를 읽게 한다.

초기 schema:

```json
{
  "schemaVersion": 1,
  "framework": "mandu",
  "project": {
    "name": "",
    "packageManager": "bun"
  },
  "routes": [],
  "apis": [],
  "layouts": [],
  "partials": [],
  "islands": [],
  "slots": [],
  "contracts": [],
  "guards": [],
  "env": [],
  "deploy": {},
  "commands": {
    "context": "mandu agent context --json",
    "plan": "mandu agent plan",
    "verify": "mandu agent verify --changed --json",
    "repair": "mandu agent repair"
  },
  "agentWorkflow": {
    "canonical": ["context", "plan", "apply", "verify", "repair"]
  }
}
```

---

## 6. MCP Profile 정리

현재 MCP tool 수가 많기 때문에 profile을 도입한다.

| Profile | 목적 | 노출 도구 |
|---------|------|-----------|
| `agent-core` | 기본 agent workflow | `mandu.agent.*` 중심 |
| `agent-full` | 도메인 작업까지 허용 | `agent-core` + route/slot/hydration/contract/guard |
| `internal` | 개발자/프레임워크 유지보수 | 모든 low-level tool |

기본값은 `agent-core`여야 한다.

예상 노출:

```text
agent-core:
  mandu.agent.context
  mandu.agent.plan
  mandu.agent.apply
  mandu.agent.verify
  mandu.agent.repair
  mandu.docs.search
  mandu.docs.get

agent-full:
  agent-core
  mandu.route.*
  mandu.api.*
  mandu.slot.*
  mandu.hydration.*
  mandu.contract.*
  mandu.guard.*

internal:
  all tools
```

---

## 7. Skill 정리

기본 skill은 하나로 만든다.

```text
mandu-agent-workflow
```

이 skill의 역할:

1. 모든 에이전트에게 공식 loop를 가르친다.
2. 직접 파일 편집 전 MCP/agent command를 먼저 보게 한다.
3. verify/repair를 작업 종료 조건으로 만든다.
4. 도메인 skill을 언제 읽어야 하는지 안내한다.

도메인 skill은 유지하되 보조로 둔다.

```text
mandu-routes
mandu-hydration
mandu-slot
mandu-guard
mandu-deploy
mandu-testing
mandu-styling
mandu-security
```

도메인 skill 공통 템플릿:

```text
When to use
Canonical workflow step
Preferred MCP tools
Allowed file edits
Verification command
Common failures
Repair path
```

금지:

1. skill마다 서로 다른 작업 순서를 제시하지 않는다.
2. 저수준 명령을 공식 첫 단계처럼 노출하지 않는다.
3. "가능한 명령 목록"만 길게 나열하지 않는다.

---

## 8. CLI 정리

새 상위 command:

```bash
mandu agent <context|plan|apply|verify|repair|sync|manifest>
```

세부:

```bash
mandu agent context --json
mandu agent manifest --write
mandu agent plan "..." --json
mandu agent apply --from .mandu/agent-plan.json
mandu agent verify --changed --json
mandu agent repair --from .mandu/agent-verify.json
mandu agent sync --target codex
mandu agent sync --target claude
mandu agent sync --target gemini
mandu agent sync --target all
```

기존 명령의 위치:

| 기존 명령 | 새 소유자 |
|-----------|-----------|
| `info --json` | `agent context` 내부 |
| `diagnose --json` | `agent context`, `agent verify` 내부 |
| `review --json` | `agent verify` 내부 |
| `guard` | `agent verify` 내부 |
| `check` | `agent verify` 내부 |
| `doctor` | `agent repair` 내부 |
| `fix` | `agent repair` 내부 |
| `skills:generate` | `agent sync` 내부 |
| `mcp register` | `agent sync` 또는 setup docs |

---

## 9. Structured Diagnostics

모든 agent-facing 실패는 공통 shape로 변환한다.

```json
{
  "code": "MANDU_HYDRATION_002",
  "severity": "error",
  "title": "Partial component is missing a client source",
  "file": "app/dashboard/page.tsx",
  "line": 12,
  "cause": "partial().Render was used without a resolvable .partial.tsx bundle",
  "suggestedFix": {
    "type": "create_file",
    "path": "app/dashboard/counter.partial.tsx"
  },
  "docs": "docs/guides/hydration.md",
  "repairable": true
}
```

요구사항:

1. `code`는 stable해야 한다.
2. `severity`는 `info | warning | error | fatal` 중 하나다.
3. `suggestedFix`는 free text가 아니라 가능한 structured action이다.
4. `docs`는 실제 파일 또는 docs MCP target으로 연결된다.
5. `repairable`이 true일 때만 `agent repair --apply` 후보가 된다.

---

## 10. 구현 순서

### Phase 1. Surface Audit

산출물:

- `docs/audits/agent-surface-inventory.md`
- CLI/MCP/skills 전체 inventory
- 등급 분류: official, domain, internal, deprecated

완료 기준:

- 모든 command/tool/skill이 새 owner workflow를 가진다.
- 중복/위험/저가치 표면이 표시된다.

구현 상태: 완료. 기준 문서 `docs/audits/agent-surface-inventory.md`.

### Phase 2. Agent Context

산출물:

- `mandu agent context --json`
- `mandu.agent.context`
- `.mandu/agent-manifest.json` read/write 초기 버전

완료 기준:

- 에이전트가 `context` 하나로 프로젝트 요약, route/API/guard/commands를 알 수 있다.

구현 상태: 완료. Core shared collector, CLI wrapper, MCP wrapper, manifest read/write가 연결됨.

### Phase 3. Agent Verify

산출물:

- `mandu agent verify --changed --json`
- `mandu.agent.verify`
- diagnostics normalizer

완료 기준:

- changed files 기준으로 guard/review/diagnose/test suggestion이 하나의 JSON으로 묶인다.

구현 상태: 완료. Diagnose, route manifest, guard, contract consistency, changed-file summary, suggested commands가 `AgentVerifyReport`로 정규화됨.

### Phase 4. Agent Repair

산출물:

- `mandu agent repair --from <verify.json>`
- `mandu.agent.repair`
- doctor/fix/loop-close integration

완료 기준:

- 실패 결과가 다음 행동과 안전한 patch 후보로 변환된다.

구현 상태: 완료(safe v1). Verify report를 읽어 structured next actions로 변환하고 `mandu.agent.repair`/CLI report path가 연결됨. 자동 patch apply는 typed patch payload가 있는 후보에만 열어두며, 현재 일반 diagnostic에는 보수적으로 제안만 반환한다.

### Phase 5. Agent Plan/Apply

산출물:

- `mandu agent plan`
- `mandu.agent.plan`
- `mandu agent apply`
- `mandu.agent.apply`

완료 기준:

- route/API/slot/hydration/contract 변경이 plan 기반으로 실행된다.

구현 상태: 완료. Deterministic preview는 compatibility로 유지하고, Refoundation Phase 4에서 exact scope, revision/hash precondition, typed operation, idempotent `ApplyReceipt`, verify, snapshot/rollback을 가진 실행 경로를 추가했다. CLI `--execute`와 MCP `dryRun=false`는 같은 Core apply 함수를 호출한다.

### Phase 6. Agent Sync and Profiles

산출물:

- `mandu agent sync --target all`
- `mandu-agent-workflow` skill
- MCP profile `agent-core`, `agent-full`, `internal`

완료 기준:

- Codex, Claude Code, Gemini CLI가 같은 공식 workflow를 받는다.
- 기본 MCP exposure가 줄어든다.

구현 상태: 완료. `mandu agent sync --target <codex|claude|gemini|all>`와 `mandu.agent.sync`가 `.mandu/agent-sync/` 산출물을 생성한다. `mandu-agent-workflow` skill이 MCP skill catalog의 첫 항목으로 추가되었고, MCP profile은 `agent-core`, `agent-full`, `internal`로 재정의되었다. 기본 서버 profile은 `agent-core`이며 legacy `minimal/standard/full`은 새 profile로 매핑된다.

### Phase 7. Domain Skill Second-Pass Cleanup

산출물:

- 기존 domain skill 11개에 `Agent Workflow Contract` 추가
- 저수준 guard/test/setup 예시를 공식 loop 뒤로 재배치
- domain skill 회귀 테스트

완료 기준:

- 모든 domain skill이 `mandu-agent-workflow`를 대체하지 않는 addendum임을 명시한다.
- 모든 domain skill이 preferred MCP tools, allowed file edits, verification command, repair path를 가진다.
- guard/test/deploy/styling/UI 예시가 첫 단계처럼 보이지 않고 `plan`/`verify` 이후 예시로 읽힌다.

구현 상태: 완료. `mandu-composition`, `mandu-deployment`, `mandu-fs-routes`, `mandu-guard`, `mandu-hydration`, `mandu-performance`, `mandu-security`, `mandu-slot`, `mandu-styling`, `mandu-testing`, `mandu-ui`가 모두 `Agent Workflow Contract`를 포함한다. 회귀 테스트는 `packages/mcp/tests/resources/domain-skills-workflow.test.ts`.

---

## 11. 검증 전략

단위 테스트:

```bash
bun test packages/cli/src/commands/__tests__/agent*.test.ts
bun test packages/mcp/tests
```

통합 테스트:

```bash
bun run test:packages
bun run typecheck
bun run check:publish
```

Agent workflow regression:

```text
Task A: add page route
Task B: add API + contract
Task C: add SSR data + partial island
Task D: fix guard violation
Task E: repair hydration failure
```

측정 지표:

1. 에이전트가 사용한 tool/command 수
2. 잘못 선택한 low-level tool 수
3. verify 실패 후 repair 성공률
4. 직접 파일 수정 전 plan 생성률
5. 최종 green까지의 반복 횟수

---

## 12. 성공 기준

이 계획은 다음 상태가 되면 완료다.

1. 기본 문서와 skills가 `context -> plan -> apply -> verify -> repair`를 공식 루프로 설명한다.
2. 기본 MCP profile에서 에이전트가 보는 도구 수가 크게 줄어든다.
3. `mandu agent context --json`이 프로젝트 상태를 충분히 설명한다.
4. `mandu agent verify --changed --json`이 기존 검증 기능을 하나로 묶는다.
5. `mandu agent repair`가 실패 결과를 다음 행동으로 바꾼다.
6. 기존 기능들은 유지되지만 agent-facing 문서에서는 상위 workflow를 우선한다.
7. Codex, Claude Code, Gemini CLI용 sync 결과가 같은 원칙을 말한다.

---

## 13. 첫 작업 후보

우선순위:

1. `docs/audits/agent-surface-inventory.md` 작성
2. `mandu agent context --json`
3. `mandu.agent.context`
4. `mandu agent verify --changed --json`
5. `mandu.agent.verify`
6. `mandu-agent-workflow` skill
7. MCP profile `agent-core`

첫 구현은 새 기능을 크게 만들기보다 기존 `info`, `diagnose`, `ai.brief`, `review`, `doctor`, `fix`, `loop.close`를 상위 workflow로 감싸는 방식으로 진행한다.
