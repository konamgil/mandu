# Mandu MCP Roadmap v1.0

> 5명 전문가 (MCP 에이전트, DX, 하네스 컨텍스트, 워크플로우, Claude Code Skills) 분석 기반
>
> 날짜: 2026-04-12

---

## 현재 상태: 16개 카테고리, 76개 도구

### 즉시 수정이 필요한 문제 (P0)

| # | 문제 | 영향 |
|---|------|------|
| 1 | **네이밍 비일관성**: `mandu_guard_check` (밑줄) vs `mandu.ate.extract` (점) 혼재 | 에이전트가 도구명 추측 시 혼란 |
| 2 | **이름 충돌**: `mandu_get_architecture`가 brain.ts와 guard.ts에 중복 정의 | 호출 시 어느 것이 실행될지 불확실 |
| 3 | **도구 설명 과다**: 일부 description이 7줄 이상 — 컨텍스트 윈도우 낭비 (~5,000 토큰) | 에이전트 성능 저하 |
| 4 | **guard.ts 과밀**: 한 파일에 13개 도구 (guard + decisions + negotiate + slot constraints) | 카테고리 혼란 |
| 5 | **`isError: true` 미설정**: 에러 응답이 content 안에 `{ error: "..." }`로만 반환 | 에이전트가 성공/실패 판단 어려움 |

---

## Phase 1: 도구 품질 개선

### 1-1. 네이밍 통일

```
현재: mandu_guard_check, mandu.ate.extract (혼재)
목표: mandu.guard.check, mandu.ate.extract (점 표기 통일)
```

점 표기법이 카테고리 계층 구조를 자연스럽게 표현:
- `mandu.guard.check`, `mandu.guard.heal`, `mandu.guard.explain`
- `mandu.contract.create`, `mandu.contract.validate`
- `mandu.route.add`, `mandu.route.list`, `mandu.route.delete`

### 1-2. Description 축소

```
AS-IS (7줄):
"List all routes that have a contract module defined. In Mandu, a 'contract'
is a Zod-schema that declares the request/response shapes for an API route.
Contracts enable runtime validation, OpenAPI generation, and ATE level..."

TO-BE (1줄):
"List routes with contract modules. Use before creating or validating contracts."
```

상세 문서는 MCP `annotations.documentation` 또는 별도 리소스로 분리.

### 1-3. guard.ts 카테고리 분리

```
현재 guard.ts (13개 도구):
→ guard: check, heal, explain (3개)
→ decisions: get_decisions, save_decision, check_consistency (3개)
→ negotiate: negotiate, generate_scaffold, analyze_structure (3개)
→ slot_validation: validate_slot, get_slot_constraints (2개)
→ architecture: get_architecture (1개) — brain.ts 중복 해결
```

### 1-4. MCP Annotations 추가

```typescript
{
  name: "mandu.route.delete",
  annotations: {
    destructiveHint: true,    // 파일 삭제
    readOnlyHint: false,
    idempotentHint: false,
  }
}
```

### 1-5. 에러 응답 표준화

```typescript
// AS-IS
return { content: [{ type: "text", text: JSON.stringify({ error: "..." }) }] };

// TO-BE
return { content: [{ type: "text", text: "..." }], isError: true };
```

---

## Phase 2: 신규 도구 — 워크플로우 자동화

### 2-1. `mandu.feature.create` — 기능 원샷 생성

**현재 6단계 → 1단계**:

```
입력:
{
  name: "products",
  routes: [{ path: "/api/products", kind: "api", methods: ["GET", "POST"] }],
  withContract: true,
  withIsland: true,
  guardPreset: "fsd"
}

내부 동작:
  mandu.route.add → mandu.contract.create → slot scaffold → island scaffold → mandu.generate → mandu.build

출력:
{
  files: ["app/api/products/route.ts", "spec/contracts/api-products.contract.ts", ...],
  editLocations: [{ file: "...", line: 10, hint: "implement GET handler" }],
  nextSteps: ["Edit route handler", "Run mandu dev"]
}
```

### 2-2. `mandu.island.add` — Island 전용 스캐폴딩

```
입력: { name: "chart", route: "dashboard", strategy: "visible", dataType: "ChartData" }
출력: app/dashboard/chart.island.tsx + spec/slots/dashboard-chart.client.tsx
```

### 2-3. `mandu.diagnose` — 통합 진단

```
입력: { scope: "all", autoFix: true }
내부 동작: kitchen_errors + guard_check + validate_contracts + validate_manifest 병렬 실행
출력: 통합 리포트 + 자동 수정 결과
```

### 2-4. `mandu.middleware.add` — 미들웨어 스캐폴딩

```
입력: { preset: "jwt", options: { secret: "env:JWT_SECRET" } }
출력: middleware.ts 생성 + .env.example 업데이트
```

### 2-5. `mandu.test.route` — 단일 라우트 테스트

```
입력: { routeId: "api-products", quick: true }
내부 동작: ATE extract(해당 라우트만) → generate → run → report
출력: pass/fail + 실패 시 heal 제안
```

### 2-6. `mandu.deploy.check` — 배포 준비 검증

```
입력: { target: "bun" }
출력: { ready: true, warnings: [...], blockers: [] }
```

### 2-7. `mandu.cache.manage` — ISR 캐시 관리

```
입력: { action: "invalidate", tag: "products" }
출력: { invalidated: 5, remaining: 42 }
```

---

## Phase 3: MCP Prompts — 대화형 워크플로우

### 3-1. `new-feature` 프롬프트

```
에이전트에게 제공되는 대화 템플릿:
"사용자가 새 기능을 요청했습니다. 다음 단계로 진행하세요:
1. 기능 설명을 바탕으로 mandu.feature.create 호출
2. 생성된 파일의 TODO 위치를 안내
3. guard check 실행"
```

### 3-2. `debug` 프롬프트

```
"에러가 발생했습니다. 다음 단계로 진행하세요:
1. mandu.diagnose 호출
2. 에러 원인을 사용자에게 설명
3. autoFix 가능한 항목 수정 제안"
```

### 3-3. `add-crud` 프롬프트

```
"사용자가 CRUD API를 요청했습니다:
1. 리소스 이름과 필드를 확인
2. mandu.feature.create로 라우트 + contract + slot 생성
3. 각 HTTP method 핸들러 구현 안내"
```

---

## Phase 4: MCP Resources

### 4-1. `mandu://routes`

```json
{
  "uri": "mandu://routes",
  "mimeType": "application/json",
  "description": "현재 프로젝트의 route manifest"
}
```

### 4-2. `mandu://errors`

```json
{
  "uri": "mandu://errors",
  "description": "최근 빌드/런타임 에러 (Kitchen + Guard)"
}
```

### 4-3. `mandu://config`

```json
{
  "uri": "mandu://config",
  "description": "mandu.config.ts 파싱 결과"
}
```

---

## Phase 5: MCP 프로파일 + 컨텍스트 최적화

### 5-1. 프로파일 시스템

```typescript
// mandu.config.ts
export default {
  mcp: {
    profile: "standard", // "minimal" | "standard" | "full"
  },
};
```

| 프로파일 | 도구 수 | 대상 |
|---------|--------|------|
| `minimal` | ~15 | 신규 사용자, 작은 프로젝트 |
| `standard` | ~40 | 일반 개발 (기본값) |
| `full` | 76 | 프레임워크 전문가 |

### 5-2. 트랜잭션 락

```typescript
mandu.tx.begin → lockId 발급
mandu.tx.commit(lockId) → 변경 적용
// 다른 에이전트가 같은 lockId 없이 파괴적 도구 호출 시 거부
```

---

## Phase 6: Claude Code 통합

### 6-1. Skills

```markdown
<!-- .claude/skills/mandu-create-feature/SKILL.md -->
---
name: mandu-create-feature
description: Create a new feature with routes, contracts, and islands
allowed-tools:
  - mcp__mandu__mandu.feature.create
  - mcp__mandu__mandu.guard.check
---

# Feature Creation Workflow
1. Ask user for feature name and routes
2. Call mandu.feature.create with gathered info
3. Run guard check on generated files
4. Show user the TODO locations
```

### 6-2. Hooks

```json
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Write|Edit",
      "command": "bun run mandu guard-check --quick --silent"
    }]
  }
}
```

---

## 우선순위 매트릭스

```
임팩트 ↑
극대  │  feature.create(2-1)   diagnose(2-3)
      │  네이밍통일(1-1)        description축소(1-2)
      │
 대   │  island.add(2-2)       test.route(2-5)
      │  프로파일(5-1)         에러표준화(1-5)
      │
 높   │  Prompts(3-1~3)        middleware.add(2-4)
      │  Resources(4-1~3)      deploy.check(2-6)
      │
 중   │  Skills(6-1)           cache.manage(2-7)
      │  Hooks(6-2)            tx.lock(5-2)
      │  annotations(1-4)      카테고리분리(1-3)
      │
      └────────────────────────────────────────→ 난이도
           하                  중              상
```

---

## 핵심 인사이트

> **"새로운 AI 기능을 만드는 것이 아니라, 기존 76개 MCP 도구의 품질을 올리고 조합하는 것이 최대 ROI"**
>
> — MCP 에이전트 전문가

> **"76개 도구를 15/40/76으로 프로파일링하면, 에이전트 선택 정확도가 3배 향상"**
>
> — 하네스 컨텍스트 전문가

> **"6단계 기능 생성을 1단계로 압축하는 mandu.feature.create가 가장 큰 생산성 향상"**
>
> — 워크플로우 전문가

> **"MCP 도구는 기계용, Claude Code 스킬은 인지용으로 역할 분담해야"**
>
> — Claude Code Skills 전문가
