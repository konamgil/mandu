# Mandu 제품급 준비 완료 계획 (Product Readiness Plan) — 상세

작성일: 2026-02-05  
대상: Mandu v0.x → 제품급(External Ready)  
목표 버전: v0.11.x (최소)
배포 범위: **공식 배포 레시피/가이드는 제외**

---

## 0) 핵심 결론

현재 Mandu는 “기능적으로는 충분하지만, 제품급 운영을 위한 안정성·통합·성능 검증이 부족”한 상태다.  
이 문서는 제품급 준비 완료를 위해 필요한 **명확한 기준(DoD)**과 **실행 항목**, **증거 산출물**, **릴리즈 게이트**를 정의한다.

---

## 1) 제품급 정의 (Definition of Done)

제품급 준비 완료는 아래 **모든 조건**이 충족될 때 선언한다.

| 영역 | 기준 | 증거(Deliverable) |
|---|---|---|
| 안정성 | 크리티컬 버그 0, 핵심 E2E 100% 통과 | `tests/e2e/*` 리포트, CI 통과 |
| 성능 | 기준 앱에서 TTFB ≤ 200ms(로컬), SSR latency ≤ 50ms(로컬) | `tests/perf/*` 결과 |
| 보안 | 기본 보안 체크리스트 100% 충족 | `docs/guides/99_security_checklist.md` |
| DX | “init → dev → build” 끊김 없음 | `docs/guides/00_quickstart.md`, 템플릿 |
| 문서 | 신규 사용자 기준으로 “첫 페이지 → 배포” 완료 | `README.md` + `docs/guides/*` |
| 운영 | 릴리즈 정책/체크리스트/버전 규칙 정착 | `docs/release/RELEASE_CHECKLIST.md` |

---

## 2) 기준 앱 (Readiness Reference Apps)

제품급 준비 확인을 위해 최소 3개 기준 앱을 유지한다.  
각 앱은 “기능 범위 + 테스트 + 성능 측정”의 기준이 된다.

1. **Hello SSR**  
목표: 가장 단순한 SSR 페이지 로드 확인  
범위: FS Routes 2개, layout, SEO 기본, server-only env  
산출물: `demo/hello-ssr/*`, `tests/e2e/hello-ssr.test.ts`

2. **Blog CRUD + Contract**  
목표: Contract-First + API + Guard 검증  
범위: CRUD API, Zod 계약, client 호출, Guard preset 적용  
산출물: `demo/blog-crud/*`, `tests/e2e/blog-crud.test.ts`

3. **Dashboard + Auth + Island**  
목표: 인증/권한 + Island hydration  
범위: JWT auth, protected route, island counter  
산출물: `demo/dashboard-auth/*`, `tests/e2e/dashboard-auth.test.ts`

---

## 3) 테스트/품질 게이트 (Test & Quality Gate)

### 필수 테스트 종류

1. **Unit Tests**  
범위: core/cli/mcp의 순수 유틸/로직  
경로: `packages/*/tests/*`  
명령: `bun test`

2. **Integration Tests**  
범위: router + guard + contract 통합 흐름  
경로: `tests/integration/*`  
명령: `bun test tests/integration`

3. **E2E Tests**  
범위: 기준 앱 3개 전부  
경로: `tests/e2e/*`  
명령: `bun test tests/e2e`

### 릴리즈 게이트

1. 모든 Unit/Integration/E2E 통과  
2. 성능 벤치마크 통과  
3. 보안 체크리스트 통과  
4. 문서 업데이트 완료

---

## 4) 작업 스트림 상세 계획

### Stream A. 안정성/품질 (Stability & QA)

1. **Bun 테스트 크래시 원인 분석**  
산출물: `docs/qa/bun-test-crash.md`  
완료 기준: `bun test` 안정 실행

2. **E2E 하네스 도입**  
산출물: `tests/e2e/*`, `package.json` 스크립트  
완료 기준: 기준 앱 3개 테스트 통과

3. **에러 메시지 표준화**  
산출물: `packages/cli/src/errors/*` 개선  
완료 기준: 모든 CLI 에러가 “원인+해결” 형태로 출력

---

### Stream B. 성능/벤치마크 (Performance)

1. **벤치마크 기준선 정의**  
산출물: `tests/perf/perf-baseline.json`  
완료 기준: TTFB/SSR/TTI 기준 수립

2. **자동 성능 테스트 도입**  
산출물: `tests/perf/*` 실행 스크립트  
완료 기준: CI에서 perf 테스트 실행 가능

---

### Stream C. 개발자 경험 (DX)

1. **CLI UX 종단 플로우 검증**  
산출물: `docs/guides/00_quickstart.md` 개선  
완료 기준: init → dev → build 실습 가능

2. **템플릿 확장**  
산출물: `templates/hello-ssr`, `templates/blog-crud`, `templates/dashboard-auth`  
완료 기준: `mandu init --template`로 선택 가능

---

### Stream D. 데이터 레이어 MVP

1. **Loader API 설계**  
산출물: `docs/specs/08_loader_system.md`  
완료 기준: Loader 타입/컨텍스트 정의

2. **Loader 구현**  
산출물:  
`packages/core/src/loader/types.ts`  
`packages/core/src/loader/context.ts`  
`packages/core/src/loader/memory.ts`  
`packages/core/src/loader/file.ts`  
`packages/core/src/loader/index.ts`

3. **사용 예제 제공**  
산출물: `demo/blog-crud`에서 loader 활용 예제  
완료 기준: “컨텐츠 로드 → 캐시 → SSR” 흐름 검증

---

### Stream E. 통합 생태계 (Integrations)

1. **Auth (JWT) 레시피**  
산출물: `docs/guides/02_auth_jwt.md`, `demo/dashboard-auth`  
완료 기준: 로그인/로그아웃/권한 보호 동작

2. **DB/ORM — Prisma 확정 (공식)**  
선정 이유: 빠른 DX, 마이그레이션/스키마 관리 안정성  
산출물: `docs/guides/04_prisma.md`, `demo/blog-crud`  
완료 기준: CRUD API 완성

3. **Drizzle은 옵션(비공식)**  
비고: 성능/SQL 제어 목적의 선택지로 문서 최소화 또는 제외

3. **Deploy 레시피는 공식 범위에서 제외**  
비고: 외부 배포는 커뮤니티/개별 사용자 가이드로 남김

---

### Stream F. 보안/운영 (Security & Ops)

1. **보안 체크리스트 문서화**  
산출물: `docs/guides/99_security_checklist.md`  
완료 기준: 기본 보안 항목 100% 체크 가능

2. **운영 가이드(로컬 기준)**  
산출물: `docs/guides/97_local_ops.md`  
완료 기준: env/로그/장애 대응 “로컬 기준” 문서 제공

---

### Stream G. 문서 완결성

1. **“처음 시작 → 배포” 문서 흐름 재정리**  
산출물: `docs/README.md` + `docs/guides/*` 정리  
완료 기준: 신규 사용자 기준 튜토리얼 완결

2. **FAQ/문제 해결 강화**  
산출물: `docs/guides/96_troubleshooting.md`  
완료 기준: 상위 20개 이슈 대응

---

### Stream H. 릴리즈/품질 게이트

1. **릴리즈 체크리스트 정의**  
산출물: `docs/release/RELEASE_CHECKLIST.md`

2. **버전 정책**  
산출물: `docs/release/VERSIONING.md`  
완료 기준: SemVer 적용 및 지원 범위 명시

---

## 5) 단계별 마일스톤 (Concrete Timeline)

### Phase 1 (2~4주) — “안정성 확보”
목표: 테스트 안정화 및 기본 사용성 보장  
필수 완료: Stream A 1~3, Stream C 1, Stream H 1

### Phase 2 (4~6주) — “제품 MVP”
목표: 실서비스 MVP 가능한 기능 확보  
필수 완료: Stream D 1~3, Stream E 1~2, Stream G 1

### Phase 3 (6~10주) — “외부 출시 준비(배포 제외)”
목표: 운영/성능 게이트 완성  
필수 완료: Stream B 1~2, Stream F 1~2, Stream H 2

---

## 6) 즉시 실행 항목 (Next Actions)

1. Bun 테스트 크래시 원인 분석 착수  
2. E2E 테스트 구조 확정 및 테스트 첫 1개 작성  
3. Loader API 스펙 문서 초안 작성  
4. 로컬 운영 가이드 초안 작성  

---

## Appendix: 참고

- `docs/status.md` — 구현 상태  
- `README.md` — 온보딩 흐름  
- `docs/specs/*` — 기능 스펙  
