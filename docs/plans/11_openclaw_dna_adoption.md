# OpenClaw DNA 채택 계획

> **분석 대상**: OpenClaw (멀티채널 AI 메시징 플랫폼)
> **적용 대상**: Mandu (Agent-Native 웹 프레임워크)
> **작성일**: 2026-02-05
> **버전**: v1.0

---

## 목차

1. [Executive Summary](#1-executive-summary)
2. [OpenClaw 핵심 철학](#2-openclaw-핵심-철학)
3. [채택할 DNA 목록](#3-채택할-dna-목록)
4. [상세 구현 계획](#4-상세-구현-계획)
5. [코드 패턴 레퍼런스](#5-코드-패턴-레퍼런스)
6. [로드맵 통합](#6-로드맵-통합)
7. [참고하지 않을 DNA](#7-참고하지-않을-dna)

---

## 1. Executive Summary

### 1.1 프로젝트 비교

| 항목 | OpenClaw | Mandu |
|------|----------|-------|
| **유형** | 멀티채널 AI 메시징 플랫폼 | Agent-Native 웹 프레임워크 |
| **런타임** | Node.js 22+ | Bun 1.0+ |
| **핵심 기능** | 채널 통합, AI 에이전트 | FS Routes, Guard, SSR |
| **규모** | 500+ 파일, 12+ 채널 | 200+ 파일, 5 프리셋 |
| **철학** | "EXFOLIATE!" (계층 분리) | "만두" (wrapper 일정, filling 유연) |

### 1.2 채택 DNA 요약

| 우선순위 | DNA | Mandu 적용 영역 | 예상 효과 |
|----------|-----|----------------|----------|
| 🔴 P0 | 플러그인 어댑터 패턴 | Guard 프리셋, MCP 도구 | 확장성 ↑ |
| 🔴 P0 | 의존성 주입 | Filling 핸들러 | 테스트성 ↑ |
| 🔴 P0 | Zod `.strict()` | Config, API 검증 | 안전성 ↑ |
| 🟡 P1 | 세션 키 격리 | SSR 상태 관리 | 멀티테넌트 지원 |
| 🟡 P1 | UTF-16 안전 처리 | 문자열 유틸 | 이모지 안전 |
| 🟡 P1 | 설정 핫 리로드 | mandu.config.ts | DX 개선 |
| 🟢 P2 | 에러 코드 추출 | ErrorClassifier | 디버깅 ↑ |
| 🟢 P2 | 구조화된 로깅 | Runtime Logger | 관찰성 ↑ |

---

## 2. OpenClaw 핵심 철학

### 2.1 "EXFOLIATE!" 원칙

OpenClaw의 모토는 **"EXFOLIATE! EXFOLIATE!"** - 복잡한 시스템을 양파 껍질처럼 작은 계층으로 벗겨내는 접근법입니다.

```
┌─────────────────────────────────────────────┐
│              OpenClaw 계층 구조               │
├─────────────────────────────────────────────┤
│                                             │
│   Entry Layer        진입점 정규화           │
│        ↓                                    │
│   CLI Layer          커맨드 파싱             │
│        ↓                                    │
│   Config Layer       설정 검증               │
│        ↓                                    │
│   Agent Layer        AI 에이전트 런타임       │
│        ↓                                    │
│   Channel Layer      플러그인 어댑터          │
│        ↓                                    │
│   Message Layer      메시지 처리 파이프라인    │
│                                             │
└─────────────────────────────────────────────┘
```

**Mandu 적용**: 이미 유사한 구조 (Router → Guard → Filling → Runtime)

### 2.2 핵심 설계 원칙

| 원칙 | OpenClaw 구현 | Mandu 현황 | Gap |
|------|--------------|-----------|-----|
| Single Responsibility | 파일당 ~700 LOC | 일부 파일 1000+ LOC | 🟡 개선 필요 |
| Plugin-First | 모든 채널이 플러그인 | 프리셋만 플러그인 | 🔴 확장 필요 |
| Config > Code | JSON5 설정 | TS 설정 | ✅ 양호 |
| DI > Globals | createDefaultDeps() | 부분 적용 | 🟡 확대 필요 |
| Type-Safety | Zod .strict() | Zod (일반) | 🟡 강화 필요 |

---

## 3. 채택할 DNA 목록

### 3.1 P0: 필수 채택 (v0.11)

#### DNA-001: 플러그인 어댑터 패턴

**출처**: `extensions/*/index.ts`, `src/channels/plugins/`

**OpenClaw 구현**:
```typescript
// extensions/slack/index.ts
const plugin = {
  id: "slack",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: slackPlugin });
  },
};
export default plugin;
```

**Mandu 적용 대상**:
- Guard 프리셋 (fsd, clean, hexagonal, atomic, mandu)
- MCP 도구 확장
- 빌드 플러그인 (analyzer, minifier)
- 로깅 전송 (console, file, external)

**예상 파일**:
```
packages/core/src/
├── plugins/
│   ├── types.ts              # 플러그인 인터페이스
│   ├── registry.ts           # 플러그인 레지스트리
│   └── discovery.ts          # 동적 발견
├── guard/
│   └── presets/
│       ├── plugin.ts         # 프리셋 플러그인 인터페이스
│       └── index.ts          # 레지스트리 연동
└── bundler/
    └── plugins/
        ├── analyzer.ts
        └── minifier.ts
```

---

#### DNA-002: 의존성 주입 패턴

**출처**: `src/cli/deps.ts`

**OpenClaw 구현**:
```typescript
// src/cli/deps.ts
export type CliDeps = {
  sendMessageWhatsApp: typeof sendMessageWhatsApp;
  sendMessageTelegram: typeof sendMessageTelegram;
  // ...
};

export function createDefaultDeps(): CliDeps {
  return {
    sendMessageWhatsApp,
    sendMessageTelegram,
    // ...
  };
}

// 사용처
const deps = createDefaultDeps();
await deps.sendMessageWhatsApp(target, message);

// 테스트
const mockDeps = { sendMessageWhatsApp: vi.fn() };
await runCommand(mockDeps);
```

**Mandu 적용 대상**:
- Filling 핸들러 (DB, 캐시, 외부 API 호출)
- Guard 체커 (파일 시스템, 설정 로더)
- MCP 도구 (프로젝트 경로, 파일 I/O)

**예상 파일**:
```
packages/core/src/
├── filling/
│   ├── deps.ts               # 의존성 타입 + 팩토리
│   ├── context.ts            # 수정: deps 주입
│   └── filling.ts            # 수정: deps 전달
└── guard/
    └── deps.ts               # Guard 의존성
```

---

#### DNA-003: Zod `.strict()` 전면 적용

**출처**: `src/config/zod-schema.*.ts`

**OpenClaw 구현**:
```typescript
// src/config/zod-schema.core.ts
export const ModelDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    // ...
  })
  .strict(); // 예상 외 필드 금지 → 오타 즉시 감지
```

**Mandu 적용 대상**:
- `mandu.config.ts` 검증
- API 요청/응답 스키마
- MCP 도구 입력 검증
- Guard 설정

**변경 파일**:
```
packages/core/src/
├── config/
│   └── validate.ts           # .strict() 추가
├── contract/
│   └── schema.ts             # .strict() 추가
└── guard/
    └── types.ts              # .strict() 추가
```

---

### 3.2 P1: 권장 채택 (v0.12)

#### DNA-004: 세션 키 기반 격리

**출처**: `src/routing/session-key.ts`

**OpenClaw 구현**:
```typescript
// src/routing/session-key.ts
export function buildAgentPeerSessionKey(params: {
  agentId: string;
  channel: string;
  peerId?: string;
  dmScope?: "main" | "per-peer" | "per-channel-peer";
}): string {
  return `agent:${normalizeAgentId(params.agentId)}:${channel}:dm:${peerId}`;
}
```

**Mandu 적용**:
- SSR 상태 격리 (팀별, 사용자별)
- 캐시 키 생성 (route + params + user)
- WebSocket 채널 격리 (향후)

**예상 파일**:
```
packages/core/src/
└── runtime/
    └── session-key.ts        # 세션 키 유틸
```

**구현 예시**:
```typescript
// src/runtime/session-key.ts
export type SessionScope = "global" | "team" | "user" | "request";

export function buildSessionKey(params: {
  route: string;
  teamId?: string;
  userId?: string;
  scope: SessionScope;
}): string {
  const parts = ["session", params.route];

  if (params.scope === "team" && params.teamId) {
    parts.push(`team:${params.teamId}`);
  }
  if (params.scope === "user" && params.userId) {
    parts.push(`user:${params.userId}`);
  }

  return parts.join(":");
}
```

---

#### DNA-005: UTF-16 안전 문자열 처리

**출처**: `src/utils.ts`

**OpenClaw 구현**:
```typescript
// src/utils.ts
function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

export function sliceUtf16Safe(input: string, start: number, end?: number): string {
  const len = input.length;
  let from = Math.max(0, start);
  let to = end === undefined ? len : Math.min(len, end);

  // 서로게이트 쌍 경계 보호
  if (from > 0 && from < len) {
    const codeUnit = input.charCodeAt(from);
    if (isLowSurrogate(codeUnit) && isHighSurrogate(input.charCodeAt(from - 1))) {
      from += 1;
    }
  }

  if (to > 0 && to < len) {
    const codeUnit = input.charCodeAt(to);
    if (isLowSurrogate(codeUnit) && isHighSurrogate(input.charCodeAt(to - 1))) {
      to -= 1;
    }
  }

  return input.slice(from, to);
}
```

**Mandu 적용**:
- 에러 메시지 트렁케이션
- 로그 메시지 제한
- API 응답 요약
- 파일명 정규화

**예상 파일**:
```
packages/core/src/
└── utils/
    └── string.ts             # 문자열 유틸
```

---

#### DNA-006: 설정 핫 리로드

**출처**: `src/config/config.ts` (파일 감시)

**Mandu 적용**:
- `mandu.config.ts` 변경 시 자동 리로드
- Guard 설정 실시간 반영
- 개발 서버 재시작 없이 설정 적용

**예상 파일**:
```
packages/core/src/
└── config/
    ├── watcher.ts            # 설정 파일 감시
    └── hot-reload.ts         # 리로드 로직
```

**구현 접근**:
```typescript
// src/config/watcher.ts
import { watch } from "fs";

export function watchConfig(
  configPath: string,
  onReload: (newConfig: ManduConfig) => void
) {
  const watcher = watch(configPath, async (eventType) => {
    if (eventType === "change") {
      const newConfig = await loadConfig(configPath);
      onReload(newConfig);
    }
  });

  return () => watcher.close();
}
```

---

### 3.3 P2: 선택 채택 (v0.13+)

#### DNA-007: 에러 코드 추출 강화

**출처**: `src/infra/errors.ts`

**OpenClaw 구현**:
```typescript
// src/infra/errors.ts
export function extractErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    if ("code" in err && typeof err.code === "string") {
      return err.code;
    }
    if ("errorCode" in err && typeof err.errorCode === "string") {
      return err.errorCode;
    }
  }
  return undefined;
}

export function formatUncaughtError(err: unknown): string {
  if (extractErrorCode(err) === "INVALID_CONFIG") {
    return formatErrorMessage(err);
  }
  if (err instanceof Error) {
    return err.stack ?? err.message ?? err.name;
  }
  return formatErrorMessage(err);
}
```

**Mandu 적용**:
- `ErrorClassifier` 강화
- 에러 코드 기반 복구 로직
- 사용자 친화적 에러 메시지

---

#### DNA-008: 구조화된 로깅 시스템

**출처**: `src/logging/logger.ts` (tslog 기반)

**OpenClaw 구현**:
```typescript
// src/logging/logger.ts
export type LogTransport = (logObj: LogTransportRecord) => void;

const externalTransports = new Set<LogTransport>();

export function attachLogTransport(transport: LogTransport) {
  externalTransports.add(transport);
}

export function detachLogTransport(transport: LogTransport) {
  externalTransports.delete(transport);
}
```

**Mandu 적용**:
- 플러그인 가능한 로그 전송
- JSON 구조화 로깅
- 로그 레벨별 필터링
- 시간대별 로그 롤링

---

## 4. 상세 구현 계획

### 4.1 DNA-001: 플러그인 어댑터 패턴

#### Phase 1: 타입 정의

```typescript
// packages/core/src/plugins/types.ts

import type { z } from "zod";

/**
 * 플러그인 메타데이터
 */
export interface PluginMeta {
  /** 고유 식별자 (예: "guard-fsd", "build-analyzer") */
  id: string;
  /** 표시 이름 */
  name: string;
  /** 버전 (semver) */
  version: string;
  /** 설명 */
  description?: string;
  /** 작성자 */
  author?: string;
}

/**
 * 플러그인 카테고리
 */
export type PluginCategory =
  | "guard-preset"    // Guard 프리셋
  | "build"           // 빌드 플러그인
  | "mcp-tool"        // MCP 도구 확장
  | "logging"         // 로깅 전송
  | "middleware";     // 런타임 미들웨어

/**
 * 플러그인 인터페이스 (기본)
 */
export interface ManduPlugin<TConfig = unknown> {
  /** 메타데이터 */
  meta: PluginMeta;

  /** 카테고리 */
  category: PluginCategory;

  /** 설정 스키마 (Zod) */
  configSchema: z.ZodType<TConfig>;

  /** 플러그인 등록 */
  register: (api: ManduPluginApi, config: TConfig) => void | Promise<void>;

  /** 플러그인 해제 (선택) */
  unregister?: () => void | Promise<void>;
}

/**
 * 플러그인 API (플러그인이 호출하는 메서드들)
 */
export interface ManduPluginApi {
  /** Guard 프리셋 등록 */
  registerGuardPreset: (preset: GuardPresetPlugin) => void;

  /** 빌드 플러그인 등록 */
  registerBuildPlugin: (plugin: BuildPlugin) => void;

  /** MCP 도구 등록 */
  registerMcpTool: (tool: McpToolPlugin) => void;

  /** 로깅 전송 등록 */
  registerLogTransport: (transport: LogTransport) => void;

  /** 설정 접근 */
  getConfig: () => ManduConfig;

  /** 프로젝트 경로 */
  getProjectRoot: () => string;
}
```

#### Phase 2: 레지스트리 구현

```typescript
// packages/core/src/plugins/registry.ts

import type { ManduPlugin, PluginCategory, ManduPluginApi } from "./types.js";

/**
 * 플러그인 레지스트리
 */
class PluginRegistry {
  private plugins = new Map<string, ManduPlugin>();
  private byCategory = new Map<PluginCategory, Set<string>>();

  /**
   * 플러그인 등록
   */
  async register(plugin: ManduPlugin, config: unknown): Promise<void> {
    if (this.plugins.has(plugin.meta.id)) {
      throw new Error(`Plugin already registered: ${plugin.meta.id}`);
    }

    // 설정 검증
    const validatedConfig = plugin.configSchema.parse(config);

    // 카테고리별 인덱스
    if (!this.byCategory.has(plugin.category)) {
      this.byCategory.set(plugin.category, new Set());
    }
    this.byCategory.get(plugin.category)!.add(plugin.meta.id);

    // 플러그인 등록 호출
    const api = this.createApi();
    await plugin.register(api, validatedConfig);

    this.plugins.set(plugin.meta.id, plugin);
  }

  /**
   * 플러그인 해제
   */
  async unregister(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    if (plugin.unregister) {
      await plugin.unregister();
    }

    this.plugins.delete(pluginId);
    this.byCategory.get(plugin.category)?.delete(pluginId);
  }

  /**
   * 카테고리별 플러그인 조회
   */
  getByCategory(category: PluginCategory): ManduPlugin[] {
    const ids = this.byCategory.get(category) ?? new Set();
    return Array.from(ids).map((id) => this.plugins.get(id)!);
  }

  /**
   * 플러그인 API 생성
   */
  private createApi(): ManduPluginApi {
    return {
      registerGuardPreset: (preset) => {
        // Guard 프리셋 레지스트리에 등록
        guardPresetRegistry.register(preset);
      },
      registerBuildPlugin: (plugin) => {
        buildPluginRegistry.register(plugin);
      },
      registerMcpTool: (tool) => {
        mcpToolRegistry.register(tool);
      },
      registerLogTransport: (transport) => {
        logTransportRegistry.register(transport);
      },
      getConfig: () => currentConfig,
      getProjectRoot: () => projectRoot,
    };
  }
}

export const pluginRegistry = new PluginRegistry();
```

#### Phase 3: Guard 프리셋 플러그인화

```typescript
// packages/core/src/guard/presets/plugin.ts

import type { ManduPlugin, ManduPluginApi } from "../../plugins/types.js";
import type { PresetDefinition, LayerDefinition } from "../types.js";
import { z } from "zod";

/**
 * Guard 프리셋 플러그인 인터페이스
 */
export interface GuardPresetPlugin {
  /** 프리셋 ID (예: "fsd", "clean") */
  id: string;

  /** 프리셋 이름 */
  name: string;

  /** 설명 */
  description: string;

  /** 레이어 정의 */
  layers: LayerDefinition[];

  /** 기본 제외 패턴 */
  defaultExclude?: string[];
}

/**
 * Guard 프리셋 플러그인 생성 헬퍼
 */
export function createGuardPresetPlugin(
  preset: GuardPresetPlugin
): ManduPlugin {
  return {
    meta: {
      id: `guard-preset-${preset.id}`,
      name: preset.name,
      version: "1.0.0",
      description: preset.description,
    },
    category: "guard-preset",
    configSchema: z.object({}).optional(),
    register: (api: ManduPluginApi) => {
      api.registerGuardPreset(preset);
    },
  };
}

// 예시: FSD 프리셋 플러그인
export const fsdPresetPlugin = createGuardPresetPlugin({
  id: "fsd",
  name: "Feature-Sliced Design",
  description: "Frontend-focused architecture",
  layers: [
    { name: "app", level: 6 },
    { name: "pages", level: 5 },
    { name: "widgets", level: 4 },
    { name: "features", level: 3 },
    { name: "entities", level: 2 },
    { name: "shared", level: 1 },
  ],
});
```

---

### 4.2 DNA-002: 의존성 주입 패턴

#### Filling 핸들러 DI 적용

```typescript
// packages/core/src/filling/deps.ts

/**
 * Filling 핸들러 의존성 타입
 */
export interface FillingDeps {
  /** 데이터베이스 접근 (추상화) */
  db?: {
    query: <T>(sql: string, params?: unknown[]) => Promise<T>;
    transaction: <T>(fn: () => Promise<T>) => Promise<T>;
  };

  /** 캐시 접근 (추상화) */
  cache?: {
    get: <T>(key: string) => Promise<T | null>;
    set: <T>(key: string, value: T, ttl?: number) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };

  /** 외부 HTTP 클라이언트 */
  fetch?: typeof fetch;

  /** 로거 */
  logger?: {
    debug: (msg: string, data?: unknown) => void;
    info: (msg: string, data?: unknown) => void;
    warn: (msg: string, data?: unknown) => void;
    error: (msg: string, data?: unknown) => void;
  };

  /** 현재 시간 (테스트용) */
  now?: () => Date;
}

/**
 * 기본 의존성 생성
 */
export function createDefaultDeps(): FillingDeps {
  return {
    fetch: globalThis.fetch,
    logger: console,
    now: () => new Date(),
  };
}

/**
 * 테스트용 모킹 헬퍼
 */
export function createMockDeps(overrides: Partial<FillingDeps> = {}): FillingDeps {
  return {
    db: {
      query: async () => [] as any,
      transaction: async (fn) => fn(),
    },
    cache: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    },
    fetch: async () => new Response("{}"),
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    now: () => new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}
```

#### Context에 Deps 주입

```typescript
// packages/core/src/filling/context.ts (수정)

import type { FillingDeps } from "./deps.js";

export class FillingContext<TState = {}> {
  private deps: FillingDeps;

  constructor(
    private request: Request,
    private state: TState,
    deps?: FillingDeps
  ) {
    this.deps = deps ?? createDefaultDeps();
  }

  /** 의존성 접근 */
  get db() { return this.deps.db; }
  get cache() { return this.deps.cache; }
  get fetch() { return this.deps.fetch ?? globalThis.fetch; }
  get logger() { return this.deps.logger ?? console; }
  get now() { return this.deps.now ?? (() => new Date()); }

  // ... 기존 메서드들
}
```

#### 테스트 예시

```typescript
// packages/core/tests/filling/handler.test.ts

import { describe, it, expect, vi } from "bun:test";
import { Mandu } from "../../src/index.js";
import { createMockDeps } from "../../src/filling/deps.js";

describe("Filling Handler with DI", () => {
  it("should use injected db", async () => {
    const mockQuery = vi.fn().mockResolvedValue([{ id: 1, name: "Test" }]);

    const handler = Mandu.filling()
      .get(async (ctx) => {
        const users = await ctx.db!.query("SELECT * FROM users");
        return ctx.ok({ data: users });
      });

    const deps = createMockDeps({
      db: { query: mockQuery, transaction: async (fn) => fn() },
    });

    const result = await handler.handle(
      new Request("http://localhost/api/users"),
      deps
    );

    expect(mockQuery).toHaveBeenCalledWith("SELECT * FROM users");
    expect(result.status).toBe(200);
  });

  it("should use injected time for testing", async () => {
    const fixedDate = new Date("2026-06-15T10:00:00Z");

    const handler = Mandu.filling()
      .get(async (ctx) => {
        return ctx.ok({ timestamp: ctx.now().toISOString() });
      });

    const deps = createMockDeps({ now: () => fixedDate });

    const result = await handler.handle(
      new Request("http://localhost/api/time"),
      deps
    );

    const body = await result.json();
    expect(body.timestamp).toBe("2026-06-15T10:00:00.000Z");
  });
});
```

---

## 5. 코드 패턴 레퍼런스

### 5.1 OpenClaw 패턴 → Mandu 적용

#### 패턴 1: 정규화 함수

```typescript
// OpenClaw: src/utils.ts
export function normalizeAgentId(value: string): string {
  const trimmed = (value ?? "").trim();
  if (SAFE_ID_RE.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed
    .toLowerCase()
    .replace(UNSAFE_CHARS_RE, "-")
    .slice(0, 64) || "unknown";
}

// Mandu 적용: src/utils/normalize.ts
export function normalizeRouteId(value: string): string {
  const trimmed = (value ?? "").trim();
  if (SAFE_ROUTE_ID_RE.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64) || "route";
}

export function normalizeSlotPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\//, "")
    .replace(/\/$/, "");
}
```

#### 패턴 2: 에러 래핑

```typescript
// OpenClaw: src/infra/errors.ts
export class ManduError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ManduError";
  }
}

export function wrapError(err: unknown, context: string): ManduError {
  if (err instanceof ManduError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  return new ManduError(
    `${context}: ${message}`,
    "WRAPPED_ERROR",
    { originalError: err }
  );
}
```

#### 패턴 3: 안전한 JSON 파싱

```typescript
// OpenClaw 패턴 적용
export function safeJsonParse<T>(
  input: string,
  fallback: T
): { success: true; data: T } | { success: false; error: Error; data: T } {
  try {
    const data = JSON.parse(input) as T;
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      data: fallback,
    };
  }
}
```

---

## 6. 로드맵 통합

### 6.1 v0.11 (Q1 2026)

| 항목 | DNA | 예상 공수 | 담당 |
|------|-----|----------|------|
| 플러그인 타입 정의 | DNA-001 | 2일 | - |
| 플러그인 레지스트리 | DNA-001 | 3일 | - |
| Guard 프리셋 플러그인화 | DNA-001 | 2일 | - |
| Filling DI 패턴 | DNA-002 | 3일 | - |
| Zod .strict() 전면 적용 | DNA-003 | 1일 | - |

### 6.2 v0.12 (Q2 2026)

| 항목 | DNA | 예상 공수 | 담당 |
|------|-----|----------|------|
| 세션 키 유틸 | DNA-004 | 2일 | - |
| UTF-16 안전 문자열 | DNA-005 | 1일 | - |
| 설정 핫 리로드 | DNA-006 | 3일 | - |
| MCP 도구 플러그인 API | DNA-001 | 3일 | - |
| 빌드 플러그인 API | DNA-001 | 3일 | - |

### 6.3 v0.13 (Q3 2026)

| 항목 | DNA | 예상 공수 | 담당 |
|------|-----|----------|------|
| 에러 코드 추출 강화 | DNA-007 | 2일 | - |
| 구조화된 로깅 시스템 | DNA-008 | 4일 | - |
| 로깅 전송 플러그인 | DNA-001 | 2일 | - |

---

## 7. 참고하지 않을 DNA

### 7.1 비적합 DNA 목록

| DNA | OpenClaw 용도 | 비적합 이유 |
|-----|--------------|------------|
| **다중 모델 페일오버** | AI 모델 순차 시도 | Mandu에 AI 런타임 없음 |
| **컨텍스트 압축** | LLM 프롬프트 최적화 | AI 기능 없음 |
| **OAuth 프로필 관리** | 멀티채널 인증 | 앱 레벨 기능 |
| **메시지 청킹** | 긴 메시지 분할 | 메시징 플랫폼 전용 |
| **채널 라우팅** | 멀티채널 메시지 전달 | 웹 프레임워크 불필요 |
| **E164 정규화** | 전화번호 처리 | 도메인 특화 |
| **WhatsApp JID 변환** | WhatsApp 식별자 | 플랫폼 특화 |

### 7.2 향후 검토 가능 DNA

| DNA | 조건 | 검토 시점 |
|-----|------|----------|
| **컨텍스트 압축** | Mandu AI 기능 추가 시 | v1.0+ |
| **다중 제공자 페일오버** | API 게이트웨이 기능 시 | v1.0+ |
| **플랫폼 앱 (iOS/Android)** | 모바일 SDK 제공 시 | v2.0+ |

---

## 부록 A: 파일 변경 요약

### 신규 파일

```
packages/core/src/
├── plugins/
│   ├── types.ts              # 플러그인 인터페이스
│   ├── registry.ts           # 플러그인 레지스트리
│   └── discovery.ts          # 동적 발견
├── filling/
│   └── deps.ts               # 의존성 주입
├── guard/
│   └── presets/
│       └── plugin.ts         # 프리셋 플러그인 인터페이스
├── runtime/
│   └── session-key.ts        # 세션 키 유틸
├── config/
│   ├── watcher.ts            # 설정 감시
│   └── hot-reload.ts         # 핫 리로드
└── utils/
    ├── string.ts             # UTF-16 안전 처리
    └── normalize.ts          # 정규화 함수
```

### 수정 파일

```
packages/core/src/
├── filling/
│   ├── context.ts            # deps 주입 추가
│   └── filling.ts            # deps 전달
├── guard/
│   ├── types.ts              # .strict() 추가
│   └── presets/index.ts      # 플러그인 연동
├── config/
│   └── validate.ts           # .strict() 추가
└── contract/
    └── schema.ts             # .strict() 추가
```

---

## 부록 B: 참고 자료

### OpenClaw 소스 코드 위치

| 파일 | 참고 내용 |
|------|----------|
| `src/cli/deps.ts` | 의존성 주입 패턴 |
| `src/config/zod-schema.*.ts` | Zod 스키마 설계 |
| `src/utils.ts` | 유틸리티 함수 |
| `src/infra/errors.ts` | 에러 처리 |
| `src/logging/logger.ts` | 로깅 시스템 |
| `src/routing/session-key.ts` | 세션 키 생성 |
| `extensions/*/index.ts` | 플러그인 구조 |

### 관련 문서

- OpenClaw AGENTS.md - 코딩 가이드라인
- OpenClaw CONTRIBUTING.md - 기여 가이드
- Mandu RFC-001 - Guard to Guide

---

*문서 끝*
