# Mandu DB 실서비스 전환 계획 (Production Readiness Plan)

- Status: Draft
- Owner: Mandu Core Team
- Scope: DB 통합 표준(ORM agnostic), 운영, 검증, 관측
- Related Guide: `docs/guides/04_prisma.md`

## 1) 목표

Mandu에서 DB 연동을 "개발 가능" 수준에서 "실서비스 운영 가능" 수준으로 끌어올린다.

성공 기준:
- 프레임워크 권장 DB 구조(연결/리포지토리/트랜잭션)가 문서+예제로 고정됨
- 마이그레이션/시드/롤백이 CI에서 자동화됨
- 동시성/정합성/장애 복구 시나리오가 테스트로 검증됨
- 멀티테넌시/감사로그/보존정책의 표준 패턴이 존재함

---

## 2) 현재 상태

강점:
- API route 중심 구조로 DB 연동 책임 분리 용이
- 계약(타입/스키마) 기반 응답 무결성 관리 가능
- 실시간(SSE) + 서버 주도 아키텍처로 상태 일관성 확보에 유리

갭:
- ORM 무관 공통 패턴(Repository/UoW) 공식 표준 부재
- 트랜잭션/락/동시성 가이드 미흡
- 운영 툴링(backup/restore/retry policy) 표준 부족
- DB 회귀 테스트 템플릿 부족

---

## 3) 단계별 실행 계획

## Phase 0. Baseline 확정
- 샘플 프로젝트 2종 준비
  - CRUD 중심 앱
  - 동시성/실시간 중심 앱
- DB 성능/오류 baseline 수집 (p95, deadlock, timeout)
- 운영 체크리스트 초안 작성

DoD:
- baseline 리포트가 CI artifact로 저장됨

## Phase 1. DB 통합 아키텍처 표준화
- 권장 레이어 정의
  - Route Handler → Application Service → Repository → DB Adapter
- ORM agnostic 인터페이스 정의(Prisma/Drizzle/Raw SQL 확장 가능)
- DB client lifecycle 표준(연결 재사용, shutdown hook)

DoD:
- docs + 예제 코드 + lint/rule 가이드 동시 제공

## Phase 2. 마이그레이션/시드/롤백 체계
- migration naming/version 정책
- seed idempotent 규칙
- rollback 안전 규칙(데이터 유실 방지)
- CI에서 migration drift 검증

DoD:
- "빈 DB -> 최신 스키마" 자동 재현 가능

## Phase 3. 트랜잭션/동시성/정합성
- 트랜잭션 경계 표준화
- 낙관/비관 잠금 사용 기준
- 재시도 정책(backoff/jitter) 표준 제공
- idempotency key 패턴(중복 요청 방지)

DoD:
- 동시성 테스트(경합/중복요청) 통과

## Phase 4. 실시간 + DB 일관성
- outbox/inbox 패턴 가이드
- SSE 이벤트와 DB commit 순서 보장 규칙
- reconnect/catch-up 시나리오 표준화

DoD:
- 네트워크 장애 후 재연결 시 데이터 유실 없음

## Phase 5. 보안/감사/컴플라이언스
- 민감정보 암호화/마스킹 표준
- 감사로그 스키마(누가/언제/무엇을)
- 삭제/보존 정책(soft delete, retention)
- 권한 경계(테넌트/조직 스코프)

DoD:
- 감사 이벤트 추적 가능 + 권한 누수 테스트 통과

## Phase 6. 운영/관측/장애복구
- 쿼리 성능 지표(p50/p95/slow query) 표준 수집
- connection pool/timeout/circuit breaker 권장값
- backup/restore 런북 + 정기 복구 리허설
- 장애 시 read-only degraded 모드 가이드

DoD:
- 복구 리허설 성공률 100%

## Phase 7. CLI/CI 품질 게이트
- `mandu check --db` 또는 `mandu db:check` 도입
- 검사 항목
  - migration drift
  - seed idempotency
  - N+1 위험 쿼리 패턴
  - 트랜잭션 누락 경로
- JSON/SARIF 결과 출력

DoD:
- PR 단계에서 DB 품질 게이트 적용 가능

---

## 4) 우선순위 Top 20

1. DB 아키텍처 레이어 공식화
2. ORM agnostic repository interface
3. DB client lifecycle 가이드
4. migration drift check
5. seed idempotency rule
6. rollback safety policy
7. transaction boundary guideline
8. lock strategy guideline
9. idempotency key pattern
10. retry/backoff helper
11. outbox/inbox example
12. SSE + commit ordering rule
13. audit log schema template
14. tenant scope enforcement pattern
15. retention policy template
16. DB metrics baseline collector
17. slow query reporting
18. backup/restore runbook
19. `db:check` CLI spec
20. CI gate + SARIF integration

---

## 5) KPI

- Migration reliability: 실패 없는 마이그레이션 비율
- Consistency: 동시성 테스트 실패율
- Performance: p95 query latency, slow query count
- Operability: 복구 리허설 성공률
- Security: 권한/감사 관련 결함 재발률

---

## 6) 리스크와 대응

- 리스크: ORM 종속 심화
  - 대응: ORM agnostic interface 유지
- 리스크: 트랜잭션 남용으로 성능 저하
  - 대응: 경계 최소화 + 벤치 기반 가이드
- 리스크: 운영 문서-코드 불일치
  - 대응: 체크 명령으로 자동 검증
- 리스크: 멀티테넌시 누수
  - 대응: tenant scope lint + 테스트 강제

---

## 7) 4주 실행안

- Week 1: Phase 0~1
- Week 2: Phase 2~3
- Week 3: Phase 4~5
- Week 4: Phase 6~7 + 문서/CI 고정

---

## 8) Exit Criteria

아래를 충족하면 DB 실서비스 준비 완료:
- 개발/테스트/운영 파이프라인에서 DB 품질 자동 검증 가능
- 동시성/정합성/장애복구 시나리오 재현 가능
- 감사/권한/보존 정책이 표준 문서+테스트로 관리됨
