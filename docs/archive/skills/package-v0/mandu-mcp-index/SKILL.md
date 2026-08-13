---
name: mandu-mcp-index
description: |
  MCP 도구 오케스트레이션 라우터 (always-on). 108개 MCP 도구 중
  상황에 맞는 워크플로우 skill 선택, 집계>세분 우선순위, anti-pattern 카탈로그.
  MCP 도구 호출 직전 자동 참조.
---

# Mandu MCP Index

`@mandujs/mcp` 는 약 108 개의 MCP 도구를 노출합니다. 이 문서는
**flat palette 가 아니라 tiered hierarchy** 로 도구를 선택하도록 안내합니다.

핵심 원칙:

1. **Workflow skill 먼저**. 개별 도구가 아닌 `mandu-mcp-*` workflow skill 을 먼저 본다.
2. **집계 > 세분**. 같은 일을 하는 집계 도구가 있으면 그걸 먼저. 실패했을 때만 세분 도구로 drill-down.
3. **안전망 먼저**. `refactor_*` / 마이그레이션은 `mandu.history.snapshot` + `mandu.tx.begin` 안에서만.
4. **순서는 강제**. `mandu_create_contract` → `mandu_generate`, `mandu.history.snapshot` → `refactor_*`.

## 1. Situation -> Workflow Skill

| 상황 | 먼저 열 workflow skill | 보조 task-shaped skill |
|------|----------------------|----------------------|
| 세션 시작 / "현 상태?" / "무슨 일 있었어?" | `mandu-mcp-orient` | — |
| "만들어줘" / 피처·리소스·라우트 추가 | `mandu-mcp-create-flow` | `mandu-create-feature`, `mandu-create-api` |
| 편집 직후 / stop-hook / "check 해줘" | `mandu-mcp-verify` | `mandu-debug` |
| 마이그레이션 / 리팩터 / `refactor_*` | `mandu-mcp-safe-change` | — |
| 배포 / release / "deploy" | `mandu-mcp-deploy` | `mandu-deploy` |
| 에러 / 증상 기반 진단 | `mandu-mcp-verify` -> drill-down | `mandu-debug` |
| Guard 위반 | `mandu-mcp-verify` -> `mandu_guard_explain` | `mandu-guard-guide` |
| Island / Hydration | `mandu-mcp-verify` | `mandu-hydration`, `mandu-slot` |

## 2. Aggregate > Granular — 우선순위 표

한 번에 처리하는 집계 도구가 있으면 그걸 먼저. 실패/불충분할 때만 세분.

| 목적 | 집계 (먼저 호출) | 세분 (drill-down 용도만) |
|------|----------------|----------------------|
| 테스트 파이프라인 | `mandu.ate.auto_pipeline` | `mandu.ate.extract`, `mandu.ate.generate`, `mandu.ate.run`, `mandu.ate.heal`, `mandu.ate.apply_heal` |
| 세션 오리엔테이션 | `mandu.ai.brief` | `mandu_get_architecture`, `mandu_get_decisions`, `mandu_list_routes` |
| 배포 준비 | `mandu.deploy.check` | `mandu_guard_check`, `mandu_validate_contracts`, `mandu_validate_manifest` |
| 배포 미리보기 | `mandu.deploy.preview` | `mandu_preview_seo`, `mandu_write_seo_file` |
| 구조/진단 | `mandu_doctor` | `mandu_check_import`, `mandu_check_location` |
| 스캐폴드 | `mandu_generate_scaffold` (negotiate → scaffold 묶음) | `mandu_add_route`, `mandu_create_contract`, `mandu_generate` |
| 피처 생성 | `mandu.feature.create` | `mandu_add_route` × n + contract + generate |
| 리소스 생성 | `mandu.resource.create` | `mandu.resource.addField`, `mandu_create_contract`, `mandu_generate` |

규칙:

- **집계 도구 실패 시에만** 개별 도구로 분해한다. "4번 부르면 뭐 하는지 알 수 있을 것 같아서" 라는 이유로 `extract → generate → run → heal` 을 수동으로 호출하지 않는다.
- 집계 도구는 내부에서 올바른 **순서 / 병렬화 / 실패 복구** 를 이미 구현하고 있다. 손으로 재조립하면 그 보장을 잃는다.

## 3. Tiered Tool Hierarchy (108 tools)

> 전체 나열이 아니라 *계층* 이다. 각 티어 안에서 "먼저 볼 곳" 이 정해져 있다.

### Tier 0 — Aggregate Orchestrators (먼저 본다)

- `mandu.ai.brief` — 세션 진입용 종합 브리핑
- `mandu.ate.auto_pipeline` — ATE 전체 파이프라인 (extract/generate/run/heal)
- `mandu.deploy.check` — guard + contract + manifest 병렬 검사
- `mandu.deploy.preview` — 프로덕션 빌드 사전 리허설
- `mandu_doctor` (alias of `mandu.brain.doctor`) — 구조/임포트/위치 진단
- `mandu.feature.create`, `mandu.resource.create` — 복합 스캐폴드
- `mandu_generate_scaffold` (alias of `mandu.negotiate.scaffold`) — negotiate→scaffold 묶음

### Tier 1 — Domain Entry Points

| Domain | Entry tool | 역할 |
|--------|-----------|------|
| Architecture | `mandu_get_architecture` (alias `mandu.brain.architecture`) | 프리셋/레이어 규칙 |
| Decisions | `mandu_get_decisions` | ADR / 결정 이력 |
| Contract | `mandu_list_contracts`, `mandu_create_contract` | Zod 계약 |
| Routes | `mandu_list_routes`, `mandu_add_route` | FS 라우트 |
| Island | `mandu_list_islands`, `mandu_set_hydration` | 하이드레이션 |
| Slot | `mandu_read_slot`, `mandu_validate_slot` | 서버 로더 |
| SEO | `mandu_preview_seo`, `mandu_write_seo_file` | 메타/sitemap/robots |
| Runtime | `mandu_get_runtime_config` | 실행 구성 |
| Guard | `mandu_guard_check`, `mandu_guard_heal`, `mandu_guard_explain` | 아키텍처 강제 |
| History | `mandu.history.snapshot`, `mandu_list_history`, `mandu_prune_history` | 스냅샷 |
| Transaction | `mandu_begin`, `mandu_commit`, `mandu_rollback`, `mandu_tx_status` | 트랜잭션 |
| Kitchen | `mandu_kitchen_errors` | 런타임 에러 스트림 |

### Tier 2 — Granular Operations (drill-down 시에만)

- ATE 개별: `mandu.ate.extract`, `mandu.ate.generate`, `mandu.ate.run`, `mandu.ate.report`, `mandu.ate.heal`, `mandu.ate.apply_heal`, `mandu.ate.impact`, `mandu.ate.feedback`
- Brain 세분: `mandu_check_import`, `mandu_check_location`, `mandu_watch_start`, `mandu_watch_stop`, `mandu_watch_status`
- Contract 세분: `mandu_get_contract`, `mandu_update_route_contract`, `mandu_validate_contracts`, `mandu_sync_contract_slot`, `mandu_generate_openapi`
- Resource 세분: `mandu.resource.list`, `mandu.resource.get`, `mandu.resource.addField`, `mandu.resource.removeField`
- SEO 세분: `mandu_generate_sitemap_preview`, `mandu_generate_robots_preview`, `mandu_create_jsonld`, `mandu_seo_analyze`

### Tier 3 — Destructive / AI Refactor (항상 Safe-Change wrapper)

> 이 레이어의 도구는 **반드시** `mandu-mcp-safe-change` 레시피 안에서만 호출한다.
> `mandu.history.snapshot` 선행 + `mandu.tx.begin` 래핑 필수.

- `mandu.refactor.rewriteGeneratedBarrel`
- `mandu.refactor.migrateRouteConventions`
- `mandu.refactor.extractContract`

## 4. Anti-Pattern Catalog

다음 패턴이 감지되면 **즉시 멈추고** 대응 워크플로우로 전환한다.

### AP-1 — ATE 수동 조합
- 증상: `mandu.ate.extract` → `mandu.ate.generate` → `mandu.ate.run` → `mandu.ate.heal` 를 개별 호출.
- 왜 안 되나: `mandu.ate.auto_pipeline` 이 이 시퀀스를 내부에서 올바른 순서와 실패 복구로 실행한다. 수동 조합은 왕복 4배 + 오더링 버그 + 실패 지점에서 멈추지 못함.
- 대응: `mandu-mcp-verify` 의 fast path (`mandu.ate.auto_pipeline`) 사용. 실패 응답이 개별 도구를 지시할 때만 분해.

### AP-2 — Generate before Contract
- 증상: `mandu_generate` 를 `mandu_create_contract` 없이 호출.
- 왜 안 되나: 생성물 (`.mandu/generated/**`) 의 타입이 unstable. Re-generate 시 매번 변경되고, API-호출 쪽 타입이 부유.
- 대응: `mandu-mcp-create-flow` 순서 (`negotiate → route/resource → contract → generate`) 고정.

### AP-3 — Refactor without Snapshot
- 증상: `mandu.refactor.*` 또는 마이그레이션을 `mandu.history.snapshot` 없이 호출.
- 왜 안 되나: 롤백 포인트가 없어 실패 시 수동 복구 불가. Git 이 있어도 `.mandu/generated/**` 같은 생성물은 추적 밖.
- 대응: `mandu-mcp-safe-change` 레시피 (`snapshot → tx_begin → edit+verify → commit/rollback`).

### AP-4 — Name-Match Tool Pick
- 증상: "이름이 맞아 보여서" 108개 중 하나를 직접 호출. 예: "build 니까 `mandu_build`" "deploy 니까 `mandu.deploy.*`".
- 왜 안 되나: 같은 도메인에 3-4개 도구가 있고 집계 도구가 우선한다. 잘못 고르면 효과가 없거나 순서가 깨진다.
- 대응: 먼저 이 index 의 **Situation → Workflow Skill** 표에서 workflow skill 을 고르고, workflow skill 이 지시하는 도구만 호출.

### AP-5 — Guard After Commit
- 증상: `mandu_guard_check` 를 `git commit` 후 실행.
- 왜 안 되나: 위반을 커밋 안에 박음. CI 에서 reject 되거나 revert 부담.
- 대응: `mandu-mcp-verify` fast path 를 편집 직후 / pre-commit hook 으로.

### AP-6 — Parallel Mutation Without Transaction
- 증상: `mandu_add_route`, `mandu_create_contract`, `mandu_generate` 를 `mandu.tx.begin` 없이 독립적으로.
- 왜 안 되나: 중간에 실패하면 반쯤 만들어진 상태가 남는다. (예: route 만 있고 contract 없음 → guard violation.)
- 대응: 복합 스캐폴드는 `mandu.resource.create` / `mandu.feature.create` / `mandu_generate_scaffold` 집계로, 또는 `mandu-mcp-safe-change` 로.

### AP-7 — Manual Build Pipeline
- 증상: 배포 전에 `mandu_build`, `mandu_guard_check`, `mandu_validate_contracts`, `mandu_validate_manifest`, `mandu_preview_seo` 를 손으로 나열.
- 왜 안 되나: `mandu.deploy.check` + `mandu.deploy.preview` 가 이 시퀀스를 올바른 순서와 병렬로 이미 처리한다.
- 대응: `mandu-mcp-deploy` 레시피.

## 5. Escalation Flow

```
요청 도착
  → mandu-mcp-index (이 문서) 로 상황 매핑
  → 해당 workflow skill 오픈
    → 집계 도구 먼저 호출
      → 통과: 종료
      → 실패: workflow skill 의 drill-down 섹션으로만 진입
    → 필요시 task-shaped skill (mandu-debug, mandu-guard-guide, ...) 참조
```

이 순서를 뒤집지 않는다. 특히 **108개 도구 목록을 직접 훑지 않는다** — workflow skill 이 고른 도구만 호출한다.

## See Also

- `mandu-mcp-orient` — 세션 시작 시 상태 파악
- `mandu-mcp-create-flow` — 스펙 우선 생성
- `mandu-mcp-verify` — 편집 후 검증
- `mandu-mcp-safe-change` — 위험 변경 트랜잭션
- `mandu-mcp-deploy` — 빌드/배포
- `mandu-create-feature`, `mandu-create-api`, `mandu-debug`, `mandu-guard-guide` — 도메인 지식 skill
