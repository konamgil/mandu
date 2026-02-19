# 13-B. Mandu DevTool Kitchen — 개발 기획서

> 구현 레벨 기술 명세. 기획안(`13_devtool_kitchen_plan.md`)의 Phase 1~4를 스프린트 단위로 분해.

---

## 1. 시스템 제약 조건

### 1.1 프로세스 모델

```
┌──────────────────────────────────────────────────┐
│ mandu dev (Bun 프로세스 #1)                       │
│  ├── Bun.serve() → port 3333 (앱 + Kitchen)       │
│  ├── HMR WebSocket → port 3334                    │
│  ├── Guard Watcher (chokidar)                      │
│  ├── CSS Watcher (Tailwind)                        │
│  └── FS Routes Watcher                             │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│ MCP Server (Bun 프로세스 #2)                      │
│  ├── stdio transport (Claude Code/Gemini가 spawn) │
│  ├── ActivityMonitor → .mandu/activity.jsonl       │
│  └── Guard/Watch/Tool 이벤트 기록                  │
└──────────────────────────────────────────────────┘
```

**핵심 제약**: 두 프로세스는 **파일시스템**으로만 통신.
- MCP → `.mandu/activity.jsonl` 기록
- Kitchen → `.mandu/activity.jsonl` 감시 (fs.watch)

### 1.2 기존 요청 처리 흐름 (server.ts)

```
Bun.serve fetch →
  handleRequestInternal() →
    1. CORS preflight 처리
    2. 정적 파일 서빙 (public/, .mandu/client/)
    3. Router.match(pathname)
    4. API route → handleApiRoute()
    5. Page route → handlePageRoute()
    6. Not found → 404
```

**Kitchen 삽입 지점**: **2번과 3번 사이**에 `/__kitchen` 프리픽스 체크 추가.
`isDev === true`일 때만 활성화.

### 1.3 HMR WebSocket 패턴 (기존)

```typescript
// dev.ts에서 이미 사용 중
hmrServer = createHMRServer(port);
hmrServer.broadcast({ type: "css-update", data: { ... } });
hmrServer.broadcast({ type: "island-update", data: { ... } });
hmrServer.broadcast({ type: "reload", data: { ... } });
```

Kitchen WebSocket도 이 패턴을 **확장**하여 동일 HMR 포트에서 처리 가능.

---

## 2. Phase 1: Kitchen Core — 스프린트 분해

### Sprint 1-1: Kitchen 라우트 인프라 (2일)

#### 변경 파일

| 파일 | 변경 | 설명 |
|------|------|------|
| `packages/core/src/runtime/server.ts` | 수정 | `handleRequestInternal()`에 Kitchen 가로채기 |
| `packages/core/src/kitchen/index.ts` | 신규 | Kitchen 모듈 진입점 |
| `packages/core/src/kitchen/kitchen-handler.ts` | 신규 | Kitchen HTTP 핸들러 |
| `packages/core/src/kitchen/kitchen-ui.ts` | 신규 | 내장 HTML/JS 서빙 |

#### 구현 상세

**server.ts 수정** — `handleRequestInternal()` 라인 1092:

```typescript
// 기존 2번(정적 파일)과 3번(라우트 매칭) 사이에 삽입
// 2.5. Kitchen 라우트 (dev mode only)
if (settings.isDev && pathname.startsWith("/__kitchen")) {
  return ok(await handleKitchenRequest(req, pathname, settings));
}
```

**kitchen-handler.ts** — Kitchen 라우트 디스패처:

```typescript
export async function handleKitchenRequest(
  req: Request,
  pathname: string,
  settings: ServerSettings
): Promise<Response> {
  // /__kitchen → Kitchen UI (HTML)
  if (pathname === "/__kitchen" || pathname === "/__kitchen/") {
    return serveKitchenUI();
  }

  // /__kitchen/api/* → Kitchen API
  if (pathname.startsWith("/__kitchen/api/")) {
    return handleKitchenAPI(req, pathname, settings);
  }

  // /__kitchen/assets/* → Kitchen 정적 자원
  if (pathname.startsWith("/__kitchen/assets/")) {
    return serveKitchenAsset(pathname);
  }

  return new Response("Not Found", { status: 404 });
}
```

**kitchen-ui.ts** — 인라인 HTML 서빙:

Phase 1에서는 외부 번들러 의존 없이 **인라인 HTML + vanilla JS**로 시작.
React island 전환은 Phase 2에서 진행.

```typescript
export function serveKitchenUI(): Response {
  const html = generateKitchenHTML();
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function generateKitchenHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mandu Kitchen</title>
  <style>${KITCHEN_CSS}</style>
</head>
<body>
  <div id="kitchen-app"></div>
  <script type="module">${KITCHEN_JS}</script>
</body>
</html>`;
}
```

**이유**: Mandu의 island 빌드 파이프라인은 사용자 앱 코드 전용. Kitchen UI를 여기에 끼우면 빌드 복잡도가 급증. 인라인 HTML로 시작 후 별도 빌드 스텝으로 분리.

---

### Sprint 1-2: Activity Stream SSE (3일)

#### 데이터 플로우

```
MCP Server                    Kitchen (dev server)               Browser
    │                              │                               │
    ├─ tool.call ─────────────────►│                               │
    │  (activity.jsonl 기록)        │                               │
    │                              ├─ fs.watch() 감지 ────────────►│
    │                              │  (파일 변경 → SSE push)        │
    │                              │                               │
    │                              │   GET /__kitchen/api/stream   │
    │                              │◄──────────────────────────────┤
    │                              │   Content-Type: text/event-   │
    │                              │   stream                      │
    │                              │──────────────────────────────►│
    │                              │   data: {"type":"tool.call"}  │
```

#### 변경 파일

| 파일 | 변경 | 설명 |
|------|------|------|
| `packages/core/src/kitchen/stream/activity-sse.ts` | 신규 | SSE 엔드포인트 + 파일 감시 |
| `packages/core/src/kitchen/stream/file-tailer.ts` | 신규 | JSONL 파일 tail 유틸 |

#### 핵심 클래스: `ActivitySSEBroadcaster`

```typescript
interface SSEClient {
  id: string;
  controller: ReadableStreamDefaultController;
  connectedAt: number;
}

export class ActivitySSEBroadcaster {
  private clients: Map<string, SSEClient> = new Map();
  private tailer: FileTailer;
  private throttleTimer: NodeJS.Timeout | null = null;
  private pendingEvents: string[] = [];

  constructor(private rootDir: string) {
    const logPath = path.join(rootDir, ".mandu", "activity.jsonl");
    this.tailer = new FileTailer(logPath, {
      startAtEnd: true,         // 기존 로그 스킵, 새 이벤트만
      pollIntervalMs: 300,      // fs.watchFile 폴링 간격
    });
  }

  start(): void {
    this.tailer.on("line", (line: string) => {
      this.pendingEvents.push(line);
      this.scheduleFlush();
    });
    this.tailer.start();
  }

  // AionUI 패턴: 500ms throttle
  private scheduleFlush(): void {
    if (this.throttleTimer) return;
    this.throttleTimer = setTimeout(() => {
      this.flush();
      this.throttleTimer = null;
    }, 500);
  }

  private flush(): void {
    const events = this.pendingEvents.splice(0);
    for (const event of events) {
      this.broadcast(event);
    }
  }

  private broadcast(data: string): void {
    const message = `data: ${data}\n\n`;
    for (const [id, client] of this.clients) {
      try {
        client.controller.enqueue(new TextEncoder().encode(message));
      } catch {
        this.clients.delete(id);
      }
    }
  }

  createResponse(): Response {
    const clientId = crypto.randomUUID();
    const stream = new ReadableStream({
      start: (controller) => {
        this.clients.set(clientId, {
          id: clientId,
          controller,
          connectedAt: Date.now(),
        });
        // 연결 확인 이벤트
        controller.enqueue(
          new TextEncoder().encode(`data: {"type":"connected","clientId":"${clientId}"}\n\n`)
        );
      },
      cancel: () => {
        this.clients.delete(clientId);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Kitchen-Version": "1",
      },
    });
  }

  stop(): void {
    this.tailer.stop();
    for (const [, client] of this.clients) {
      try { client.controller.close(); } catch { /* ignore */ }
    }
    this.clients.clear();
  }
}
```

#### `FileTailer` — JSONL 파일 tail

```typescript
import { EventEmitter } from "events";
import fs from "fs";

export class FileTailer extends EventEmitter {
  private position = 0;
  private buffer = "";
  private watcher: ReturnType<typeof fs.watchFile> | null = null;

  constructor(
    private filePath: string,
    private options: { startAtEnd: boolean; pollIntervalMs: number }
  ) {
    super();
  }

  async start(): Promise<void> {
    try {
      const stat = fs.statSync(this.filePath);
      this.position = this.options.startAtEnd ? stat.size : 0;
    } catch {
      this.position = 0;
    }

    fs.watchFile(this.filePath, { interval: this.options.pollIntervalMs }, (curr) => {
      if (curr.size > this.position) {
        this.readNewContent(curr.size);
      } else if (curr.size < this.position) {
        // 파일이 truncate/재생성된 경우 (MCP 재시작)
        this.position = 0;
        this.buffer = "";
        this.readNewContent(curr.size);
      }
    });
  }

  private readNewContent(newSize: number): void {
    const fd = fs.openSync(this.filePath, "r");
    const length = newSize - this.position;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, this.position);
    fs.closeSync(fd);
    this.position = newSize;

    this.buffer += buf.toString("utf-8");
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        this.emit("line", line);
      }
    }
  }

  stop(): void {
    fs.unwatchFile(this.filePath);
  }
}
```

**기존 코드 재활용**: `packages/mcp/src/activity-monitor.ts`의 `followFile()` (라인 218-261)과 `packages/cli/src/commands/monitor.ts`의 tail 로직을 참조하되, Kitchen은 Bun 서버 내에서 SSE로 변환.

---

### Sprint 1-3: Route Explorer API (2일)

#### API 설계

```
GET /__kitchen/api/routes
→ Response: KitchenRoutesResponse
```

```typescript
interface KitchenRoutesResponse {
  routes: KitchenRoute[];
  summary: {
    total: number;
    pages: number;
    apis: number;
    withIsland: number;
    withSlot: number;
    withContract: number;
  };
}

interface KitchenRoute {
  id: string;
  pattern: string;
  kind: "page" | "api";
  // 연결 관계
  hasIsland: boolean;       // client hydration
  hasSlot: boolean;         // server-side data loader
  hasContract: boolean;     // Zod schema
  hasLayout: boolean;       // layout.tsx
  // 파일 위치
  serverModule: string;     // page.tsx / route.ts 경로
  clientModule?: string;    // .client.tsx 경로
  layoutModule?: string;    // layout.tsx 경로
  // 메타
  methods?: string[];       // API: GET, POST, etc.
  params?: string[];        // 동적 파라미터: [id], [slug]
}
```

#### 변경 파일

| 파일 | 변경 | 설명 |
|------|------|------|
| `packages/core/src/kitchen/api/routes-api.ts` | 신규 | 라우트 조회 API |

#### 구현

```typescript
import type { RoutesManifest } from "../../spec/schema";

export function handleRoutesAPI(manifest: RoutesManifest): Response {
  const routes: KitchenRoute[] = manifest.routes.map((r) => ({
    id: r.id,
    pattern: r.pattern,
    kind: r.kind,
    hasIsland: r.kind === "page" && !!r.clientModule,
    hasSlot: !!r.slotModule,
    hasContract: !!r.contractModule,
    hasLayout: !!r.layoutModule,
    serverModule: r.serverModule,
    clientModule: r.clientModule,
    layoutModule: r.layoutModule,
    methods: r.kind === "api" ? r.methods : undefined,
    params: extractParams(r.pattern),
  }));

  const summary = {
    total: routes.length,
    pages: routes.filter((r) => r.kind === "page").length,
    apis: routes.filter((r) => r.kind === "api").length,
    withIsland: routes.filter((r) => r.hasIsland).length,
    withSlot: routes.filter((r) => r.hasSlot).length,
    withContract: routes.filter((r) => r.hasContract).length,
  };

  return Response.json({ routes, summary });
}

function extractParams(pattern: string): string[] {
  const matches = pattern.matchAll(/\[([^\]]+)\]/g);
  return [...matches].map((m) => m[1]);
}
```

**manifest 접근 방법**: `startServer()`가 반환하는 `ManduServer` 객체에 manifest가 이미 있음. Kitchen 핸들러에 manifest 참조를 주입.

---

### Sprint 1-4: Guard Dashboard API (2일)

#### API 설계

```
GET /__kitchen/api/guard
→ Response: KitchenGuardResponse

GET /__kitchen/api/guard/check   (POST도 가능)
→ Response: KitchenGuardCheckResponse (on-demand 실행)
```

```typescript
interface KitchenGuardResponse {
  preset: string;
  enabled: boolean;
  realtimeEnabled: boolean;
  lastCheck?: {
    timestamp: string;
    violations: KitchenViolation[];
    summary: { error: number; warn: number; info: number };
  };
}

interface KitchenViolation {
  ruleId: string;
  severity: "error" | "warn" | "info";
  file: string;
  line?: number;
  message: string;
  layer?: string;         // FSD 레이어
  suggestion?: string;    // 수정 제안
}

interface KitchenGuardCheckResponse {
  timestamp: string;
  preset: string;
  violations: KitchenViolation[];
  summary: { error: number; warn: number; info: number; total: number };
  duration: number;       // ms
}
```

#### 변경 파일

| 파일 | 변경 | 설명 |
|------|------|------|
| `packages/core/src/kitchen/api/guard-api.ts` | 신규 | Guard 조회/실행 API |

#### 구현

```typescript
import { checkDirectory, getPreset, type GuardConfig } from "../../guard";

export async function handleGuardCheckAPI(
  guardConfig: GuardConfig,
  rootDir: string
): Promise<Response> {
  const start = Date.now();
  const report = await checkDirectory(guardConfig, rootDir);
  const duration = Date.now() - start;

  const violations: KitchenViolation[] = report.violations.map((v) => ({
    ruleId: v.ruleId,
    severity: v.severity,
    file: v.file,
    line: v.line,
    message: v.message,
    layer: v.meta?.layer,
    suggestion: v.meta?.suggestion,
  }));

  return Response.json({
    timestamp: new Date().toISOString(),
    preset: guardConfig.preset,
    violations,
    summary: report.bySeverity,
    duration,
  });
}
```

**Guard Watcher 연동**: dev.ts에서 이미 `createGuardWatcher()`를 사용 중(라인 416). 이 watcher의 violation 콜백을 Kitchen SSE로도 브로드캐스트.

```typescript
// dev.ts 수정 (Sprint 1-4)
archGuardWatcher = createGuardWatcher({
  config: guardConfig,
  rootDir,
  onViolation: (violation) => {
    // 기존: 콘솔 출력
    // 추가: Kitchen SSE 브로드캐스트
    kitchenBroadcaster?.broadcast(JSON.stringify({
      type: "guard.violation",
      ...violation,
      ts: new Date().toISOString(),
    }));
  },
});
```

---

### Sprint 1-5: Kitchen UI 프론트엔드 (3일)

#### UI 아키텍처

Phase 1은 **인라인 vanilla JS**로 최소 UI 구현:

```
┌─────────────────────────────────────────────┐
│  🥟 Mandu Kitchen                    [port] │
├──────┬──────────────────────────────────────┤
│      │                                      │
│  📡  │  ┌─ Activity Stream ──────────────┐  │
│ Nav  │  │ 14:23:01 → [SPEC] add /blog    │  │
│      │  │ 14:23:03 ✓ [GEN]  2 files      │  │
│  🛣️  │  │ 14:23:05 🚨 [GUARD] cross-imp │  │
│      │  │ 14:23:08 → [CONTRACT] validate │  │
│  🛡️  │  └────────────────────────────────┘  │
│      │                                      │
│      │  ┌─ Route Explorer ───────────────┐  │
│      │  │ / (page) [island] [slot]       │  │
│      │  │ /blog (page) [island]          │  │
│      │  │ /blog/[id] (page) [contract]   │  │
│      │  │ /api/health (api) GET          │  │
│      │  └────────────────────────────────┘  │
│      │                                      │
│      │  ┌─ Guard Dashboard ──────────────┐  │
│      │  │ Preset: mandu                  │  │
│      │  │ ❌ 2 errors  ⚠️ 1 warning      │  │
│      │  │ ─────────────────────────────  │  │
│      │  │ no-cross-import src/feat/a.ts  │  │
│      │  │ layer-dep     src/shared/b.ts  │  │
│      │  └────────────────────────────────┘  │
└──────┴──────────────────────────────────────┘
```

#### UI 기술 선택 근거

| 옵션 | 장점 | 단점 | 선택 |
|------|------|------|------|
| Mandu Island | Dogfooding | 빌드 파이프라인 복잡도 | Phase 2 |
| React (별도 번들) | 풍부한 컴포넌트 | 추가 의존성 | Phase 2 |
| **Vanilla JS (인라인)** | **의존성 0, 즉시 사용** | UI 복잡도 한계 | **Phase 1** |

Phase 1에서 vanilla JS로 검증 후, Phase 2에서 React island로 전환.

#### JS 모듈 구조 (인라인)

```typescript
// kitchen-ui-source.ts → 빌드 시 문자열로 번들
const KITCHEN_JS = `
  // SSE 연결
  class ActivityStream {
    constructor(container) { ... }
    connect() {
      this.source = new EventSource('/__kitchen/api/stream');
      this.source.onmessage = (e) => this.render(JSON.parse(e.data));
    }
    render(event) { ... }
  }

  // Route Explorer
  class RouteExplorer {
    constructor(container) { ... }
    async load() {
      const res = await fetch('/__kitchen/api/routes');
      const data = await res.json();
      this.renderTree(data.routes);
    }
    renderTree(routes) { ... }
  }

  // Guard Dashboard
  class GuardDashboard {
    constructor(container) { ... }
    async check() {
      const res = await fetch('/__kitchen/api/guard/check');
      const data = await res.json();
      this.renderViolations(data.violations);
    }
  }

  // App 초기화
  const app = document.getElementById('kitchen-app');
  const stream = new ActivityStream(app);
  const routes = new RouteExplorer(app);
  const guard = new GuardDashboard(app);
  stream.connect();
  routes.load();
`;
```

---

## 3. Phase 2: Interactive Features — 스프린트 분해

### Sprint 2-1: Kitchen WebSocket (2일)

#### 변경 파일

| 파일 | 변경 | 설명 |
|------|------|------|
| `packages/core/src/kitchen/ws/kitchen-ws.ts` | 신규 | Kitchen WebSocket 서버 |
| `packages/cli/src/commands/dev.ts` | 수정 | Kitchen WS 초기화 |

#### 설계

기존 HMR WebSocket(`createHMRServer`)을 **확장**하여 Kitchen 메시지도 처리:

```typescript
// HMR 서버에 Kitchen 네임스페이스 추가
hmrServer.on("kitchen:subscribe", (ws, channel) => {
  kitchenWS.subscribe(ws, channel);
});

// Kitchen → 브라우저 양방향
interface KitchenWSMessage {
  ns: "kitchen";                    // 네임스페이스
  type: "subscribe" | "guard.approve" | "preview.request" | "contract.validate";
  payload: Record<string, unknown>;
}
```

**AionUI 패턴 적용**: WebSocketManager의 하트비트(30s ping), 토큰 검증, 클라이언트 맵 관리.

---

### Sprint 2-2: Preview Engine (4일)

#### AionUI Preview 패턴 분석 결과

```
AionUI Preview 핵심 구조:
├── PreviewContext (React Context)     → 탭 관리, 콘텐츠 업데이트
├── PreviewPanel                       → 메인 패널
├── viewers/ (Markdown, Code, Diff...) → 포맷별 렌더러
├── editors/ (Monaco)                  → 편집 지원
├── hooks/ (history, keyboard, scroll) → 유틸 훅
└── Streaming Update (500ms debounce)  → IPC 기반 실시간
```

#### Mandu 적용

Kitchen Preview는 **읽기 전용 Diff 뷰어**로 시작 (에이전트 변경 추적용):

```typescript
// API
GET /__kitchen/api/preview/diff?file=src/server/api/users.ts
→ Response: { before: string, after: string, language: string }

// WebSocket 이벤트 (실시간)
{ ns: "kitchen", type: "file.changed", payload: { file, diff } }
```

#### 변경 파일

| 파일 | 변경 | 설명 |
|------|------|------|
| `packages/core/src/kitchen/preview/diff-engine.ts` | 신규 | Git diff 생성 |
| `packages/core/src/kitchen/preview/file-watcher.ts` | 신규 | 소스 파일 변경 감시 |
| `packages/core/src/kitchen/api/preview-api.ts` | 신규 | Preview API |

#### Diff Engine

```typescript
export async function getFileDiff(
  rootDir: string,
  filePath: string
): Promise<{ before: string; after: string; language: string } | null> {
  const absPath = path.join(rootDir, filePath);

  // Git에서 이전 버전 가져오기
  const proc = Bun.spawn(["git", "diff", "HEAD", "--", filePath], {
    cwd: rootDir,
    stdout: "pipe",
  });
  const diff = await new Response(proc.stdout).text();

  if (!diff.trim()) return null;

  // 현재 파일 내용
  const after = await Bun.file(absPath).text();

  // Git에서 HEAD 버전
  const headProc = Bun.spawn(["git", "show", `HEAD:${filePath}`], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const before = await new Response(headProc.stdout).text();

  const ext = path.extname(filePath).slice(1);
  const language = EXT_TO_LANGUAGE[ext] ?? "text";

  return { before, after, language };
}
```

---

### Sprint 2-3: Tool Confirmation (3일)

#### AionUI Tool Confirmation 플로우 적용

```
Agent → guard.violation 이벤트
  → Kitchen SSE → 브라우저에 알림 표시
  → 사용자가 "Approve" / "Reject" 클릭
  → Kitchen WS → 서버
  → 결과를 .mandu/guard-decisions.json에 기록
  → MCP 서버가 다음 guard check에서 참조
```

```typescript
interface GuardDecision {
  ruleId: string;
  file: string;
  action: "approve" | "reject" | "ignore_once" | "ignore_rule";
  decidedAt: string;
  expiresAt?: string;   // ignore_once: 다음 check까지
}
```

---

### Sprint 2-4: Contract Playground (3일)

```
GET  /__kitchen/api/contracts
→ Response: { contracts: ContractInfo[] }

POST /__kitchen/api/contracts/validate
→ Body: { contractId: string, input: object }
→ Response: { valid: boolean, errors?: ZodError[] }

GET  /__kitchen/api/contracts/:id/openapi
→ Response: OpenAPI JSON
```

---

## 4. Phase 3: Channel Gateway — 스프린트 분해

### Sprint 3-1: Channel 인프라 (3일)

#### AionUI Channel 아키텍처 적용

AionUI의 `channels/` 구조를 경량화:

```
packages/core/src/kitchen/channels/
├── base-plugin.ts          # 생명주기 상태머신 (AionUI BasePlugin 축소)
├── plugin-manager.ts       # 플러그인 등록/관리
├── action-executor.ts      # 메시지 라우팅
├── types.ts                # 통일 메시지 프로토콜
└── plugins/
    ├── telegram.ts         # grammY
    ├── discord.ts          # discord.js
    └── slack.ts            # Bolt SDK
```

#### BasePlugin 상태머신 (AionUI 패턴 축소)

```typescript
type PluginStatus = "created" | "ready" | "running" | "stopped" | "error";

export abstract class BasePlugin {
  protected status: PluginStatus = "created";

  abstract onStart(): Promise<void>;
  abstract onStop(): Promise<void>;
  abstract sendMessage(chatId: string, message: UnifiedOutgoingMessage): Promise<string>;

  async start(): Promise<void> {
    this.status = "ready";
    await this.onStart();
    this.status = "running";
  }

  async stop(): Promise<void> {
    await this.onStop();
    this.status = "stopped";
  }
}
```

#### 통일 메시지 프로토콜 (AionUI 패턴)

```typescript
interface UnifiedOutgoingMessage {
  type: "text" | "code" | "alert";
  text: string;
  severity?: "info" | "warn" | "error";
  codeLanguage?: string;
  metadata?: {
    file?: string;
    line?: number;
    ruleId?: string;
    routeId?: string;
  };
}

// Guard violation → 채널 메시지 변환
function violationToMessage(v: KitchenViolation): UnifiedOutgoingMessage {
  return {
    type: "alert",
    text: `[${v.ruleId}] ${v.file}${v.line ? `:${v.line}` : ""}\n${v.message}`,
    severity: v.severity,
    metadata: { file: v.file, line: v.line, ruleId: v.ruleId },
  };
}
```

### Sprint 3-2: Telegram Plugin (2일)

```typescript
// grammY SDK 사용 (AionUI TelegramPlugin 패턴)
import { Bot } from "grammy";

export class TelegramPlugin extends BasePlugin {
  private bot: Bot;

  constructor(private token: string) {
    super();
    this.bot = new Bot(token);
  }

  async onStart(): Promise<void> {
    this.bot.on("message:text", (ctx) => {
      this.handleCommand(ctx.message.text, ctx.chat.id.toString());
    });
    this.bot.start();
  }

  async sendMessage(chatId: string, message: UnifiedOutgoingMessage): Promise<string> {
    const result = await this.bot.api.sendMessage(chatId, message.text, {
      parse_mode: "Markdown",
    });
    return result.message_id.toString();
  }

  private async handleCommand(text: string, chatId: string): Promise<void> {
    if (text === "/guard") {
      // guard check 실행 → 결과 전송
    } else if (text === "/routes") {
      // 라우트 목록 전송
    } else if (text === "/status") {
      // 서버 상태 전송
    }
  }

  async onStop(): Promise<void> {
    await this.bot.stop();
  }
}
```

### Sprint 3-3: Discord + Slack Plugins (3일)

Discord, Slack도 동일 `BasePlugin` 패턴으로 구현.

### Sprint 3-4: Kitchen UI 채널 관리 (2일)

```
GET  /__kitchen/api/channels         → 플러그인 목록
POST /__kitchen/api/channels/enable  → 플러그인 활성화 (토큰 설정)
POST /__kitchen/api/channels/test    → 연결 테스트
```

Kitchen UI에서 채널 토큰 입력 → `.mandu/channels.json`에 저장 → 플러그인 시작.

---

## 5. Phase 4: AI Provider Integration — 스프린트 분해

### Sprint 4-1: OAuth 인프라 (3일)

#### DNA/ai의 OAuth 패턴 적용

```typescript
// oauth-types.ts (DNA/ai 패턴)
import { z } from "zod";

const OAuthTokensSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
});

type OAuthTokens = z.infer<typeof OAuthTokensSchema>;
```

```typescript
// token-manager.ts (AionUI OAuthTokenManager 패턴)
export class ManduTokenManager {
  private tokenInfo: TokenInfo = { state: "unknown" };
  private refreshPromise: Promise<boolean> | null = null;
  private checkTimer: NodeJS.Timeout | null = null;

  constructor(
    private provider: AIProvider,
    private config: {
      preRefreshWindowMs: number;  // 5분 (기본)
      refreshTimeoutMs: number;    // 30초
      maxRefreshRetries: number;   // 3회
    }
  ) {}

  // 만료 전 자동 갱신 (AionUI 패턴)
  startMonitoring(): void {
    this.checkTimer = setInterval(() => {
      if (this.isExpiringSoon()) {
        this.refresh();
      }
    }, 60_000);
  }

  private isExpiringSoon(): boolean {
    if (!this.tokenInfo.expiryTime) return false;
    const remaining = this.tokenInfo.expiryTime - Date.now();
    return remaining < this.config.preRefreshWindowMs;
  }
}
```

#### OAuth 플로우 엔드포인트

```
GET  /__kitchen/api/auth/providers        → 사용 가능한 프로바이더 목록
GET  /__kitchen/api/auth/login/:provider  → OAuth 시작 (리다이렉트)
GET  /__kitchen/api/auth/callback         → OAuth 콜백
GET  /__kitchen/api/auth/status           → 로그인 상태
POST /__kitchen/api/auth/logout           → 로그아웃
```

### Sprint 4-2: Google OAuth → Gemini (2일)

```typescript
// PKCE 기반 Google OAuth
const GOOGLE_AUTH_CONFIG = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  clientId: "...",  // 사용자가 Kitchen UI에서 입력
  scopes: ["https://www.googleapis.com/auth/generative-language"],
  redirectUri: "http://localhost:3333/__kitchen/api/auth/callback",
};
```

### Sprint 4-3: OpenAI OAuth → ChatGPT (2일)

OpenAI의 OAuth provider 지원 활용. API 키 대신 OAuth 로그인으로 ChatGPT 사용.

### Sprint 4-4: Kitchen AI Chat UI (3일)

Kitchen UI에서 AI와 직접 대화. Mandu 프로젝트 컨텍스트(라우트, guard 상태, contract 등)를 AI에 자동 주입.

---

## 6. 의존성 분석

### Phase 1 (추가 의존성 없음)

Kitchen Core는 **Bun 내장 API만** 사용:
- `Bun.serve()` — 이미 사용 중
- `fs.watchFile()` — 파일 tail
- `ReadableStream` — SSE
- `crypto.randomUUID()` — 클라이언트 ID

### Phase 2 (최소 의존성)

| 패키지 | 용도 | 대안 |
|--------|------|------|
| 없음 (Git CLI) | Diff 생성 | `Bun.spawn(["git", "diff", ...])` |

### Phase 3 (채널별)

| 패키지 | 용도 | 선택적 |
|--------|------|--------|
| `grammy` | Telegram Bot | Yes (opt-in) |
| `discord.js` | Discord Bot | Yes (opt-in) |
| `@slack/bolt` | Slack Bot | Yes (opt-in) |

**중요**: 채널 패키지는 `peerDependencies`로 선언. 사용자가 원하는 채널만 설치.

### Phase 4

| 패키지 | 용도 |
|--------|------|
| `pkce-challenge` | OAuth PKCE (DNA/ai에서 사용) |

---

## 7. 테스트 전략

### Phase 1 테스트

```
packages/core/tests/kitchen/
├── kitchen-handler.test.ts     # 라우트 디스패치
├── activity-sse.test.ts        # SSE 브로드캐스트
├── file-tailer.test.ts         # JSONL tail
├── routes-api.test.ts          # Route Explorer API
└── guard-api.test.ts           # Guard Dashboard API
```

#### 테스트 패턴 (기존 Mandu 패턴 준수)

```typescript
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "os";
import path from "path";
import fs from "fs/promises";

describe("ActivitySSEBroadcaster", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "kitchen-test-"));
    await fs.mkdir(path.join(tempDir, ".mandu"), { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("broadcasts new JSONL lines as SSE events", async () => {
    const logPath = path.join(tempDir, ".mandu", "activity.jsonl");
    await fs.writeFile(logPath, "");

    const broadcaster = new ActivitySSEBroadcaster(tempDir);
    broadcaster.start();

    // SSE 클라이언트 연결
    const response = broadcaster.createResponse();
    const reader = response.body!.getReader();

    // JSONL에 새 라인 추가
    await fs.appendFile(logPath, '{"type":"tool.call","tool":"mandu_guard_check"}\n');

    // SSE 이벤트 수신 확인
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("tool.call");

    broadcaster.stop();
  });

  it("handles file truncation (MCP restart)", async () => { ... });
  it("throttles rapid events (500ms)", async () => { ... });
  it("cleans up disconnected clients", async () => { ... });
});
```

#### Kitchen 라우트 통합 테스트

```typescript
describe("Kitchen routes (dev mode)", () => {
  it("serves /__kitchen UI in dev mode", async () => {
    const server = startServer(manifest, { isDev: true, port: 0 });
    const res = await fetch(`http://localhost:${server.server.port}/__kitchen`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    server.stop();
  });

  it("returns 404 for /__kitchen in production mode", async () => {
    const server = startServer(manifest, { isDev: false, port: 0 });
    const res = await fetch(`http://localhost:${server.server.port}/__kitchen`);
    expect(res.status).toBe(404);
    server.stop();
  });

  it("serves routes API", async () => {
    const server = startServer(manifest, { isDev: true, port: 0 });
    const res = await fetch(`http://localhost:${server.server.port}/__kitchen/api/routes`);
    const data = await res.json();
    expect(data.routes).toBeArray();
    expect(data.summary.total).toBe(manifest.routes.length);
    server.stop();
  });
});
```

---

## 8. 리스크 분석

| 리스크 | 확률 | 영향 | 대응 |
|--------|------|------|------|
| fs.watchFile 성능 (Windows) | 중 | 중 | pollIntervalMs 조정, 대안: Bun.file().watch() |
| Kitchen UI가 앱 라우트와 충돌 | 낮 | 높 | `/__kitchen` 프리픽스로 격리 (더블 언더스코어) |
| SSE 연결 누수 (브라우저 탭 방치) | 중 | 낮 | 5분 하트비트 + 자동 정리 |
| 채널 패키지 사이즈 (grammy 등) | 중 | 중 | peerDependencies + opt-in |
| OAuth 보안 (토큰 로컬 저장) | 중 | 높 | .gitignore 자동 추가, 암호화 저장 |
| MCP ↔ Kitchen 타이밍 (파일 기반) | 중 | 낮 | 300ms 폴링으로 충분, 실시간성 요구 낮음 |

---

## 9. 마일스톤 요약

| Phase | 스프린트 | 소요 | 산출물 |
|-------|---------|------|--------|
| **1** | 1-1 ~ 1-5 | **12일** | `/__kitchen` 기본 대시보드 (Activity, Routes, Guard) |
| **2** | 2-1 ~ 2-4 | **12일** | Preview Engine, Tool Confirmation, Contract Playground |
| **3** | 3-1 ~ 3-4 | **10일** | Telegram/Discord/Slack 채널 알림 |
| **4** | 4-1 ~ 4-4 | **10일** | OAuth AI 로그인, Kitchen AI Chat |
| | | **총 44일** | |

---

## 10. 코드 컨벤션

Kitchen 코드는 기존 Mandu 패턴을 따름:
- TypeScript strict mode
- `bun:test` 테스트 프레임워크
- 에러는 `Result<T>` 패턴 (기존 `packages/core/src/error.ts`)
- export는 barrel file (`index.ts`)
- 영어 코드 코멘트 (v0.20.0부터)
