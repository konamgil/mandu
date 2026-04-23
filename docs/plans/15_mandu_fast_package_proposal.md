# Mandu Fast 패키지 제안 도입 기획서

- Status: Proposal Draft
- Owner: Mandu Core Team
- Target Package: `@mandujs/fast` (가칭)
- Goal: "웹 빠른 렌더링"을 위한 Mandu 전용 단일 성능 패키지 제공

## 1. 배경

현재 고성능 UI(가상 스크롤, GPU 활용, 성능 계측)는 프로젝트마다 조합 방식이 달라
- 초기 도입 난이도 증가
- 품질/접근성/fallback 편차 발생
- 팀 간 재현성 저하
문제가 반복된다.

Mandu 철학(island-first, 서버 중심 무결성, 재현성)을 유지하면서
"가져다 쓰면 바로 빠르게"를 제공하는 단일 패키지가 필요하다.

---

## 2. 제안 요약

### 핵심 제안
- `@mandujs/fast` 하나로 아래 3축 제공
  1) Virtual Rendering (VirtualList/VirtualGrid)
  2) GPU Capability + Rendering Adapter(WebGPU 우선, 안전 fallback)
  3) Runtime Performance Metrics(FPS/LongTask/메모리/렌더 시간)

### 왜 단일 패키지인가
- 사용자 목표가 하나(빠른 렌더링)이므로 진입점도 하나가 맞다.
- 설치/학습/운영 비용 최소화
- 문서/예제/테스트 경로 단순화

---

## 3. 제품 목표

1. **즉시성**: 설치 후 10분 내 성능 개선 체감 가능
2. **안전성**: 브라우저/기기 미지원 환경 자동 fallback
3. **일관성**: Mandu island와 자연스럽게 결합
4. **재현성**: 성능 전/후를 수치로 비교 가능

비목표(Non-goals):
- 게임 엔진급 3D 프레임워크 대체
- 모든 컴포넌트의 무조건 가상화
- WebGPU 강제 사용

---

## 4. 기능 범위 (MVP)

## 4.1 VirtualList
- 고정 높이/가변 높이 리스트 지원
- overscan/anchor/restore scroll 기본 제공
- 접근성(키보드 포커스/스크린리더) 가이드 포함

## 4.2 useGpuCapability
- `navigator.gpu` 지원 여부 및 안전 체크
- 성능/배터리 조건 기반 권장 모드 반환
- `webgpu | webgl2 | canvas2d` fallback 전략

## 4.3 PerformancePanel
- 개발 모드 성능 HUD
- FPS, LongTask, 메모리 추정, 렌더 횟수 표시
- route/island 단위 측정 지원

---

## 5. API 초안

```ts
import {
  VirtualList,
  VirtualGrid,
  useGpuCapability,
  createRenderAdapter,
  PerformancePanel,
  usePerfMarks,
} from "@mandujs/fast";
```

### 예시 1: VirtualList
```tsx
<VirtualList
  items={messages}
  estimateSize={56}
  overscan={8}
  renderItem={(item) => <MessageRow item={item} />}
/>
```

### 예시 2: GPU Capability
```ts
const gpu = useGpuCapability();
// gpu.mode: "webgpu" | "webgl2" | "canvas2d"
```

### 예시 3: Perf Panel
```tsx
{process.env.NODE_ENV === "development" ? <PerformancePanel /> : null}
```

---

## 6. 아키텍처 원칙

1. Island-safe
- 무거운 렌더 로직은 island 내부에서만 활성화

2. Progressive Enhancement
- 고성능 기능은 지원 환경에서만 활성화
- 미지원 환경에서는 동일 UX fallback

3. Measurable First
- 기능 제공과 동시에 성능 지표를 기본 노출

4. Guarded Defaults
- 작은 리스트(예: 100개 미만)는 기본 렌더 유지 권장
- "가상화 만능" 오해 방지

---

## 7. 성능 목표 (MVP KPI)

- 10,000 row 리스트 기준
  - 메모리 사용량 40% 이상 절감(기준 대비)
  - 스크롤 프레임 유지율 개선
- 대시보드형 UI에서 LongTask 빈도 감소
- 도입 프로젝트 3개 이상에서 체감 개선 사례 확보

---

## 8. 개발 단계

## Phase 0: 설계/벤치 베이스라인
- 샘플 앱 2개 구성(채팅/테이블)
- 현재 성능 baseline 수집

## Phase 1: VirtualList/VirtualGrid
- 고정 높이 우선 구현
- 가변 높이 실험 옵션 제공

## Phase 2: GPU Capability + Adapter
- capability detect
- webgpu/webgl2/canvas2d adapter

## Phase 3: PerformancePanel
- FPS/LongTask/memory/rerender 표시

## Phase 4: 문서/예제/가이드
- "언제 virtualize하지 말아야 하는가" 포함
- 접근성/SEO 영향 가이드 포함

## Phase 5: demo 적용
- `mandu-chat-demo` 메시지 리스트 적용
- 전/후 benchmark 리포트 첨부

---

## 9. 리스크와 대응

1) 리스크: 패키지 비대화
- 대응: 내부 모듈 분리, 외부 단일 엔트리 유지

2) 리스크: 가상화로 UX 악화
- 대응: 기본 threshold + 접근성 체크리스트 제공

3) 리스크: WebGPU 지원 편차
- 대응: multi-fallback adapter 표준화

4) 리스크: "수치 없는 최적화" 반복
- 대응: PerformancePanel + benchmark template 의무화

---

## 10. 적용 전략

- 1차: Experimental 태그로 배포
- 2차: 데모/실사용 프로젝트에서 피드백 수집
- 3차: 안정화 후 `@mandujs/fast` 정식 릴리즈

출시 정책:
- Major 목표: API 안정성
- Minor 목표: 성능 개선
- Patch 목표: 회귀 수정

---

## 11. 성공 판정 (Exit Criteria)

아래를 모두 만족하면 MVP 성공:
- 설치 후 10분 내 적용 가능한 공식 예제 존재
- 2개 이상 실제 프로젝트에서 성능 개선 수치 확보
- 접근성/호환성 문제 없는 fallback 검증 완료
- Mandu 문서/CLI 가이드와 충돌 없이 통합

---

## 12. 후속 제안

- `mandu check --perf`와 연동하여 perf budget 게이트 제공
- route/island별 성능 히스토리 추적 기능 추가
- WebGPU 연산 워커 연동(고급 모드) 검토
