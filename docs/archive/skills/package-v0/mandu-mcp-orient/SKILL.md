---
name: mandu-mcp-orient
description: |
  세션 시작 / 상태 파악 워크플로우. "현 상태", "무슨 일 있었어?",
  "어디서부터 시작?", 세션 재진입, 긴 대화 복귀 시 자동 호출.
  개별 진단 도구를 순차 호출하지 않고 ai_brief 로 집계한다.
---

# Mandu MCP Orient

세션에 처음 진입하거나 긴 휴지 뒤 복귀할 때 **"지금 프로젝트가 어떤 상태인지"** 를
한 번에 파악하는 레시피. 개별 진단 도구를 나열하지 않고 집계부터 시작한다.

## Trigger

- "현 상태?", "지금 어디까지 됐지?", "무슨 일 있었어?"
- "여기서부터 계속", 세션 재진입
- 긴 대화 복귀, `/sc:load` 직후
- 사용자가 프로젝트 이름만 말하고 추가 지시가 없을 때

## Recipe (순서 고정)

```
mandu.ai.brief                       ← Tier-0 aggregate: 먼저 호출
  └─> mandu_get_architecture         ← 프리셋/레이어 규칙
       └─> mandu_kitchen_errors      ← 런타임 에러 스트림 (있으면 최근 N개)
            └─> mandu_guard_check    ← snapshot only, heal 금지
```

### Step 1 — `mandu.ai.brief`

```
mandu.ai.brief({ depth: "short" })
```

반환 필드:
- `title`, `summary` — 프로젝트 정체성
- `skills` — 설치된 @mandujs/skills + 프로젝트별 generated skills
- `recent_changes` — 최근 20 커밋 subject/hash
- `docs` — `docs/` 최상위 목차
- `config.guard_preset`, `config.fs_routes`, `config.has_playwright`
- `suggested_next_steps` — 최근 활동 기반 추천

read-only, fail-soft. git 이나 docs 가 없어도 에러 나지 않음.

depth 는 상황에 맞춰:
- **처음 진입**: `"short"` 으로 충분
- **장기 복귀 / 복잡 프로젝트**: `"full"`

### Step 2 — `mandu_get_architecture`

```
mandu_get_architecture({})
```

alias of `mandu.brain.architecture`. 프리셋 (mandu / fsd / clean / hexagonal / atomic / cqrs),
레이어 방향, 허용/금지 import 규칙을 반환. `ai.brief` 로 "무엇을 하는 프로젝트인지" 는
알았으니, 여기서 "어떤 규칙으로 돼 있는지" 를 확인한다.

### Step 3 — `mandu_kitchen_errors`

```
mandu_kitchen_errors({ limit: 10 })
```

dev 서버가 실행 중이면 최근 런타임 에러를 스트림에서 가져온다. 빌드는 됐지만
실행 중 에러가 쌓여 있는 경우 — `ai.brief` / `get_architecture` 만으로는 안 보인다.
dev 서버가 없으면 빈 배열. 실패 아니다.

### Step 4 — `mandu_guard_check` (snapshot only)

```
mandu_guard_check({ repoRoot: "." })
```

CRITICAL: **`heal` 하지 않는다**. 오리엔테이션 단계에서는 현황만 본다.
위반이 있으면 그 사실을 기록하고 사용자에게 알리되, 고치는 건
`mandu-mcp-verify` 나 `mandu_guard_heal` 을 명시적으로 호출할 때만.

## 종료 조건

4 단계가 끝나면 다음 중 하나로 전이:

| 결과 | 다음 skill |
|------|-----------|
| 사용자가 "만들어줘" / 새 피처 요청 | `mandu-mcp-create-flow` |
| guard 위반 존재 + 사용자가 정리 원함 | `mandu-mcp-verify` -> drill-down |
| 에러 있음 + 사용자가 디버그 원함 | `mandu-debug` |
| 빌드/배포 원함 | `mandu-mcp-deploy` |
| 사용자 지시가 없으면 `suggested_next_steps` 요약 제시 | — |

## Anti-patterns

### AP — `ai.brief` 스킵
- 증상: `mandu_list_routes` + `mandu_list_contracts` + `mandu_get_decisions` + `mandu_list_islands` 를 연속 호출하며 상태를 조립.
- 왜 안 되나: 왕복 4-6배. `ai.brief` 가 이미 이것들을 집계하고 docs/commit 까지 붙여준다.
- 대응: 무조건 `mandu.ai.brief` 부터.

### AP — `guard_heal` 을 오리엔테이션 중에 실행
- 증상: 세션 진입 직후 `mandu_guard_heal({ autofix: true })`.
- 왜 안 되나: 사용자 의도를 확인하기 전에 파일을 고침. 스냅샷 없이 수정이라 롤백 어려움.
- 대응: Step 4 는 반드시 `mandu_guard_check` (read-only). heal 은 `mandu-mcp-verify` 또는 `mandu-mcp-safe-change` 에서.

### AP — 전체 파일을 Read 로 훑기
- 증상: `ai.brief` 대신 `app/`, `src/`, `spec/` 을 Read/Grep 으로 샅샅이 읽기.
- 왜 안 되나: 컨텍스트 낭비 + 불완전. `ai.brief` 는 config + 최근 commit + skills manifest 를 이미 압축해서 준다.
- 대응: `ai.brief` 먼저. 거기서 가리킨 특정 파일만 Read.

## Quick Reference

```
세션 진입
  mandu.ai.brief              (1 call, Tier-0)
  mandu_get_architecture      (1 call, Tier-1)
  mandu_kitchen_errors        (1 call, Tier-1, fail-soft)
  mandu_guard_check           (1 call, read-only)
  ──────────────────────────
  total: 4 calls, no mutations
```

이 4 호출로 상태 파악이 충분하지 않으면 사용자의 구체 질문이 들어온 것이므로,
그 질문에 맞는 **다른 workflow skill** 로 전이한다. "더 많이 알아보려고" 도구를 계속 호출하지 않는다.

## See Also

- `mandu-mcp-index` — workflow skill 선택 라우터
- `mandu-mcp-verify` — 오리엔테이션 후 편집 시작 시 검증 루프
- `mandu-debug` — 에러가 구체적으로 드러났을 때의 진단 가이드
