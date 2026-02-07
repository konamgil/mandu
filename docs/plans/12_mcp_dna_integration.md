# MCP × DNA 통합 기획서

> DNA 기능들과 MCP 서버의 통합 계획 (v0.12.0 목표)

---

## 1. 현황 분석

### 1.1 현재 MCP 아키텍처

```
packages/mcp/
├── src/
│   ├── index.ts              # 진입점
│   ├── server.ts             # ManduMcpServer (하드코딩된 도구 등록)
│   ├── activity-monitor.ts   # 독립적인 활동 모니터링
│   └── tools/                # 12개 도구 모듈 (하드코딩)
│       ├── spec.ts           # specToolDefinitions + specTools()
│       ├── generate.ts
│       ├── guard.ts
│       └── ...
```

### 1.2 문제점

| 영역 | 현재 상태 | 문제점 |
|------|----------|--------|
| **도구 등록** | 12개 모듈 하드코딩 import | 동적 확장 불가, 제3자 도구 추가 어려움 |
| **로깅** | ActivityMonitor 독립 구현 | DNA-008 TransportRegistry와 분리, 중복 로직 |
| **에러** | `{ error: msg }` 단순 반환 | 분류 없음, 복구 제안 없음 |
| **설정** | 서버 시작 시 1회 로드 | 핫 리로드 없음 |
| **훅** | 없음 | 도구 실행 전/후 확장점 없음 |

### 1.3 DNA 기능 활용 가능성

| DNA | 기능 | MCP 적용 포인트 |
|-----|------|----------------|
| DNA-001 | 플러그인 시스템 | `McpToolPlugin` 기반 도구 등록 |
| DNA-007 | 에러 추출 | MCP 에러 응답 표준화 |
| DNA-008 | 로깅 전송 | ActivityMonitor → LogTransport 통합 |
| DNA-006 | 설정 핫 리로드 | MCP 서버 설정 감시 |
| DNA-016 | Pre-Action 훅 | 도구 실행 전 사전 조건 확인 |

---

## 2. 통합 아키텍처

### 2.1 목표 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                     ManduMcpServer v2                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │  PluginRegistry │◄───│ McpToolPlugin (DNA-001)         │ │
│  │   (DNA-001)     │    │  - Built-in tools (12개)        │ │
│  └────────┬────────┘    │  - Third-party tools (동적)     │ │
│           │             └─────────────────────────────────┘ │
│           ▼                                                 │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │  ToolExecutor   │───►│ Pre-Action Hooks (DNA-016)      │ │
│  │                 │    │  - 권한 검사                     │ │
│  └────────┬────────┘    │  - 설정 검증                     │ │
│           │             └─────────────────────────────────┘ │
│           ▼                                                 │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │  ErrorHandler   │───►│ Error Extraction (DNA-007)      │ │
│  │                 │    │  - classifyError()               │ │
│  └────────┬────────┘    │  - serializeError()              │ │
│           │             └─────────────────────────────────┘ │
│           ▼                                                 │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │ ActivityMonitor │───►│ TransportRegistry (DNA-008)     │ │
│  │   (Adapter)     │    │  - Console transport            │ │
│  └─────────────────┘    │  - File transport               │ │
│                         │  - External transport            │ │
│  ┌─────────────────┐    └─────────────────────────────────┘ │
│  │  ConfigWatcher  │───► watchConfig() (DNA-006)           │
│  └─────────────────┘                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 새 파일 구조

```
packages/mcp/
├── src/
│   ├── index.ts
│   ├── server.ts                    # ManduMcpServer v2 (리팩토링)
│   ├── activity-monitor.ts          # → LogTransport 어댑터로 변경
│   ├── adapters/
│   │   ├── tool-adapter.ts          # [NEW] Tool → McpToolPlugin 변환
│   │   └── monitor-adapter.ts       # [NEW] MonitorEvent → LogTransportRecord
│   ├── executor/
│   │   ├── tool-executor.ts         # [NEW] 도구 실행 + 훅 + 에러 처리
│   │   └── error-handler.ts         # [NEW] DNA-007 통합 에러 처리
│   ├── hooks/
│   │   └── mcp-hooks.ts             # [NEW] MCP 전용 Pre-Action 훅
│   └── tools/                       # 기존 유지 (점진적 마이그레이션)
│       └── ...
```

---

## 3. 상세 구현 계획

### Phase 1: 플러그인 기반 도구 시스템 (DNA-001)

**목표**: MCP 도구를 `McpToolPlugin` 인터페이스로 표준화

#### 3.1.1 Tool Adapter

```typescript
// packages/mcp/src/adapters/tool-adapter.ts

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpToolPlugin } from "@mandujs/core";

/**
 * MCP SDK Tool을 McpToolPlugin으로 변환
 */
export function toolToPlugin(
  definition: Tool,
  handler: (args: Record<string, unknown>) => Promise<unknown>
): McpToolPlugin {
  return {
    name: definition.name,
    description: definition.description ?? "",
    inputSchema: definition.inputSchema as Record<string, unknown>,
    execute: handler,
  };
}

/**
 * 기존 도구 모듈을 플러그인으로 변환
 */
export function moduleToPlugins(
  definitions: Tool[],
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>
): McpToolPlugin[] {
  return definitions.map((def) => {
    const handler = handlers[def.name];
    if (!handler) {
      throw new Error(`Handler not found for tool: ${def.name}`);
    }
    return toolToPlugin(def, handler);
  });
}
```

#### 3.1.2 MCP Tool Registry

```typescript
// packages/mcp/src/registry/mcp-tool-registry.ts

import type { McpToolPlugin } from "@mandujs/core";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP 도구 레지스트리
 *
 * PluginRegistry의 MCP 특화 래퍼
 */
export class McpToolRegistry {
  private tools = new Map<string, McpToolPlugin>();
  private categories = new Map<string, Set<string>>();

  /**
   * 도구 등록
   */
  register(plugin: McpToolPlugin, category?: string): void {
    this.tools.set(plugin.name, plugin);

    if (category) {
      if (!this.categories.has(category)) {
        this.categories.set(category, new Set());
      }
      this.categories.get(category)!.add(plugin.name);
    }
  }

  /**
   * 도구 제거
   */
  unregister(name: string): boolean {
    const existed = this.tools.delete(name);

    // 카테고리에서도 제거
    for (const names of this.categories.values()) {
      names.delete(name);
    }

    return existed;
  }

  /**
   * 도구 조회
   */
  get(name: string): McpToolPlugin | undefined {
    return this.tools.get(name);
  }

  /**
   * MCP SDK Tool 형식으로 변환
   */
  toToolDefinitions(): Tool[] {
    return Array.from(this.tools.values()).map((plugin) => ({
      name: plugin.name,
      description: plugin.description,
      inputSchema: plugin.inputSchema,
    }));
  }

  /**
   * 핸들러 맵 반환
   */
  toHandlers(): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
    const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};

    for (const [name, plugin] of this.tools) {
      handlers[name] = async (args) => plugin.execute(args);
    }

    return handlers;
  }

  /**
   * 카테고리별 도구 목록
   */
  getByCategory(category: string): McpToolPlugin[] {
    const names = this.categories.get(category);
    if (!names) return [];

    return Array.from(names)
      .map((name) => this.tools.get(name))
      .filter((t): t is McpToolPlugin => t !== undefined);
  }

  /**
   * 등록된 도구 수
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 모든 도구 이름
   */
  get names(): string[] {
    return Array.from(this.tools.keys());
  }
}

export const mcpToolRegistry = new McpToolRegistry();
```

#### 3.1.3 Built-in Tools 마이그레이션

```typescript
// packages/mcp/src/tools/index.ts

import { mcpToolRegistry } from "../registry/mcp-tool-registry.js";
import { moduleToPlugins } from "../adapters/tool-adapter.js";

// 기존 도구 모듈들
import { specTools, specToolDefinitions } from "./spec.js";
import { generateTools, generateToolDefinitions } from "./generate.js";
// ... 나머지 import

/**
 * 기존 도구들을 레지스트리에 등록
 */
export function registerBuiltinTools(projectRoot: string): void {
  const modules = [
    { definitions: specToolDefinitions, handlers: specTools(projectRoot), category: "spec" },
    { definitions: generateToolDefinitions, handlers: generateTools(projectRoot), category: "generate" },
    { definitions: guardToolDefinitions, handlers: guardTools(projectRoot), category: "guard" },
    { definitions: slotToolDefinitions, handlers: slotTools(projectRoot), category: "slot" },
    { definitions: contractToolDefinitions, handlers: contractTools(projectRoot), category: "contract" },
    { definitions: transactionToolDefinitions, handlers: transactionTools(projectRoot), category: "transaction" },
    { definitions: historyToolDefinitions, handlers: historyTools(projectRoot), category: "history" },
    { definitions: hydrationToolDefinitions, handlers: hydrationTools(projectRoot), category: "hydration" },
    { definitions: runtimeToolDefinitions, handlers: runtimeTools(projectRoot), category: "runtime" },
    { definitions: seoToolDefinitions, handlers: seoTools(projectRoot), category: "seo" },
    { definitions: projectToolDefinitions, handlers: projectTools(projectRoot), category: "project" },
  ];

  for (const { definitions, handlers, category } of modules) {
    const plugins = moduleToPlugins(definitions, handlers);
    for (const plugin of plugins) {
      mcpToolRegistry.register(plugin, category);
    }
  }
}
```

---

### Phase 2: 로깅 통합 (DNA-008)

**목표**: ActivityMonitor를 LogTransport로 통합

#### 3.2.1 Monitor → Transport 어댑터

```typescript
// packages/mcp/src/adapters/monitor-adapter.ts

import type { LogTransportRecord, LogLevel } from "@mandujs/core";
import type { MonitorEvent, MonitorSeverity } from "../activity-monitor.js";

/**
 * MonitorEvent → LogTransportRecord 변환
 */
export function monitorEventToRecord(event: MonitorEvent): LogTransportRecord {
  return {
    timestamp: event.ts,
    level: severityToLevel(event.severity),
    meta: {
      type: event.type,
      source: event.source,
      fingerprint: event.fingerprint,
      count: event.count,
      actionRequired: event.actionRequired,
      ...event.data,
    },
  };
}

/**
 * MonitorSeverity → LogLevel 변환
 */
function severityToLevel(severity: MonitorSeverity): LogLevel {
  switch (severity) {
    case "error": return "error";
    case "warn": return "warn";
    case "info":
    default: return "info";
  }
}

/**
 * LogTransportRecord → MonitorEvent 변환 (역방향)
 */
export function recordToMonitorEvent(record: LogTransportRecord): MonitorEvent {
  const meta = record.meta ?? {};

  return {
    ts: record.timestamp,
    type: (meta.type as string) ?? "log",
    severity: levelToSeverity(record.level),
    source: (meta.source as string) ?? "unknown",
    message: record.error?.message,
    data: meta,
    actionRequired: (meta.actionRequired as boolean) ?? false,
    fingerprint: meta.fingerprint as string | undefined,
    count: meta.count as number | undefined,
  };
}

function levelToSeverity(level: LogLevel): MonitorSeverity {
  switch (level) {
    case "error": return "error";
    case "warn": return "warn";
    case "debug":
    case "info":
    default: return "info";
  }
}
```

#### 3.2.2 MCP LogTransport

```typescript
// packages/mcp/src/logging/mcp-transport.ts

import { attachLogTransport, type LogTransport, type LogTransportRecord } from "@mandujs/core";
import { monitorEventToRecord } from "../adapters/monitor-adapter.js";
import type { ActivityMonitor } from "../activity-monitor.js";

/**
 * ActivityMonitor를 LogTransport로 래핑
 */
export function createMcpMonitorTransport(monitor: ActivityMonitor): LogTransport {
  return (record: LogTransportRecord) => {
    // MCP 관련 로그만 필터링
    if (record.meta?.source === "mcp" || record.meta?.source === "tool") {
      // ActivityMonitor의 파일 로깅 활용
      // monitor 내부에서 처리
    }
  };
}

/**
 * MCP 서버 로깅 설정
 *
 * DNA-008 TransportRegistry에 MCP 전송 등록
 */
export function setupMcpLogging(monitor: ActivityMonitor): void {
  const transport = createMcpMonitorTransport(monitor);
  attachLogTransport("mcp-monitor", transport, { minLevel: "info" });
}
```

---

### Phase 3: 에러 처리 강화 (DNA-007)

**목표**: MCP 에러 응답을 DNA-007 체계로 표준화

#### 3.3.1 MCP 에러 핸들러

```typescript
// packages/mcp/src/executor/error-handler.ts

import {
  extractErrorInfo,
  classifyError,
  serializeError,
  isRetryableError,
  type ErrorCategory,
  type ExtractedErrorInfo,
} from "@mandujs/core";

/**
 * MCP 에러 응답 타입
 */
export interface McpErrorResponse {
  error: string;
  code?: string;
  category: ErrorCategory;
  retryable: boolean;
  context?: Record<string, unknown>;
  suggestion?: string;
}

/**
 * 에러를 MCP 응답 형식으로 변환
 */
export function formatMcpError(err: unknown, toolName?: string): McpErrorResponse {
  const info = extractErrorInfo(err);

  return {
    error: info.message,
    code: info.code,
    category: info.category,
    retryable: isRetryableError(err),
    context: {
      ...info.context,
      toolName,
    },
    suggestion: generateSuggestion(info),
  };
}

/**
 * 에러 카테고리별 복구 제안 생성
 */
function generateSuggestion(info: ExtractedErrorInfo): string | undefined {
  switch (info.category) {
    case "network":
      return "네트워크 연결을 확인하고 다시 시도해주세요.";
    case "timeout":
      return "요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.";
    case "auth":
      return "인증 정보를 확인해주세요.";
    case "validation":
      return "입력 값을 확인해주세요.";
    case "config":
      return "설정 파일(mandu.config.ts)을 확인해주세요.";
    case "system":
      if (info.code === "ENOENT") {
        return `파일 또는 디렉토리를 찾을 수 없습니다: ${info.context?.path ?? "unknown"}`;
      }
      return "시스템 리소스를 확인해주세요.";
    default:
      return undefined;
  }
}

/**
 * 도구 실행 결과를 MCP 응답으로 변환
 */
export function createToolResponse(
  toolName: string,
  result: unknown,
  error?: unknown
): { content: Array<{ type: string; text: string }>; isError?: boolean } {
  if (error) {
    const errorResponse = formatMcpError(error, toolName);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorResponse, null, 2),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
```

---

### Phase 4: 설정 핫 리로드 + Pre-Action 훅 (DNA-006, DNA-016)

#### 3.4.1 MCP 설정 감시

```typescript
// packages/mcp/src/config/mcp-config-watcher.ts

import { watchConfig, hasConfigChanged, type ManduConfig } from "@mandujs/core";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { mcpToolRegistry } from "../registry/mcp-tool-registry.js";

/**
 * MCP 서버 설정 감시 시작
 */
export async function startConfigWatcher(
  projectRoot: string,
  server: Server,
  onReload?: (config: ManduConfig) => void
): Promise<{ stop: () => void }> {
  const watcher = await watchConfig(
    projectRoot,
    async (newConfig, event) => {
      // 로깅
      server.sendLoggingMessage({
        level: "info",
        logger: "mandu-config",
        data: {
          type: "config_reload",
          changedSections: event.changedSections,
        },
      }).catch(() => {});

      // MCP 관련 설정 변경 시 도구 재초기화
      if (hasConfigChanged(event.previous, event.current, "mcp")) {
        // 도구 재등록 등 필요한 작업
      }

      onReload?.(newConfig);
    },
    {
      debounceMs: 200,
      onError: (err) => {
        server.sendLoggingMessage({
          level: "error",
          logger: "mandu-config",
          data: { type: "config_error", error: String(err) },
        }).catch(() => {});
      },
    }
  );

  return watcher;
}
```

#### 3.4.2 MCP Pre-Action 훅

```typescript
// packages/mcp/src/hooks/mcp-hooks.ts

import type { ManduConfig } from "@mandujs/core";

/**
 * MCP 도구 실행 컨텍스트
 */
export interface McpToolContext {
  toolName: string;
  args: Record<string, unknown>;
  projectRoot: string;
  config?: ManduConfig;
  startTime: number;
}

/**
 * MCP Pre-Tool 훅 타입
 */
export type McpPreToolHook = (ctx: McpToolContext) => void | Promise<void>;

/**
 * MCP Post-Tool 훅 타입
 */
export type McpPostToolHook = (
  ctx: McpToolContext,
  result: unknown,
  error?: unknown
) => void | Promise<void>;

/**
 * MCP 훅 레지스트리
 */
class McpHookRegistry {
  private preHooks: McpPreToolHook[] = [];
  private postHooks: McpPostToolHook[] = [];

  registerPreHook(hook: McpPreToolHook): () => void {
    this.preHooks.push(hook);
    return () => {
      const idx = this.preHooks.indexOf(hook);
      if (idx >= 0) this.preHooks.splice(idx, 1);
    };
  }

  registerPostHook(hook: McpPostToolHook): () => void {
    this.postHooks.push(hook);
    return () => {
      const idx = this.postHooks.indexOf(hook);
      if (idx >= 0) this.postHooks.splice(idx, 1);
    };
  }

  async runPreHooks(ctx: McpToolContext): Promise<void> {
    for (const hook of this.preHooks) {
      await hook(ctx);
    }
  }

  async runPostHooks(ctx: McpToolContext, result: unknown, error?: unknown): Promise<void> {
    for (const hook of this.postHooks) {
      await hook(ctx, result, error);
    }
  }

  clear(): void {
    this.preHooks = [];
    this.postHooks = [];
  }
}

export const mcpHookRegistry = new McpHookRegistry();

/**
 * 기본 훅 등록 (로깅, 통계 등)
 */
export function registerDefaultMcpHooks(): void {
  // 실행 시간 로깅 훅
  mcpHookRegistry.registerPostHook((ctx, result, error) => {
    const duration = Date.now() - ctx.startTime;
    if (duration > 5000) {
      console.warn(`[MCP] Slow tool execution: ${ctx.toolName} (${duration}ms)`);
    }
  });
}
```

---

### Phase 5: 통합된 ManduMcpServer v2

```typescript
// packages/mcp/src/server.ts (리팩토링)

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { mcpToolRegistry } from "./registry/mcp-tool-registry.js";
import { registerBuiltinTools } from "./tools/index.js";
import { mcpHookRegistry, registerDefaultMcpHooks, type McpToolContext } from "./hooks/mcp-hooks.js";
import { createToolResponse } from "./executor/error-handler.js";
import { startConfigWatcher } from "./config/mcp-config-watcher.js";
import { setupMcpLogging } from "./logging/mcp-transport.js";
import { ActivityMonitor } from "./activity-monitor.js";
import { loadManduConfig, type ManduConfig } from "@mandujs/core";

export class ManduMcpServer {
  private server: Server;
  private projectRoot: string;
  private monitor: ActivityMonitor;
  private config?: ManduConfig;
  private configWatcher?: { stop: () => void };

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.monitor = new ActivityMonitor(projectRoot);
    this.server = new Server(
      { name: "mandu-mcp", version: "0.12.0" },
      { capabilities: { tools: {}, resources: {}, logging: {} } }
    );

    // DNA-001: 플러그인 기반 도구 등록
    registerBuiltinTools(projectRoot);

    // DNA-008: 로깅 통합
    setupMcpLogging(this.monitor);

    // DNA-016: 기본 훅 등록
    registerDefaultMcpHooks();

    this.registerToolHandlers();
  }

  private registerToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: mcpToolRegistry.toToolDefinitions(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const tool = mcpToolRegistry.get(name);
      if (!tool) {
        return createToolResponse(name, null, new Error(`Unknown tool: ${name}`));
      }

      const ctx: McpToolContext = {
        toolName: name,
        args: args || {},
        projectRoot: this.projectRoot,
        config: this.config,
        startTime: Date.now(),
      };

      try {
        // DNA-016: Pre-Tool 훅 실행
        await mcpHookRegistry.runPreHooks(ctx);

        // 도구 실행
        this.monitor.logTool(name, args);
        const result = await tool.execute(args || {});
        this.monitor.logResult(name, result);

        // DNA-016: Post-Tool 훅 실행
        await mcpHookRegistry.runPostHooks(ctx, result);

        return createToolResponse(name, result);
      } catch (error) {
        // DNA-007: 에러 처리 강화
        this.monitor.logTool(name, args, null, error instanceof Error ? error.message : String(error));

        await mcpHookRegistry.runPostHooks(ctx, null, error);

        return createToolResponse(name, null, error);
      }
    });
  }

  async run(): Promise<void> {
    // 설정 로드
    this.config = await loadManduConfig(this.projectRoot);

    // DNA-006: 설정 핫 리로드 시작
    this.configWatcher = await startConfigWatcher(
      this.projectRoot,
      this.server,
      (newConfig) => {
        this.config = newConfig;
      }
    );

    // 서버 시작
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.monitor.start();

    console.error(`Mandu MCP Server v0.12.0 running for: ${this.projectRoot}`);
  }

  async stop(): Promise<void> {
    this.configWatcher?.stop();
    this.monitor.stop();
  }
}
```

---

## 4. 구현 일정

| Phase | 내용 | 예상 작업량 | 우선순위 |
|-------|------|------------|---------|
| **Phase 1** | 플러그인 기반 도구 시스템 | 2-3일 | 🔴 높음 |
| **Phase 2** | 로깅 통합 | 1-2일 | 🔴 높음 |
| **Phase 3** | 에러 처리 강화 | 1일 | 🔴 높음 |
| **Phase 4** | 설정 + 훅 통합 | 1-2일 | 🟡 중간 |
| **Phase 5** | 서버 통합 + 테스트 | 2일 | 🔴 높음 |

**총 예상 기간**: 7-10일 (v0.12.0 릴리스)

---

## 5. 테스트 계획

### 5.1 단위 테스트

```typescript
// packages/mcp/tests/adapters/tool-adapter.test.ts
describe("Tool Adapter", () => {
  it("should convert Tool to McpToolPlugin", ...);
  it("should preserve input schema", ...);
});

// packages/mcp/tests/executor/error-handler.test.ts
describe("Error Handler", () => {
  it("should classify errors correctly", ...);
  it("should generate suggestions", ...);
});
```

### 5.2 통합 테스트

```typescript
// packages/mcp/tests/integration/server.test.ts
describe("ManduMcpServer v2", () => {
  it("should register builtin tools", ...);
  it("should execute pre/post hooks", ...);
  it("should handle config reload", ...);
});
```

---

## 6. 마이그레이션 가이드

### 6.1 기존 도구 마이그레이션

```typescript
// Before (하드코딩)
import { specTools, specToolDefinitions } from "./tools/spec.js";
const handlers = { ...specTools(projectRoot) };

// After (플러그인 기반)
import { mcpToolRegistry } from "./registry/mcp-tool-registry.js";
registerBuiltinTools(projectRoot);
const handlers = mcpToolRegistry.toHandlers();
```

### 6.2 커스텀 도구 추가

```typescript
// 제3자 도구 등록
import { mcpToolRegistry } from "@mandujs/mcp";

mcpToolRegistry.register({
  name: "custom_tool",
  description: "My custom tool",
  inputSchema: { type: "object", properties: {} },
  execute: async (args) => {
    return { success: true };
  },
}, "custom");
```

---

## 7. 관련 문서

- [DNA Features API](../api/dna-features.md)
- [Plugin System (DNA-001)](../api/dna-features.md#plugin-system-dna-001)
- [Error Extraction (DNA-007)](../api/dna-features.md#error-extraction-dna-007)
- [Structured Logging (DNA-008)](../api/dna-features.md#structured-logging-dna-008)
- [OpenClaw DNA Adoption Plan](./11_openclaw_dna_adoption.md)
