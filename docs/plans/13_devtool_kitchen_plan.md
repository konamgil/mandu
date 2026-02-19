# 13. Mandu DevTool Kitchen — 종합 기획안

> Agent-Native Framework의 눈과 손: `mandu dev`에 내장되는 웹 기반 개발자 대시보드

## 1. 배경

Mandu는 **Agent-Native Fullstack Framework**를 표방하지만, 현재 에이전트 경험은 MCP 도구 호출 → 터미널 로그가 전부다. AionUI(16.5k stars)와 OpenClaw의 아키텍처를 분석하여, Mandu 프레임워크에 **내장형 웹 대시보드**를 설계한다.

### 참조 프로젝트

| 프로젝트 | 핵심 인사이트 | 소스 위치 |
|----------|-------------|----------|
| **AionUI** | 리치 프리뷰 + 멀티 에이전트 + WebUI + Cron 자동화 | `DNA/AionUi/` |
| **OpenClaw** | 멀티채널 게이트웨이 + Device Auth + 세션 관리 | `DNA/openclaw/` |
| **AI SDK (Vercel)** | OAuth 2.1 + PKCE 기반 AI 서비스 인증 | `DNA/ai/` |

## 2. 핵심 컨셉

Mandu는 이미 SSR 웹프레임워크이므로, DevTool Kitchen을 **Mandu 자체 기능으로 빌드** (dogfooding). Electron 같은 외부 런타임 불필요.

```
mandu dev → localhost:3333         (앱)
          → localhost:3333/__kitchen       (DevTool Kitchen)
          → localhost:3333/__kitchen/ws    (WebSocket 실시간)
```

## 3. AionUI에서 차용할 패턴

| AionUI 패턴 | Mandu 적용 | 소스 참조 |
|-------------|-----------|----------|
| **Preview 시스템** (10+ 포맷, 탭, 스트리밍) | 에이전트 수정 파일 실시간 Diff 프리뷰 | `AionUi/src/renderer/pages/conversation/preview/` |
| **WebSocket Manager** (토큰 인증, 하트비트) | Kitchen 실시간 통신 | `AionUi/src/webserver/websocket/WebSocketManager.ts` |
| **Channel 아키텍처** (Plugin→Gateway→ActionExecutor) | 알림 채널 (Telegram/Discord/Slack) | `AionUi/src/channels/` |
| **Tool Confirmation UI** (에이전트 도구 승인/거부) | Guard violation 인터랙티브 승인 | `AionUi/src/channels/actions/ChatActions.ts` |
| **Streaming 500ms throttle** | Activity Stream 최적화 | `AionUi/src/channels/ARCHITECTURE.md` §5.2 |
| **OAuth Token Manager** (pre-refresh, state tracking) | AI 서비스 인증 | `AionUi/src/agent/gemini/cli/oauthTokenManager.ts` |

## 4. OpenClaw에서 차용할 패턴

| OpenClaw 패턴 | Mandu 적용 | 소스 참조 |
|--------------|-----------|----------|
| **Gateway 서버** (WebSocket + REST) | Kitchen API 서버 | `openclaw/src/gateway/server.ts` |
| **Device Auth** (challenge-response, 키페어) | 원격 접근 보안 | `openclaw/src/gateway/device-auth.ts` |
| **Session 관리** (per-chat 격리) | 멀티 프로젝트 세션 | `openclaw/src/sessions/` |
| **Channel 플러그인** (Telegram, Discord, WhatsApp) | 알림/명령 채널 | `openclaw/src/{telegram,discord,whatsapp}/` |
| **Control UI** (브라우저 대시보드) | Kitchen 대시보드 | `openclaw/src/gateway/control-ui.ts` |

## 5. AI 인증 — OAuth Provider 패턴

DNA/ai에서 발견한 **MCP OAuth 2.1 + PKCE** 구현:

```
ai/packages/mcp/src/tool/oauth-types.ts  → Zod 스키마로 타입 안전한 토큰/메타데이터
ai/packages/mcp/src/tool/oauth.ts        → OAuthClientProvider 인터페이스 (PKCE, 토큰 저장/갱신)
AionUi/.../oauthTokenManager.ts          → 프리뷰/리프레시 윈도우, 만료 전 자동 갱신
```

**Mandu 적용**: API 키 입력 없이 **Google/OpenAI OAuth 로그인**으로 AI 서비스 사용 가능. ChatGPT를 API 대신 OAuth로 사용하는 플로우 지원.

### OAuth 플로우 (Mandu Kitchen)

```
1. Kitchen UI에서 "Google 로그인" / "OpenAI 로그인" 클릭
2. OAuth 2.1 + PKCE 인증 시작 → 브라우저 리다이렉트
3. 콜백 수신 → 토큰 저장 (로컬 `.mandu/auth/`)
4. OAuthTokenManager가 만료 전 자동 갱신 (pre-refresh window: 5분)
5. 토큰으로 Gemini/ChatGPT API 호출 (API 키 불필요)
```

## 6. 아키텍처 설계

```
┌──────────────────────────────────────────────────────┐
│                   mandu dev server                    │
│                   (Bun, port 3333)                    │
├──────────────────────────────────────────────────────┤
│  App Routes              │  Kitchen Routes            │
│  /                       │  /__kitchen                │
│  /about                  │  /__kitchen/api/stream(SSE)│
│  /api/*                  │  /__kitchen/api/guard      │
│                          │  /__kitchen/api/routes     │
│                          │  /__kitchen/api/contracts  │
│                          │  /__kitchen/api/auth/oauth │
│                          │  /__kitchen/ws (WebSocket) │
├──────────────────────────────────────────────────────┤
│                Kitchen Core Services                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │ Activity     │ │ Channel      │ │ AI Provider  │  │
│  │ Stream       │ │ Manager      │ │ (OAuth)      │  │
│  │ (SSE)        │ │ (Telegram,   │ │ Google/OpenAI│  │
│  │              │ │  Discord)    │ │ Claude       │  │
│  └──────────────┘ └──────────────┘ └──────────────┘  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │ Preview      │ │ Guard        │ │ Route        │  │
│  │ Engine       │ │ Dashboard    │ │ Explorer     │  │
│  │ (Diff/Code)  │ │ (Realtime)   │ │ (Visual)     │  │
│  └──────────────┘ └──────────────┘ └──────────────┘  │
└──────────────────────────────────────────────────────┘
```

## 7. Kitchen 기능 상세

### 7.1 Activity Stream (실시간 모니터)

기존 `ActivityMonitor`(`packages/mcp/src/activity-monitor.ts`)가 로그 파일에 쓰는 이벤트를 **SSE 엔드포인트**로도 브로드캐스트.

- MCP 도구 호출 타임라인 (SPEC, GEN, GUARD, SLOT, CONTRACT...)
- Guard violation 즉시 표시 + 해당 코드 인라인 프리뷰
- Watch 경고 실시간 피드
- AionUI의 **500ms throttle** 패턴 적용

```typescript
// SSE 엔드포인트 예시
GET /__kitchen/api/stream
→ Content-Type: text/event-stream
→ data: {"type":"tool.call","tool":"mandu_guard_check","ts":"..."}
→ data: {"type":"guard.violation","ruleId":"no-cross-import","file":"..."}
```

### 7.2 Route Explorer (아키텍처 시각화)

- `manifest.json` 기반 라우트 트리 렌더링
- 각 라우트의 contract, slot, island 연결 관계 시각화
- 클릭하면 코드 프리뷰 + 스키마 뷰어
- FSD 레이어 구조 다이어그램

### 7.3 Guard Dashboard (실시간)

- Guard check 결과 실시간 표시
- 위반 코드 위치 + 규칙 설명
- 위반 트렌드 차트 (시간대별 건수)
- **인터랙티브 승인/거부** (AionUI의 Tool Confirmation 패턴)

### 7.4 Preview Engine (Diff 프리뷰)

AionUI의 Preview 모듈 패턴을 차용:

- 에이전트가 파일 수정 시 → before/after Diff 즉시 표시
- 멀티탭 아키텍처 (여러 파일 동시 프리뷰)
- 스트리밍 업데이트 (500ms debounce)
- 코드 하이라이팅 (Monaco Editor 또는 경량 대안)
- 지원 포맷: Code, Markdown, Diff, JSON, HTML

```typescript
// AionUI 패턴 차용
interface PreviewTab {
  id: string;
  content: string;
  contentType: 'code' | 'markdown' | 'diff' | 'json' | 'html';
  metadata?: { filePath: string; fileName: string };
  isDirty?: boolean;
  originalContent?: string;
}
```

### 7.5 Contract Playground

- Zod 스키마 입력 → OpenAPI 프리뷰, ATE 테스트 케이스 자동 생성
- 실시간 validate — JSON 입력 → contract 검증 결과 즉시 표시
- 에이전트가 contract 수정 시 → 영향받는 라우트/슬롯 자동 표시

### 7.6 Channel Gateway (알림)

AionUI의 채널 아키텍처를 경량화하여 적용:

```
┌─────────────┐
│ BasePlugin  │ ← 추상 기본 클래스 (생명주기 상태머신)
├─────────────┤
│ Telegram    │ ← grammY SDK, Long Polling
│ Discord     │ ← discord.js
│ Slack       │ ← Bolt SDK
└─────────────┘
         │
    PluginManager (등록/시작/중지)
         │
    ActionExecutor (메시지 라우팅)
         │
    ┌────┴────┐
    │ Guard   │ → 위반 알림 push
    │ Build   │ → 빌드 에러 알림
    │ Watch   │ → 파일 변경 알림
    └─────────┘
```

통일 메시지 프로토콜 (AionUI 패턴):

```typescript
interface IUnifiedOutgoingMessage {
  type: 'text' | 'code' | 'alert';
  text: string;
  severity?: 'info' | 'warn' | 'error';
  metadata?: { file?: string; line?: number; ruleId?: string };
}
```

### 7.7 AI Provider Integration (OAuth)

```typescript
// OAuthClientProvider 인터페이스 (AI SDK 패턴)
interface ManduOAuthProvider {
  tokens(): OAuthTokens | undefined;
  saveTokens(tokens: OAuthTokens): void;
  redirectToAuthorization(url: URL): void;
  codeVerifier(): string;
}

// 지원 프로바이더
type AIProvider = 'google' | 'openai' | 'anthropic';

// OAuth 설정 저장 위치
// .mandu/auth/{provider}.json
```

## 8. 기술적 차별점

| | AionUI | OpenClaw | **Mandu Kitchen** |
|---|--------|---------|-------------------|
| **런타임** | Electron (무거움) | Node.js 데몬 | **Bun 내장 (경량)** |
| **설치** | 별도 앱 설치 | npm global | **프레임워크 내장** |
| **UI** | React + Arco Design | 자체 HTML | **Mandu Island SSR** |
| **대상** | 범용 AI 채팅 | 메시징 게이트웨이 | **프레임워크 개발자 전용** |
| **활성화** | 앱 실행 | 데몬 실행 | **`mandu dev` 자동** |
| **프로덕션** | N/A | 항시 실행 | **자동 제거** |

## 9. 구현 Phase

### Phase 1: Kitchen Core (MVP) — 예상 2주

**목표**: `mandu dev` 실행 시 `/__kitchen`에서 기본 대시보드 접근 가능

- [ ] `/__kitchen` 라우트 등록 (dev 서버 전용, 프로덕션 제외)
- [ ] Activity Stream SSE 엔드포인트 (`ActivityMonitor` → SSE broadcast)
- [ ] Route Explorer (manifest.json 파싱 → 라우트 트리 시각화)
- [ ] Guard Dashboard (guard 결과 실시간 표시)
- [ ] Kitchen UI를 Mandu island로 빌드 (dogfooding)

**변경 파일**:
- `packages/core/src/server.ts` — `/__kitchen/*` 라우트 등록
- `packages/mcp/src/activity-monitor.ts` — SSE broadcast 추가
- `packages/core/src/kitchen/` — 신규 디렉토리 (Kitchen 서비스)
- Kitchen UI islands — `app/__kitchen/` (dev 전용)

### Phase 2: Interactive Features — 예상 3주

**목표**: 에이전트 작업의 실시간 프리뷰와 인터랙션

- [ ] Preview Engine (Diff 프리뷰, 멀티탭)
- [ ] Tool Confirmation UI (guard violation 승인/거부)
- [ ] Contract Playground (Zod → OpenAPI 프리뷰)
- [ ] WebSocket 양방향 통신

### Phase 3: Channel Gateway — 예상 3주

**목표**: 외부 메시징 채널로 알림/명령

- [ ] BasePlugin 추상 클래스 + PluginManager
- [ ] TelegramPlugin (grammY)
- [ ] DiscordPlugin (discord.js)
- [ ] 통일 메시지 프로토콜
- [ ] Kitchen UI에서 채널 설정/관리

### Phase 4: AI Provider Integration — 예상 2주

**목표**: OAuth 기반 AI 서비스 로그인

- [ ] OAuth 2.1 + PKCE 인프라
- [ ] Google OAuth → Gemini
- [ ] OpenAI OAuth → ChatGPT
- [ ] OAuthTokenManager (자동 갱신)
- [ ] Kitchen UI에서 AI 에이전트와 직접 대화

## 10. 재사용 기존 코드

| 기존 코드 | 용도 |
|----------|------|
| `packages/mcp/src/activity-monitor.ts` | Activity Stream 데이터 소스 |
| `packages/core/src/server.ts` | Kitchen 라우트 등록 |
| `packages/core/src/guard/` | Guard Dashboard 데이터 |
| `packages/core/src/manifest/` | Route Explorer 데이터 |
| `packages/core/src/contract/` | Contract Playground 데이터 |
| `packages/cli/src/terminal/theme.ts` | Kitchen UI 컬러 토큰 참조 |

## 11. 파일 구조 (예상)

```
packages/core/src/kitchen/
├── index.ts                    # Kitchen 모듈 진입점
├── kitchen-server.ts           # Kitchen HTTP/WS 서버
├── stream/
│   ├── activity-sse.ts         # SSE 브로드캐스트
│   └── file-watcher.ts         # 파일 변경 스트리밍
├── api/
│   ├── routes-api.ts           # 라우트 조회 API
│   ├── guard-api.ts            # Guard 결과 API
│   ├── contract-api.ts         # Contract 조회 API
│   └── auth-api.ts             # OAuth 인증 API
├── channels/
│   ├── base-plugin.ts          # 채널 플러그인 기본 클래스
│   ├── plugin-manager.ts       # 플러그인 관리
│   ├── telegram-plugin.ts      # Telegram
│   └── discord-plugin.ts       # Discord
├── auth/
│   ├── oauth-provider.ts       # OAuth 2.1 + PKCE
│   ├── token-manager.ts        # 토큰 관리
│   └── providers/
│       ├── google.ts           # Google OAuth
│       └── openai.ts           # OpenAI OAuth
└── ui/                         # Kitchen UI (Mandu island)
    ├── kitchen.client.tsx       # 메인 island
    ├── activity-stream.tsx      # Activity Stream 컴포넌트
    ├── route-explorer.tsx       # Route Explorer
    ├── guard-dashboard.tsx      # Guard Dashboard
    ├── preview-panel.tsx        # Preview Engine
    └── contract-playground.tsx  # Contract Playground
```

## 12. 보안 고려사항

- Kitchen은 **dev 모드에서만** 활성화 (`mandu dev`)
- 프로덕션 빌드(`mandu build`)에서 Kitchen 코드 자동 제거
- OAuth 토큰은 `.mandu/auth/`에 로컬 저장 (`.gitignore` 자동 추가)
- WebSocket 연결 시 토큰 인증 (AionUI의 `TokenMiddleware` 패턴)
- 원격 접근 시 Device Auth (OpenClaw의 challenge-response 패턴)

## 13. 향후 확장

- **Cron/Scheduled Tasks**: 주기적 guard check, 트렌드 분석 (AionUI의 croner 패턴)
- **멀티 프로젝트**: 여러 Mandu 프로젝트를 하나의 Kitchen에서 관리
- **플러그인 시스템**: 커뮤니티 Kitchen 플러그인 (커스텀 뷰어, 채널 등)
- **모바일 WebUI**: 반응형 Kitchen UI로 모바일에서 알림/모니터링
