# Mandu SEO 실서비스 전환 계획 (Production Readiness Plan)

- Status: Draft
- Owner: Mandu Core Team
- Scope: `@mandujs/core` SEO 모듈 + CLI/문서/검증 체계
- Related Spec: `docs/specs/07_seo_module.md`

## 1. 목표

Mandu의 현재 SEO 기능(기본 meta/OG/Twitter/JSON-LD/sitemap/robots)을
**실서비스 운영 가능한 수준**으로 끌어올린다.

성공 기준:

1. 프로젝트 생성 직후에도 SEO 기본값이 안전하게 동작
2. route 단위 SEO 선언/상속/override 규칙이 명확하고 테스트됨
3. 빌드/CI에서 SEO 품질을 자동 검증 가능
4. 대규모 사이트(다국어/대량 URL)에서도 sitemap/robots 운영 가능
5. 운영 중 SEO 회귀(regression)를 빠르게 감지 가능

---

## 2. 현재 상태 요약

이미 존재하는 구성요소:

- Resolver: title, url, robots, twitter, opengraph
- Renderer: basic meta, og, twitter, jsonld, sitemap, robots
- SSR integration 계층

현재 갭:

- 선언 방식과 우선순위(전역/레이아웃/페이지) 가이드 부족
- lint/check 명령 부재(또는 약함)
- 다국어 canonical/hreflang 운영 시나리오 미흡
- 대규모 sitemap 분할/인덱스 정책 부재
- 회귀 테스트와 모니터링 지표 표준 부재

---

## 3. 단계별 실행 계획

## Phase 0. 기준선(Baseline) 고정

### 작업
- SEO capability matrix 문서화 (지원/미지원/실험)
- 데모 프로젝트 2종 구성
  - 소규모 사이트 (정적+블로그)
  - 중규모 사이트 (다국어+동적 route)
- Lighthouse/검색 엔진 검사 baseline 수집

### 산출물
- `docs/seo/baseline-matrix.md`
- baseline 리포트(JSON + markdown)

### 완료 기준(DoD)
- baseline 수치가 CI artifact로 보존됨

---

## Phase 1. 선언 모델 표준화 (DX 1차)

### 작업
- SEO 설정 우선순위 규칙 확정
  - global default
  - layout-level default
  - page-level override
- 타입 안전한 SEO config schema 확정
- 흔한 실수 방지(중복 canonical, invalid robots 등) validation 추가

### 산출물
- `docs/guides/seo-configuration.md`
- schema + validator 테스트

### DoD
- 잘못된 SEO 선언이 dev/check 단계에서 설명형 에러로 노출

---

## Phase 2. 핵심 산출물 완성도 강화

### 작업
- canonical URL 자동 보정(상대/절대 경로 정책)
- OG/Twitter fallback 규칙 정교화
- JSON-LD multi-block 안전 병합 지원
- route별 robots 정책 분기 강화

### 산출물
- resolver/renderer 개선 PR
- snapshot 테스트 세트

### DoD
- 핵심 메타 태그 누락률 0% (테스트 기준)

---

## Phase 3. sitemap/robots 실서비스화

### 작업
- 대량 URL 대응 sitemap 분할(`sitemap-1.xml` ...)
- sitemap index 자동 생성
- changefreq/priority/lastmod 정책 훅 제공
- robots 환경 분기 (production/staging/dev)

### 산출물
- sitemap index/partition 기능
- 운영 가이드 (배포 환경별 robots)

### DoD
- 100k+ URL 시나리오에서 메모리/성능 임계값 통과

---

## Phase 4. 다국어 SEO (i18n)

### 작업
- canonical + hreflang 표준 규칙 제공
- locale fallback 정책 명시
- 지역 도메인/서브패스 전략 문서화

### 산출물
- i18n SEO guide + examples
- hreflang 검증 유틸

### DoD
- 다국어 샘플 프로젝트에서 자동 검증 통과

---

## Phase 5. CLI/CI 품질게이트

### 작업
- `mandu seo:check` (또는 `mandu check --seo`) 제공
- 검사 항목:
  - title/description 길이
  - canonical 유효성
  - robots 충돌
  - OG/Twitter 필수값
  - JSON-LD 스키마 유효성(선택)
- CI용 머신 리포트(JSON/SARIF) 출력

### 산출물
- CLI 명령 + CI 예시 workflow

### DoD
- CI에서 SEO gate on/off 및 severity 제어 가능

---

## Phase 6. 관측/회귀 감지

### 작업
- route별 SEO 스냅샷 회귀 테스트
- 릴리즈 간 SEO diff 리포트
- “검색 유입 영향 지표” 추적 가이드

### 산출물
- `docs/guides/seo-regression-testing.md`
- diff 리포트 자동화 스크립트

### DoD
- 릴리즈 파이프라인에서 SEO regression 자동 탐지

---

## 4. 우선순위 백로그 (Top 20)

1. SEO config 우선순위 명세 확정
2. canonical validator
3. robots conflict validator
4. title/description length checks
5. OG fallback policy
6. Twitter fallback policy
7. JSON-LD merge strategy
8. sitemap index support
9. sitemap partition support
10. env-aware robots policy
11. hreflang helper
12. i18n canonical helper
13. `mandu seo:check` CLI
14. CI JSON/SARIF output
15. SEO snapshot test harness
16. SEO diff report
17. guides + examples
18. demo baseline scenario A
19. demo baseline scenario B
20. release checklist template

---

## 5. 품질 지표 (KPI)

- Coverage KPI
  - route별 필수 SEO 태그 충족률
- Stability KPI
  - 릴리즈당 SEO 회귀 건수
- Performance KPI
  - sitemap 생성 시간 / 메모리 사용량
- DX KPI
  - SEO 관련 이슈 재발률
- Ops KPI
  - robots/sitemap 배포 실수 건수

---

## 6. 리스크와 대응

1. 리스크: 선언 모델이 복잡해짐
- 대응: 최소 기본값 + 고급옵션 분리

2. 리스크: 다국어 정책 혼선
- 대응: 공식 전략(도메인/서브패스) 템플릿 제공

3. 리스크: CI gate 과민으로 배포 지연
- 대응: severity 레벨(warn/error) 선택 제공

4. 리스크: sitemap 대규모 성능 문제
- 대응: 분할/스트리밍 생성 + 벤치마크 기준선 유지

---

## 7. 실행 순서 제안 (4주)

- Week 1: Phase 0~1
- Week 2: Phase 2
- Week 3: Phase 3~4
- Week 4: Phase 5~6 + 문서/데모/CI 고정

---

## 8. 최종 완료 조건 (Exit Criteria)

아래를 모두 만족하면 “Mandu SEO 실서비스 준비 완료”로 간주:

- 공식 가이드만으로 SEO 설정 가능
- CI에서 SEO 품질 자동검사 가능
- 다국어 canonical/hreflang 운영 가능
- 대규모 sitemap 안정 생성 가능
- 릴리즈 SEO 회귀를 자동 감지 가능
