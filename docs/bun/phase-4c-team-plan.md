---
title: "Phase 4c — 에이전트 팀 실행 계획"
status: execution-plan
audience: Mandu core team + dispatched agents
depends_on:
  - docs/rfcs/0001-db-resource-layer.md
  - docs/bun/phases-4-plus.md
created: 2026-04-18
---

# Phase 4c — 에이전트 팀 실행 계획

Resource → DDL → migration SQL → generated repo — 자동화의 마지막 조각. 3주 분량의 작업을 **7-agent × 4 라운드** 병렬로 압축. 이 문서가 팀의 북극성.

---

## 1. 분리 가능한 6 concerns + 보안

| # | Concern | 라운드 | Agent |
|---|---|---|---|
| 1 | DDL Engine (type map + dialect-aware emit) | R1 | A |
| 2 | Schema Diff Engine (snapshot-based) | R1 | B |
| 3 | Migration Runtime (__mandu_migrations + apply + lock) | R1 | C |
| 4 | Resource Generator 확장 (*.repo.ts + *.schema.sql) | R2 | D |
| 5 | `mandu db` CLI | R2 | E |
| 6 | Validation + Demo (매트릭스 + auth-starter DB 통합) | R3 | F |
| 7 | Security 감사 (SQL injection, identifier quoting, checksum) | R4 | G |

---

## 2. 공유 타입 계약 — 사전 확정

**모든 에이전트는 `packages/core/src/resource/ddl/types.ts` 에서 타입 import.** 이 파일은 **Round 1 시작 전 내가 직접 작성**해 Agents A/B/C 가 동일 상형을 보고 작업.

`types.ts` 가 정의하는 것:
- `SqlProvider = "postgres" | "mysql" | "sqlite"`
- `DdlFieldType` (9 타입: uuid/string/int/bigint/float/boolean/timestamp/json/bytes)
- `DdlFieldDef` — DDL-relevant field subset of ParsedResource fields
- `DdlResource` — table name + fields[] (ParsedResource 에서 derive)
- `Snapshot` — { version: 1, resources: DdlResource[] }
- `Change` — discriminated union: create-table / drop-table / add-column / drop-column / alter-column-type (stub) / add-index / drop-index / rename-column (stub) / rename-table (stub)
- `PendingMigration` — { version, filename, sql, checksum, createdAt }
- `AppliedMigration` — PendingMigration + { appliedAt, executionMs, success }

v1 스코프 외 제외: FK, ENUM, CHECK constraint, computed column, trigger, view, stored procedure.

---

## 3. 에이전트 I/O 명세

### Agent A — DDL Engineer (backend-architect, R1)
**파일**: `packages/core/src/resource/ddl/emit.ts` + `__tests__/emit.test.ts`
**Input**: `DdlResource`, `Change`, `SqlProvider`
**Output**: SQL string
**Exports**:
- `emitCreateTable(resource: DdlResource, provider): string`
- `emitChange(change: Change, provider): string`  (dispatch on change.kind)
- `emitSchema(resources: DdlResource[], provider): string`  (multi-table)
- `quoteIdent(name: string, provider): string`  (`"name"` or `` `name` ``)

### Agent B — Schema Diff Engineer (backend-architect, R1)
**파일**: `packages/core/src/resource/ddl/diff.ts` + `snapshot.ts` + `__tests__/diff.test.ts`
**Input**: `ParsedResource[]`, `Snapshot | null`
**Output**: `Change[]` (deterministic order)
**Exports**:
- `snapshotFromResources(resources: ParsedResource[]): Snapshot`
- `diffSnapshots(old: Snapshot | null, next: Snapshot): Change[]`
- `serializeSnapshot(s: Snapshot): string`  (JSON.stringify 5-space-indent for diff-friendly git)
- `parseSnapshot(s: string): Snapshot`

### Agent C — Migration Runtime (backend-architect, R1)
**파일**: `packages/core/src/db/migrations/runner.ts` + `history-table.ts` + `__tests__/runner.test.ts`
**Input**: `Db`, migrations directory path
**Output**: plan / apply / status results
**Exports**:
- `createMigrationRunner(db: Db, options: { migrationsDir: string; lockStrategy?: LockStrategy }): MigrationRunner`
- `MigrationRunner.plan(): Promise<PendingMigration[]>`
- `MigrationRunner.apply(options?: { dryRun?: boolean }): Promise<AppliedMigration[]>`
- `MigrationRunner.status(): Promise<{ applied: AppliedMigration[]; pending: PendingMigration[] }>`
- `MigrationRunner.ensureHistoryTable(): Promise<void>`  (idempotent create of `__mandu_migrations`)
- checksum = SHA-256 of migration SQL with newlines normalized to `\n`

### Agent D — Generator Integrator (refactoring-expert, R2)
**파일**: `packages/core/src/resource/generator.ts` (수정) + `generator-repo.ts` (신규) + `generator-schema.ts` (신규)
**Input**: Agent A's `emitSchema`, Agent B's `diffSnapshots`
**Output**: 생성된 `*.repo.ts`, `*.schema.sql`, `spec/db/migrations/NNNN_auto.sql` 파일
**Critical**: `resource/__tests__/generator.test.ts` Appendix B TC-1~6 (preservation) 반드시 통과

### Agent E — CLI Engineer (backend-architect, R2)
**파일**: `packages/cli/src/commands/db.ts` + CLI registry 등록
**Input**: Agents A/B/C 의 primitives
**Output**: `mandu db plan | apply | status | reset` 명령
**특수**: Rename 프롬프트 (TTY 인터랙티브), `--ci` non-interactive 모드

### Agent F — QA + Demo (quality-engineer, R3)
**파일**: `packages/core/tests/resource/db-migration-e2e.test.ts` + `demo/auth-starter/spec/resources/posts.resource.ts` (신규 리소스) + E2E 추가
**Input**: Rounds 1/2 전부
**Output**: 3 dialect matrix 통합 테스트 + auth-starter 에 posts 리소스 추가 (기존 user flow 불변)

### Agent G — Security Engineer (security-engineer, R4)
**파일**: `docs/security/phase-4c-audit.md` + 발견 시 fix PR
**Input**: Rounds 1~3 전부
**Output**: 감사 리포트 + 필요 시 작은 패치. SQL injection surface, identifier quoting 완전성, checksum tamper 시나리오, migration file 조작 방어, AsyncLocalStorage tx 누출 (v2 대비).

---

## 4. 의존성 DAG

```
[Pre-R1 (me)]
  types.ts 작성 + 브리프 작성
        ↓
[R1 병렬 — 독립]
  A: DDL emit         ─┐
  B: Diff engine       ├─→ 세 개 merge 후 ──┐
  C: Migration runtime ─┘                     │
                                              ↓
[R2 병렬 — types.ts + A/B/C 소비]
  D: Generator 확장    ─┐
  E: CLI               ─┴─→ merge 후 ──┐
                                        ↓
[R3 단일 — Rounds 1+2 통합 검증]
  F: QA + Demo migration
                                        ↓
[R4 단일 — 감사]
  G: Security review
```

---

## 5. v1 스코프 경계 (각 에이전트 명시적 주지)

**포함**:
- CREATE TABLE (3 dialect) · ADD COLUMN · DROP COLUMN (stub 경고) · ADD INDEX · DROP INDEX
- Snapshot 기반 deterministic diff
- Forward-only migration · Checksum 검증 · Schema history table
- `mandu db plan/apply/status` + rename 인터랙티브 프롬프트
- Generated `*.repo.ts` 의 5 CRUD: `findById`, `findMany`, `create`, `update`, `delete`

**제외 (v2+)**:
- Foreign key · ENUM · CHECK constraint
- Type change 자동 처리 (stub + 유저 edit)
- Rollback (`down` migration)
- Repeatable migration (Flyway `R__` 스타일)
- Multi-instance apply coordination (single-process lock 만)
- AsyncLocalStorage implicit tx context (Phase 4c.1 로 연기, v1 은 explicit `db.transaction`)
- Schema introspection / reverse-engineer

---

## 6. 품질 게이트

모든 에이전트 merge 조건:
1. 자신의 모듈 단위 테스트 ≥ 15 (R1/R2) 또는 매트릭스 ≥ 30 (R3)
2. `bun run test:core` 1961+ pass, 0 fail
3. `bun run test:cli` 134+ pass (R2+R3 영향 범위)
4. `bun run typecheck` 4 패키지 clean
5. R2+: `demo/auth-starter` E2E 11+ pass 유지 (posts 리소스 추가로 13~15 까지 증가 예상)
6. R3 특수: 3 dialect Docker 매트릭스 (Postgres + MySQL + SQLite) 전부 pass

---

## 7. 리스크 & 방어

| 리스크 | 담당 | 방어 |
|---|---|---|
| R1 병렬 타입 미스매치 | A/B/C | **types.ts 사전 작성** (이 문서 §2) |
| Generator 가 기존 사용자 앱 파손 | D | Appendix B TC-1~6 regression 강제. 기존 `todo-app` / `ai-chat` / `auth-starter` E2E 유지 |
| MySQL dialect 버그 (RETURNING 등) | A + F | 매트릭스 통합 테스트로 컴파일이 아닌 **실행 시점** 에 발견 |
| Checksum false-positive (CRLF vs LF) | C | Hash 전 `\r\n` → `\n` 정규화. Flyway 동일 방식 |
| Rename 오탐 (A 드롭 + B 추가 = rename?) | B + E | Diff 엔진은 **항상 drop+add 로 출력**, CLI 만 interactive 프롬프트로 rename 으로 재해석 |
| SQL injection via resource name | A + G | `quoteIdent` 가 모든 identifier emit 담당. DDL 값에 유저 입력 없음 (값은 runtime insert 만) |
| 동시 apply 파손 | C | dialect별 lock: PG `pg_advisory_lock`, MySQL `GET_LOCK`, SQLite `BEGIN IMMEDIATE` |
| Migration file 변조 (체크섬 mismatch) | C | apply 시점 checksum 재계산 → __mandu_migrations 저장값과 비교 → mismatch 시 fail-fast |

---

## 8. 커밋 전략

라운드별 커밋 (bisect 용이):
- `feat(core): Phase 4c.R1 — DDL emit + diff engine + migration runtime`
- `feat(core,cli): Phase 4c.R2 — resource generator extension + mandu db CLI`
- `test(core,demo): Phase 4c.R3 — dialect matrix + auth-starter posts demo`
- `security(core): Phase 4c.R4 — audit report + fixes`

각 커밋은 pre-push typecheck 통과 전 push 안 됨 (lefthook 훅).

---

## 9. 예상 완료 시간

에이전트 실 작업량 기준:
- R1 (병렬 3): 약 10~15분 알림 (동시 실행이라 전체 wall clock 짧음)
- R2 (병렬 2): 10~15분
- R3 (단일, 매트릭스 테스트 무거움): 20~30분
- R4 (단일): 10~15분

**전체 wall clock**: 1~2시간 (내 검토 + commit 포함). 전통 순차 구현이면 3주짜리 작업.

---

## 10. 실행 순서 체크리스트

- [x] 이 계획 문서 작성
- [ ] `packages/core/src/resource/ddl/types.ts` 사전 작성 (공유 계약)
- [ ] R1 3 에이전트 브리핑 + 파견
- [ ] R1 완료 검증 (단위 테스트 + typecheck + 회귀)
- [ ] R1 커밋 + 푸시
- [ ] R2 2 에이전트 브리핑 + 파견
- [ ] R2 완료 검증 + 커밋 + 푸시
- [ ] R3 단일 에이전트 파견
- [ ] R3 완료 검증 (3 dialect 매트릭스) + 커밋 + 푸시
- [ ] R4 보안 감사 파견
- [ ] R4 감사 리포트 검토 + 발견 사항 fix + 커밋 + 푸시
- [ ] Phase 4c 종료 보고

*이 문서는 실행 중 업데이트 금지. 변경 필요 시 ADR/RFC 추가.*
