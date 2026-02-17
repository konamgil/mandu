# Mandu i18n Production Plan

- Status: Proposal Draft
- Owner: Mandu Core Team
- Scope: 라우팅/SSR/SEO/CI를 포함한 실서비스 다국어 체계

## 1) 목표

Mandu 프로젝트에서 i18n을 단순 번역 수준이 아닌
**실서비스 운영 가능한 국제화 시스템**으로 표준화한다.

성공 기준:
1. locale 라우팅/폴백 정책이 일관됨
2. SSR 단계에서 번역이 안정적으로 주입됨
3. canonical/hreflang/sitemap이 locale별로 올바르게 생성됨
4. CI에서 번역 누락/불일치를 자동 감지함

---

## 2) 핵심 원칙

1. **Route-first i18n**
- `/ko`, `/en`, `/ja`처럼 URL로 locale을 명확히 표현

2. **SSR-first localization**
- 초기 HTML부터 locale 텍스트 반영 (hydration flicker 최소화)

3. **SEO-integrated i18n**
- hreflang/canonical/sitemap을 i18n과 함께 관리

4. **Operational i18n**
- 번역 누락/키 충돌/폴백 비율을 CI로 관리

---

## 3) 권장 아키텍처

```text
Request (/en/...)
  -> Locale Resolver
  -> Translation Loader (namespaces)
  -> SSR Render (localized)
  -> SEO Resolver (canonical/hreflang)
  -> Hydration (same locale payload)
```

구성 요소:
- Locale Resolver
- Translation Catalog Loader
- Formatting Layer(Intl)
- SEO i18n Resolver
- i18n Check Pipeline

---

## 4) 라우팅 전략

## 4.1 URL 정책
- 기본: locale prefix 전략
  - `/ko/...`, `/en/...`
- 루트 `/` 진입 시 기본 locale로 redirect 또는 negotiate

## 4.2 Locale 결정 우선순위
1. URL prefix
2. 사용자 설정(cookie/profile)
3. Accept-Language
4. default locale

## 4.3 Fallback
- region fallback (`en-US` -> `en`)
- key fallback (`ko` 누락 시 `en`)

---

## 5) 번역 리소스 구조

권장 디렉터리 예시:

```text
src/shared/i18n/
  locales/
    ko/
      common.json
      auth.json
      chat.json
    en/
      common.json
      auth.json
      chat.json
```

네이밍 규칙:
- `domain.section.key`
- 예: `chat.input.placeholder`

분리 기준:
- `common`: 공통 UI
- 도메인별 파일: 페이지/기능 단위

---

## 6) SSR / Hydration 연동

1. SSR에서 locale 및 필요한 namespace 로드
2. 렌더 결과와 함께 locale payload 주입
3. 클라이언트 hydration에서 동일 payload 재사용
4. route 전환 시 namespace lazy-load

주의:
- SSR/CSR 번역 키 불일치 방지
- hydration mismatch 방지용 payload checksum 고려

---

## 7) 포맷 국제화 (Intl)

텍스트 번역과 포맷 로직 분리:
- 날짜/시간: `Intl.DateTimeFormat`
- 숫자/통화: `Intl.NumberFormat`
- 상대시간: `Intl.RelativeTimeFormat`

규칙:
- 컴포넌트 내 직접 포맷 금지(공통 유틸 사용)
- locale 포맷 정책을 중앙 관리

---

## 8) SEO 연계

필수:
- locale별 canonical 생성
- hreflang 세트 자동 생성
- locale별 sitemap 또는 sitemap index 관리
- robots 정책의 locale 경로 반영

검증:
- 누락 hreflang 감지
- canonical 충돌 감지

---

## 9) CI/검증 체계

제안 명령:
- `mandu check --i18n` (또는 `mandu i18n:check`)

검사항목:
1. missing translation keys
2. unused keys
3. namespace 충돌
4. locale 간 key parity
5. SEO i18n 메타 누락

출력:
- human readable report
- JSON/SARIF

---

## 10) 운영 워크플로우

1. 키 추가(영문 기준)
2. 번역 동기화 요청 자동 생성
3. CI 검증
4. 리뷰/병합
5. 릴리즈 후 폴백 발생률 모니터링

비개발자 협업:
- 번역 플랫폼/스프레드시트 연계 가능 구조
- sync 스크립트로 PR 자동 생성

---

## 11) 단계별 로드맵

## Phase 0
- locale 정책/URL 전략 확정
- baseline 문구 카탈로그 정리

## Phase 1
- locale resolver + translation loader
- SSR 연동

## Phase 2
- SEO(hreflang/canonical/sitemap) 연동

## Phase 3
- check 명령 + CI 게이트

## Phase 4
- 번역 운영 자동화(sync/review/report)

---

## 12) KPI

- missing key 발생률
- fallback 발생률
- locale별 SEO 메타 충족률
- i18n 관련 회귀 버그 건수
- 번역 반영 lead time

---

## 13) 리스크와 대응

1) 리스크: 번역 누락 증가
- 대응: check 게이트 + fallback 모니터링

2) 리스크: URL 정책 혼선
- 대응: route-first 정책 강제

3) 리스크: SEO 메타 불일치
- 대응: i18n SEO lint + snapshot 테스트

4) 리스크: 번역 운영 병목
- 대응: sync 자동화 + 역할 분리 워크플로우

---

## 14) Exit Criteria

아래를 만족하면 i18n 실서비스 준비 완료:
- locale 라우팅/SSR/hydration이 안정 동작
- locale별 SEO 메타 자동 생성/검증 가능
- CI에서 누락/불일치 자동 감지
- 운영 워크플로우가 문서만으로 재현 가능
