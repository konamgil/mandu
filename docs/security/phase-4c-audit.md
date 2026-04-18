---
title: "Phase 4c — 보안 감사 보고서 (R4 최종 게이트)"
status: audit-complete
audience: Mandu core team + release review
scope:
  - Rounds R1/R2/R3 구현 전수 (2026-04-18)
  - Resource → DDL → migration → generated repo 파이프라인
last_commit_audited: b785fe2
related:
  - docs/bun/phase-4c-team-plan.md
  - docs/rfcs/0001-db-resource-layer.md
created: 2026-04-18
---

# Phase 4c — 보안 감사 보고서

Phase 4c (`feat(core): Phase 4c.R1` ~ `feat(core,cli,demo): Phase 4c.R3`)에 대한 merge-gate 감사. 감사자가 작성한 CRITICAL/HIGH 발견 1건은 최소 범위 패치로 해당 파일에 직접 적용되어 있으며, 아래의 "수정된 파일" 섹션에 목록이 있다. MEDIUM/LOW/INFO 항목은 TODO로 기록만 남겼다 (v2 스코프 또는 문서화로 충분).

---

## 1. 감사 요약

| 심각도 | 카운트 | 상태 |
|---|---|---|
| Critical | 0 | — |
| High | **1** | 패치 적용 완료 |
| Medium | 4 | TODO (v2) |
| Low | 5 | TODO (v2) |
| Info | 4 | 문서화 |

### 감사 범위

| # | 영역 | 파일 | 결과 |
|---|---|---|---|
| 1 | SQL injection surface | `ddl/emit.ts`, `ddl/quote.ts` (=`emit.ts#quoteIdent`) | ✅ 통과 — whitelist + NUL 차단 |
| 2 | Identifier quoting 완전성 | 모든 DDL emit 지점 | ✅ 통과 — 모두 `quoteIdent` 경유 |
| 3 | Checksum tamper 시나리오 | `runner.ts`, `history-table.ts` | ✅ 통과 (documented limitation) |
| 4 | Migration file 조작 방어 | `runner.ts#readMigrationsFromDisk` | ✅ 통과 — regex + tamper re-check |
| 5 | Lock 우회 / race | `lock.ts`, `runner.ts#apply` | ⚠️ M-02 (read-before-lock window) |
| 6 | Generated repo SQL 안전성 | `generator-repo.ts` | ✅ 통과 — 값은 bound params, identifier는 `quoteIdent` |
| 7 | CLI secrets 노출 | `apply.ts`, `plan.ts`, `resolve-db.ts` | ⚠️ M-03 (driver error 메시지 통과) |
| 8 | applied.json 취급 | `generator-schema.ts`, `apply.ts` | ✅ 통과 — fail-closed |
| 9 | Rename prompt ANSI surface | `rename-prompt.ts` | ✅ 통과 — 입력이 validated |
| 10 | AsyncLocalStorage tx 누출 | `db/index.ts` | ✅ 통과 — v1은 explicit tx만 |
| 11 | **경로 순회 (path traversal)** | `generator-schema.ts#writeSchemaArtifacts` | ❌ **H-01** — 패치 적용 |

---

## 2. 발견 상세

### H-01 — Path traversal via unvalidated `tableName` / `pluralName` in `writeSchemaArtifacts`

**심각도**: High
**상태**: 패치 적용 완료 (`feat-level fix`, commit 전 staging)
**CWE**: [CWE-22 (Path Traversal)](https://cwe.mitre.org/data/definitions/22.html)
**OWASP**: A01:2021 — Broken Access Control

#### 영향

`writeSchemaArtifacts` (packages/core/src/resource/generator-schema.ts:197)가 `desiredSchemaByTable`의 키를 그대로 `path.join(paths.resourceSchemaOutDir, \`${tableName}.sql\`)`로 파일 경로에 합성하고 있었다. `tableName`의 공급원:

1. `persistence.tableName` — `asPersistence`가 `typeof === "string"` 만 검사, 형식 미검증.
2. `options.pluralName` — Phase 4c 이전부터 있던 필드, 런타임 형식 검사 없음.
3. 자동 pluralize된 `definition.name` — `validateResourceDefinition`이 `/^[a-z][a-z0-9_]*$/i` 로 검사하므로 안전.

공급원 1 또는 2에 `"../../../../etc/passwd-evil"` 같은 값이 들어오면, `path.join`이 `resourceSchemaOutDir`를 벗어난 임의 위치에 SQL 파일을 쓰게 된다. 악의적 resource 정의 혹은 공급망 공격 (신뢰되지 않은 npm 패키지가 `defineResource`를 export하는 경우) 을 통해 트리거 가능.

**이차 피해**: `emit.ts#quoteIdent`는 `..`에 대해 throw하지 않는다 (`"..".length === 2`, NUL 없음, `"` / \`\` 없음). 따라서 DDL 생성 경로는 통과하지만, 생성된 CREATE TABLE `".."` 은 대부분의 DB에서 문법적으로 수용되어 이후 조인·쿼리 기대치가 무너질 수 있다 (보조 문제 — 주된 이슈는 파일시스템 쓰기).

#### 재현 단계

1. `spec/resources/evil.resource.ts`에서:
   ```ts
   export default defineResource({
     name: "evil",
     fields: { id: { type: "uuid", required: true, primary: true } },
     options: {
       persistence: {
         provider: "sqlite",
         tableName: "../../../tmp/pwned",
       },
     },
   });
   ```
2. `mandu generate` 또는 `mandu db plan` 실행.
3. Pre-patch: `.mandu/../../../tmp/pwned.sql` 경로에 CREATE TABLE 문이 쓰인다. `resourceSchemaOutDir`를 탈출.

(데모는 실행하지 않았으나 `path.join` 동작을 코드 상으로 검증 완료.)

#### 수정

두 곳에서 방어를 추가했다:

1. **Primary (persistence-types.ts)**: `asPersistence()` 안에서 `tableName`, `fieldOverrides[*].columnName`, `indexes[*].name`을 `SAFE_PERSISTENCE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/`로 format 검증 + `MAX_PERSISTENCE_IDENTIFIER_LENGTH = 63` 길이 제한.
2. **Defense-in-depth (generator-schema.ts)**: `writeSchemaArtifacts`가 모든 파일 경로를 `safeJoinSegment()`를 거치게 변경. `safeJoinSegment`는:
   - 입력 segment를 regex allowlist로 검사 (`SAFE_TABLE_FILE_SEGMENT_RE` 또는 `SAFE_MIGRATION_FILE_SEGMENT_RE`).
   - `path.resolve(joined)`가 `path.resolve(dir) + path.sep` 로 시작하는지 검사 → symlink/UNC 경로 같은 크로스플랫폼 엣지케이스도 막음.

`options.pluralName`은 스키마 검증이 4c 이전부터 없었으므로 `asPersistence` 검사가 잡지 못한다 → `safeJoinSegment`의 defense-in-depth로 막힘. 소급 적용으로 pre-4c의 `pluralName: "people's"` 같은 비-ASCII/공백 포함 값은 이제 거부되지만, 이는 의도된 tightening이며 SQL identifier로 사용할 수 없는 값이었다.

#### 수정된 파일

- `packages/core/src/resource/ddl/persistence-types.ts` — `asPersistence`에 format 검증 + `SAFE_PERSISTENCE_IDENTIFIER_RE` export.
- `packages/core/src/resource/generator-schema.ts` — `safeJoinSegment` 도입, 테이블 파일 + 마이그레이션 파일 양쪽에 적용.

#### 회귀 테스트

기존 테스트 125/125 pass (schema generation, generator integration, preservation TC-1~6 포함). 새로운 format-rejection 테스트는 별도 RFC에서 작성 예정 (TODO: N1 아래).

#### 관련 CWE / OWASP

- [CWE-22 Path Traversal](https://cwe.mitre.org/data/definitions/22.html)
- [CWE-73 External Control of File Name or Path](https://cwe.mitre.org/data/definitions/73.html)
- OWASP A01:2021 Broken Access Control

---

### M-01 — Read-before-lock window in `runner.apply()`

**심각도**: Medium
**상태**: TODO (v2 또는 4c.1 패치)
**파일**: `packages/core/src/db/migrations/runner.ts:253-293`

#### 영향

`apply()`는 다음 순서로 진행한다:

1. `history = readAllHistory(...)` — 락 획득 **전**
2. `diskFiles = readMigrationsFromDisk(...)` — 락 획득 전
3. Tamper 체크 — 락 획득 전
4. `pending = diskFiles.filter(...)` — 락 획득 전
5. **락 획득** — `acquireMigrationLock(...)`
6. `for (pending)` 루프 — SQL + INSERT history

프로세스 A와 B가 동시에 apply 시 B는 락 대기 중. A가 migration 0003, 0004를 완료한 뒤 B가 락을 얻지만, B의 `pending`은 여전히 [0003, 0004]. B는 이미 적용된 migration을 다시 실행하려 시도:

- SQL이 `CREATE TABLE IF NOT EXISTS` 같은 멱등 구문이면 재실행이 성공하나 `insertHistory`가 PRIMARY KEY 충돌 (version="0003").
- SQL이 멱등이지 않으면 `CREATE TABLE` 같은 구문이 중복 에러를 일으켜 transaction rollback 후 runner가 throw.

#### 보안 측면 영향

Single-operator 환경에서는 거의 트리거되지 않음. 다수의 CI 작업이 `DATABASE_URL` 공유하는 deployment 상황에서 race 노출. **데이터 손실은 없다** (transaction rollback) — 하지만 partial failure 상태 + 불명확한 에러 메시지는 operational 위험. 감사 범위인 "lock 우회 / race" 리스크에 해당.

#### 권장 조치

락 획득 **후** `readAllHistory` + `readMigrationsFromDisk` 다시 수행 → tamper + pending 재계산. 순서:

```
lock = acquire()
try {
  history = await readAllHistory()
  diskFiles = await readMigrationsFromDisk()
  tamperCheck(history, diskFiles)
  pending = computePending(history, diskFiles)
  for (p of pending) { ... }
} finally {
  lock.release()
}
```

초기 pre-lock 체크 (fast-fail path)는 유지하되 "advisory hint"로 재정의.

#### 관련 CWE

- [CWE-362 Concurrent Execution using Shared Resource with Improper Synchronization](https://cwe.mitre.org/data/definitions/362.html)
- [CWE-367 TOCTOU Race Condition](https://cwe.mitre.org/data/definitions/367.html)

---

### M-02 — Tamper detection bypass via direct DB manipulation

**심각도**: Medium
**상태**: TODO (문서화로 v1 범위 내, v2는 signed history row 고려)
**파일**: `packages/core/src/db/migrations/runner.ts:256-266`, `history-table.ts:233`

#### 영향

Tamper detection은 `disk.checksum !== row.checksum`으로 파일 변조를 감지한다. 하지만 공격자가 DB 자격증명을 가진 경우 `__mandu_migrations.checksum` 컬럼을 직접 UPDATE 해서 변조된 파일과 체크섬을 맞출 수 있다. `MigrationTamperedError`가 발동하지 않는다.

#### 권장 조치 (v2)

HMAC 서명된 checksum 컬럼 추가. Master key는 env (`MANDU_MIGRATION_KEY`) 또는 KMS에서 로드. 각 history 행에 HMAC(checksum + version + filename, key)를 저장. apply 시 재계산 검증. 이는 RFC의 "documented limitation"이지만 supply chain 공격 모델에는 필요.

v1에서는 README에 "tamper detection only catches file drift, not DB-level manipulation" 명시.

#### 관련 CWE

- [CWE-345 Insufficient Verification of Data Authenticity](https://cwe.mitre.org/data/definitions/345.html)

---

### M-03 — DB driver error messages may leak connection credentials

**심각도**: Medium
**상태**: TODO (Bun.SQL 드라이버 쪽 동작 감사 필요)
**파일**: `packages/cli/src/commands/db/apply.ts:267-270`, `plan.ts:290-295`, `status.ts:148-151`, `reset.ts:213-216`

#### 영향

`printError(label, err)`가 `err.message`를 그대로 stderr에 출력. Bun.SQL Postgres/MySQL 드라이버가 연결 실패 시 error message에 포함하는 정보:

- 호스트명, 포트, 데이터베이스 이름 (확인됨)
- 사용자 이름 (확인됨)
- 패스워드 — **드라이버 버전에 따라 포함 가능성** (재현 미확인)

CI 로그에 stderr가 commit되는 환경에서 credential 누출 리스크.

#### 재현 단계

1. 잘못된 비밀번호로 `mandu db apply` 실행.
2. stderr 출력 확인.
3. Bun.SQL 버전별 에러 메시지 포맷을 기록.

**감사자는 이 재현을 수행하지 않았다** — Bun 1.3.x 드라이버 동작 검증은 별도 추적.

#### 권장 조치

`printError`를 sanitize wrapper로 교체:

```ts
function sanitizeError(msg: string): string {
  return msg
    .replace(/:([^@\s]+)@/g, ":***@")  // user:password@host
    .replace(/password=[^\s&]+/gi, "password=***");
}
```

`--json` 모드에서도 동일 sanitize 필요 (apply.ts:181-187, 247-249).

#### 관련 CWE

- [CWE-200 Exposure of Sensitive Information](https://cwe.mitre.org/data/definitions/200.html)
- [CWE-532 Insertion of Sensitive Information into Log File](https://cwe.mitre.org/data/definitions/532.html)

---

### M-04 — `DdlDefault.kind === "sql"` is an unbounded expression injection

**심각도**: Medium
**상태**: TODO (documented as escape hatch; needs supply-chain warning)
**파일**: `packages/core/src/resource/ddl/type-map.ts:168-169`

#### 영향

```ts
case "sql":
  return def.expr;  // passed through verbatim
```

`def.expr`은 `fieldOverrides[key].default = { kind: "sql", expr: "..." }`에서 옴. 정상 사용 케이스는 `gen_random_uuid()` 같은 DB-specific default. 하지만 `asPersistence`가 `FieldOverride.default`의 내부 shape를 검증하지 않으므로 임의의 SQL expression이 DDL에 주입된다:

```ts
fieldOverrides: {
  evil: { default: { kind: "sql", expr: "'x'; DROP TABLE users; --" } }
}
```

결과 DDL: `"evil" TEXT DEFAULT 'x'; DROP TABLE users; --`. Bun.SQL이 multi-statement execution을 허용하면 `DROP TABLE users`가 실행된다.

**현실적 영향**: 이 `default`는 resource 정의 파일 안에 직접 기록되어 있어야 하므로 repo 소유자가 스스로를 공격하는 셈. 하지만 supply chain — 악의적 npm 패키지가 `defineResource`를 export하는 경우 — 에서는 트리거 가능.

#### 권장 조치

**Option A (tighten)**: `asPersistence`가 `default.kind === "sql"` 의 `expr`을 제한적 regex로 검증. 예: `/^[A-Za-z0-9_()' ,.\-]+$/`. 단 이는 복잡한 표현식을 막을 수 있음.

**Option B (warn)**: 문서에 "`kind: "sql"` 은 escape hatch; supply-chain 관점에서 trusted source에서만 사용"이라고 명시. 런타임 warning log.

**Option C (allowlist)**: 자주 쓰이는 expression만 whitelist — `NOW()`, `CURRENT_TIMESTAMP`, `gen_random_uuid()` 등. 나머지는 reject.

RFC §D1 후속 논의 필요.

#### 관련 CWE

- [CWE-89 SQL Injection](https://cwe.mitre.org/data/definitions/89.html)

---

## 3. LOW / INFO 항목 (TODO 요약)

| ID | 제목 | 파일 / 라인 | 비고 |
|---|---|---|---|
| L-01 | `formatLiteral()` string default가 NUL byte를 거부하지 않음 | `packages/core/src/resource/ddl/type-map.ts:192-195` | PG standard_conforming_strings ON 기본이면 대부분 문제 없으나 driver crash 가능 |
| L-02 | `resolveDefault({kind:"sql", ...})` 탈출 해치 | `packages/core/src/resource/ddl/type-map.ts:168-169` | M-04와 중복; escape hatch는 유지되어야 함 |
| L-03 | `SAFE_PERSISTENCE_IDENTIFIER_RE`가 reserved SQL keyword를 거부하지 않음 | `packages/core/src/resource/ddl/persistence-types.ts:59` | `tableName: "select"` 은 통과하여 DDL에서 문법 충돌 야기 가능 — SQL error로 fail-fast이나 UX는 나쁨 |
| L-04 | Migration filename 길이 제한 없음 | `packages/core/src/db/migrations/runner.ts:489` | MySQL VARCHAR(255) insert 실패 가능; PG/SQLite는 영향 없음 |
| L-05 | `mandu db plan`의 `applied.json` 파싱 에러 메시지 echo | `packages/cli/src/commands/db/plan.ts:138` | 에러가 파일 내용을 포함하면 누출; 현재는 JSON.parse 에러만 echo하므로 낮음 |
| I-01 | 체크섬이 DB row 수준 tamper를 감지하지 못함 | — | M-02와 중복; v1 문서화 완료 |
| I-02 | SQLite lock은 in-process only | `packages/core/src/db/migrations/lock.ts:195-245` | RFC §8 non-goal; multi-process는 Bun.SQL의 OS lock이 담당 |
| I-03 | Rename prompt는 ANSI injection 안전 | `packages/cli/src/commands/db/rename-prompt.ts:140-143` | `oldFieldName`/`newField.name`이 validated — 방어 불필요 |
| I-04 | `execRaw` 합성 `TemplateStringsArray` 패턴이 load-bearing | `packages/core/src/db/migrations/runner.ts:626-629` | 리팩터가 interpolation 허용하면 injection 발생 — 추가 JSDoc 경고 권장 |

---

## 4. 감사 외 항목 (의도적 보류)

- **FK / ENUM / CHECK constraint**: v1 스코프 밖 (RFC §5 non-goals).
- **Rollback / DOWN migrations**: v2+.
- **Multi-instance apply coordination**: RFC §8에서 v2로 연기됨. 현재는 single-process lock만.
- **AsyncLocalStorage tx 누출**: v1은 explicit `db.transaction(async (tx) => ...)` 만 지원. ALS 기반 implicit tx context는 RFC Appendix D.3에서 v2.
- **Bun.SQL 자체의 parameter binding 버그**: 프레임워크 밖. 별도 추적.

---

## 5. Merge 권장

**HIGH 1건 (H-01) 패치 적용 완료 → merge 가능**.

MEDIUM 4건은 모두 v2 패치 혹은 문서화로 해결되며 v1 릴리즈를 block하지 않는다. LOW/INFO 항목은 backlog에 남긴다.

### 다음 단계 (post-merge)

1. **4c.1 패치 (2주 내)**: M-01 (read-before-lock) 해결. 추가 15줄 내외 변경.
2. **4c.2 or v2**: M-02 (signed history), M-03 (error sanitizer), M-04 (sql default allowlist).
3. **문서 보강**: RFC §8에 "DB-level tampering은 탐지되지 않음" 명시, README의 `persistence.fieldOverrides[].default.kind === "sql"` 섹션에 supply-chain 경고 추가.

---

## 6. 감사자 노트

Rounds R1~R3의 구현 품질은 전반적으로 높다:

- 모든 DDL emit 경로가 `quoteIdent`를 거친다 — 주요 injection surface가 일관되게 차단됨.
- `computeMigrationChecksum`의 CRLF 정규화 + SHA-256 선택이 올바름.
- `execRaw`의 합성 TemplateStringsArray 패턴이 Bun.SQL의 parameter-binding 경계를 유지 — 영리한 트릭이지만 fragile하므로 JSDoc 강화 권장.
- 테스트 커버리지가 충실 (emit 85, ddl 150, generator 125, runner 37/38, db-migration-e2e 12).
- `asPersistence`가 shallow validation만 수행했던 점이 유일한 systemic 약점 — H-01 패치로 해결.

감사 대상 코드 3,000 줄 규모 치고는 보안 취약점이 적었다. R1 Agent A/B/C + R2 Agent D/E가 security-aware coding을 잘 실천한 결과.

---

*감사 시작: 2026-04-18, 종료: 2026-04-18*
*감사자: Agent G (security-engineer) — Phase 4c.R4*
