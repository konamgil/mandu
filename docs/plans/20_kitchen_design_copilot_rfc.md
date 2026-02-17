# Mandu Kitchen Design Copilot RFC

- Status: Proposal Draft
- Owner: Mandu Core + Devtools Team
- Scope: 에이전트 코딩 환경에서 디자인 시스템 자동 구축/유지 + Dev-only 디자인 시스템 페이지

## 1) 문제 정의

에이전트 기반 코딩에서 반복되는 문제:

- 컴포넌트 재사용 실패(매번 신규 생성)
- 상태 누락(empty/loading/error/hover/focus/disabled)
- 토큰 미사용(하드코딩 스타일)
- 접근성 누락
- 리뷰 시점 발견으로 비용 증가

목표는 "코드가 늘수록 디자인 시스템 품질이 같이 올라가는 구조"를 만드는 것이다.

---

## 2) 제안 요약

Kitchen DevTool에 **Design Copilot**를 도입한다.

핵심 5요소:
1. Design Registry (컴포넌트/토큰/상태 인덱싱)
2. Rule Engine (누락/중복/위반 탐지)
3. Auto-Fix Proposal (승인형 패치 제안)
4. Agent Watch (실시간 코딩 피드백)
5. Dev-only Design System Page (실행되는 디자인 시스템 문서)

---

## 3) 제품 구조

```text
Kitchen DevTool
  ├─ Design Health
  ├─ Component Registry
  ├─ Auto-Fix Proposals
  └─ Agent Watch

Dev-only Route
  └─ /__mandu/design-system
      ├─ Component Gallery
      ├─ State Matrix
      ├─ Token Preview
      ├─ A11y Checks
      └─ Code Snippets
```

---

## 4) DevTool 세부 탭

## 4.1 Design Health
- 프로젝트 디자인 건강도 점수
- 지표
  - 재사용률
  - 상태 누락율
  - 토큰 준수율
  - 접근성 준수율
- 라우트/컴포넌트별 리스크 히트맵

## 4.2 Component Registry
- 자동 인덱싱된 컴포넌트 목록
- 유사 컴포넌트 중복 감지
- 공통화 후보 제안(merge/refactor)

## 4.3 Auto-Fix Proposals
- 누락 상태/속성 패치 제안
- diff preview + 영향 분석 + 리스크 레벨
- 승인 후 적용(자동 반영 금지)

## 4.4 Agent Watch
- 에이전트 코딩 중 실시간 경고
- 예: "기존 Button 재사용 가능", "토큰 미사용", "empty state 누락"

---

## 5) Dev-only Design System Page

경로(제안): `/__mandu/design-system`

표시 섹션:
1. Component Gallery
2. State Matrix (default/hover/focus/disabled/loading/empty/error)
3. Token Preview (color/typography/spacing/radius/shadow)
4. Accessibility Panel
5. Code Snippets (복사용)

동작 정책:
- 개발 모드에서만 활성
- 프로덕션 배포 시 완전 제외(또는 404)
- Kitchen 경고 항목과 deep-link 연동

---

## 6) Rule Engine (초기 규칙)

1. 인터랙티브 요소 focus-visible 필수
2. 목록형 UI empty state 필수
3. API 의존 UI loading/error 상태 필수
4. 버튼/입력 disabled 상태 필수
5. hover 상태 누락 경고
6. color/spacing 하드코딩 금지
7. 토큰 기반 타이포 강제
8. 클릭 가능한 div 경고
9. aria 속성 누락 경고
10. 중복 유사 컴포넌트 생성 경고

규칙 출력 레벨:
- info / warn / error

---

## 7) 데이터 모델

### 7.1 `design-registry.json`
- 컴포넌트 정의
- 지원 상태
- 토큰 사용 패턴

### 7.2 `design-rules.json`
- 룰 활성화
- severity
- 예외 allowlist

### 7.3 `design-health-report.json`
- 점수 이력
- 위반 통계
- 경고 트렌드

---

## 8) 승인형 실행 정책

원칙:
- 자동 코드 반영 금지
- 모든 패치는 사용자 승인 후 적용

적용 전 표시:
- 변경 diff
- 영향받는 파일/컴포넌트
- 테스트 영향
- 롤백 방법

---

## 9) CI/검증 연계

후속 제안:
- `mandu check --design`
- PR 품질게이트(선택)
  - error 레벨 차단
  - warn 레벨 코멘트

리포트 출력:
- JSON/SARIF

---

## 10) 단계별 로드맵

## Phase 0 (설계)
- 탭 IA/UX 정의
- 규칙 스키마 확정
- dev-only 라우트 정책 정의

## Phase 1 (관측)
- Registry 수집
- Design Health 대시보드
- 경고 출력(수정 없음)

## Phase 2 (제안)
- Auto-Fix proposal + 승인 적용
- 영향 분석/롤백 안내

## Phase 3 (실시간)
- Agent Watch 코칭
- Kitchen ↔ Design page deep-link

## Phase 4 (운영)
- check --design
- CI 게이트
- 프로젝트 템플릿 내장

---

## 11) KPI

- 컴포넌트 재사용률 증가
- 상태 누락 건수 감소
- 토큰 준수율 증가
- 접근성 위반 감소
- PR 리뷰 수정 횟수 감소

---

## 12) 리스크와 대응

리스크 1: 규칙 과잉으로 개발 속도 저하
- 대응: warn 기본, 점진적 강화

리스크 2: 오탐지 증가
- 대응: 프로젝트별 예외 규칙 + feedback 루프

리스크 3: 디자인 시스템 강제가 창의성 저해
- 대응: 확장 슬롯/예외 컴포넌트 공식 경로 제공

---

## 13) Exit Criteria

아래를 만족하면 1차 완료:
- DevTool에서 디자인 건강도/위반/패치 제안이 동작
- Dev-only 디자인 시스템 페이지 제공
- 승인형 패치로 최소 3개 실전 누락 이슈 해결
- 문서만으로 신규 프로젝트에서 재현 가능
