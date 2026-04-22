---
name: mandu-mcp-safe-change
description: |
  위험 변경 트랜잭션 래퍼. 마이그레이션 / 대규모 리팩터 / refactor_* 도구 /
  "돌이킬 수 없는 변경" 시 자동 호출. history_snapshot + tx_begin 필수,
  verify green 이면 tx_commit, 아니면 tx_rollback.
---

# Mandu MCP Safe Change

**돌이키기 힘든 변경** 을 실행할 때의 표준 래퍼. `history.snapshot` 으로 롤백 포인트를
찍고, `tx.begin` 으로 트랜잭션을 열고, 안에서 편집 + verify, 결과에 따라
`tx.commit` 또는 `tx.rollback`.

## Trigger

- 마이그레이션: 경로 컨벤션 변경, 생성 barrel 재작성, contract 추출 등
- 대규모 리팩터: 레이어 재배치, 모듈 이동, 대량 import 경로 수정
- `mandu.refactor.*` / `mandu.refactor.migrateRouteConventions` / `mandu.refactor.rewriteGeneratedBarrel` / `mandu.refactor.extractContract` 호출 직전
- 사용자: "돌이킬 수 없는 변경", "한 번에 바꿔줘", "전체 프로젝트에 적용"
- 생성 파일 대량 재작성 (`mandu_generate` 를 전체 재실행)

## Recipe (순서 고정)

```
mandu.history.snapshot              ← 롤백 포인트 (Tier-1)
  └─> mandu_begin                   ← 트랜잭션 시작 (alias of mandu.tx.begin)
       └─> <편집 / refactor tool 호출>
            └─> mandu-mcp-verify fast path
                 ├─ all green → mandu_commit  (alias of mandu.tx.commit)
                 │                └─> mandu_prune_history (선택, 오래된 스냅샷 정리)
                 └─ 실패       → mandu_rollback (alias of mandu.tx.rollback)
                                   └─> 스냅샷은 유지. 원인 분석 후 재시도
```

## Step Detail

### Step 1 — `mandu.history.snapshot`

```
mandu.history.snapshot({
  repoRoot: ".",
  label: "pre-route-migration-2026-04-20"
})
```

스냅샷은 `.mandu/generated/**` 같이 git 추적 밖 산출물까지 포함해서 저장한다.
**label 은 항상 붙인다** — `mandu_list_history` 로 볼 때 뭐였는지 알아야 함.

### Step 2 — `mandu_begin`

```
mandu_begin({ label: "route-convention-migration" })
```

트랜잭션 ID 를 기억한다. Step 4 에서 쓴다. `mandu.tx.status` 로 상태 조회 가능.

### Step 3 — 실제 변경

이제야 파괴적 도구를 호출한다. **dry-run 이 있으면 먼저 dry-run**:

```
mandu.refactor.migrateRouteConventions({ dryRun: true, ... })
  → 변경 목록 검토
mandu.refactor.migrateRouteConventions({ dryRun: false, ... })
```

복합 변경이면 여러 도구를 순차 호출 — tx 안이므로 중간 실패도 안전.

### Step 4 — `mandu-mcp-verify` fast path

변경 후 검증. `mandu-mcp-verify` 의 병렬 3 콜 (`ate.auto_pipeline`, `guard_check`, `doctor`).

### Step 5a — 모두 green 이면 Commit

```
mandu_commit({ txId })
```

그리고 선택적으로 오래된 스냅샷 정리:

```
mandu_prune_history({ olderThan: "7d", keep: 10 })
```

### Step 5b — 실패면 Rollback

```
mandu_rollback({ txId })
```

그리고 스냅샷은 **삭제하지 않는다**. 원인 분석 / 로그 공유 후 재시도에 필요.

```
mandu.history.snapshot 은 그대로
  → 로그 수집
  → 원인 수정
  → Step 2 부터 다시
```

## 절대 규칙

| # | 규칙 | 이유 |
|---|------|------|
| SC-1 | `refactor_*` 또는 대규모 마이그레이션은 **반드시** 이 레시피 안에서 | snapshot 없는 변경은 롤백 불가 |
| SC-2 | `history.snapshot` 은 **`tx.begin` 전에** | tx 내부에서 찍으면 rollback 시 스냅샷도 사라질 수 있음 |
| SC-3 | `refactor_*` 도구는 **dry-run 먼저** (도구가 지원하면) | 변경 범위 가시화 없이 실행 금지 |
| SC-4 | verify 는 fast path 의 **세 개 모두** | 한두 개만 확인하고 커밋하는 건 안전망 의미 없음 |
| SC-5 | rollback 시 **스냅샷 유지** | 재시도 / 재현 / 로그 공유에 필요 |
| SC-6 | 하나의 tx 에 **하나의 의미 단위** | 여러 독립 변경을 한 tx 로 묶으면 부분 rollback 불가 |

## Anti-patterns

### AP — Snapshot Skip (index AP-3)
- 증상: `mandu.refactor.*` 를 `history.snapshot` 없이 바로 호출.
- 왜 안 되나: git 은 `.mandu/generated/**`, `node_modules/**`, 런타임 아티팩트를 추적하지 않는다. 실패 시 수동 복구 불가.
- 대응: Step 1 항상 실행. 예외 없음.

### AP — tx 없이 복합 변경
- 증상: `mandu_add_route` × 5 + `mandu_create_contract` × 3 + `mandu_generate` 를 독립 호출.
- 왜 안 되나: 중간에 실패하면 부분 생성물이 남아 guard violation 유발.
- 대응: `mandu_begin` ~ `mandu_commit` 또는 집계 도구 (`mandu.feature.create`) 로 묶는다.

### AP — Commit 전 verify 생략
- 증상: refactor → 바로 `mandu_commit`.
- 왜 안 되나: tx 커밋 = 되돌리기 포기. 검증 없이 커밋하면 깨진 상태가 확정.
- 대응: SC-4, fast path 3 개 모두 green 확인.

### AP — Rollback 후 같은 절차 재시도
- 증상: `mandu_rollback` → 뭐가 문제인지 분석 없이 Step 2 부터 같은 도구 같은 인자로 재실행.
- 왜 안 되나: 같은 실패가 재현된다. 시간 낭비.
- 대응: 스냅샷/로그로 원인 진단 → 인자 / 순서 / scope 수정 → 재시도.

### AP — 너무 큰 tx
- 증상: 여러 날에 걸쳐 여러 독립 변경을 하나의 tx 로.
- 왜 안 되나: 중간 실패 시 **무관한 변경까지** rollback 된다.
- 대응: SC-6, 의미 단위 하나씩.

## Quick Reference

```
위험 변경
  mandu.history.snapshot  (1 call)
  mandu_begin             (1 call)
  <refactor tool(s)>      (n calls)
  mandu-mcp-verify fast   (3 calls, parallel)
  ───────────────────────
  all green → mandu_commit        (1 call)
              mandu_prune_history (optional, 1 call)
  실패      → mandu_rollback      (1 call, 스냅샷 유지)
```

표준 총 호출 수:
- Happy path: **1 + 1 + n + 3 + 1 = 6 + n**
- Rollback path: **1 + 1 + n + 3 + 1 = 6 + n**

n (실제 변경 도구 호출) 을 줄이는 게 최적화 — 가능하면 집계 refactor 도구 하나로.

## See Also

- `mandu-mcp-index` — AP-3 (refactor without snapshot) / Tier-3 destructive 규칙
- `mandu-mcp-verify` — Step 4 의 fast path 상세
- `mandu-mcp-create-flow` — 간단한 생성은 여기로 (safe-change 불필요)
- `mandu-guard-guide` — verify 단계에서 guard 실패 시 수정 방법
