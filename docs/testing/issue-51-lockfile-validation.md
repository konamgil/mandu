# Issue #51 — Lockfile Validation Duplication (Test Scenarios)

## 목적
`mandu dev` / `mandu start` / `mandu check`에서 lockfile 검증 흐름이 일관되게 동작하는지 확인하고, lock mismatch 시 경고/차단 정책이 모드별로 기대대로 적용되는지 검증한다.

## 공통 사전조건
1. 테스트 프로젝트 루트에서 기본 lockfile 생성
   - `mandu lock`
2. lock mismatch 유도
   - `mandu.config.ts`에서 해시에 영향 있는 값 변경 (예: `server.port` 변경)
   - 변경 후 `mandu lock`은 다시 실행하지 않음
3. `mandu start` 시나리오용 빌드 산출물 준비
   - `mandu build` (또는 `.mandu/manifest.json` 존재 보장)

## 시나리오 1 — `mandu dev` (개발 모드: warn)
### Steps
1. `NODE_ENV=development mandu dev` 실행
2. 출력 로그에서 lockfile 관련 메시지 확인

### Expected
- 프로세스가 즉시 종료되지 않고 dev 서버가 계속 실행됨
- lock mismatch 경고가 출력됨 (`Lockfile 불일치 - 경고`)
- 복구 가이드가 함께 출력됨
  - `mandu lock`
  - `mandu lock --diff`
  - `mandu lock && mandu dev --watch` (또는 `bun run dev:safe`)
- 차단 문구(`서버 시작 차단`)는 출력되지 않음
- lockfile 상태 안내 블록이 중복 출력되지 않음 (1회)

## 시나리오 2 — `mandu start` (프로덕션 모드: block)
### Steps
1. `NODE_ENV=production mandu start` 실행
2. 종료 코드와 에러 출력 확인

### Expected
- lock mismatch 시 서버 시작이 차단됨
- 차단 메시지 출력: `🛑 서버 시작 차단: Lockfile 불일치`
- 복구/확인 가이드 출력
  - `mandu lock`
  - `mandu lock --diff`
- 프로세스 종료 코드 `1`
- `Production server running ...` 로그가 출력되지 않음
- 검증 결과 상세(불일치 요약)가 포함됨 (`formatValidationResult` 기반)

## 시나리오 3 — `mandu check` (통합 점검 경로)
### Steps
1. `NODE_ENV=development mandu check` 실행
2. Config Integrity 섹션 출력 확인

### Expected
- Config 섹션에 lockfile 불일치가 표시됨
- Health Score가 lock mismatch 패널티를 반영해 감소
- 개발 모드(`warn`)에서는 check 전체가 실패로 강제되지 않음(다른 오류 없으면 통과 가능)
- lockfile 검증 결과가 다른 검사 출력과 충돌 없이 1개 섹션으로 정리됨

## 시나리오 4 — 우회 동작 (`MANDU_LOCK_BYPASS`)
### Steps
1. mismatch 상태 유지
2. `MANDU_LOCK_BYPASS=1 NODE_ENV=production mandu start` 실행
3. `MANDU_LOCK_BYPASS=1 NODE_ENV=development mandu dev` 실행

### Expected
- 원래 `block`/`error` 상황이 `warn`으로 완화됨
- 우회 표식 포함 경고 출력 (`(우회됨)` 포함)
- start/dev 모두 프로세스 진행 가능
- 우회 미사용 기준 시나리오와 정책 변화가 명확함

## 회귀 포인트 (Issue #51 핵심)
- `dev`와 `start`에서 lockfile 검증/차단/상태출력 로직이 동일 규칙으로 동작
- lock mismatch 안내 문구/복구 가이드가 명령별로 의미적으로 일치
- 동일 커맨드 내 lockfile 검증 결과 출력이 중복되지 않음
