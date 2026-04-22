---
name: mandu-mcp-verify
description: |
  편집 후 검증 루프. 파일 편집 직후, "check 해줘", stop-hook 자동 호출.
  ate_auto_pipeline + guard_check + doctor 를 병렬로. 개별 ate_* 도구로
  수동 분해 금지 — 실패했을 때만 drill-down.
---

# Mandu MCP Verify

**편집 직후 / 생성 직후 / pre-commit** 에서 도는 표준 검증 루프.
핵심은 "하나의 ate 파이프라인 + guard + 구조 진단" 을 **병렬 fast path** 로 먼저 돌리고,
실패했을 때만 세분 도구로 drill-down 하는 것.

## Trigger

- 파일 편집 직후 (특히 `app/`, `spec/`, `src/shared/contracts/`)
- `mandu_generate` 완료 직후 (create-flow 가 자동 전이)
- "check 해줘", "제대로 된 거야?", "괜찮아?"
- stop-hook / pre-commit 자동 실행
- 사용자가 명시적으로 "verify", "validate", "검증"

## Fast Path (병렬, 기본값)

세 도구는 서로 독립. 병렬 호출.

```
┌─────────────────────────────┐
│ mandu.ate.auto_pipeline     │  ← Tier-0: extract/generate/run/heal 전부
├─────────────────────────────┤
│ mandu_guard_check           │  ← Tier-1: 아키텍처 규칙 위반 스캔
├─────────────────────────────┤
│ mandu_doctor                │  ← Tier-0: 구조/import/location 진단
└─────────────────────────────┘
       세 개를 parallel 호출
```

인자 예:
```
mandu.ate.auto_pipeline({
  repoRoot: ".",
  oracleLevel: "standard",
  useImpactAnalysis: true,    // 변경된 라우트만 대상
  autoHeal: false              // heal 은 별도 단계
})

mandu_guard_check({ repoRoot: "." })

mandu_doctor({ repoRoot: "." })
```

세 응답을 수집하고 pass/fail 매트릭스를 만든다:

| 도구 | pass | fail 의 의미 |
|------|------|------------|
| `ate.auto_pipeline` | 테스트 통과 + 계약 일치 | 테스트 실패 또는 impact 드리프트 |
| `guard_check` | 레이어/금지 import 위반 없음 | 아키텍처 규칙 위반 |
| `doctor` | 파일 위치 / import 정상 | 구조 결함 |

**세 개 모두 green** → verify 종료. 사용자에게 압축 요약 제시.

## Drill-Down (실패 시에만)

fast path 가 빨간 항목을 돌려주면 그 카테고리별로만 drill-down.
세 종류가 다 실패했다고 모든 drill-down 을 돌리지 말고, **응답에 들어온 카테고리만**.

### Guard 실패

```
mandu_guard_explain({ violationId })    ← 먼저: 왜 위반인지 설명
  → (자동 수정 가능하면) mandu_guard_heal({ autofix: true, violationIds: [...] })
  → (수동 수정이면) 사용자에게 수정 지시 후 fast path 재실행
```

### ATE 실패 (테스트 실패 / 힐 후보 있음)

```
mandu.ate.feedback({ runId })           ← 힐 후보의 카테고리/우선순위
  → mandu.ate.apply_heal({ runId, healIndex, createBackup: true })
  → fast path 의 ate.auto_pipeline 재실행
```

중요: `mandu.ate.heal` + `mandu.ate.apply_heal` 을 수동으로 엮지 않는다.
`ate.auto_pipeline` 이 이미 heal 후보를 계산했고, 우리는 **적용 여부**만 결정.

### Doctor 실패 (구조 / import)

```
mandu_check_import({ filePath })        ← 잘못된 import 경로 상세
  → mandu_check_location({ filePath })  ← 파일 위치 규칙 위반 상세
  → 사용자에게 수정안 제시 (또는 safe-change 로 전이)
```

### Kitchen (런타임 에러 동반)

dev 서버 돌고 있고 fast path 중 런타임 성격의 실패가 보이면:

```
mandu_kitchen_errors({ limit: 20 })
```

## 절대 규칙

| # | 규칙 | 이유 |
|---|------|------|
| V-1 | ATE 는 **반드시** `mandu.ate.auto_pipeline` 하나로 시작 | 개별 ate_* 도구 수동 조합 = AP-1 (index 참조) |
| V-2 | fast path 는 **병렬** 호출 | 세 도구 독립. 순차 호출은 왕복 3배 낭비 |
| V-3 | `mandu_guard_heal` 은 **drill-down 단계에서만** | fast path 에서 autofix 를 켜면 스냅샷 없이 자동 수정됨 |
| V-4 | drill-down 은 **실패한 카테고리에만** | 통과한 쪽까지 drill 해서 왕복 부풀리지 않는다 |
| V-5 | heal 후에는 **fast path 를 다시 돌린다** | 수정이 새 위반을 만들 수 있음. 1회 재확인 |
| V-6 | 대규모 수정이 필요한 drill-down 은 `mandu-mcp-safe-change` 로 escalate | snapshot + tx 없이 큰 수정 금지 |

## Anti-patterns

### AP-1 — ATE 수동 분해 (index AP-1 재인용)
- 증상: `mandu.ate.extract` → `mandu.ate.generate` → `mandu.ate.run` → `mandu.ate.heal` → `mandu.ate.apply_heal` 를 손으로.
- 왜 안 되나: 왕복 5배 + 중간 실패 처리 로직을 재구현하게 됨.
- 대응: `mandu.ate.auto_pipeline` 단 하나.

### AP — fast path 순차 호출
- 증상: `auto_pipeline` 결과 보고 → `guard_check` → `doctor` 를 하나씩.
- 왜 안 되나: 독립 작업을 직렬화. 응답 집계가 늦어지고 사용자 대기 시간이 3배.
- 대응: V-2, 병렬 호출.

### AP — heal 없이 재생성
- 증상: ate 또는 guard 실패 → `mandu_generate` 재호출로 "리셋" 시도.
- 왜 안 되나: 같은 입력이면 같은 결과. 원인은 입력 쪽 (contract / slot / island) 에 있음.
- 대응: 해당 카테고리 drill-down → `guard_heal` / `apply_heal` / 수동 수정.

### AP — verify 생략
- 증상: 편집 후 바로 `git add . && git commit`.
- 왜 안 되나: 위반을 커밋에 박음. CI 에서 reject.
- 대응: stop-hook 또는 명시적 `mandu-mcp-verify` 호출.

## Quick Reference

```
편집 완료
  ┌─ mandu.ate.auto_pipeline ─┐
  ├─ mandu_guard_check        │  (parallel)
  └─ mandu_doctor             ─┘
  ────────────────────────────
  all green? → 종료
  실패? → 해당 카테고리만 drill-down:
           guard_explain / guard_heal
           ate.feedback / ate.apply_heal
           check_import / check_location
         → 재실행 (fast path)
```

목표 호출 수:
- all-green 경로: **3 calls** (parallel)
- 1 카테고리 drill + 재실행: **3 + 1~2 + 3 = 7~8 calls**
- 모든 카테고리 실패: escalate to `mandu-mcp-safe-change`

## See Also

- `mandu-mcp-index` — Tier/aggregate 우선순위 + AP-1 (ATE 수동 분해)
- `mandu-mcp-create-flow` — 생성 직후 이 skill 로 자동 전이
- `mandu-mcp-safe-change` — drill-down 이 대규모 수정으로 번질 때
- `mandu-debug` — 에러 카테고리별 도메인 지식
- `mandu-guard-guide` — guard 위반 유형별 수정 방법
