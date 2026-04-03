# Mandu 상태관리 권장안 제안서

- Status: Proposal Draft
- Owner: Mandu Core Team
- Decision Type: Recommended Stack (non-breaking)

## 1) 결론

Mandu의 기본 권장 상태관리 스택은 아래 조합을 제안한다.

1. **TanStack Query**: 서버 상태(Server State)
2. **Zustand**: 클라이언트/UI 상태(Client/UI State)

핵심 원칙:
- 서버에서 온 데이터(조회/캐시/무효화/재시도)는 Query로
- 화면 상호작용 전역 상태(모달/필터/선택/패널)는 Zustand로

---

## 2) 배경

Mandu는 SSR + Island 중심 구조를 제공하지만,
내장 전역 상태관리(클라이언트) 및 서버 캐시 프레임워크를 강제하지 않는다.

프로젝트가 커질수록 아래 문제가 반복된다.
- 팀마다 fetch/cache 패턴이 다름
- mutation 이후 화면 동기화 규칙이 제각각
- UI 상태/서버 상태 경계가 섞여 디버깅 난이도 증가

따라서 Mandu 관점에서 일관된 실무 기본 조합을 제안한다.

---

## 3) 역할 분리 모델

## 3.1 서버 상태 (TanStack Query)
대상:
- API 조회 데이터
- 캐시/재요청/무효화가 필요한 데이터
- 네트워크 실패/재시도 정책 적용 대상

대표 책임:
- query key 관리
- stale/gc policy
- mutation 후 invalidate/refetch
- 백그라운드 동기화

## 3.2 클라이언트/UI 상태 (Zustand)
대상:
- 모달 열림/닫힘
- 탭/패널 상태
- 로컬 필터/정렬 옵션
- 선택된 항목 ID, 임시 입력 버퍼

대표 책임:
- 전역 UI 상태 공유
- selector 기반 최소 렌더
- 도메인별 작은 store 구성

---

## 4) Mandu 아키텍처와의 정합성

1. SSR + hydration
- Query는 SSR prefetch/hydrate 패턴과 결합이 쉬움

2. Island 분리
- Island 단위로 store/query를 경량 조합 가능

3. 서버 중심 무결성
- 권한/검증은 서버 API에서 확정, Query는 조회/동기화 계층 담당

4. 실시간(SSE)
- 이벤트 수신 시 Query invalidate로 최신화, UI 세부 상태는 Zustand 유지

---

## 5) 금지/비권장 패턴

비권장 1:
- Zustand에 서버 데이터 캐시를 장기 저장

비권장 2:
- Query cache에 UI 토글 상태를 저장

비권장 3:
- mutation 성공 후 invalidate 없이 수동 patch만 반복

비권장 4:
- 상태 책임이 섞인 거대한 단일 store

---

## 6) 권장 구현 패턴

패턴 A: Query + UI store 결합
- `useQuery`로 데이터 가져오기
- `useUiStore`로 필터/선택 상태 관리
- 필터 변경은 UI store, 서버 재조회는 query key 반영

패턴 B: Mutation + Invalidation
- write는 `useMutation`
- 성공 시 관련 query key만 invalidate

패턴 C: SSE + Query Sync
- SSE 이벤트 수신
- 이벤트 타입별 query key invalidate
- UI store는 필요 최소한만 업데이트

---

## 7) 단계별 도입안

## Phase 0
- `mandu-chat-demo`에 baseline 적용
- query key 규칙 문서화

## Phase 1
- 공통 helper 제공 (`getRouteQueryKey`)
- mutation/invalidation 관례화

## Phase 2
- SSE invalidation helper 도입
- 실시간 시나리오 회귀 테스트 추가

## Phase 3
- `@mandujs/query` wrapper(MVP) 공개
- 공식 템플릿에 권장 패턴 반영

---

## 8) KPI

- 중복 요청 감소율
- mutation 이후 stale UI 지속시간 감소
- 상태관리 관련 버그 재발률 감소
- 신규 팀원의 상태관리 온보딩 시간 단축

---

## 9) 리스크 및 대응

리스크: 라이브러리 러닝커브 증가
- 대응: 공식 예제/문서/템플릿 제공

리스크: 역할 경계 혼동
- 대응: "서버 상태 vs UI 상태" 결정표 문서화

리스크: Query key 난립
- 대응: route 기반 key helper 제공

---

## 10) Exit Criteria

아래를 만족하면 권장안 정착으로 간주:
- demo에서 Query+Zustand 분리 패턴 검증 완료
- 문서만으로 신규 프로젝트 재현 가능
- 실시간(SSE) 시나리오에서 데이터 일관성 유지
- 상태관리 관련 이슈 재발률 감소 확인
