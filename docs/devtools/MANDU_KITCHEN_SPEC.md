# Mandu Kitchen - DevTools 상세 기획서

> **버전**: 1.0.0-draft
> **최종 수정**: 2024-02-03
> **상태**: 기획 단계

---

## 목차

1. [Executive Summary](#1-executive-summary)
2. [Product Vision](#2-product-vision)
3. [Feature Specification](#3-feature-specification)
4. [UI/UX Design Guide](#4-uiux-design-guide)
5. [Technical Architecture](#5-technical-architecture)
6. [API Specification](#6-api-specification)
7. [Implementation Plan](#7-implementation-plan)
8. [Testing Strategy](#8-testing-strategy)
9. [Performance Considerations](#9-performance-considerations)
10. [Future Roadmap](#10-future-roadmap)

---

## 1. Executive Summary

### 1.1 프로젝트 개요

**Mandu Kitchen**은 Mandu Framework에 내장되는 개발자 도구입니다. "만두를 찌듯 편안하게 디버깅한다"는 컨셉으로, 친근한 UX와 강력한 기능을 결합합니다.

### 1.2 핵심 가치

| 가치 | 설명 |
|------|------|
| **Zero Config** | 설치 없이 자동 활성화, 프로덕션 자동 제거 |
| **AI-Native** | MCP 연동으로 AI 수정 제안 제공 |
| **Islands 전문** | 하이드레이션 상태 시각화 특화 |
| **친근한 UX** | 만두 캐릭터로 에러를 두렵지 않게 |

### 1.3 컨셉: "만두 주방" 메타포

| 개발 용어 | 만두 메타포 |
|----------|------------|
| 코드 | 레시피 |
| 컴포넌트 | 재료 |
| 빌드 | 요리 과정 |
| 에러 | 타버린 만두 🔥 |
| HMR | 레시피 업데이트 |
| 배포 | 서빙 |

---

## 2. Product Vision

### 2.1 비전 스테이트먼트

> "개발자가 만두를 찌듯 편안하게 디버깅할 수 있는 세상"

### 2.2 미션

- 에러를 두렵지 않게 만들기
- 복잡한 디버깅을 친근하게
- AI와 함께하는 문제 해결

### 2.3 타겟 사용자 페르소나

#### 페르소나 1: 초보 개발자 "민수"

| 항목 | 내용 |
|------|------|
| 경력 | 1년 미만 |
| 고민 | 에러 메시지가 무섭고 어려움 |
| 니즈 | 친근한 에러 설명, AI 도움 |
| Mandu Kitchen 가치 | 만두 캐릭터로 친근감, "이 에러 고쳐줘" 버튼 |

#### 페르소나 2: 풀스택 개발자 "영희"

| 항목 | 내용 |
|------|------|
| 경력 | 3-5년 |
| 고민 | SSR/CSR 디버깅 복잡, 하이드레이션 이슈 |
| 니즈 | Islands 상태 시각화, 네트워크 모니터링 |
| Mandu Kitchen 가치 | Islands Inspector, SSE 스트리밍 추적 |

#### 페르소나 3: 시니어 개발자 "철수"

| 항목 | 내용 |
|------|------|
| 경력 | 7년 이상 |
| 고민 | 아키텍처 일관성 유지, 팀 코드 품질 |
| 니즈 | Architecture Guard 통합, 성능 프로파일링 |
| Mandu Kitchen 가치 | Guard Viewer, 의존성 그래프 |

### 2.4 경쟁 분석

| 도구 | 강점 | 약점 | Mandu Kitchen 차별점 |
|------|------|------|---------------------|
| Next.js DevTools | RSC 특화 | 딱딱한 UI | 친근한 UX |
| Vue DevTools | 컴포넌트 트리 | 브라우저 확장 필요 | Zero Config |
| React DevTools | 프로파일링 | 설치 필요 | AI 통합 |

---

## 3. Feature Specification

### 3.1 기능 개요

| 탭 | 기능명 | 설명 | 우선순위 |
|----|--------|------|----------|
| 🔥 | Error Steamer | 에러 오버레이 + 스택 트레이스 | P0 |
| 🏝️ | Islands Inspector | 하이드레이션 상태 시각화 | P1 |
| 📡 | Network Kitchen | API/SSE 스트리밍 모니터링 | P1 |
| 🛡️ | Guard Viewer | Architecture 위반 실시간 | P2 |
| 📊 | Performance | Core Web Vitals | P3 |
| 🤖 | AI Assist | MCP 연동 수정 제안 | P2 |

### 3.2 Error Steamer (에러 찜기)

#### 3.2.1 에러 감지 시스템

| 에러 타입 | 감지 방법 | 우선순위 |
|----------|----------|---------|
| Runtime Error | `window.onerror` | Critical |
| Unhandled Rejection | `unhandledrejection` event | Critical |
| React Error | ErrorBoundary + console.error 후킹 | High |
| Network Error | fetch 래핑, status >= 400 | High |
| HMR Error | WebSocket 메시지 | Medium |
| Guard Violation | Guard Watcher 연동 | Medium |

#### 3.2.2 에러 정보 구조

```typescript
interface ManduError {
  id: string;                    // 고유 ID
  type: ErrorType;               // 에러 타입
  severity: 'critical' | 'error' | 'warning';

  // 기본 정보
  message: string;               // 에러 메시지
  stack?: string;                // 스택 트레이스

  // 위치 정보
  source?: string;               // 파일 경로
  line?: number;                 // 라인 번호
  column?: number;               // 컬럼 번호

  // 컨텍스트
  componentStack?: string;       // React 컴포넌트 스택
  islandId?: string;             // 발생한 Island ID
  routeId?: string;              // 발생한 라우트

  // 메타
  timestamp: number;             // 발생 시간
  userAgent: string;             // 브라우저 정보
  url: string;                   // 현재 URL

  // AI 분석용
  codeContext?: string;          // 주변 코드 (±5줄)
  suggestions?: string[];        // AI 수정 제안
}
```

#### 3.2.3 사용자 액션

| 액션 | 설명 | 단축키 |
|------|------|--------|
| 닫기 | 오버레이 최소화 | `ESC` |
| 무시 | 해당 에러 무시 (세션 동안) | `I` |
| 복사 | 에러 정보 클립보드 복사 | `C` |
| 소스 보기 | 에디터에서 파일 열기 | `O` |
| AI에게 물어보기 | MCP로 컨텍스트 전송 | `A` |
| 새로고침 | 페이지 리로드 | `R` |

### 3.3 Islands Inspector (섬 검사기)

#### 3.3.1 Island 상태 구조

```typescript
interface IslandStatus {
  id: string;                      // Island ID
  name: string;                    // 컴포넌트 이름
  strategy: HydrationStrategy;     // load | idle | visible | media | never

  // 타이밍
  ssrRenderTime?: number;          // SSR 렌더링 시간
  hydrateStartTime?: number;       // 하이드레이션 시작
  hydrateEndTime?: number;         // 하이드레이션 완료
  totalHydrateTime?: number;       // 총 하이드레이션 시간

  // 상태
  status: 'ssr' | 'pending' | 'hydrating' | 'hydrated' | 'error';

  // 번들 정보
  bundleSize?: number;             // JS 번들 크기
  loadTime?: number;               // 번들 로드 시간
}
```

#### 3.3.2 시각화 모드

**타임라인 뷰**
```
Time →  0ms    100ms   200ms   300ms   400ms
        │       │       │       │       │
ChatBox ████████████████░░░░░░░░░░░░░░░░  hydrated (150ms)
TechPanel       ████████████████░░░░░░░░  hydrated (120ms)
Sidebar                 ████████████████  hydrating...

█ = 하이드레이션 진행
░ = 대기 중
```

**오버레이 뷰**
- SSR: 회색
- Pending: 노란색
- Hydrating: 파란색 (애니메이션)
- Hydrated: 초록색
- Error: 빨간색

#### 3.3.3 성능 알림

| 조건 | 알림 | 레벨 |
|------|------|------|
| 하이드레이션 > 500ms | "느린 하이드레이션 감지" | Warning |
| 번들 > 100KB | "큰 Island 번들" | Warning |
| visible 전략인데 LCP 차단 | "LCP 최적화 필요" | Warning |

### 3.4 Network Kitchen (네트워크 주방)

#### 3.4.1 요청 추적 데이터

```typescript
interface NetworkRequest {
  id: string;

  // 요청 정보
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;

  // 응답 정보
  status?: number;
  statusText?: string;
  responseSize?: number;

  // 타이밍
  startTime: number;
  endTime?: number;
  duration?: number;

  // 스트리밍 (SSE/WebSocket)
  isStreaming: boolean;
  streamType?: 'sse' | 'websocket' | 'fetch-stream';
  chunks?: StreamChunk[];
}

interface StreamChunk {
  index: number;
  timestamp: number;
  size: number;
  data?: unknown;
}
```

### 3.5 Guard Viewer (가드 뷰어)

```typescript
interface GuardViolation {
  id: string;
  severity: 'error' | 'warning';

  // 위반 정보
  fromFile: string;
  fromLayer: string;
  toFile: string;
  toLayer: string;
  importStatement: string;
  line: number;

  // 규칙 정보
  ruleId: string;
  ruleDescription: string;

  // 수정 제안
  suggestion?: string;
}
```

---

## 4. UI/UX Design Guide

### 4.1 디자인 토큰

```typescript
const ManduDesignTokens = {
  colors: {
    // 브랜드 색상
    brand: {
      primary: '#F5E6D3',      // 만두피 베이지
      secondary: '#8B4513',    // 구운 갈색
      accent: '#E8967A',       // 새우 만두 분홍
    },

    // 시맨틱 색상
    semantic: {
      success: '#90EE90',      // 채소 초록
      warning: '#FFD700',      // 계란 노란
      error: '#FF6B6B',        // 고추 빨강
      info: '#87CEEB',         // 하늘색
    },

    // 배경
    background: {
      dark: '#1A1A2E',         // 찜기 내부
      medium: '#2D2D44',       // 패널 배경
      light: '#3D3D5C',        // 카드 배경
      overlay: 'rgba(0,0,0,0.85)',
    },

    // 텍스트
    text: {
      primary: '#FFFFFF',
      secondary: '#B0B0B0',
      muted: '#707070',
    },
  },

  typography: {
    fontFamily: {
      mono: "'JetBrains Mono', 'Fira Code', monospace",
      sans: "'Pretendard', -apple-system, sans-serif",
    },
    fontSize: {
      xs: '10px',
      sm: '12px',
      md: '14px',
      lg: '16px',
      xl: '20px',
    },
  },

  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
  },

  borderRadius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    full: '9999px',
  },

  shadow: {
    sm: '0 2px 4px rgba(0,0,0,0.3)',
    md: '0 4px 8px rgba(0,0,0,0.4)',
    lg: '0 8px 16px rgba(0,0,0,0.5)',
    glow: '0 0 20px rgba(245,230,211,0.3)',
  },
};
```

### 4.2 만두 캐릭터

#### 상태별 표정

| 상태 | 이모티콘 | 설명 |
|------|----------|------|
| 정상 | `(◕‿◕)` | "모든 만두가 잘 익고 있어요~" |
| 경고 | `(◕_◕)` | "뭔가 이상해요..." |
| 에러 | `(ノಠ益ಠ)ノ` | "만두가 타버렸어요!" |
| 로딩 | `(◕‿◕)💨` | "만두 찌는 중..." |
| HMR | `(◕‿◕)✨` | "레시피 업데이트됨!" |

#### SVG 구조

```svg
<svg viewBox="0 0 100 100">
  <!-- 만두 몸체 -->
  <ellipse cx="50" cy="55" rx="40" ry="30" fill="#F5E6D3" />

  <!-- 만두 주름 -->
  <path d="M20,45 Q35,35 50,45 Q65,35 80,45"
        stroke="#D4C4B0" fill="none" stroke-width="3"/>

  <!-- 눈 -->
  <circle cx="35" cy="55" r="5" fill="#333" />
  <circle cx="65" cy="55" r="5" fill="#333" />

  <!-- 입 -->
  <path d="M40,65 Q50,75 60,65" stroke="#333" fill="none"/>

  <!-- 볼터치 -->
  <ellipse cx="25" cy="60" rx="8" ry="5" fill="#FFCCCC" opacity="0.5"/>
  <ellipse cx="75" cy="60" rx="8" ry="5" fill="#FFCCCC" opacity="0.5"/>
</svg>
```

### 4.3 레이아웃

#### 메인 패널

```
┌─────────────────────────────────────────────────┐
│  🥟 Mandu Kitchen          [_] [□] [×]          │
├─────────────────────────────────────────────────┤
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │
│  │ 🔥  │ │ 🏝️  │ │ 📡  │ │ 🛡️  │ │ 📊  │       │
│  │에러 │ │섬   │ │주문 │ │검사 │ │성능 │       │
│  │ (2) │ │ (3) │ │ (5) │ │ OK │ │     │       │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘       │
├─────────────────────────────────────────────────┤
│  선택된 탭 내용...                               │
└─────────────────────────────────────────────────┘
```

#### 에러 오버레이

```
┌─────────────────────────────────────────────────┐
│                                                 │
│         🔥                                      │
│        (ノಠ益ಠ)ノ彡┻━┻                          │
│                                                 │
│    만두가 타버렸어요!                            │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │ TypeError: Cannot read property 'foo'   │    │
│  │                                         │    │
│  │ at UserComponent (src/components/...)   │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  [소스 보기]  [무시하기]  [AI에게 물어보기]        │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 5. Technical Architecture

### 5.1 시스템 구조

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
├─────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐ │
│  │                 Mandu Kitchen Client                    │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  ErrorCatcher → NetworkProxy → IslandTracker           │ │
│  │         │              │              │                │ │
│  │         └──────────────┼──────────────┘                │ │
│  │                        ▼                               │ │
│  │                 StateManager                           │ │
│  │                        │                               │ │
│  │         ┌──────────────┼──────────────┐                │ │
│  │         ▼              ▼              ▼                │ │
│  │    OverlayUI      PanelUI       BadgeUI                │ │
│  └────────────────────────────────────────────────────────┘ │
│                           │ WebSocket                       │
├───────────────────────────┼─────────────────────────────────┤
│                         Server                              │
├───────────────────────────┼─────────────────────────────────┤
│  ┌────────────────────────┼───────────────────────────────┐ │
│  │                 Mandu Kitchen Server                    │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  HTMLInjector ←── DevToolsCore ──→ WSServer            │ │
│  │                        │                               │ │
│  │         ┌──────────────┼──────────────┐                │ │
│  │         ▼              ▼              ▼                │ │
│  │   HMR Bridge    Guard Bridge    API Bridge             │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 패키지 구조

```
packages/core/src/devtools/
├── index.ts              # 메인 export
├── types.ts              # 타입 정의
├── protocol.ts           # WebSocket 프로토콜
├── tokens.ts             # 디자인 토큰
│
├── client/               # 클라이언트 런타임
│   ├── index.ts
│   ├── state-manager.ts
│   ├── error-catcher.ts
│   ├── network-proxy.ts
│   ├── island-tracker.ts
│   └── components/
│       ├── overlay.tsx
│       ├── panel.tsx
│       ├── badge.tsx
│       ├── mandu-character.tsx
│       └── tabs/
│           ├── errors.tsx
│           ├── islands.tsx
│           ├── network.tsx
│           └── guard.tsx
│
├── server/               # 서버 런타임
│   ├── index.ts
│   ├── injector.ts
│   ├── websocket.ts
│   └── bridges/
│       ├── hmr.ts
│       ├── guard.ts
│       └── api.ts
│
└── assets/               # 정적 자산
    └── mandu-icons.ts
```

### 5.3 WebSocket 프로토콜

```typescript
type DevToolsMessage =
  | { type: 'init'; data: InitData }
  | { type: 'error'; data: ManduError }
  | { type: 'error:clear'; data: { id?: string } }
  | { type: 'island:status'; data: IslandStatus }
  | { type: 'island:hydrated'; data: { id: string; time: number } }
  | { type: 'network:request'; data: NetworkRequest }
  | { type: 'network:response'; data: NetworkResponse }
  | { type: 'network:chunk'; data: StreamChunk }
  | { type: 'guard:violation'; data: GuardViolation }
  | { type: 'hmr:update'; data: HMRUpdate }
  | { type: 'hmr:error'; data: HMRError }
  | { type: 'ping' }
  | { type: 'pong' };
```

### 5.4 HTML 주입 전략

```typescript
function injectDevTools(html: string, options: DevToolsOptions): string {
  if (process.env.NODE_ENV !== 'development') {
    return html; // 프로덕션에서는 주입 안 함
  }

  const devToolsScript = `
    <script id="mandu-devtools">
      (function() {
        ${generateDevToolsRuntime(options)}
      })();
    </script>
    <style id="mandu-devtools-styles">
      ${generateDevToolsStyles()}
    </style>
  `;

  return html.replace('</body>', `${devToolsScript}</body>`);
}
```

---

## 6. API Specification

### 6.1 클라이언트 API

```typescript
declare namespace ManduDevTools {
  /** 커스텀 로그 추가 */
  function log(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    data?: unknown
  ): void;

  /** 에러 보고 */
  function reportError(
    error: Error | string,
    context?: {
      componentStack?: string;
      islandId?: string;
      severity?: 'critical' | 'error' | 'warning';
    }
  ): void;

  /** 타이밍 측정 */
  function time(label: string): void;
  function timeEnd(label: string): number;

  /** 네트워크 요청 태깅 */
  function tagRequest(
    url: string,
    tag: { label: string; group?: string }
  ): void;

  /** AI에게 질문 (MCP 연동) */
  function askAI(
    question: string,
    context?: {
      includeErrors?: boolean;
      includeNetwork?: boolean;
      includeCode?: string;
    }
  ): Promise<void>;

  /** 패널 제어 */
  function toggle(): void;
  function open(): void;
  function close(): void;
  function openTab(tab: 'errors' | 'islands' | 'network' | 'guard'): void;
}
```

### 6.2 설정 스키마

```typescript
// mandu.config.ts
interface DevToolsConfig {
  /** 활성화 여부 (기본: development에서 true) */
  enabled?: boolean;

  /** 패널 위치 */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

  /** 시작 시 열림 상태 */
  defaultOpen?: boolean;

  /** 테마 */
  theme?: 'light' | 'dark' | 'auto';

  /** 기능별 활성화 */
  features?: {
    errorOverlay?: boolean;
    islandsInspector?: boolean;
    networkMonitor?: boolean;
    guardViewer?: boolean;
    aiAssist?: boolean;
  };

  /** 에러 필터 */
  errorFilter?: (error: ManduError) => boolean;

  /** 커스텀 패널 */
  panels?: CustomPanel[];

  /** 단축키 */
  shortcuts?: {
    toggle?: string;      // 기본: 'Ctrl+Shift+M'
    openErrors?: string;  // 기본: 'Ctrl+Shift+E'
  };
}
```

### 6.3 CLI 옵션

```bash
# DevTools 비활성화
mandu dev --no-devtools

# DevTools 포트 지정
mandu dev --devtools-port 3001

# 특정 기능만 활성화
mandu dev --devtools-features errors,network

# 테마 지정
mandu dev --devtools-theme dark
```

---

## 7. Implementation Plan

### 7.1 Phase 1: Foundation (Week 1)

| 일차 | 작업 | 산출물 |
|------|------|--------|
| 1-2 | 프로젝트 구조, 타입 정의 | `types.ts`, `protocol.ts` |
| 3-4 | 서버 런타임 | `injector.ts`, `websocket.ts` |
| 5 | 클라이언트 기초 | `StateManager`, Badge UI |

### 7.2 Phase 2: Error Overlay (Week 2)

| 일차 | 작업 | 산출물 |
|------|------|--------|
| 1-2 | 에러 감지 시스템 | `ErrorCatcher` |
| 3-4 | 오버레이 UI | `Overlay`, `ErrorCard` |
| 5 | 만두 캐릭터 | SVG 아이콘, 애니메이션 |

### 7.3 Phase 3: Panel & Islands (Week 3)

| 일차 | 작업 | 산출물 |
|------|------|--------|
| 1-2 | 패널 프레임워크 | `Panel`, Tab 시스템 |
| 3-4 | Islands Inspector | `IslandTracker`, 타임라인 |
| 5 | 통합 테스트 | E2E 테스트 |

### 7.4 Phase 4: Network & Guard (Week 4)

| 일차 | 작업 | 산출물 |
|------|------|--------|
| 1-2 | Network Monitor | fetch 프록시, SSE 추적 |
| 3 | Guard 통합 | Guard Watcher 브릿지 |
| 4-5 | 문서화 & 릴리즈 | API 문서, v1.0.0 |

### 7.5 Phase 5: AI Integration (Week 5)

| 일차 | 작업 | 산출물 |
|------|------|--------|
| 1-2 | MCP 연동 | MCP 클라이언트 |
| 3-4 | AI UI | "AI에게 물어보기" 버튼 |
| 5 | 최적화 & 릴리즈 | v1.1.0 |

---

## 8. Testing Strategy

### 8.1 테스트 피라미드

```
           /\
          /  \        E2E Tests (10%)
         /----\       - Playwright
        /      \
       /--------\     Integration Tests (30%)
      /          \    - 컴포넌트 통합
     /------------\
    /              \  Unit Tests (60%)
   /----------------\ - 개별 함수
```

### 8.2 E2E 시나리오

```typescript
test('에러 발생 시 오버레이 표시', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { throw new Error('테스트'); });
  await expect(page.locator('#mandu-error-overlay')).toBeVisible();
});

test('Island 하이드레이션 추적', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="devtools-toggle"]');
  await expect(page.locator('.island-status')).toContainText('hydrated');
});
```

---

## 9. Performance Considerations

### 9.1 성능 목표

| 메트릭 | 목표 | 측정 방법 |
|--------|------|----------|
| 초기 로드 영향 | < 50ms | Lighthouse |
| 메모리 사용 | < 10MB | Chrome DevTools |
| CPU 유휴 시 | < 1% | Performance Monitor |
| 번들 크기 | < 50KB (gzip) | Bundle Analyzer |

### 9.2 최적화 전략

1. **Lazy Loading**: 탭 컴포넌트 지연 로드
2. **가상화**: 긴 목록에 react-window 사용
3. **Debouncing**: 상태 업데이트 100ms 디바운스
4. **조건부 렌더링**: 프로덕션에서 완전 제거
5. **Web Worker**: 무거운 작업 분리

### 9.3 프로덕션 안전장치

```typescript
// Tree-shaking 보장
export const devtools = process.env.NODE_ENV === 'development'
  ? require('./devtools').devtools
  : { log: () => {}, reportError: () => {} }; // no-op
```

---

## 10. Future Roadmap

### 10.1 v1.2 (예정)

- [ ] 성능 프로파일러 (Core Web Vitals)
- [ ] Bundle Analyzer 통합
- [ ] 테마 커스터마이징

### 10.2 v1.3 (예정)

- [ ] 플러그인 시스템
- [ ] 원격 디버깅
- [ ] 팀 협업 기능

### 10.3 v2.0 (장기)

- [ ] VS Code 확장
- [ ] Chrome 확장
- [ ] 모바일 지원

---

## 부록

### A. 용어 사전

| 용어 | 정의 |
|------|------|
| Island | 독립적으로 하이드레이션되는 인터랙티브 컴포넌트 |
| Hydration | 서버 렌더링된 HTML에 이벤트 핸들러를 연결하는 과정 |
| SSE | Server-Sent Events, 서버→클라이언트 단방향 스트리밍 |
| MCP | Model Context Protocol, AI 모델과의 통신 프로토콜 |

### B. 참고 자료

- [Next.js DevTools](https://nextjs.org/docs/architecture/nextjs-compiler)
- [Vue DevTools](https://devtools.vuejs.org/)
- [React DevTools](https://react.dev/learn/react-developer-tools)

---

*이 문서는 Mandu Kitchen 개발 진행에 따라 업데이트됩니다.*
