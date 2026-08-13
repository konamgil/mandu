---
name: mandu-mcp-create-flow
description: |
  스펙 우선 생성 워크플로우. "만들어줘", 피처/리소스/라우트 추가 시 자동 호출.
  contract → generate 순서를 강제하고 생성 직후 verify loop 로 전이.
  granular 도구 (add_route + create_contract + generate) 를 손으로 엮지 않는다.
---

# Mandu MCP Create Flow

새 기능을 스캐폴딩할 때의 **스펙 우선** 레시피. "contract 없이 generate 먼저"
라는 대표적 실수를 방지하고, 가능한 한 집계 도구 (resource/feature/scaffold) 를
사용한다.

## Trigger

- "만들어줘", "추가해줘", "create", "add"
- "CRUD" + 엔티티 이름
- 피처 / 라우트 / 리소스 / API 엔드포인트 / 컴포넌트 추가
- `mandu-create-feature` 또는 `mandu-create-api` task-shaped skill 이 활성화될 때

## Decision Tree

요청의 단위를 먼저 구분한다.

```
요청 내용
├─ 리소스 단위 (User, Post, Comment 같은 도메인 엔티티)
│    → Track A: Resource flow
├─ 피처 단위 (페이지 + 섹션 + island + slot 세트)
│    → Track B: Feature flow
├─ 단일 라우트 (페이지 하나 또는 API 하나만)
│    → Track C: Route flow
└─ 스키마만 이미 있고 스캐폴드만 필요
     → Track D: Scaffold-only
```

### Track A — Resource Flow (도메인 엔티티)

```
mandu.resource.create        ← Tier-0 aggregate: resource + fields 묶음 생성
  └─> mandu_create_contract  ← Zod 계약 (집계 도구가 자동으로 요청하지 않을 때만)
       └─> mandu_generate    ← 스캐폴드 생성
            └─> mandu-mcp-verify 로 전이
```

`mandu.resource.create` 인자 예:
```
mandu.resource.create({
  name: "Post",
  fields: { title: "string", content: "string", publishedAt: "datetime?" }
})
```

리소스가 생성되면 route / slot / contract 의 후보가 제안된다. 제안을 그대로
받아 `mandu_generate` 로 흘린다. 제안된 경로를 무시하고 `mandu_add_route` 로
손수 만들지 않는다.

### Track B — Feature Flow (페이지 + island + slot)

```
mandu_analyze_structure         ← alias of mandu.negotiate.analyze, 요구사항 → 구조 제안
  └─> mandu.feature.create      ← Tier-0 aggregate: 여러 라우트 + slot + island 묶음
       └─> mandu_create_contract ← API 엔드포인트가 포함된 경우
            └─> mandu_generate
                 └─> mandu-mcp-verify 로 전이
```

또는 단축 경로:

```
mandu_generate_scaffold   ← alias of mandu.negotiate.scaffold,
                            negotiate + scaffold 를 한 번에
  └─> mandu-mcp-verify
```

사용자가 이미 스키마를 구체적으로 제시했다면 `mandu_analyze_structure` 는 스킵.
"대충 사용자 프로필 페이지 만들어줘" 처럼 모호한 요청일 때만 negotiate 먼저.

### Track C — Single Route Flow

```
mandu_add_route          ← 파일 생성 (경로 규칙 자동 적용)
  └─> mandu_create_contract ← API 라우트면 필수, 페이지만이면 생략 가능
       └─> mandu_generate    ← 스캐폴드 반영
            └─> mandu-mcp-verify
```

`mandu_add_route` 인자:
```
mandu_add_route({ path: "/users/[id]", type: "page" })
mandu_add_route({ path: "/api/users/[id]", type: "api" })
```

### Track D — Scaffold-Only (스키마 이미 있음)

사용자가 `spec.ts` 또는 기존 contract 를 제시했다면:

```
mandu_generate_scaffold   ← negotiate skip, 바로 scaffold
  └─> mandu-mcp-verify
```

## Absolute Rules

| # | 규칙 | 이유 |
|---|------|------|
| R-1 | `mandu_generate` 는 **언제나 마지막** | contract 이전 generate 는 생성물 타입이 unstable |
| R-2 | `mandu_create_contract` 는 **`mandu_generate` 전에** | 생성물이 Zod 타입에 바인딩됨 |
| R-3 | 복합 생성은 **집계 도구 우선** (`resource.create` / `feature.create` / `generate_scaffold`) | 순서 / 롤백 / 검증을 집계가 처리 |
| R-4 | 생성 직후 **무조건 `mandu-mcp-verify` 로 전이** | 생성물은 guard / contract / ate 로 검증해야 의미 있음 |
| R-5 | 사용자가 스키마를 준 경우 **`negotiate` 스킵** | 중복 분석 왕복 제거 |
| R-6 | 단일 트랜잭션 단위는 **`mandu_begin` ~ `mandu_commit`** 로 감싼다 (위험 변경 시) | `mandu-mcp-safe-change` 참조 |

## Post-Create Transition (자동)

생성이 끝나면 **반드시** `mandu-mcp-verify` fast path 로 넘어간다:

```
mandu_generate 완료
  → mandu.ate.auto_pipeline + mandu_guard_check + mandu_doctor (병렬)
  → 실패 시 drill-down
```

`mandu_generate` 의 응답이 "success" 라도 verify 를 건너뛰지 않는다.
guard 위반이나 contract 타입 불일치는 생성 자체는 성공해도 나중에 드러난다.

## Anti-patterns

### AP — Granular Manual Assembly
- 증상: 피처 하나 만들라는 요청에 `mandu_add_route` × 3 + `mandu_create_contract` × 2 + `mandu_generate` 를 수동 호출.
- 왜 안 되나: 중간에 실패하면 반쯤 만들어진 상태. 집계 도구 (`feature.create`, `resource.create`) 가 이 시퀀스를 트랜잭션으로 처리한다.
- 대응: Track A / B / D 의 집계 도구 먼저.

### AP — Generate Before Contract (R-2 위반)
- 증상: `mandu_generate` → 결과 보고 → `mandu_create_contract` → 또 `mandu_generate`.
- 왜 안 되나: 1차 generate 의 생성물이 버려짐 + 2차에서 import path 꼬임.
- 대응: contract 먼저. 항상.

### AP — Negotiate 후 직접 생성
- 증상: `mandu_analyze_structure` 로 계획 받고, 반환된 route 목록을 `mandu_add_route` 로 손으로 하나씩.
- 왜 안 되나: `mandu_generate_scaffold` 가 이 역할. negotiate 의 구조를 바로 scaffold 로 흘린다.
- 대응: `mandu_generate_scaffold` 한 방.

### AP — "만들고 바로 커밋"
- 증상: `mandu_generate` 결과를 보고 verify 스킵하고 git commit.
- 왜 안 되나: guard 위반 / contract 불일치가 커밋에 박힘.
- 대응: R-4 (생성 직후 verify) 지킨다.

## Quick Recipes

### 간단한 CRUD 리소스 추가
```
mandu.resource.create({ name, fields })
mandu_generate                        (resource.create 가 요청할 때만)
→ mandu-mcp-verify
```
호출 수: 2-3

### 피처 + API + Island
```
mandu_generate_scaffold({ description })
→ mandu-mcp-verify
```
호출 수: 2 (가장 압축된 경로)

### 이미 있는 contract 에 라우트 하나만 추가
```
mandu_add_route({ path, type })
mandu_generate
→ mandu-mcp-verify
```
호출 수: 3

목표: 표준 CRUD 피처 기준 **≤ 6 MCP 호출 (생성 + verify fast path 포함)**.

## See Also

- `mandu-mcp-index` — 라우터 / anti-pattern 카탈로그
- `mandu-mcp-verify` — 생성 직후 자동 전이
- `mandu-mcp-safe-change` — 기존 구조를 흔드는 리팩터의 경우
- `mandu-create-feature`, `mandu-create-api` — 도메인 지식 (파일 구조, 네이밍)
- `mandu-slot` — slot 파일 작성 규칙
