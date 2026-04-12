# MCP Tool Naming Unification Plan

> 64개 밑줄(underscore) 도구 → 점(dot) 표기로 통일
>
> Breaking Change — major 버전에 포함

---

## 네이밍 규칙

```
mandu.<카테고리>.<동작>
```

- **카테고리**: 도구가 속한 기능 영역 (route, guard, contract 등)
- **동작**: 구체적 작업 (list, get, create, check, heal 등)
- 2단계가 자연스러운 경우: `mandu.<동작>` (예: mandu.init, mandu.build)

---

## 변환 맵 (64개)

### spec.ts — Route 관리 (5개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_list_routes` | `mandu.route.list` |
| `mandu_get_route` | `mandu.route.get` |
| `mandu_add_route` | `mandu.route.add` |
| `mandu_delete_route` | `mandu.route.delete` |
| `mandu_validate_manifest` | `mandu.manifest.validate` |

### contract.ts — Contract 관리 (7개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_list_contracts` | `mandu.contract.list` |
| `mandu_get_contract` | `mandu.contract.get` |
| `mandu_create_contract` | `mandu.contract.create` |
| `mandu_update_route_contract` | `mandu.contract.link` |
| `mandu_validate_contracts` | `mandu.contract.validate` |
| `mandu_sync_contract_slot` | `mandu.contract.sync` |
| `mandu_generate_openapi` | `mandu.contract.openapi` |

### guard.ts — Guard 검증 (4개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_guard_check` | `mandu.guard.check` |
| `mandu_analyze_error` | `mandu.guard.analyze` |
| `mandu_guard_heal` | `mandu.guard.heal` |
| `mandu_guard_explain` | `mandu.guard.explain` |

### decisions.ts — 의사결정 기록 (4개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_get_decisions` | `mandu.decision.list` |
| `mandu_save_decision` | `mandu.decision.save` |
| `mandu_check_consistency` | `mandu.decision.check` |
| `mandu_get_architecture` | `mandu.decision.architecture` |

### negotiate.ts — 아키텍처 협상 (3개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_negotiate` | `mandu.negotiate` |
| `mandu_generate_scaffold` | `mandu.negotiate.scaffold` |
| `mandu_analyze_structure` | `mandu.negotiate.analyze` |

### slot-validation.ts — 슬롯 검증 (2개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_validate_slot` | `mandu.slot.validate` |
| `mandu_get_slot_constraints` | `mandu.slot.constraints` |

### slot.ts — 슬롯 읽기 (2개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_read_slot` | `mandu.slot.read` |
| `mandu_validate_slot` | `mandu.slot.validate` (중복 — slot-validation.ts와 통합 필요) |

### generate.ts — 코드 생성 (2개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_generate` | `mandu.generate` |
| `mandu_generate_status` | `mandu.generate.status` |

### kitchen.ts — DevTools (1개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_kitchen_errors` | `mandu.kitchen.errors` |

### brain.ts — AI 분석 (7개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_doctor` | `mandu.brain.doctor` |
| `mandu_watch_start` | `mandu.watch.start` |
| `mandu_watch_stop` | `mandu.watch.stop` |
| `mandu_watch_status` | `mandu.watch.status` |
| `mandu_check_location` | `mandu.brain.checkLocation` |
| `mandu_check_import` | `mandu.brain.checkImport` |
| `mandu_get_architecture` | `mandu.brain.architecture` (brain.ts 버전 — decisions.ts와 중복 해결) |

### project.ts — 프로젝트 관리 (3개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_init` | `mandu.project.init` |
| `mandu_dev_start` | `mandu.dev.start` |
| `mandu_dev_stop` | `mandu.dev.stop` |

### hydration.ts — Island/빌드 (5개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_build` | `mandu.build` |
| `mandu_build_status` | `mandu.build.status` |
| `mandu_list_islands` | `mandu.island.list` |
| `mandu_set_hydration` | `mandu.hydration.set` |
| `mandu_add_client_slot` | `mandu.hydration.addClientSlot` |

### transaction.ts — 트랜잭션 (4개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_begin` | `mandu.tx.begin` |
| `mandu_commit` | `mandu.tx.commit` |
| `mandu_rollback` | `mandu.tx.rollback` |
| `mandu_tx_status` | `mandu.tx.status` |

### history.ts — 이력 (3개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_list_history` | `mandu.history.list` |
| `mandu_get_snapshot` | `mandu.history.snapshot` |
| `mandu_prune_history` | `mandu.history.prune` |

### component.ts — 컴포넌트 (1개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_add_component` | `mandu.component.add` |

### runtime.ts — 런타임 설정 (5개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_get_runtime_config` | `mandu.runtime.config` |
| `mandu_set_contract_normalize` | `mandu.runtime.setNormalize` |
| `mandu_get_contract_options` | `mandu.runtime.contractOptions` |
| `mandu_list_logger_options` | `mandu.runtime.loggerOptions` |
| `mandu_generate_logger_config` | `mandu.runtime.loggerConfig` |

### seo.ts — SEO (6개)

| 현재 | 변경 후 |
|------|--------|
| `mandu_preview_seo` | `mandu.seo.preview` |
| `mandu_seo_analyze` | `mandu.seo.analyze` |
| `mandu_generate_sitemap_preview` | `mandu.seo.sitemap` |
| `mandu_generate_robots_preview` | `mandu.seo.robots` |
| `mandu_create_jsonld` | `mandu.seo.jsonld` |
| `mandu_write_seo_file` | `mandu.seo.write` |

### 이미 점 표기인 도구 (변경 없음, 21개)

- `mandu.ate.*` (9개)
- `mandu.resource.*` (5개)
- `mandu.feature.create`, `mandu.diagnose`, `mandu.island.add` (3개)
- `mandu.middleware.add`, `mandu.test.route`, `mandu.deploy.check`, `mandu.cache.manage` (4개)

---

## 영향 범위

### 코드 변경 대상

| 위치 | 변경 내용 |
|------|----------|
| `packages/mcp/src/tools/*.ts` | tool definition `name` 필드 |
| `packages/mcp/src/tools/*.ts` | handler 함수의 키 이름 (export object keys) |
| `packages/mcp/src/tools/composite.ts` | 자식 도구 호출 시 키 이름 |
| `packages/mcp/src/tools/index.ts` | 혹시 하드코딩된 이름이 있으면 |
| `packages/mcp/src/prompts.ts` | 프롬프트 내 도구 이름 참조 |
| `packages/skills/skills/*/SKILL.md` | 스킬 내 도구 이름 참조 |
| `packages/cli/src/commands/mcp.ts` | CLI 브리지 (도구 이름 표시) |
| `docs/*.md` | 문서 내 도구 이름 참조 |

### 사용자 영향

| 위치 | 영향 |
|------|------|
| `.claude/settings.json` | `"mcp__mandu__mandu_*"` 권한 패턴 → `"mcp__mandu__mandu.*"` |
| `.mcp.json` | 변경 없음 (서버 이름만 사용) |
| CLAUDE.md | 도구 이름 참조 있으면 업데이트 필요 |

### 호환성 전략

**Option A: 별칭 유지 (권장)**
```typescript
// handler에서 새 이름과 구 이름 모두 등록
handlers["mandu.guard.check"] = guardCheckHandler;
handlers["mandu_guard_check"] = guardCheckHandler; // deprecated alias
```
→ 기존 사용자 코드 안 깨지고, 점진적 마이그레이션 가능

**Option B: 한번에 교체**
→ major 버전 릴리스 시 일괄 변경, 마이그레이션 가이드 제공

---

## 중복 도구 해결

| 중복 | 해결 |
|------|------|
| `mandu_validate_slot` (guard.ts + slot.ts) | slot.ts 것만 유지 → `mandu.slot.validate` |
| `mandu_get_architecture` (decisions.ts + brain.ts) | decisions.ts → `mandu.decision.architecture`, brain.ts → `mandu.brain.architecture` |

---

## 구현 순서

1. 변환 맵 확정 (이 문서)
2. handler 키 이름 변경 + 별칭 등록
3. tool definition `name` 필드 변경
4. composite.ts 참조 업데이트
5. prompts.ts 참조 업데이트
6. Skills SKILL.md 참조 업데이트
7. 문서 업데이트
8. 테스트 업데이트
9. settings.json 템플릿 업데이트
