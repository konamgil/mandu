# Mandu Kitchen DevTools - Final Specification

> **버전**: 1.0.3
> **최종 수정**: 2026-02-03
> **상태**: 구현 준비 완료

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|----------|
| 1.0.0 | 2026-02-03 | 최초 통합 스펙 |
| 1.0.1 | 2026-02-03 | Hook 시그니처 수정, Network 마스킹 명시, Core UI 스택 확정, 테스트 셀렉터 표준화, Worker 범위 명시 |
| 1.0.2 | 2026-02-03 | Core UI: Preact → React (프레임워크와 공유) |
| 1.0.3 | 2026-02-03 | Shadow DOM+React 호환성, GuardViolation 타입, 큐 제한, 단축키 조건, 번들 목표 명확화 |

---

## 목차

1. [Executive Summary](#1-executive-summary)
2. [Product Vision](#2-product-vision)
3. [Design System](#3-design-system)
4. [Feature Specification](#4-feature-specification)
5. [Data Safety & AI Context](#5-data-safety--ai-context)
6. [Framework ↔ DevTools Bridge](#6-framework--devtools-bridge)
7. [Persistence Strategy](#7-persistence-strategy)
8. [Plugin Architecture](#8-plugin-architecture)
9. [Technical Architecture](#9-technical-architecture)
10. [API Specification](#10-api-specification)
11. [Fail-safe & Telemetry](#11-fail-safe--telemetry)
12. [Testing Strategy](#12-testing-strategy)
13. [Performance Considerations](#13-performance-considerations)
14. [Implementation Plan](#14-implementation-plan)
15. [Future Roadmap](#15-future-roadmap)

---

## 1. Executive Summary

### 1.1 프로젝트 개요

**Mandu Kitchen**은 Mandu Framework에 내장되는 AI-Native 개발자 도구입니다.

- **컨셉**: "만두를 찌듯 편안하게 디버깅한다"
- **차별점**: AI 인과관계 분석, Islands 전문, Zero Config
- **안전성**: 프로덕션 자동 제거, 데이터 마스킹, Quota 대응

### 1.2 핵심 가치

| 가치 | 설명 |
|------|------|
| **Zero Config** | 설치 없이 자동 활성화, 프로덕션 자동 제거 |
| **AI-Native** | 인과관계 체인 분석, MCP 연동 수정 제안 |
| **Islands 전문** | 하이드레이션 타임라인, 번들 분석 |
| **Data Safety** | 다단계 마스킹, PII 자동 필터링 |
| **Fail-safe** | Quota 대응, 앱 크래시 방지, 자가 복구 |

### 1.3 컨셉: "만두 주방" 메타포

| 개발 용어 | 만두 메타포 |
|----------|------------|
| 코드 | 레시피 |
| 컴포넌트 | 재료 |
| 빌드 | 요리 과정 |
| 에러 | 타버린 만두 🔥 |
| HMR | 레시피 업데이트 |
| 배포 | 서빙 |

### 1.4 기술 스택 결정 (v1.0.2 확정)

| 영역 | 기술 | 이유 |
|------|------|------|
| **Core UI** | **React** | 프레임워크와 공유, 중복 로드 방지, 호환성 완벽 |
| **스타일** | CSS-in-JS (인라인) | Shadow DOM 내 격리, 외부 의존성 없음 |
| **플러그인** | Imperative mount | 어떤 UI 라이브러리든 허용 |
| **Worker** | 제한적 사용 | v1.0은 redaction만, sourcemap은 v1.1 |

---

## 2. Product Vision

### 2.1 비전 스테이트먼트

> "개발자가 만두를 찌듯 편안하게 디버깅할 수 있는 세상"

### 2.2 타겟 사용자 페르소나

#### 페르소나 1: 초보 개발자 "민수"

| 항목 | 내용 |
|------|------|
| 경력 | 1년 미만 |
| 고민 | 에러 메시지가 무섭고 어려움 |
| 니즈 | 친근한 에러 설명, AI 도움 |
| Mandu Kitchen 가치 | 만두 캐릭터로 친근감, "AI에게 물어보기" 버튼 |

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
| 고민 | 아키텍처 일관성 유지, 보안 |
| 니즈 | Architecture Guard, 데이터 안전성 |
| Mandu Kitchen 가치 | Guard Viewer, Smart Redaction |

### 2.3 경쟁 분석

| 도구 | 강점 | 약점 | Mandu Kitchen 차별점 |
|------|------|------|---------------------|
| Next.js DevTools | RSC 특화 | AI 미지원 | AI 인과관계 분석 |
| Vue DevTools | 컴포넌트 트리 | 확장 설치 필요 | Zero Config |
| React DevTools | 프로파일링 | Islands 미지원 | 하이드레이션 전문 |

---

## 3. Design System

### 3.1 디자인 토큰

```typescript
const ManduDesignTokens = {
  colors: {
    brand: {
      primary: '#F5E6D3',      // 만두피 베이지
      secondary: '#8B4513',    // 구운 갈색
      accent: '#E8967A',       // 새우 만두 분홍
    },
    semantic: {
      success: '#90EE90',
      warning: '#FFD700',
      error: '#FF6B6B',
      info: '#87CEEB',
    },
    background: {
      dark: '#1A1A2E',
      medium: '#2D2D44',
      light: '#3D3D5C',
      overlay: 'rgba(0,0,0,0.85)',
    },
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
    fontSize: { xs: '10px', sm: '12px', md: '14px', lg: '16px', xl: '20px' },
  },
  spacing: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px' },
  borderRadius: { sm: '4px', md: '8px', lg: '12px', full: '9999px' },
};
```

### 3.2 만두 캐릭터

| 상태 | 이모티콘 | 메시지 | 사용 시점 |
|------|----------|--------|----------|
| 정상 | `(◕‿◕)` | "모든 만두가 잘 익고 있어요~" | 에러 없음 |
| 경고 | `(◕_◕)` | "뭔가 이상해요..." | warning 발생 |
| 에러 | `(ノಠ益ಠ)ノ彡┻━┻` | "만두가 타버렸어요!" | error 발생 |
| 로딩 | `(◕‿◕)💨` | "만두 찌는 중..." | 하이드레이션 중 |
| HMR | `(◕‿◕)✨` | "레시피 업데이트됨!" | HMR 성공 |

### 3.3 테스트 셀렉터 표준 (v1.0.1)

> **중요**: Shadow DOM 내외부에서 일관된 테스트를 위해 `data-testid` 규칙을 표준화한다.

| 요소 | data-testid | 위치 |
|------|-------------|------|
| Host 컨테이너 | `mk-host` | document.body |
| Shadow 루트 | `mk-root` | Shadow DOM 내부 |
| 오버레이 | `mk-overlay` | Shadow DOM 내부 |
| 패널 | `mk-panel` | Shadow DOM 내부 |
| 배지 | `mk-badge` | Shadow DOM 내부 |
| 탭 버튼 (에러) | `mk-tab-errors` | Shadow DOM 내부 |
| 탭 버튼 (Islands) | `mk-tab-islands` | Shadow DOM 내부 |
| 탭 버튼 (Network) | `mk-tab-network` | Shadow DOM 내부 |
| 탭 버튼 (Guard) | `mk-tab-guard` | Shadow DOM 내부 |
| 에러 목록 | `mk-error-list` | Shadow DOM 내부 |
| 만두 캐릭터 | `mk-mandu` | Shadow DOM 내부 |

### 3.4 단축키

| 단축키 | 동작 | 조건 |
|--------|------|------|
| `Ctrl+Shift+M` | 패널 토글 | 전역 |
| `Ctrl+Shift+E` | 에러 탭 열기 | 전역 |
| `ESC` | 오버레이 닫기 | 오버레이 열림 시 |
| `I` | 현재 에러 무시 | 오버레이 포커스 시 |
| `C` | 에러 정보 복사 | 오버레이 포커스 시 |

> **주의**: 단일 키(`I`, `C`)는 오버레이/패널에 포커스가 있을 때만 동작하여 일반 타이핑과 충돌하지 않음.

---

## 4. Feature Specification

### 4.1 기능 개요

| 탭 | 기능명 | 설명 | 우선순위 |
|----|--------|------|----------|
| 🔥 | Error Steamer | 에러 오버레이 + AI 인과관계 분석 | P0 |
| 🏝️ | Islands Inspector | 하이드레이션 타임라인 | P1 |
| 📡 | Network Kitchen | API/SSE 스트리밍 모니터링 | P1 |
| 🛡️ | Guard Viewer | Architecture 위반 실시간 | P2 |

### 4.2 Error Steamer

```typescript
interface NormalizedError {
  id: string;
  type: 'runtime' | 'unhandled' | 'react' | 'network' | 'hmr' | 'guard';
  severity: 'critical' | 'error' | 'warning' | 'info';
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  componentStack?: string;
  islandId?: string;
  timestamp: number;
  url: string;
}
```

### 4.3 Islands Inspector

```typescript
interface IslandSnapshot {
  id: string;
  name: string;
  strategy: 'load' | 'idle' | 'visible' | 'media' | 'never';
  status: 'ssr' | 'pending' | 'hydrating' | 'hydrated' | 'error';
  ssrRenderTime?: number;
  hydrateStartTime?: number;
  hydrateEndTime?: number;
  bundleSize?: number;
}
```

### 4.4 Guard Viewer

```typescript
interface GuardViolation {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: 'error' | 'warning';
  message: string;
  source: {
    file: string;
    line?: number;
    column?: number;
  };
  target?: {
    file: string;
    line?: number;
  };
  suggestion?: string;
  timestamp: number;
}
```

### 4.5 Network Kitchen (v1.0.1 보강)

#### 4.5.1 Network 데이터 마스킹 정책

> **핵심 원칙**: Network payload는 PII/시크릿이 가장 많이 섞이는 구간이다. 기본 미수집 + opt-in 정책을 적용한다.

**Headers 정책 (Allowlist 기반)**

| 분류 | 헤더 | 표시 |
|------|------|------|
| ✅ 허용 | `content-type`, `content-length`, `accept`, `cache-control` | 그대로 표시 |
| ❌ 차단 | `authorization`, `cookie`, `set-cookie`, `x-csrf-token` | `[REDACTED]` |
| ⚠️ 민감 | 그 외 커스텀 헤더 | 키만 표시, 값은 `[...]` |

**Body/Chunk 정책**

```typescript
interface NetworkBodyPolicy {
  // 기본: 미수집
  collectBody: false;

  // opt-in 시에도 제한 적용
  optInPolicy?: {
    maxBytes: 10_000;           // 10KB 제한
    applyPIIFilter: true;       // PII 필터 필수
    applySecretFilter: true;    // 시크릿 필터 필수
    allowedContentTypes: [      // 허용 타입만
      'application/json',
      'text/plain',
      'text/event-stream',
    ];
  };
}
```

**스펙 명시문**

> Network payload(body/chunk)는 **기본 미수집**이며, opt-in 시에도 PII/Secret 필터 + maxBytes 제한을 적용한다. Authorization/Cookie 헤더는 항상 `[REDACTED]` 처리한다.

#### 4.5.2 NetworkRequest 구조

```typescript
interface NetworkRequest {
  id: string;
  method: string;
  url: string;

  // Headers는 allowlist만 포함
  safeHeaders: Record<string, string>;

  // 민감 헤더 존재 여부만 표시 (값 없음)
  redactedHeaders: string[];

  // Body는 opt-in + 필터링
  body?: {
    available: boolean;
    size: number;
    // 실제 내용은 collectBody: true일 때만
    content?: unknown;
  };

  status?: number;
  startTime: number;
  endTime?: number;

  // 스트리밍
  isStreaming: boolean;
  chunkCount?: number;
  // chunk 내용은 opt-in일 때만
}
```

---

## 5. Data Safety & AI Context

### 5.1 설계 원칙

1. **기본 안전**: 민감 정보는 절대 전송하지 않음
2. **옵트인**: 추가 정보는 사용자 동의 후 수집
3. **로컬 우선**: 가능한 로컬에서 처리
4. **투명성**: 무엇이 전송되는지 항상 표시

### 5.2 AI Context Payload

```typescript
interface AIContextPayload {
  // 항상 포함 (safe)
  error: NormalizedError;
  island?: IslandSnapshot;
  framework: { name: 'mandu'; version: string };
  devtools: { version: string };

  // 인과관계 분석용 (기본 포함)
  recentErrors?: Array<{
    id: string;
    message: string;
    timestamp: number;
    isCausedBy?: string;
  }>;

  // 사용자 액션 힌트 (옵트인)
  userActions?: Array<{
    type: 'navigation' | 'interaction' | 'reload';
    targetHint?: string; // 셀렉터만, 텍스트/값 금지
    timestamp: number;
  }>;

  // 코드 컨텍스트 (옵트인, 조건부)
  codeContext?: CodeContextInfo;
}
```

### 5.3 Code Context 수집 경로 (v1.0.1 명시)

> **중요**: `codeContext`는 브라우저 단독으로 수집 불가능한 케이스가 많다. 수집 경로를 명확히 한다.

```typescript
interface CodeContextInfo {
  // 항상 가능: 스택에서 추출
  filePath: string;
  line: number;
  column?: number;

  // 조건부: sourcemap URL (있으면)
  sourcemapUrl?: string;

  // 조건부: 실제 snippet (Dev Server Bridge 필요)
  snippet?: {
    content: string;
    lineRange: [number, number];
    // 어떻게 수집했는지 명시
    source: 'dev-server' | 'sourcemap-inline' | 'unavailable';
  };
}
```

**수집 경로별 가용성**

| 버전 | 수집 범위 | 방법 |
|------|----------|------|
| v1.0 | stack + sourcemapUrl | 브라우저 단독 |
| v1.1+ | + snippet | Dev Server Bridge (`/api/__mandu_source__`) |

**스펙 명시문**

> `codeContext`는 기본적으로 "stack frame + sourcemapUrl"까지만 수집한다. 실제 snippet은 Dev Server Bridge가 제공할 수 있을 때만 포함되며, `snippet.source` 필드로 출처를 명시한다.

### 5.4 Context Filters (마스킹 파이프라인)

```typescript
const ContextFilters = {
  // Phase 1: 구조적 제거 (항상 적용, 비활성화 불가)
  removeComments(code: string): string;

  // Phase 1b: 문자열 처리
  // 'smart': PII/시크릿 패턴만 마스킹 (권장)
  // 'strip': 모든 문자열 제거
  handleStrings(code: string, mode: 'smart' | 'strip'): string;

  // Phase 2: 기본 보안 마스킹 (항상 적용, 비활성화 불가)
  redactBuiltInSecrets(text: string): string;

  // Phase 3: 사용자 정의 패턴 (옵트인)
  redactCustomPatterns(text: string, patterns: RedactPattern[]): string;

  // Phase 4: 용량 제한 (항상 마지막)
  truncate(text: string, maxBytes: number): string;
};
```

### 5.5 커스텀 패턴 설정 (v1.0.1 수정)

> **변경**: RegExp 객체 대신 직렬화 가능한 형태로 변경. JSON config, CLI, 플러그인 호환성 확보.

```typescript
// ❌ 이전 (직렬화 불가)
customRedactPatterns?: RegExp[];

// ✅ 변경 (직렬화 가능)
interface RedactPattern {
  source: string;      // RegExp source
  flags?: string;      // 기본: 'gi'
  replacement?: string; // 기본: '[REDACTED]'
  label?: string;       // 로깅용 레이블
}

customRedactPatterns?: RedactPattern[];
```

**런타임 빌드**

```typescript
function buildPatterns(patterns: RedactPattern[]): RegExp[] {
  return patterns.map(p => new RegExp(p.source, p.flags ?? 'gi'));
}
```

**설정 예시**

```typescript
// mandu.config.ts
export default {
  devtools: {
    dataSafety: {
      customRedactPatterns: [
        { source: 'internal-[a-z]+-\\d+', label: 'internal-id' },
        { source: 'sk_live_[A-Za-z0-9]+', label: 'stripe-key' },
      ],
    },
  },
};
```

---

## 6. Framework ↔ DevTools Bridge

### 6.1 설계 원칙

- DOM 스캐닝을 기본 경로로 삼지 않음
- 프레임워크와 DevTools 간 표준 프로토콜 정의
- Production에서 완전히 제거 가능해야 함

### 6.2 Global Hook Protocol (v1.0.1 수정)

> **변경**: `onReady` 시그니처가 불명확했던 문제 해결. `connect(sink)` 패턴으로 단순화.

```typescript
type ManduDevtoolsHook = {
  /** 이벤트 발송 (프레임워크 → DevTools) */
  emit: (event: KitchenEvent<string, any>) => void;

  /** DevTools가 sink 등록 (DevTools → 프레임워크) */
  connect: (sink: (event: KitchenEvent<string, any>) => void) => void;

  /** DevTools 연결 전 이벤트 큐 */
  queue: KitchenEvent<string, any>[];
};

declare global {
  interface Window {
    __MANDU_DEVTOOLS_HOOK__?: ManduDevtoolsHook;
  }
}
```

### 6.3 Hook 구현 (v1.0.3 수정)

```typescript
// 큐 크기 제한 - 메모리 누수 방지
const MAX_QUEUE_SIZE = 100;

export const createDevtoolsHook = (): ManduDevtoolsHook => {
  // Production: 완전한 noop
  if (process.env.NODE_ENV === 'production') {
    return {
      emit: () => {},
      connect: () => {},
      queue: [],
    };
  }

  // Development: 실제 구현
  const queue: KitchenEvent<string, any>[] = [];
  let sink: ((event: KitchenEvent<string, any>) => void) | null = null;

  return {
    emit(event) {
      if (sink) {
        // DevTools 연결됨 - 직접 전송
        sink(event);
      } else {
        // 큐에 쌓기 (크기 제한)
        if (queue.length >= MAX_QUEUE_SIZE) {
          // 오래된 이벤트 제거 (에러는 우선 보존)
          const nonErrorIndex = queue.findIndex(e => e.type !== 'error');
          if (nonErrorIndex !== -1) {
            queue.splice(nonErrorIndex, 1);
          } else {
            queue.shift(); // 모두 에러면 가장 오래된 것 제거
          }
        }
        queue.push(event);
      }
    },

    connect(nextSink) {
      sink = nextSink;
      // 큐 플러시
      for (const event of queue) {
        sink(event);
      }
      queue.length = 0;
    },

    queue,
  };
};
```

> **v1.0.3 추가**: 큐 크기를 `MAX_QUEUE_SIZE`(100)로 제한하여 DevTools 미연결 시 메모리 누수 방지. 에러 이벤트는 우선 보존.

### 6.4 동작 흐름

```
┌─────────────────────────────────────────────────────────────┐
│  1. 프레임워크 코어 로드                                      │
│     └─ window.__MANDU_DEVTOOLS_HOOK__ = createDevtoolsHook() │
│     └─ hook.emit(event) → queue에 쌓임                       │
│                                                             │
│  2. DevTools 로드                                           │
│     └─ hook.connect((event) => handleEvent(event))          │
│     └─ 큐에 있던 이벤트들 flush                              │
│     └─ 이후 emit() 호출 시 즉시 sink로 전달                   │
│                                                             │
│  3. Production 빌드                                         │
│     └─ createDevtoolsHook()이 noop 반환                     │
│     └─ 트리쉐이킹으로 DevTools 코드 완전 제거                 │
└─────────────────────────────────────────────────────────────┘
```

### 6.5 이벤트 타입

```typescript
interface KitchenEvent<T extends string, D> {
  type: T;
  timestamp: number;
  data: D;
}

type KitchenEvents =
  | KitchenEvent<'error', NormalizedError>
  | KitchenEvent<'error:clear', { id?: string }>
  | KitchenEvent<'island:register', IslandSnapshot>
  | KitchenEvent<'island:hydrate:start', { id: string }>
  | KitchenEvent<'island:hydrate:end', { id: string; time: number }>
  | KitchenEvent<'network:request', NetworkRequest>
  | KitchenEvent<'network:response', { id: string; status: number }>
  | KitchenEvent<'guard:violation', GuardViolation>
  | KitchenEvent<'hmr:update', { routeId: string }>
  | KitchenEvent<'hmr:error', { message: string }>;
```

### 6.6 Source Context Provider (v1.0.1 추가)

> v1.1+에서 코드 snippet을 제공하기 위한 Dev Server 엔드포인트 정의.

```typescript
// Dev Server에서 제공하는 API
// GET /api/__mandu_source__?file=src/components/User.tsx&line=42&context=5

interface SourceContextResponse {
  success: boolean;
  data?: {
    filePath: string;
    content: string;
    lineRange: [number, number];
    highlightLine: number;
  };
  error?: string;
}
```

---

## 7. Persistence Strategy

### 7.1 문제 정의

1. `sessionStorage`는 5~10MB 제한
2. `beforeunload`에서 직렬화하면 jank 발생
3. 페이지 새로고침 시 이벤트 유실

### 7.2 PreserveLog 설정

```typescript
interface PreserveLogConfig {
  enabled: boolean;
  maxPersistEvents: number;   // default: 50
  maxPersistBytes: number;    // default: 2_000_000 (≈2MB)
  priority: 'errors-first' | 'recent-first';
  incremental?: {
    enabled: boolean;         // default: true
    idleSyncMs: number;       // default: 300
  };
}
```

### 7.3 QuotaExceededError 처리

```typescript
async function persistEvents(events: KitchenEvent[]): Promise<void> {
  const sorted = sortByPriority(events, config.priority);

  for (let i = sorted.length; i > 0; i--) {
    try {
      const subset = sorted.slice(0, i);
      const json = JSON.stringify(subset);
      if (json.length > config.maxPersistBytes) continue;
      sessionStorage.setItem(STORAGE_KEY, json);
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        continue;
      }
      throw e;
    }
  }

  // 모두 실패 - 메타로그만 남기고 포기
  logMeta({ type: 'persist_fail', eventCount: events.length });
}
```

---

## 8. Plugin Architecture

### 8.1 설계 원칙

- **Core UI**: React로 구현 (프레임워크와 공유, 중복 로드 방지)
- **플러그인**: Imperative mount (어떤 UI 라이브러리든 허용)
- **격리**: Shadow DOM으로 CSS 격리

### 8.2 Plugin Interface

```typescript
interface KitchenPanelPlugin {
  id: string;
  name: string;
  icon: string;
  order: number;

  init(api: KitchenAPI): void;
  destroy?(): void;

  /** Imperative mount - 플러그인이 container에 직접 렌더링 */
  render(container: HTMLElement): void;

  onEvent?(event: KitchenEvent<string, any>): void;
}
```

### 8.3 KitchenAPI

```typescript
interface KitchenAPI {
  subscribe(type: string, callback: (event: KitchenEvent) => void): () => void;
  getErrors(): NormalizedError[];
  getIslands(): IslandSnapshot[];
  getNetworkRequests(): NetworkRequest[];
  clearErrors(): void;
  getConfig(): DevToolsConfig;
  copyToClipboard(text: string): Promise<void>;
  openInEditor(file: string, line?: number): void;
}
```

### 8.4 Plugin 등록

```typescript
// mandu.config.ts
export default {
  devtools: {
    plugins: [
      {
        id: 'my-panel',
        name: '내 패널',
        icon: '🔧',
        order: 100,
        init(api) {
          console.log('Plugin initialized');
        },
        render(container) {
          // 플러그인은 React, Vue, Vanilla JS 등 자유롭게 사용 가능
          // (Core UI는 React, 플러그인은 imperative mount로 격리)
          container.innerHTML = '<div>Hello Plugin!</div>';
        },
      },
    ],
  },
};
```

---

## 9. Technical Architecture

### 9.1 Core UI 기술 스택 (v1.0.3 확정)

> **결정**: Core UI는 **React**로 구현한다. Mandu Framework가 이미 React를 사용하므로 공유하여 중복 로드를 방지한다.

| 선택지 | 장점 | 단점 | 결정 |
|--------|------|------|------|
| React | 프레임워크와 공유, 중복 로드 방지, 호환성 완벽 | Shadow DOM 이벤트 처리 필요 | ✅ 채택 |
| Preact | 3KB | React 이미 로드됨 → 중복 | ❌ |
| Vanilla | 의존성 없음 | 상태 관리 어려움 | ❌ |
| Lit/WC | 표준 | 학습 비용 | ❌ (v2.0 검토) |

#### 9.1.1 Shadow DOM + React 호환성 (v1.0.3 추가)

> **문제**: React의 이벤트 위임 시스템은 `document`에 이벤트를 등록하므로 Shadow DOM 내부 이벤트가 제대로 전파되지 않을 수 있음.

**해결책**

```typescript
// 방법 1: @emotion/react + shadow DOM portal (권장)
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';

function createShadowRoot(container: HTMLElement) {
  const shadow = container.attachShadow({ mode: 'open' });
  const emotionRoot = document.createElement('style');
  shadow.appendChild(emotionRoot);

  const cache = createCache({
    key: 'mandu-kitchen',
    container: emotionRoot,
  });

  return { shadow, cache };
}

// 방법 2: 이벤트 수동 바인딩 (fallback)
function setupShadowEvents(shadowRoot: ShadowRoot) {
  // React 이벤트가 Shadow boundary를 넘지 못하는 경우
  // onClick 대신 직접 addEventListener 사용
  shadowRoot.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const handler = target.dataset.onClick;
    if (handler) {
      // 핸들러 실행
    }
  });
}
```

**권장 구현**

```typescript
// DevTools 마운트
export function mountKitchen(hostElement: HTMLElement) {
  const { shadow, cache } = createShadowRoot(hostElement);

  const root = createRoot(shadow);
  root.render(
    <CacheProvider value={cache}>
      <KitchenApp />
    </CacheProvider>
  );
}
```

### 9.2 시스템 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                           Browser                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Application Code                         │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │  __MANDU_DEVTOOLS_HOOK__                             │  │ │
│  │  │  └─ emit() / connect() / queue                       │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └─────────────────────────┬──────────────────────────────────┘ │
│                            │ connect(sink)                       │
│                            ▼                                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │         Mandu Kitchen Client (Shadow DOM + React)           │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │  ErrorCatcher → NetworkProxy → IslandTracker               │ │
│  │         │              │              │                    │ │
│  │         └──────────────┼──────────────┘                    │ │
│  │                        ▼                                   │ │
│  │                 StateManager                               │ │
│  │                        │                                   │ │
│  │         ┌──────────────┼──────────────┐                    │ │
│  │         ▼              ▼              ▼                    │ │
│  │   OverlayUI       PanelUI        BadgeUI                   │ │
│  │   (React)         (React)        (React)                   │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 9.3 패키지 구조

```
packages/core/src/devtools/
├── index.ts
├── types.ts
├── protocol.ts
│
├── hook/
│   ├── index.ts
│   ├── create-hook.ts
│   └── noop.ts
│
├── client/
│   ├── state-manager.ts
│   ├── persistence.ts
│   ├── catchers/
│   ├── filters/
│   └── components/        # React 컴포넌트
│       ├── root.tsx
│       ├── overlay.tsx
│       ├── panel.tsx
│       └── mandu-character.tsx
│
├── server/
│   ├── injector.ts
│   ├── websocket.ts
│   └── source-provider.ts  # v1.1: 코드 snippet 제공
│
└── plugins/
    ├── types.ts
    └── api.ts
```

---

## 10. API Specification

### 10.1 클라이언트 API

```typescript
declare namespace ManduDevTools {
  function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void;
  function reportError(error: Error | string, context?: object): void;
  function time(label: string): void;
  function timeEnd(label: string): number;
  function toggle(): void;
  function open(): void;
  function close(): void;
  function clearErrors(): void;
}
```

### 10.2 설정 스키마 (v1.0.1 업데이트)

```typescript
interface DevToolsConfig {
  enabled?: boolean;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  defaultOpen?: boolean;
  theme?: 'light' | 'dark' | 'auto';

  features?: {
    errorOverlay?: boolean;
    islandsInspector?: boolean;
    networkMonitor?: boolean;
    guardViewer?: boolean;
  };

  dataSafety?: {
    stringMode?: 'smart' | 'strip';
    collectUserActions?: boolean;
    collectCodeContext?: boolean;
    // v1.0.1: 직렬화 가능한 형태
    customRedactPatterns?: Array<{
      source: string;
      flags?: string;
      label?: string;
    }>;
  };

  network?: {
    // v1.0.1: Network body 수집 정책
    collectBody?: boolean;  // default: false
    bodyMaxBytes?: number;  // default: 10_000
  };

  persistence?: PreserveLogConfig;
  plugins?: KitchenPanelPlugin[];
}
```

---

## 11. Fail-safe & Telemetry

### 11.1 자가 복구 원칙

1. DevTools 에러가 앱을 크래시시키면 안 됨
2. 무한 루프/메모리 누수 방지
3. 실패 시 graceful degradation

### 11.2 Worker 에러 처리 (v1.0.1 추가)

> Worker timeout/error 시 fallback 정책을 명시한다.

```typescript
interface WorkerPolicy {
  // 타임아웃 설정
  timeout: 3000; // 3초

  // 타임아웃 시 처리
  onTimeout: 'fallback-main' | 'skip';

  // 에러 시 처리
  onError: 'disable-worker' | 'retry-once';

  // 연속 실패 임계치
  maxConsecutiveFailures: 3;
}

// 실패 시 동작
function handleWorkerFailure(type: 'timeout' | 'error'): void {
  workerFailCount++;

  if (workerFailCount >= POLICY.maxConsecutiveFailures) {
    // Worker 비활성화, 메인 스레드 최소 처리로 전환
    disableWorker();
    logMeta({ type: 'worker_disabled', reason: type });
  } else if (POLICY.onTimeout === 'fallback-main') {
    // 메인 스레드에서 최소 처리
    processOnMainThread(pendingTask);
  }
  // 'skip'이면 해당 작업 포기
}
```

### 11.3 Internal Meta Log

```typescript
interface KitchenMetaLog {
  timestamp: number;
  type: 'init' | 'hook_fail' | 'render_fail' | 'persist_fail' |
        'worker_timeout' | 'worker_error' | 'worker_disabled' | 'recovered';
  error?: string;
  context: {
    eventCount: number;
    activeTab: string;
    memoryInfo?: { usedJSHeapSize?: number };
  };
}
```

---

## 12. Testing Strategy

### 12.1 테스트 피라미드

```
           /\
          /  \        E2E (10%) - Playwright
         /----\
        /      \      Integration (30%)
       /--------\
      /          \    Unit (60%)
     /------------\
```

### 12.2 E2E 셀렉터 규칙 (v1.0.1)

> Shadow DOM 내부 요소는 `>>>` 피어싱 + `data-testid` 사용

```typescript
// 올바른 셀렉터 사용법
const host = page.locator('[data-testid="mk-host"]');
const overlay = host.locator('>>> [data-testid="mk-overlay"]');
const panel = host.locator('>>> [data-testid="mk-panel"]');
const errorTab = host.locator('>>> [data-testid="mk-tab-errors"]');
const mandu = host.locator('>>> [data-testid="mk-mandu"]');
```

### 12.3 CSS Isolation Test

```typescript
test('CSS isolation prevents leakage', async ({ page }) => {
  await page.goto('/');

  // 앱 글로벌 CSS 오염
  await page.addStyleTag({
    content: '* { color: red !important; }'
  });

  // DevTools 열기
  await page.keyboard.press('Control+Shift+M');

  // DevTools 내부 텍스트는 빨간색이 아니어야 함
  const panelTitle = page.locator('[data-testid="mk-host"]')
    .locator('>>> .panel-title');
  await expect(panelTitle).not.toHaveCSS('color', 'rgb(255, 0, 0)');
});
```

### 12.4 Worker Fallback Test

```typescript
test('Worker timeout triggers fallback', async ({ page }) => {
  await page.goto('/');

  // Worker를 강제로 지연시키는 모킹
  await page.evaluate(() => {
    const originalWorker = window.Worker;
    window.Worker = class extends originalWorker {
      postMessage(msg) {
        // 타임아웃 유발
        setTimeout(() => super.postMessage(msg), 5000);
      }
    };
  });

  // 에러 발생
  await page.evaluate(() => { throw new Error('test'); });

  // 오버레이가 여전히 표시되어야 함 (fallback 동작)
  const overlay = page.locator('[data-testid="mk-host"]')
    .locator('>>> [data-testid="mk-overlay"]');
  await expect(overlay).toBeVisible();
});
```

---

## 13. Performance Considerations

### 13.1 성능 목표

| 메트릭 | 목표 | 비고 |
|--------|------|------|
| 초기 로드 영향 | < 50ms | - |
| 메모리 사용 | < 10MB | - |
| 번들 크기 (DevTools 자체) | < 30KB (gzip) | React 제외, DevTools 코드만 |
| 번들 크기 (React 미포함 환경) | < 70KB (gzip) | React 포함 시 |

> **명확화**: React는 Mandu Framework와 공유하므로 DevTools 자체 번들 크기 목표는 **30KB (gzip)**. React가 없는 환경(edge case)에서는 70KB까지 허용.

### 13.2 Worker 사용 범위 (v1.0.1 명시)

> Worker 사용은 제한적으로, 메시지 오버헤드와 복잡성을 고려한다.

| 버전 | Worker 사용 범위 | 메인 스레드 |
|------|-----------------|-------------|
| v1.0 | Redaction + Truncate만 | 나머지 모두 |
| v1.1 | + Sourcemap 파싱 | - |
| v2.0 | + 복잡한 분석 | 최소 UI 로직만 |

**v1.0 Worker 태스크**

```typescript
// devtools-worker.ts
self.onmessage = (e) => {
  const { type, data, id } = e.data;

  switch (type) {
    case 'redact':
      // PII/Secret 마스킹
      const redacted = applyRedaction(data.text, data.patterns);
      self.postMessage({ id, result: redacted });
      break;

    case 'truncate':
      // 용량 제한
      const truncated = truncateToBytes(data.text, data.maxBytes);
      self.postMessage({ id, result: truncated });
      break;

    default:
      self.postMessage({ id, error: 'Unknown task type' });
  }
};
```

**Fallback 처리**

```typescript
async function processWithWorker(task: WorkerTask): Promise<string> {
  if (!worker || workerDisabled) {
    // Fallback: 메인 스레드에서 최소 처리
    return minimalProcess(task);
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      handleWorkerFailure('timeout');
      resolve(minimalProcess(task)); // fallback
    }, WORKER_TIMEOUT);

    worker.postMessage(task);
    worker.onmessage = (e) => {
      clearTimeout(timeoutId);
      resolve(e.data.result);
    };
  });
}
```

---

## 14. Implementation Plan

### 14.1 Phase 1: Foundation (Week 1)

- 프로젝트 구조, 타입 정의
- Hook 시스템 (`connect(sink)` 패턴)
- 서버 런타임 (injector, WS)

### 14.2 Phase 2: Error System (Week 2)

- ErrorCatcher, Context Filters
- 오버레이 UI (React + Shadow DOM)
- 만두 캐릭터

### 14.3 Phase 3: Panel & Islands (Week 3)

- 패널 프레임워크
- Islands Inspector
- 타임라인 뷰

### 14.4 Phase 4: Network & Persistence (Week 4)

- NetworkProxy (마스킹 정책 적용)
- Persistence
- Guard 통합

### 14.5 Phase 5: Polish (Week 5)

- Worker 통합 (redaction만)
- E2E 테스트 (셀렉터 표준화)
- 문서화, v1.0.0 릴리즈

---

## 15. Future Roadmap

### 15.1 v1.1

- [ ] Source Context Provider (코드 snippet)
- [ ] Sourcemap 파싱 Worker
- [ ] AI 연동 (MCP)

### 15.2 v1.2

- [ ] Performance Profiler
- [ ] VS Code 확장

### 15.3 v2.0

- [ ] Chrome 확장
- [ ] Web Components 전환 검토

---

## 부록: 변경 요약 (v1.0.3)

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| Hook 시그니처 | `onReady(fn)` | `connect(sink)` |
| 커스텀 패턴 | `RegExp[]` | `{ source, flags }[]` |
| codeContext | 수집 경로 미정의 | stack + sourcemapUrl (v1.0), snippet (v1.1+) |
| Network body | 정책 없음 | 기본 미수집, opt-in + 필터 + maxBytes |
| Core UI | Preact | **React** (프레임워크와 공유) |
| Shadow DOM + React | 미언급 | @emotion/cache + 이벤트 처리 명시 |
| 테스트 셀렉터 | 불일치 | `mk-*` 표준화 |
| Worker 범위 | 미정 | v1.0은 redaction만, fallback 정책 명시 |
| 큐 크기 제한 | 없음 | `MAX_QUEUE_SIZE = 100`, 에러 우선 보존 |
| 단축키 조건 | 미명시 | 포커스 조건 명시 |
| 번들 크기 목표 | 50KB | DevTools 자체 30KB (React 공유 시) |
| GuardViolation | 타입 누락 | 타입 정의 추가 |

---

*이 문서는 Mandu Kitchen 구현의 계약(Contract)입니다.*
