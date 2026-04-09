# OpenClaw DNA 채택 계획

> **분석 대상**: OpenClaw (멀티채널 AI 메시징 플랫폼)
> **적용 대상**: Mandu (Agent-Native 웹 프레임워크)
> **작성일**: 2026-02-05
> **버전**: v2.0 (CLI DNA 추가)

---

## 목차

1. [Executive Summary](#1-executive-summary)
2. [OpenClaw 핵심 철학](#2-openclaw-핵심-철학)
3. [채택할 DNA 목록](#3-채택할-dna-목록)
   - 3.1 P0: 필수 채택 - Core (v0.11)
   - 3.2 P1: 권장 채택 - Core (v0.12)
   - 3.3 P2: 선택 채택 - Core (v0.13+)
   - 3.4 **🆕 CLI DNA (v0.11-0.12)**
4. [상세 구현 계획](#4-상세-구현-계획)
5. [CLI DNA 상세 구현](#5-cli-dna-상세-구현)
6. [코드 패턴 레퍼런스](#6-코드-패턴-레퍼런스)
7. [로드맵 통합](#7-로드맵-통합)
8. [참고하지 않을 DNA](#8-참고하지-않을-dna)

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
| **CLI** | Commander.js + 풍부한 UI | 수동 파싱 + 기본 출력 |

### 1.2 채택 DNA 요약

#### Core DNA (기존)

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

#### CLI DNA (신규) 🆕

| 우선순위 | DNA | Mandu 적용 영역 | 예상 효과 |
|----------|-----|----------------|----------|
| 🔴 P0 | 색상 테마 시스템 | CLI 전체 출력 | 브랜딩 + UX ↑ |
| 🔴 P0 | 명령어 레지스트리 | CLI 구조 | 유지보수성 ↑ |
| 🟡 P1 | ANSI-aware 테이블 | guard, routes 출력 | 가독성 ↑ |
| 🟡 P1 | Multi-fallback 프로그레스 | build, deploy | 피드백 ↑ |
| 🟡 P1 | Safe Stream Writer | 파이프 출력 | 안정성 ↑ |
| 🟡 P1 | 적응형 출력 포맷 | JSON/Pretty/Plain | 에이전트 친화 |
| 🟢 P2 | 시맨틱 도움말 | --help 출력 | DX ↑ |
| 🟢 P2 | Pre-Action 훅 | 배너, 설정 로드 | 일관성 ↑ |
| 🟡 P1 | **히어로 배너** | CLI 시작 화면 | 브랜딩 ↑↑ |

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
| **CLI UX** | 풍부한 테마 + 적응형 출력 | 기본 출력 | 🔴 개선 필요 |

---

## 3. 채택할 DNA 목록

### 3.1 P0: 필수 채택 - Core (v0.11)

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

### 3.2 P1: 권장 채택 - Core (v0.12)

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

---

#### DNA-006: 설정 핫 리로드

**출처**: `src/config/config.ts` (파일 감시)

**Mandu 적용**:
- `mandu.config.ts` 변경 시 자동 리로드
- Guard 설정 실시간 반영
- 개발 서버 재시작 없이 설정 적용

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

### 3.3 P2: 선택 채택 - Core (v0.13+)

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

---

### 3.4 CLI DNA (v0.11-0.12) 🆕

#### DNA-009: 색상 테마 시스템

**출처**: `src/terminal/palette.ts`, `src/terminal/theme.ts`

**OpenClaw 구현**:
```typescript
// src/terminal/palette.ts - "Lobster Seam" 팔레트
export const LOBSTER_PALETTE = {
  accent: "#FF5A2D",         // 주요 요소
  accentBright: "#FF7A3D",   // 강조
  accentDim: "#D14A22",      // 약화
  info: "#FF8A5B",           // 정보성
  success: "#2FBF71",        // 성공
  warn: "#FFB020",           // 경고
  error: "#E23D2D",          // 에러
  muted: "#8B7F77",          // 보조 텍스트
} as const;

// src/terminal/theme.ts - Chalk 기반 동적 시스템
const hasForceColor = process.env.FORCE_COLOR?.trim() !== "0";
const baseChalk = process.env.NO_COLOR && !hasForceColor
  ? new Chalk({ level: 0 })
  : chalk;

export const theme = {
  accent: hex(LOBSTER_PALETTE.accent),
  success: hex(LOBSTER_PALETTE.success),
  warn: hex(LOBSTER_PALETTE.warn),
  error: hex(LOBSTER_PALETTE.error),
  muted: hex(LOBSTER_PALETTE.muted),
  heading: baseChalk.bold.hex(LOBSTER_PALETTE.accent),
  command: hex(LOBSTER_PALETTE.accentBright),
  option: hex(LOBSTER_PALETTE.warn),
} as const;

export const isRich = () => Boolean(baseChalk.level > 0);
```

**Mandu 적용** - "Mandu" 테마:
```typescript
// packages/cli/src/terminal/palette.ts
export const MANDU_PALETTE = {
  accent: "#E8B4B8",         // 만두 분홍 (주요)
  accentBright: "#F5D0D3",   // 밝은 분홍 (강조)
  accentDim: "#C9A0A4",      // 어두운 분홍
  info: "#87CEEB",           // 스카이 블루
  success: "#90EE90",        // 라이트 그린
  warn: "#FFD700",           // 골드
  error: "#FF6B6B",          // 코랄 레드
  muted: "#9CA3AF",          // 그레이
} as const;
```

**예상 파일**:
```
packages/cli/src/
└── terminal/
    ├── palette.ts           # 색상 팔레트 정의
    ├── theme.ts             # Chalk 테마 시스템
    └── index.ts             # 내보내기
```

---

#### DNA-010: 명령어 레지스트리 패턴

**출처**: `src/cli/program/command-registry.ts`

**OpenClaw 구현**:
```typescript
// CommandRegistration 인터페이스로 선언적 등록
export type CommandRegistration = {
  id: string;
  register: (ctx: { program: Command }) => void;
};

export const commandRegistry: CommandRegistration[] = [
  { id: "setup", register: ({ program }) => registerSetupCommand(program) },
  { id: "onboard", register: ({ program }) => registerOnboardCommand(program) },
  { id: "message", register: ({ program }) => registerMessageCommand(program) },
  // ...
];

// 런타임 경로 기반 라우팅 (속도 최적화)
type RouteSpec = {
  match: (path: string[]) => boolean;
  loadPlugins?: boolean;
  run: (argv: string[]) => Promise<boolean>;
};
```

**Mandu 적용**:
```typescript
// packages/cli/src/commands/registry.ts
export type CommandRegistration = {
  id: string;
  description: string;
  register: (program: Command) => void;
};

export const commandRegistry: CommandRegistration[] = [
  { id: "dev", description: "Start dev server", register: registerDevCommand },
  { id: "build", description: "Build for production", register: registerBuildCommand },
  { id: "guard", description: "Check architecture", register: registerGuardCommand },
  { id: "routes", description: "Manage routes", register: registerRoutesCommand },
  { id: "init", description: "Initialize project", register: registerInitCommand },
];

// 빌드 시점에 lazy import로 최적화
export function registerAllCommands(program: Command) {
  for (const cmd of commandRegistry) {
    cmd.register(program);
  }
}
```

**예상 파일**:
```
packages/cli/src/
├── commands/
│   ├── registry.ts          # 명령어 레지스트리
│   ├── dev.ts               # dev 명령어
│   ├── build.ts             # build 명령어
│   ├── guard.ts             # guard 명령어
│   ├── routes.ts            # routes 명령어
│   └── init.ts              # init 명령어
└── program/
    ├── build-program.ts     # 프로그램 빌드
    └── preaction.ts         # 전처리 훅
```

---

#### DNA-011: ANSI-aware 테이블 렌더링

**출처**: `src/terminal/table.ts`

**OpenClaw 구현**:
```typescript
export type TableColumn = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  minWidth?: number;
  maxWidth?: number;
  flex?: boolean;  // 반응형 너비 조정
};

export function renderTable(opts: RenderTableOptions): string {
  const { columns, rows, border = "unicode", maxWidth } = opts;

  // ANSI SGR 패턴 인식 (ESC [ ... m) - 너비 계산에서 제외
  const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "");

  // 컬럼 너비 동적 계산
  const widths = columns.map((c, i) => {
    const headerW = stripAnsi(c.header).length;
    const maxCellW = Math.max(...rows.map(r => stripAnsi(String(r[c.key] ?? "")).length));
    const base = Math.max(headerW, maxCellW) + 2; // padding
    return c.maxWidth ? Math.min(base, c.maxWidth) : base;
  });

  // 최대 너비 제약 시 flex 컬럼부터 축소
  if (maxWidth) {
    const total = widths.reduce((a, b) => a + b, 0);
    if (total > maxWidth) {
      const flexIndices = columns.map((c, i) => c.flex ? i : -1).filter(i => i >= 0);
      // 축소 로직...
    }
  }

  // 유니코드 박스 그리기 문자
  const box = border === "unicode"
    ? { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│", t: "┬", b: "┴", ml: "├", mr: "┤", m: "┼" }
    : { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|", t: "+", b: "+", ml: "+", mr: "+", m: "+" };

  // 테이블 렌더링...
  return tableString;
}
```

**Mandu 적용** - `mandu guard` 출력:
```typescript
// packages/cli/src/terminal/table.ts
import { theme } from "./theme.js";

export function renderViolationsTable(violations: Violation[]): string {
  return renderTable({
    columns: [
      { key: "severity", header: "Sev", minWidth: 5 },
      { key: "file", header: "File", flex: true, maxWidth: 40 },
      { key: "rule", header: "Rule", minWidth: 20 },
      { key: "message", header: "Message", flex: true },
    ],
    rows: violations.map(v => ({
      severity: v.severity === "error" ? theme.error("ERR") : theme.warn("WARN"),
      file: theme.muted(shortenPath(v.filePath)),
      rule: v.ruleId,
      message: v.ruleDescription,
    })),
    border: "unicode",
    maxWidth: process.stdout.columns ?? 120,
  });
}
```

---

#### DNA-012: Multi-fallback 프로그레스

**출처**: `src/cli/progress.ts`

**OpenClaw 구현**:
```typescript
export type ProgressOptions = {
  label: string;
  total?: number;
  stream?: NodeJS.WriteStream;
  fallback?: "spinner" | "line" | "log" | "none";
};

export function createCliProgress(options: ProgressOptions): ProgressReporter {
  const stream = options.stream ?? process.stderr;
  const isTty = stream.isTTY;

  // OSC Progress 프로토콜 지원 (현대 터미널)
  const canOsc = isTty && supportsOscProgress(process.env, isTty);

  // 다단계 폴백: OSC → Spinner → Line → Log → None
  const controller = canOsc ? createOscProgressController(stream) : null;
  const spin = options.fallback === "spinner" ? createSpinner() : null;
  const renderLine = options.fallback === "line" ? createLineRenderer(stream) : null;

  let label = options.label;
  let percent = 0;
  let completed = 0;
  const total = options.total ?? 100;

  return {
    setLabel: (next: string) => { label = next; render(); },
    setPercent: (nextPercent: number) => { percent = Math.max(0, Math.min(100, nextPercent)); render(); },
    tick: (delta = 1) => { completed = Math.min(total, completed + delta); percent = (completed / total) * 100; render(); },
    done: () => { cleanup(); },
  };
}

// 컨텍스트 패턴으로 자동 정리
export async function withProgress<T>(
  options: ProgressOptions,
  work: (progress: ProgressReporter) => Promise<T>,
): Promise<T> {
  const progress = createCliProgress(options);
  try {
    return await work(progress);
  } finally {
    progress.done();
  }
}
```

**Mandu 적용** - `mandu build`:
```typescript
// packages/cli/src/commands/build.ts
import { withProgress } from "../terminal/progress.js";

export async function runBuild(options: BuildOptions) {
  await withProgress({ label: "Building...", total: 4 }, async (progress) => {
    progress.setLabel("Scanning routes...");
    await scanRoutes();
    progress.tick();

    progress.setLabel("Bundling client...");
    await bundleClient();
    progress.tick();

    progress.setLabel("Generating SSR...");
    await generateSSR();
    progress.tick();

    progress.setLabel("Optimizing...");
    await optimize();
    progress.tick();
  });

  console.log(theme.success("✓ Build completed"));
}
```

---

#### DNA-013: Safe Stream Writer (EPIPE 처리)

**출처**: `src/terminal/stream-writer.ts`

**OpenClaw 구현**:
```typescript
export type SafeStreamWriter = {
  write: (stream: NodeJS.WriteStream, text: string) => boolean;
  writeLine: (stream: NodeJS.WriteStream, text: string) => boolean;
  reset: () => void;
  isClosed: () => boolean;
};

export function createSafeStreamWriter(options: SafeStreamWriterOptions = {}): SafeStreamWriter {
  let closed = false;

  const isBrokenPipeError = (err: unknown): err is NodeJS.ErrnoException =>
    (err as NodeJS.ErrnoException)?.code === "EPIPE" ||
    (err as NodeJS.ErrnoException)?.code === "EIO";

  const write = (stream: NodeJS.WriteStream, text: string): boolean => {
    if (closed) return false;
    try {
      stream.write(text);
      return true;
    } catch (err) {
      if (!isBrokenPipeError(err)) throw err;
      closed = true;
      options.onBrokenPipe?.(err, stream);
      return false;
    }
  };

  return {
    write,
    writeLine: (stream, text) => write(stream, `${text}\n`),
    reset: () => { closed = false; },
    isClosed: () => closed,
  };
}
```

**Mandu 적용** - 파이프 출력 안정화:
```typescript
// packages/cli/src/terminal/output.ts
const writer = createSafeStreamWriter({
  onBrokenPipe: () => {
    // 조용히 종료 (head, grep 등과 파이프 시)
  },
});

export function log(message: string): boolean {
  return writer.writeLine(process.stdout, message);
}

export function error(message: string): boolean {
  return writer.writeLine(process.stderr, message);
}

// 사용 예: mandu routes --json | head -10
export function streamRoutes(routes: Route[]) {
  for (const route of routes) {
    if (!log(JSON.stringify(route))) {
      return; // 파이프 끊김 시 조용히 종료
    }
  }
}
```

---

#### DNA-014: 적응형 출력 포맷 (JSON/Pretty/Plain)

**출처**: `src/cli/logs-cli.ts`

**OpenClaw 구현**:
```typescript
// 출력 모드 결정 로직
function determineOutputMode(opts: CliOptions): OutputMode {
  if (opts.json) return "json";
  if (opts.plain || !process.stdout.isTTY) return "plain";
  return "pretty";
}

// 적응형 포맷팅
function formatOutput(data: unknown, mode: OutputMode, rich: boolean): string {
  if (mode === "json") {
    return JSON.stringify(data, null, 2);
  }

  if (mode === "plain") {
    // 색상 없이 텍스트만
    return formatPlain(data);
  }

  // Pretty 모드: 색상 + 포맷팅
  return formatPretty(data, rich);
}

// 에이전트 친화적 에러 출력
function emitError(err: unknown, mode: OutputMode, rich: boolean) {
  const message = "Gateway not reachable. Is it running?";
  const hint = `Hint: run \`${theme.command("mandu doctor")}\`.`;
  const errorText = err instanceof Error ? err.message : String(err);

  if (mode === "json") {
    return { type: "error", message, error: errorText, hint };
  }

  return [
    rich ? theme.error(message) : message,
    rich ? theme.muted(hint) : hint,
  ].join("\n");
}
```

**Mandu 적용**:
```typescript
// packages/cli/src/terminal/output.ts
export type OutputMode = "json" | "pretty" | "plain";

export function getOutputMode(opts: { json?: boolean; plain?: boolean }): OutputMode {
  // 에이전트 감지
  if (process.env.CLAUDE_CODE || process.env.CI) {
    return opts.json ? "json" : "plain";
  }
  if (opts.json) return "json";
  if (opts.plain || !process.stdout.isTTY) return "plain";
  return "pretty";
}

// mandu guard 출력 예시
export function outputGuardReport(report: ViolationReport, mode: OutputMode) {
  if (mode === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const rich = mode === "pretty";

  console.log(rich ? theme.heading("Guard Report") : "Guard Report");
  console.log(`Total: ${report.totalViolations} violations`);

  if (report.violations.length > 0) {
    console.log(rich ? renderViolationsTable(report.violations) : formatPlainViolations(report.violations));
  }
}
```

---

#### DNA-015: 시맨틱 도움말 시스템

**출처**: `src/cli/help-format.ts`, `src/cli/program/help.ts`

**OpenClaw 구현**:
```typescript
// 예제 포맷팅
export type HelpExample = readonly [command: string, description: string];

export function formatHelpExample(command: string, description: string): string {
  return `  ${theme.command(command)}\n    ${theme.muted(description)}`;
}

export function formatHelpExampleGroup(
  label: string,
  examples: ReadonlyArray<HelpExample>,
) {
  return `${theme.muted(label)}\n${examples.map(([cmd, desc]) => formatHelpExample(cmd, desc)).join("\n\n")}`;
}

// Commander.js configureHelp 커스터마이징
export function configureProgramHelp(program: Command) {
  program
    .configureHelp({
      optionTerm: (option) => theme.option(option.flags),
      subcommandTerm: (cmd) => theme.command(cmd.name()),
    })
    .configureOutput({
      writeOut: (str) => {
        const colored = str
          .replace(/^Usage:/gm, theme.heading("Usage:"))
          .replace(/^Options:/gm, theme.heading("Options:"))
          .replace(/^Commands:/gm, theme.heading("Commands:"));
        process.stdout.write(colored);
      },
      outputError: (str, write) => write(theme.error(str)),
    })
    .addHelpText("after", formatHelpExampleGroup("Examples:", [
      ["mandu dev", "Start development server with HMR"],
      ["mandu build --prod", "Build for production"],
      ["mandu guard --fix", "Check architecture and auto-fix"],
    ]));
}
```

**Mandu 적용**:
```typescript
// packages/cli/src/program/help.ts
import { theme } from "../terminal/theme.js";

const EXAMPLES: HelpExample[] = [
  ["mandu dev", "Start dev server with HMR"],
  ["mandu build", "Build for production"],
  ["mandu guard", "Check architecture rules"],
  ["mandu guard --heal", "Auto-fix violations"],
  ["mandu routes list --json", "List routes as JSON"],
];

export function configureProgramHelp(program: Command) {
  program
    .name("mandu")
    .description("Agent-Native Web Framework")
    .configureHelp({
      optionTerm: (opt) => theme.option(opt.flags),
      subcommandTerm: (cmd) => theme.command(cmd.name()),
    })
    .addHelpText("after", `\n${formatHelpExampleGroup("Examples:", EXAMPLES)}`);
}
```

---

#### DNA-016: Pre-Action 훅 패턴

**출처**: `src/cli/program/preaction.ts`

**OpenClaw 구현**:
```typescript
export function registerPreActionHooks(program: Command, programVersion: string) {
  program.hook("preAction", async (_thisCommand, actionCommand) => {
    // 1. 프로세스 타이틀 설정
    setProcessTitleForCommand(actionCommand);

    const argv = process.argv;
    if (hasHelpOrVersion(argv)) return;

    const commandPath = getCommandPath(argv, 2);

    // 2. 조건부 배너 표시
    const hideBanner =
      isTruthyEnvValue(process.env.MANDU_HIDE_BANNER) ||
      commandPath[0] === "completion";
    if (!hideBanner && process.stdout.isTTY) {
      emitCliBanner(programVersion);
    }

    // 3. Verbose 모드 설정
    const verbose = getVerboseFlag(argv);
    setVerbose(verbose);

    // 4. 설정 로드 (일부 명령어 제외)
    const SKIP_CONFIG = new Set(["init", "completion", "help"]);
    if (!SKIP_CONFIG.has(commandPath[0])) {
      await ensureConfigReady();
    }
  });
}
```

**Mandu 적용**:
```typescript
// packages/cli/src/program/preaction.ts
import { theme, isRich } from "../terminal/theme.js";
import { loadConfig } from "@mandujs/core";

export function registerPreActionHooks(program: Command, version: string) {
  program.hook("preAction", async (_thisCommand, actionCommand) => {
    const argv = process.argv;
    const commandPath = getCommandPath(argv);

    // 1. 배너 표시 (TTY + 비 JSON 모드)
    if (process.stdout.isTTY && !hasJsonFlag(argv) && !process.env.MANDU_NO_BANNER) {
      printBanner(version);
    }

    // 2. Verbose/Debug 모드
    if (hasVerboseFlag(argv)) {
      process.env.MANDU_VERBOSE = "1";
    }

    // 3. 설정 로드 (init, help 제외)
    const SKIP_CONFIG = new Set(["init", "help", "--help", "-h"]);
    if (!SKIP_CONFIG.has(commandPath[0])) {
      try {
        await loadConfig(process.cwd());
      } catch (err) {
        // 설정 없어도 일부 명령어는 실행 가능
        if (commandPath[0] !== "guard") {
          console.warn(theme.warn("Warning: No mandu.config.ts found"));
        }
      }
    }
  });
}

function printBanner(version: string) {
  if (!isRich()) {
    console.log(`Mandu v${version}`);
    return;
  }

  console.log(`
${theme.accent("  ╭─────────────────────────╮")}
${theme.accent("  │")}  ${theme.heading("🥟 Mandu")} ${theme.muted(`v${version}`)}        ${theme.accent("│")}
${theme.accent("  │")}  ${theme.muted("Agent-Native Framework")} ${theme.accent("│")}
${theme.accent("  ╰─────────────────────────╯")}
  `);
}
```

---

#### DNA-017: 히어로 배너 (cfonts + 그라데이션) 🆕

**출처**: [cfonts](https://github.com/dominikwilkowski/cfonts) - "Sexy fonts for the console"

**영감**: Vite, Astro 등 유명 CLI의 시작 화면

**구현**:
```typescript
// packages/cli/src/terminal/banner.ts
import cfonts from "cfonts";
import { MANDU_PALETTE } from "./palette.js";

export function renderHeroBanner(version: string): void {
  // 터미널 너비 확인
  const cols = process.stdout.columns ?? 80;
  if (cols < 60 || !process.stdout.isTTY) {
    // 좁은 터미널: 미니 배너
    console.log(`\n  🥟 Mandu v${version}\n`);
    return;
  }

  // cfonts로 큰 배너 렌더링
  cfonts.say("MANDU", {
    font: "block",                    // block, chrome, 3d, huge 중 선택
    gradient: [MANDU_PALETTE.accent, MANDU_PALETTE.accentBright],
    transitionGradient: true,
    align: "center",
    space: true,
    maxLength: Math.min(cols - 4, 80),
  });

  // 태그라인
  const tagline = `🥟 Agent-Native Web Framework v${version}`;
  const padding = Math.max(0, Math.floor((cols - tagline.length) / 2));
  console.log(" ".repeat(padding) + tagline + "\n");
}
```

**출력 예시** (block 폰트 + 분홍 그라데이션):
```

  ███╗   ███╗ █████╗ ███╗   ██╗██████╗ ██╗   ██╗
  ████╗ ████║██╔══██╗████╗  ██║██╔══██╗██║   ██║
  ██╔████╔██║███████║██╔██╗ ██║██║  ██║██║   ██║
  ██║╚██╔╝██║██╔══██║██║╚██╗██║██║  ██║██║   ██║
  ██║ ╚═╝ ██║██║  ██║██║ ╚████║██████╔╝╚██████╔╝
  ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝

           🥟 Agent-Native Web Framework v0.10.0

```

**폰트 옵션**:

| 폰트 | 스타일 | 색상 수 | 추천 용도 |
|------|--------|---------|----------|
| `block` | 굵은 블록 | 2 | 기본 (추천) |
| `chrome` | 메탈릭 3D | 3 | 프리미엄 느낌 |
| `3d` | 입체 | 2 | 게임 느낌 |
| `huge` | 초대형 | 2 | 와이드 터미널 |
| `slick` | 날렵한 | 2 | 모던 느낌 |
| `tiny` | 작은 | 1 | 좁은 터미널 |

**조건부 표시**:
```typescript
// packages/cli/src/program/preaction.ts
function shouldShowBanner(argv: string[]): boolean {
  // 배너 숨김 조건
  if (process.env.MANDU_NO_BANNER) return false;
  if (process.env.CI) return false;
  if (process.env.CLAUDE_CODE) return false;  // 에이전트 환경
  if (!process.stdout.isTTY) return false;     // 파이프
  if (hasJsonFlag(argv)) return false;         // --json
  if (hasQuietFlag(argv)) return false;        // --quiet, -q
  return true;
}
```

**의존성**:
```json
{
  "dependencies": {
    "cfonts": "^3.3.0"
  }
}
```

**예상 파일**:
```
packages/cli/src/
└── terminal/
    └── banner.ts            # 🆕 히어로 배너
```

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

---

### 4.2 DNA-002: 의존성 주입 패턴

```typescript
// packages/core/src/filling/deps.ts

/**
 * Filling 핸들러 의존성 타입
 */
export interface FillingDeps {
  /** 데이터베이스 접근 */
  db?: {
    query: <T>(sql: string, params?: unknown[]) => Promise<T>;
    transaction: <T>(fn: () => Promise<T>) => Promise<T>;
  };

  /** 캐시 접근 */
  cache?: {
    get: <T>(key: string) => Promise<T | null>;
    set: <T>(key: string, value: T, ttl?: number) => Promise<void>;
    delete: (key: string) => Promise<void>;
  };

  /** HTTP 클라이언트 */
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

---

## 5. CLI DNA 상세 구현

### 5.1 파일 구조

```
packages/cli/src/
├── terminal/
│   ├── palette.ts           # 🆕 색상 팔레트
│   ├── theme.ts             # 🆕 Chalk 테마
│   ├── table.ts             # 🆕 ANSI-aware 테이블
│   ├── progress.ts          # 🆕 프로그레스 표시
│   ├── stream-writer.ts     # 🆕 Safe Stream Writer
│   ├── output.ts            # 🆕 적응형 출력
│   └── index.ts
├── commands/
│   ├── registry.ts          # 🆕 명령어 레지스트리
│   ├── dev.ts               # 수정: 테마 적용
│   ├── build.ts             # 수정: 프로그레스 적용
│   ├── guard.ts             # 수정: 테이블 출력
│   └── routes.ts            # 수정: JSON/Pretty 출력
├── program/
│   ├── build-program.ts     # 🆕 프로그램 빌드
│   ├── preaction.ts         # 🆕 Pre-Action 훅
│   └── help.ts              # 🆕 도움말 커스터마이징
└── index.ts
```

### 5.2 DNA-009: 색상 테마 구현

```typescript
// packages/cli/src/terminal/palette.ts
export const MANDU_PALETTE = {
  // 브랜드 컬러
  accent: "#E8B4B8",         // 만두 분홍
  accentBright: "#F5D0D3",   // 밝은 분홍
  accentDim: "#C9A0A4",      // 어두운 분홍

  // 시맨틱 컬러
  info: "#87CEEB",           // 스카이 블루
  success: "#90EE90",        // 라이트 그린
  warn: "#FFD700",           // 골드
  error: "#FF6B6B",          // 코랄 레드

  // 뉴트럴
  muted: "#9CA3AF",          // 그레이
  dim: "#6B7280",            // 다크 그레이
} as const;

// packages/cli/src/terminal/theme.ts
import chalk, { Chalk } from "chalk";
import { MANDU_PALETTE } from "./palette.js";

// NO_COLOR / FORCE_COLOR 지원
const hasForceColor = process.env.FORCE_COLOR?.trim() !== "0";
const baseChalk = process.env.NO_COLOR && !hasForceColor
  ? new Chalk({ level: 0 })
  : chalk;

const hex = (color: string) => baseChalk.hex(color);

export const theme = {
  // 시맨틱
  accent: hex(MANDU_PALETTE.accent),
  success: hex(MANDU_PALETTE.success),
  warn: hex(MANDU_PALETTE.warn),
  error: hex(MANDU_PALETTE.error),
  info: hex(MANDU_PALETTE.info),
  muted: hex(MANDU_PALETTE.muted),

  // 복합
  heading: baseChalk.bold.hex(MANDU_PALETTE.accent),
  command: hex(MANDU_PALETTE.accentBright),
  option: hex(MANDU_PALETTE.warn),
  path: hex(MANDU_PALETTE.info),

  // 강조
  bold: baseChalk.bold,
  dim: baseChalk.dim,
} as const;

export const isRich = () => baseChalk.level > 0;

export function colorize(rich: boolean, colorFn: (s: string) => string, text: string): string {
  return rich ? colorFn(text) : text;
}
```

### 5.3 DNA-012: 프로그레스 구현

```typescript
// packages/cli/src/terminal/progress.ts
import ora from "ora";
import { theme, isRich } from "./theme.js";

export type ProgressOptions = {
  label: string;
  total?: number;
  stream?: NodeJS.WriteStream;
};

export type ProgressReporter = {
  setLabel: (label: string) => void;
  setPercent: (percent: number) => void;
  tick: (delta?: number) => void;
  done: () => void;
  fail: (message?: string) => void;
};

export function createCliProgress(options: ProgressOptions): ProgressReporter {
  const stream = options.stream ?? process.stderr;
  const isTty = stream.isTTY;
  const total = options.total ?? 100;

  let label = options.label;
  let completed = 0;

  // TTY: 스피너 사용
  const spinner = isTty && isRich() ? ora({ text: label, stream }).start() : null;

  const render = () => {
    const percent = Math.round((completed / total) * 100);
    const text = `${label} (${percent}%)`;

    if (spinner) {
      spinner.text = text;
    } else if (isTty) {
      stream.write(`\r${text}`);
    }
  };

  return {
    setLabel: (next: string) => { label = next; render(); },
    setPercent: (percent: number) => { completed = (percent / 100) * total; render(); },
    tick: (delta = 1) => { completed = Math.min(total, completed + delta); render(); },
    done: () => {
      if (spinner) {
        spinner.succeed(theme.success(`${label} completed`));
      } else if (isTty) {
        stream.write(`\r${label} completed\n`);
      } else {
        stream.write(`${label} completed\n`);
      }
    },
    fail: (message?: string) => {
      if (spinner) {
        spinner.fail(theme.error(message ?? `${label} failed`));
      } else {
        stream.write(`${message ?? `${label} failed`}\n`);
      }
    },
  };
}

export async function withProgress<T>(
  options: ProgressOptions,
  work: (progress: ProgressReporter) => Promise<T>,
): Promise<T> {
  const progress = createCliProgress(options);
  try {
    return await work(progress);
  } catch (err) {
    progress.fail();
    throw err;
  }
}
```

---

## 6. 코드 패턴 레퍼런스

### 6.1 OpenClaw 패턴 → Mandu 적용

#### 패턴 1: 정규화 함수

```typescript
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
```

#### 패턴 2: 에러 래핑

```typescript
// Mandu 적용: src/errors/wrap.ts
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
  if (err instanceof ManduError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ManduError(`${context}: ${message}`, "WRAPPED_ERROR", { originalError: err });
}
```

#### 패턴 3: Managed Resource

```typescript
// Mandu 적용: src/utils/resource.ts
export async function withManager<T, R>(params: {
  getManager: () => Promise<{ manager: T | null; error?: string }>;
  onMissing: (error?: string) => void;
  run: (manager: T) => Promise<R>;
  close: (manager: T) => Promise<void>;
}): Promise<R | undefined> {
  const { manager, error } = await params.getManager();
  if (!manager) {
    params.onMissing(error);
    return undefined;
  }
  try {
    return await params.run(manager);
  } finally {
    await params.close(manager);
  }
}
```

---

## 7. 로드맵 통합

### 7.1 v0.11 (Q1 2026) - 완료 ✅

| 항목 | DNA | 예상 공수 | 상태 |
|------|-----|----------|------|
| 플러그인 타입 정의 | DNA-001 | 2일 | ✅ 완료 |
| 플러그인 레지스트리 | DNA-001 | 3일 | ✅ 완료 |
| Guard 프리셋 플러그인화 | DNA-001 | 2일 | ✅ 완료 (인터페이스) |
| Filling DI 패턴 | DNA-002 | 3일 | ✅ 완료 |
| Zod .strict() 전면 적용 | DNA-003 | 1일 | ✅ 완료 |
| **CLI 색상 테마 시스템** | DNA-009 | 1일 | ✅ 완료 |
| **명령어 레지스트리** | DNA-010 | 2일 | ✅ 완료 |
| **Safe Stream Writer** | DNA-013 | 1일 | ✅ 완료 |
| **적응형 출력 포맷** | DNA-014 | 2일 | ✅ 완료 |
| **히어로 배너 (cfonts)** | DNA-017 | 1일 | ✅ 완료 |

### 7.2 v0.12 (Q2 2026) - 완료 ✅

| 항목 | DNA | 예상 공수 | 상태 |
|------|-----|----------|------|
| 세션 키 유틸 | DNA-004 | 2일 | ✅ 완료 |
| UTF-16 안전 문자열 | DNA-005 | 1일 | ✅ 완료 |
| 설정 핫 리로드 | DNA-006 | 3일 | ✅ 완료 |
| MCP 도구 플러그인 API | DNA-001 | 3일 | ✅ 완료 (타입) |
| 빌드 플러그인 API | DNA-001 | 3일 | ✅ 완료 (타입) |
| **ANSI-aware 테이블** | DNA-011 | 2일 | ✅ 완료 |
| **Multi-fallback 프로그레스** | DNA-012 | 2일 | ✅ 완료 |

### 7.3 v0.13 (Q3 2026) - 완료 ✅

| 항목 | DNA | 예상 공수 | 상태 |
|------|-----|----------|------|
| 에러 코드 추출 강화 | DNA-007 | 2일 | ✅ 완료 |
| 구조화된 로깅 시스템 | DNA-008 | 4일 | ✅ 완료 |
| 로깅 전송 플러그인 | DNA-001 | 2일 | ✅ 완료 (DNA-008과 통합) |
| **시맨틱 도움말** | DNA-015 | 1일 | ✅ 완료 |
| **Pre-Action 훅** | DNA-016 | 1일 | ✅ 완료 |

---

## 8. 참고하지 않을 DNA

### 8.1 비적합 DNA 목록

| DNA | OpenClaw 용도 | 비적합 이유 |
|-----|--------------|------------|
| **다중 모델 페일오버** | AI 모델 순차 시도 | Mandu에 AI 런타임 없음 |
| **컨텍스트 압축** | LLM 프롬프트 최적화 | AI 기능 없음 |
| **OAuth 프로필 관리** | 멀티채널 인증 | 앱 레벨 기능 |
| **메시지 청킹** | 긴 메시지 분할 | 메시징 플랫폼 전용 |
| **채널 라우팅** | 멀티채널 메시지 전달 | 웹 프레임워크 불필요 |
| **E164 정규화** | 전화번호 처리 | 도메인 특화 |
| **WhatsApp JID 변환** | WhatsApp 식별자 | 플랫폼 특화 |
| **ASCII 아트 배너** | 복잡한 로고 표시 | 단순한 배너로 충분 |

### 8.2 향후 검토 가능 DNA

| DNA | 조건 | 검토 시점 |
|-----|------|----------|
| **컨텍스트 압축** | Mandu AI 기능 추가 시 | v1.0+ |
| **다중 제공자 페일오버** | API 게이트웨이 기능 시 | v1.0+ |
| **플랫폼 앱 (iOS/Android)** | 모바일 SDK 제공 시 | v2.0+ |

---

## 부록 A: 파일 변경 요약

### 신규 파일 (Core)

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

### 신규 파일 (CLI) 🆕

```
packages/cli/src/
├── terminal/
│   ├── palette.ts            # 색상 팔레트
│   ├── theme.ts              # Chalk 테마
│   ├── table.ts              # ANSI-aware 테이블
│   ├── progress.ts           # 프로그레스 표시
│   ├── stream-writer.ts      # Safe Stream Writer
│   ├── output.ts             # 적응형 출력
│   └── banner.ts             # 🆕 히어로 배너 (cfonts)
├── commands/
│   └── registry.ts           # 명령어 레지스트리
└── program/
    ├── build-program.ts      # 프로그램 빌드
    ├── preaction.ts          # Pre-Action 훅
    └── help.ts               # 도움말 커스터마이징
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
| `src/terminal/palette.ts` | 🆕 색상 팔레트 |
| `src/terminal/theme.ts` | 🆕 테마 시스템 |
| `src/terminal/table.ts` | 🆕 테이블 렌더링 |
| `src/cli/progress.ts` | 🆕 프로그레스 표시 |
| `src/terminal/stream-writer.ts` | 🆕 Safe Writer |
| `src/cli/program/command-registry.ts` | 🆕 명령어 레지스트리 |
| `src/cli/program/preaction.ts` | 🆕 Pre-Action 훅 |
| `src/cli/help-format.ts` | 🆕 도움말 포맷 |

### 관련 문서

- OpenClaw AGENTS.md - 코딩 가이드라인
- OpenClaw CONTRIBUTING.md - 기여 가이드
- Mandu RFC-001 - Guard to Guide

---

*문서 끝 - v2.0 (CLI DNA 추가)*
