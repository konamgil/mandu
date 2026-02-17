# Mandu Query Wrapper 도입 기획서 (TanStack Query Wrapper Strategy)

- Status: Proposal Draft
- Owner: Mandu Core Team
- Package (proposed): `@mandujs/query`
- Approach: **Wrapper (Adapter)**, not Fork

## 1) 배경

Mandu 프로젝트에서 데이터 패칭/캐시/무효화 패턴이 팀마다 달라지며,
특히 SSR + Island + 실시간(SSE/catch-up) 조합에서 운영 일관성이 깨지는 문제가 반복된다.

TanStack Query를 그대로 활용하되, Mandu 전용 규칙/헬퍼를 제공하는
얇은 래퍼(`@mandujs/query`)를 도입해 표준을 맞춘다.

---

## 2) 목표

1. Mandu 앱에서 Query 사용 패턴 표준화
2. SSR preload/hydrate 흐름을 간단한 API로 제공
3. route 기반 query key 규칙 통일
4. mutation 후 invalidation 정책을 관례화
5. SSE/catch-up 이벤트와 캐시 동기화 자동화

비목표:
- TanStack Query 재구현
- 캐시 엔진 자체 포크
- Mandu 전용 독립 쿼리 런타임 개발

---

## 3) 핵심 원칙

1. **Upstream First**
- TanStack Query 최신을 최대한 그대로 사용

2. **Thin Wrapper**
- 추가 기능은 최소 표면적 API로만 제공

3. **Mandu-Native DX**
- route manifest/SSR/island와 자연스럽게 결합

4. **Safe Defaults**
- stale/gc/retry 등 기본값을 실전형으로 제공

---

## 4) 제안 API (MVP)

```ts
import {
  ManduQueryProvider,
  createManduQueryClient,
  getRouteQueryKey,
  useManduQuery,
  useManduMutation,
  invalidateRouteQueries,
  attachSseInvalidation,
  dehydrateForMandu,
  hydrateFromMandu,
} from "@mandujs/query";
```

### 4.1 Provider / Client
- `createManduQueryClient(options?)`
  - Mandu 기본값 포함 QueryClient 생성
- `ManduQueryProvider`
  - 앱 루트 island에서 Provider 래핑

### 4.2 Key Helper
- `getRouteQueryKey(routeId, params?, scope?)`
  - route 기반 key 생성 표준

### 4.3 Hooks Wrapper
- `useManduQuery`
  - `useQuery` thin wrapper + route key 권장
- `useManduMutation`
  - mutation 성공 시 기본 invalidation 규칙 적용 옵션

### 4.4 SSR/Hydration
- `dehydrateForMandu(client)`
- `hydrateFromMandu(client, state)`
  - SSR preload 결과를 island hydration 시 복원

### 4.5 Realtime Sync
- `attachSseInvalidation({ eventSource, mapEventToKeys })`
  - SSE 이벤트 수신 시 관련 query 자동 invalidate

---

## 5) Mandu 통합 시나리오

## 5.1 SSR 초기 로딩
1. 서버에서 핵심 query prefetch
2. dehydrated state를 HTML에 주입
3. island에서 hydrateFromMandu 실행
4. 초기 화면에서 재요청 없이 즉시 데이터 표시

## 5.2 Mutation 이후 일관성
1. `useManduMutation`으로 write 수행
2. 성공 시 관련 route key invalidate
3. 백그라운드 refetch로 화면 일치 유지

## 5.3 실시간 이벤트 연계
1. SSE 이벤트 수신
2. `mapEventToKeys`로 영향 query 식별
3. 자동 invalidate/refetch

---

## 6) 기본 설정 권장값 (초안)

- staleTime: 15s
- gcTime: 5m
- retry: 1~2회 (idempotent query만)
- refetchOnWindowFocus: true (대시보드 제외 옵션)
- networkMode: online

환경별 override:
- 모바일 저전력 모드: refetch 간격 완화
- 고빈도 실시간 화면: staleTime 단축 + SSE 연동 우선

---

## 7) 개발 단계

## Phase 0. 설계
- API 표면 확정
- demo 적용 시나리오 정의

## Phase 1. Core Wrapper
- Provider/Client/Key helper
- query/mutation thin wrappers

## Phase 2. SSR/Hydration
- dehydrate/hydrate helper
- 예제 route 적용

## Phase 3. Realtime Sync
- SSE invalidation helper
- chat demo 적용

## Phase 4. 문서/검증
- 가이드 + FAQ
- benchmark + 회귀 테스트

---

## 8) KPI

- 도입 시간: 신규 프로젝트 30분 이내
- 중복 요청 감소율
- mutation 후 stale 화면 지속 시간 감소
- 실시간 이벤트 반영 지연(ms) 감소
- query 관련 버그 재발률 감소

---

## 9) 리스크와 대응

1) 리스크: 래퍼 API 과도 확장
- 대응: MVP는 최소 API만 제공, TanStack 원형 보존

2) 리스크: 버전 호환성
- 대응: peer dependency 전략 + compatibility matrix 문서화

3) 리스크: SSR 상태 누수
- 대응: 요청 단위 client 격리 원칙 문서화/테스트

4) 리스크: 무효화 과다로 성능 저하
- 대응: route key 스코프 규칙 + 이벤트-키 매핑 가이드

---

## 10) 적용 예시 대상

1. `mandu-chat-demo`
- messages query
- send mutation
- SSE invalidation

2. 관리형 대시보드 샘플
- 리스트 캐시
- 필터 기반 key 전략

---

## 11) Exit Criteria

아래를 충족하면 MVP 완료:
- 데모 프로젝트에서 wrapper만으로 query/mutation/SSE 동기화 구현
- SSR hydrate 경로에서 hydration mismatch 없음
- 문서만 보고 신규 팀원이 동일 패턴 재현 가능
- TanStack 업스트림 버전 업데이트 절차가 문서화됨

---

## 12) 후속 로드맵

- `@mandujs/query-devtools` 통합 패널
- `mandu check --query` 규칙 검사
- route-level cache policy 선언형 설정
