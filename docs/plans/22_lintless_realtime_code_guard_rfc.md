# Mandu Lintless Real-time Code Guard RFC

- Status: Proposal Draft
- Owner: Mandu Core + Devtools Team
- Scope: ESLint/Sonar 의존 없이 실시간 코드 품질 감지/피드백 시스템

## 1) 배경

요구사항:
- 전통적인 lint 도구를 강제하지 않음
- Activity Monitor처럼 **실시간 감지**를 코드 레벨까지 확장
- 코딩 중인 에이전트에게 즉시 전달

문제:
- 사후 lint/리뷰 단계에서 발견되는 품질 이슈(순환참조, 누락 상태, 중복 컴포넌트 등)
- 개발 중 즉시 교정이 어려워 비용 누적

---

## 2) 제안 요약

Mandu DevTool/Kitchen에 **Lintless Real-time Code Guard**를 도입한다.

핵심:
1. 파일/코드 변경 이벤트 실시간 수집
2. Mandu 내장 룰 엔진으로 즉시 평가
3. 에이전트 피드백 버스로 즉시 전달
4. 승인형 패치 제안 제공
5. 품질 점수(Design/Architecture Health) 실시간 갱신

---

## 3) 아키텍처

```text
File/Code Activity Stream
  -> Event Normalizer
  -> Rule Evaluator (Mandu native)
  -> Feedback Bus (Agent/Kitchen)
  -> Suggestion Engine (patch draft)
  -> Approval Executor (opt-in apply)
  -> Health Score Store
```

### 3.1 Activity Stream 입력
- 파일 변경 (create/update/delete)
- import 그래프 변화
- 컴포넌트/훅 생성
- API contract 변화

### 3.2 Rule Evaluator
- 순환참조 탐지
- 레이어/경계 위반
- UI 상태 누락(empty/loading/error/hover/focus)
- 중복 컴포넌트 후보
- 토큰 미사용/하드코딩 탐지

### 3.3 Feedback Bus
- 에이전트 세션에 즉시 힌트 전송
- 메시지 타입: info/warn/error/proposal

---

## 4) 에이전트 전달 포맷 (초안)

```json
{
  "type": "proposal",
  "ruleId": "ui.empty-state.missing",
  "severity": "warn",
  "target": "src/client/features/chat/message-list.tsx",
  "message": "리스트 화면에 empty state가 없습니다.",
  "evidence": ["line:120-168"],
  "suggestedPatch": "...diff...",
  "risk": "low"
}
```

---

## 5) 승인형 실행 정책

원칙:
- 자동 코드 반영 금지
- 항상 "제안 -> 승인 -> 적용" 흐름

적용 전 표시:
- diff preview
- 영향 파일/테스트
- 예상 리스크
- 롤백 커맨드

---

## 6) 룰셋 (MVP)

1. `arch.no-circular-deps`
2. `arch.layer-boundary`
3. `ui.empty-state.missing`
4. `ui.loading-state.missing`
5. `ui.error-state.missing`
6. `ui.interaction.hover-focus-missing`
7. `ui.component.duplicate-candidate`
8. `design.token.hardcoded-style`

룰 레벨:
- info / warn / error

---

## 7) Kitchen UI 통합

### 탭 1: Live Guard Feed
- 실시간 이벤트/경고 스트림

### 탭 2: Proposals
- 패치 제안 목록 + 승인 버튼

### 탭 3: Health
- Architecture/Design 상태 점수 추이

### 탭 4: Evidence
- 각 경고의 근거 코드/그래프

---

## 8) 성능/운영 고려

- 증분 분석(incremental) 우선
- 파일 변경 범위 기반 rule 실행 최소화
- 백그라운드 low-priority 분석과 즉시 rule 분리
- 이벤트 폭주 시 샘플링/디바운싱

---

## 9) 단계별 로드맵

## Phase 0
- 이벤트 스키마/전송 프로토콜 확정

## Phase 1
- Live Guard Feed + 핵심 4개 룰

## Phase 2
- 패치 제안/승인형 적용

## Phase 3
- 에이전트 실시간 코칭 + Health score

## Phase 4
- 프로젝트 정책 파일 기반 커스터마이즈

---

## 10) KPI

- 사후 리뷰에서 발견되는 구조/UI 누락 결함 감소율
- 에이전트 코딩 중 즉시 수정률
- PR당 재작업 횟수 감소
- 품질 점수(Architecture/Design) 개선 추세

---

## 11) 리스크와 대응

리스크 1: 오탐지
- 대응: evidence 제공 + 룰 예외 allowlist

리스크 2: 알림 피로
- 대응: severity 필터 + 요약 모드

리스크 3: 분석 오버헤드
- 대응: 증분/비동기 실행, 룰 우선순위 제어

---

## 12) Exit Criteria

아래를 만족하면 MVP 완료:
- 코드 변경 시 실시간 경고/제안이 DevTool과 에이전트에 전달됨
- 승인형 패치로 최소 3개 이슈 자동 보완 성공
- lint 없이도 핵심 품질 룰(순환참조/상태누락/중복) 운영 가능
