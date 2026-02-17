# Mandu Kitchen AI Copilot RFC

- Status: Proposal Draft
- Owner: Mandu Core + Devtools Team
- Scope: Kitchen DevTool에 AI 대화/분석/제안/승인형 실행 흐름 도입

## 1. 문제 정의

현재 개발 흐름에서 아래 문제가 반복된다.

- 프로젝트 컨텍스트(라우트/의존성/최근 변경/에러)가 분산됨
- 유지보수 제안이 수동/후행적으로 이뤄짐
- 비개발자는 코드 변경의 영향과 엔지니어링 판단 기준을 이해하기 어려움
- 에이전트 코딩 시 실시간 품질 피드백이 약함

## 2. 제안 요약

Kitchen DevTool에 **AI Copilot 레이어**를 넣는다.

핵심:
1. 프로젝트와 대화 (상태/오류/구조/변경 질의)
2. 실시간 유지보수 제안 (의존성/리팩터링/리스크)
3. 영향 분석 (파일/테스트/런타임 영향)
4. 승인형 실행 (자동수정은 항상 사용자 승인 후)
5. 비개발자 가이드 모드 (용어 설명/프롬프트 생성/학습형 코칭)

## 3. 기술 선택

- LLM 연결: Vercel AI SDK (provider-agnostic)
- 컨텍스트 수집: routes manifest, lockfile, test report, git diff, runtime errors
- 실행 경로: "제안 -> 승인 -> 패치/PR" 워크플로우

## 4. 제품 모드

## 4.1 Builder Mode (개발자)
- 오류 원인 후보 랭킹
- 패치 제안 + 영향 분석
- 테스트/검증 커맨드 추천

## 4.2 Guide Mode (비개발자)
- 현재 코드 상태를 자연어로 설명
- "무엇을 먼저 해야 하는지" 단계형 가이드
- 프롬프트 템플릿 자동 생성

## 4.3 Maintainer Mode (운영/유지보수)
- 의존성 업그레이드 제안
- 보안/성능 리스크 경고
- 롤백 플랜 자동 제시

## 5. 핵심 기능 (MVP)

1) Context Chat
- "현재 라우트 이슈 뭐야?"
- "최근 PR 이후 깨진 테스트 뭐야?"

2) Impact Analyzer
- 변경 후보 파일과 파급 범위를 트리로 제시

3) Patch Proposal
- diff 초안 + 예상 리스크 + 검증 명령 생성

4) Approval Gate
- 사용자 승인 전 자동 변경 금지

5) Session Memory (로컬)
- 최근 의사결정/규칙을 요약 저장

## 6. 아키텍처

```text
Kitchen UI
  ├─ Context Collector
  │   ├─ routes/lockfile/git/test/runtime
  │   └─ normalization layer
  ├─ AI Orchestrator (Vercel AI SDK)
  │   ├─ tool calling
  │   └─ response guard
  ├─ Suggestion Engine
  │   ├─ impact scoring
  │   └─ risk classification
  └─ Approval Executor
      ├─ patch apply
      ├─ test run
      └─ PR draft
```

## 7. 보안/안전 원칙

1. 승인형 실행 강제
- 코드 변경/명령 실행은 명시 승인 필요

2. 비밀정보 보호
- 토큰/개인정보/민감 로그 자동 마스킹

3. 근거 기반 제안
- 모든 제안에 "근거 파일/라인/리포트" 첨부

4. 롤백 보장
- 변경 전 snapshot + rollback command 제공

## 8. 단계별 로드맵

## Phase 0 (기획/설계)
- UI 와이어프레임
- 컨텍스트 스키마 정의
- 보안 정책 정의

## Phase 1 (MVP)
- Context Chat
- Impact Analyzer
- Approval Gate(읽기/제안 중심)

## Phase 2 (실전)
- 패치 제안 + 테스트 명령 자동 생성
- PR draft 생성

## Phase 3 (고도화)
- 실시간 watch 코칭
- 비개발자 Guide Mode
- 유지보수 자동 제안(의존성/성능)

## 9. KPI

- 문제 진단 리드타임 단축
- 회귀 버그 재발률 감소
- PR 준비 시간 단축
- 비개발자 작업 성공률 향상

## 10. 리스크와 대응

- 리스크: 과도한 자동화로 오작동
  - 대응: 승인형 실행 + 위험도 레벨

- 리스크: 잘못된 AI 제안
  - 대응: 근거표시 + 검증 커맨드 동반

- 리스크: 컨텍스트 누락
  - 대응: collector health check + missing-context 경고

## 11. Exit Criteria

- Kitchen에서 프로젝트 대화/영향분석/제안이 일관 동작
- 승인형 패치 흐름으로 최소 3개 실전 이슈 해결
- 문서만으로 팀 내 재현 가능

## 12. 후속 제안

- `mandu check --ai-readiness` 도입
- 정책 파일 기반 팀별 제안 톤/강도 커스터마이즈
- 리포트 자동 아카이빙(학습 가능한 유지보수 히스토리)
