# Mandu 모바일 지향 전략서
## 네이티브 빌드(Android/iOS) + SPA급 UX 달성 계획

- Status: Proposal Draft
- Owner: Mandu Core Team
- Scope: Mobile-first delivery for Android/iOS with SPA-grade UX

## 1) 목표

Mandu를 기반으로 다음을 동시에 달성한다.

1. Android/iOS 네이티브 빌드 지향(웹뷰 래핑 + 네이티브 브리지)
2. 모바일에서 SPA 수준의 즉시성 있는 UI 전환 체감
3. 서버 무결성(권한/검증)은 유지하면서 앱 경험 품질 강화

---

## 2) 전략 요약

### 핵심 방향
- **Mandu = 공통 웹코어** (SSR/API/도메인/실시간)
- **Native Shell = 플랫폼 기능 담당** (푸시/카메라/파일/생체인증)
- **UX 목표 = SSR 기반 + SPA급 전환 체감**

즉, PWA 중심이 아니라 "웹코어 + 네이티브 셸" 하이브리드 전략으로 간다.

---

## 3) 아키텍처

```text
Mandu App (SSR + Island + API)
  ├─ Web Core UI
  ├─ Domain/API Logic
  ├─ Realtime (SSE/catch-up)
  └─ Performance Policies

Native Shell (Android/iOS)
  ├─ WebView Host
  ├─ Push / Camera / File / Biometrics
  ├─ Network/Offline Hooks
  └─ App Lifecycle Events
```

브리지 원칙:
- 비즈니스 로직은 Mandu에 유지
- 네이티브 전용 기능만 브리지 인터페이스로 노출

---

## 4) SPA급 UX 목표 정의

모바일 SPA급으로 간주하는 기준(예시):
- cold start 첫 유의미 화면 표시: 1.5s~2.5s 이내(기기군별)
- route 전환 체감 지연: 150ms~300ms 수준
- 입력 반응 지연(INP): 목표 임계 이하 유지
- 스크롤 중 프레임 드랍 최소화

---

## 5) SPA급 체감 달성을 위한 실행 항목

## 5.1 Preload / Prefetch
- 다음 라우트 island 번들 선로딩
- 사용자 행동 기반 prefetch(hover/tap 후보)
- 핵심 API prefetch + 캐시 워밍

## 5.2 캐시 우선 렌더
- stale-while-revalidate 패턴
- 첫 화면은 캐시 즉시 표시, 백그라운드 최신화
- mutation 이후 selective invalidate

## 5.3 전환 UX
- 빈 화면 전환 금지(스켈레톤/placeholder)
- route transition 동안 레이아웃 안정성 보장
- optimistic UI 적극 적용(되돌리기 포함)

## 5.4 리스트/피드 최적화
- 큰 리스트만 선택적 virtualize
- 작은 리스트는 기본 렌더 유지
- 동적 높이 항목 측정 비용 관리

## 5.5 런타임 예산
- route/island 단위 성능 budget 선언
- long task 감지 시 품질 강등 모드
- 저사양 기기용 경량 렌더 모드

---

## 6) 네이티브 빌드/배포 흐름 (권장)

## 6.1 빌드 체계
1. Mandu 웹앱 빌드
2. Native Shell에 웹 자산 주입
3. 플랫폼별 signing/profile
4. 앱스토어 배포

## 6.2 브리지 표준 인터페이스
- `push.register()`
- `device.biometricAuth()`
- `camera.capture()`
- `file.pick()/save()`
- `network.getStatus()`

## 6.3 앱 라이프사이클 연계
- foreground 진입 시 핵심 query 재검증
- background 전환 시 안전 저장
- 네트워크 복귀 시 catch-up 동기화

---

## 7) 데이터/상태 전략

권장 조합:
- 서버 상태: Query 계층(TanStack + Mandu wrapper)
- UI 상태: 경량 store(Zustand 등)
- 실시간: SSE 이벤트 -> invalidate/refetch

중요 원칙:
- 서버 상태를 UI store에 장기 캐시하지 않음
- 네트워크 불안정 시 재시도/백오프 표준화

---

## 8) 오프라인/불안정 네트워크 대응

- write 작업 큐잉(가능한 도메인 한정)
- reconnect 시 순차 재전송 정책
- 충돌 시 서버 기준 병합 규칙 정의
- 사용자에게 동기화 상태 가시화

---

## 9) 보안/품질 가드

- 토큰 저장 정책(보안 저장소 우선)
- 민감정보 로깅 금지/마스킹
- 브리지 API 권한 최소화
- 네이티브/웹 버전 호환성 매트릭스 유지

---

## 10) 측정/관측

필수 지표:
- LCP / INP / CLS
- route transition latency
- long task 빈도
- API p95 / 오류율
- 앱 크래시율 / 동기화 실패율

운영 방식:
- 릴리즈마다 전/후 비교 리포트
- 성능 budget 초과 시 경고 또는 게이트

---

## 11) 단계별 로드맵

## Phase 0 (설계)
- 모바일 UX KPI와 성능 budget 확정
- 브리지 인터페이스 초안 확정

## Phase 1 (MVP)
- Native Shell 기본 연결
- 핵심 라우트 prefetch + 캐시 워밍
- 전환 스켈레톤/optimistic UX 반영

## Phase 2 (실전)
- Query invalidation 표준화
- 실시간 catch-up 안정화
- 리스트 성능 최적화(선택적 virtualize)

## Phase 3 (고도화)
- 저사양 모드/절전 모드
- 장애 복구 런북
- release gate 자동화

---

## 12) 리스크와 대응

1. 리스크: 웹뷰 성능 편차
- 대응: 기기군별 budget + 경량 모드

2. 리스크: 브리지 복잡도 증가
- 대응: 최소 인터페이스 원칙 + 버전 관리

3. 리스크: SPA급 체감 미달
- 대응: 전환 경로 prefetch/캐시 정책 우선 튜닝

4. 리스크: 오프라인 충돌
- 대응: 도메인별 큐잉/병합 규칙 명시

---

## 13) Exit Criteria

아래를 만족하면 모바일 지향 1차 완료:
- Android/iOS 네이티브 셸 빌드 파이프라인 재현 가능
- 핵심 사용자 시나리오에서 SPA급 전환 체감 확보
- 성능/동기화/안정성 지표를 릴리즈 단위로 측정 가능
- 문서만으로 팀 내 재현 및 운영 가능
