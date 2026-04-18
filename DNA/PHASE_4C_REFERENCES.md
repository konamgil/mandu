# Phase 4c 레퍼런스 프로젝트 — 어디를 볼 것인가

Resource → DDL diff → migration SQL 자동 생성 엔진 설계 시 참고할 4개 오픈소스. 각 레포에서 **실제 열어볼 파일/디렉토리** 만 명시 — 전체 코드 다 읽을 필요 없음.

## DNA/atlas (Go, Apache 2.0, ~6 MB)

**포지션**: schema-first declarative diff 엔진. 우리가 가장 많이 훔칠 대상.

**볼 것**:
- `sql/schema/` — dialect-agnostic schema AST (Table / Column / Index / FK)
- `sql/migrate/` — diff 알고리즘 (plan 생성). 핵심은 `planner.go` 의 `Plan()` 메서드
- `schemahcl/` — HCL 선언 스키마 파서 (우리가 HCL 안 써도 AST 구조 참고)
- `sql/postgres/`, `sql/mysql/`, `sql/sqlite/` — dialect별 드라이버 + DDL emit
- `cmd/atlas/internal/cmdapi/migrate.go` — CLI 인터페이스 디자인 (`migrate diff`, `migrate apply`, `migrate status`)

**배울 것**:
- dialect-agnostic schema AST → provider-specific DDL emit 분리 패턴
- deterministic diff output (같은 입력 = 같은 순서의 ALTER 문)
- `revisions` 테이블 (우리 `__mandu_migrations`) 디자인

**스킵**: HCL 파서 전체, cloud 연동 코드 (`cmd/atlas/internal/cloudapi/`)

## DNA/drizzle-orm (TS, Apache 2.0, ~30 MB — 가장 큼)

**포지션**: TS 네이티브 ORM + drizzle-kit (migration 생성). Atlas 와 같은 문제를 TS 로 푼 버전.

**볼 것** — 거의 전부 `drizzle-kit/` 서브디렉토리만:
- `drizzle-kit/src/snapshotsDiffer.ts` — **핵심**. JSON snapshot 기반 diff. 우리가 똑같이 할 수도 있음 (resource → snapshot JSON → diff)
- `drizzle-kit/src/serializer/` — TS schema → snapshot JSON 변환
- `drizzle-kit/src/cli/commands/migrate.ts` — **rename detection 프롬프트 UX**. 자동 탐지 불가한 케이스에서 사용자에게 묻는 방식
- `drizzle-kit/src/sqlgenerator.ts` — snapshot 차이 → SQL 문자열

**배울 것**:
- **Snapshot 접근**: 현재 resource 파싱 → JSON → `.mandu/schema/applied.json` 에 저장 → 다음에 비교. diff 알고리즘 자체는 JSON 객체 비교라 단순함.
- Rename 프롬프트 인터랙션: "A 컬럼 삭제 + B 컬럼 추가가 rename 인가?" 사용자 Y/N
- Migration 파일 네이밍 + 순서 보장

**스킵**: drizzle-orm 본체 (`drizzle-orm/src/` — ORM 표현은 우리 관심사 아님)

## DNA/sqldef (Go, MIT, ~6.6 MB)

**포지션**: "idempotent apply" — migration 파일 없이 현재 DB 를 desired schema 로 강제 이동.

**볼 것**:
- `parser/` — SQL schema statement 파서 (CREATE TABLE 등을 AST 로)
- `schema/` — 내부 표현
- `adapter/postgres/`, `adapter/mysql/`, `adapter/sqlite3/` — dialect 어댑터
- `cmd/psqldef/main.go` — CLI 엔트리

**배울 것**:
- 우리가 "NOT take" 한 길을 확인 (migration 파일 없는 apply). 왜 채택 안 하는지 이해 확실히.
- Parser 구조는 가볍고 깔끔 — Atlas 대비 소규모 대안

**스킵**: 대부분. sqldef 는 "비교 대상"으로만 존재. 우리는 Atlas 쪽 접근.

## DNA/flyway (Java, Apache 2.0, ~12 MB)

**포지션**: migration **runner** (diff 엔진 아님). 이미 있는 SQL 파일 순서대로 apply + 이력 관리. 업계 표준.

**볼 것** — 소스보다 **docs 우선**:
- `documentation/` — **"Concepts" 섹션이 가장 유용**. Versioned vs Repeatable migration, schema history table, checksum strategy, callbacks, baseline.
- `flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java` — migrate 로직 (우리 `mandu db apply` 참고)
- `flyway-core/src/main/java/org/flywaydb/core/internal/schemahistory/SchemaHistory.java` — `flyway_schema_history` 테이블 스키마 (우리 `__mandu_migrations` 설계 참고)
- `flyway-core/src/main/java/org/flywaydb/core/internal/util/ChecksumCalculator.java` — checksum 검증

**배울 것**:
- **schema_history 테이블 디자인**: version / description / type / script / checksum / installed_by / installed_on / execution_time / success — 우리 `__mandu_migrations` 스키마의 템플릿
- **Checksum 전략**: 이미 apply 된 migration 파일이 수정됐을 때 에러로 감지
- **Lock 전략**: 동시 apply 방지 (PG advisory lock 등)
- **Repeatable migration** 개념 (R__ prefix) — 재실행 가능한 마이그레이션 (view/procedure 정의 갱신용). v1 에는 안 넣어도 되지만 이름 공간 예약 가치 있음

**스킵**: Java 특정 infrastructure (Maven/Gradle 빌드, Spring 통합), 상용 기능 (`flyway-core/src/main/java/.../undo/`)

## 사용 순서

**Phase 4c 설계 단계**:
1. drizzle-kit 의 **snapshotsDiffer.ts** 한 번 정독 (2시간) — snapshot 기반 diff 가 가장 우리에 가까움
2. Atlas 의 **sql/migrate/planner.go** 훑어보기 (1시간) — diff output 의 deterministic 순서
3. Flyway 의 **Concepts 문서** 전체 (2시간) — schema_history 설계 + checksum

**Phase 4c 구현 단계**:
4. sqldef 는 대조 이해용으로만. 필요 시 parser/ 를 reference

## 참고하지 말 것

- **Prisma migrate-engine**: Rust 로 쓰임. 우리 스택과 무관.
- **Ecto / Rails / Django / Alembic**: 철학/개념은 참고 가치, 코드는 언어 차이로 활용도 낮음.
- **Liquibase**: enterprise XML changeLog 접근 — 우리 방향 아님.

## 레이아웃

```
DNA/
  atlas/              ← diff 엔진 참고 (Go)
  drizzle-orm/        ← TS snapshot diff + rename UX 참고
  sqldef/             ← idempotent apply 대조
  flyway/             ← migration runner 설계 참고
  PHASE_4C_REFERENCES.md  ← 이 파일
  DNA_ADOPTION_PLAN.md    ← 상위 DNA 채택 계획 (별도)
```

`.gitignore` 에 DNA/ 는 포함 안 되어 있으나, 레퍼런스 클론은 의도적으로 untracked 유지 (다른 DNA 서브디렉토리와 동일한 컨벤션). 업데이트 시:

```bash
cd DNA/atlas && git pull --depth=1
cd ../drizzle-orm && git pull --depth=1
# ...
```
