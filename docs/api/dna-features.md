# DNA Features API Reference

> OpenClaw DNA 채택으로 추가된 기능들의 API 문서

---

## 목차

1. [Plugin System (DNA-001)](#plugin-system-dna-001)
2. [Dependency Injection (DNA-002)](#dependency-injection-dna-002)
3. [Session Keys (DNA-004)](#session-keys-dna-004)
4. [UTF-16 Safe Strings (DNA-005)](#utf-16-safe-strings-dna-005)
5. [Config Hot Reload (DNA-006)](#config-hot-reload-dna-006)
6. [Error Extraction (DNA-007)](#error-extraction-dna-007)
7. [Structured Logging (DNA-008)](#structured-logging-dna-008)
8. [CLI Terminal UI (DNA-009~017)](#cli-terminal-ui)

---

## Plugin System (DNA-001)

플러그인 기반 확장 시스템으로 Guard 프리셋, 빌드 플러그인, 로거 전송 등을 동적으로 추가할 수 있습니다.

### 플러그인 정의

```typescript
import { definePlugin, type Plugin } from "@mandujs/core";

const myPlugin = definePlugin({
  id: "my-plugin",
  version: "1.0.0",

  async onLoad(api) {
    // 플러그인 로드 시 실행
    console.log("Plugin loaded!");
  },

  async onUnload() {
    // 플러그인 언로드 시 실행
  },
});

export default myPlugin;
```

### 플러그인 등록

```typescript
import { globalPluginRegistry } from "@mandujs/core";

// 플러그인 등록
await globalPluginRegistry.register(myPlugin, { /* config */ });

// 플러그인 조회
const plugin = globalPluginRegistry.get("my-plugin");

// 플러그인 제거
await globalPluginRegistry.unregister("my-plugin");
```

### 플러그인 타입

| 타입 | 용도 | 예시 |
|------|------|------|
| `GuardPresetPlugin` | 아키텍처 프리셋 | FSD, Clean Architecture |
| `BuildPlugin` | 빌드 확장 | Analyzer, Minifier |
| `LoggerTransportPlugin` | 로그 전송 | File, External Service |
| `McpToolPlugin` | MCP 도구 | Custom AI Tools |
| `MiddlewarePlugin` | 미들웨어 | Auth, CORS, Rate Limit |

---

## Dependency Injection (DNA-002)

테스트 가능한 코드를 위한 의존성 주입 패턴입니다.

### 기본 사용

```typescript
import { createDefaultDeps, createMockDeps, type FillingDeps } from "@mandujs/core";

// 프로덕션 의존성
const deps = createDefaultDeps();

// 테스트용 Mock 의존성
const mockDeps = createMockDeps({
  fetch: vi.fn().mockResolvedValue(new Response("OK")),
  now: () => new Date("2024-01-01"),
});
```

### ManduContext에서 사용

```typescript
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get(async (ctx) => {
    // ctx.deps를 통해 의존성 접근
    const response = await ctx.deps.fetch("https://api.example.com");
    const now = ctx.deps.now();

    return ctx.json({ time: now.toISOString() });
  });
```

### FillingDeps 인터페이스

```typescript
interface FillingDeps {
  db?: DbDeps;           // 데이터베이스
  cache?: CacheDeps;     // 캐시
  fetch?: typeof fetch;  // HTTP 클라이언트
  logger?: LoggerDeps;   // 로거
  events?: EventBusDeps; // 이벤트 버스
  now?: () => Date;      // 현재 시간
  uuid?: () => string;   // UUID 생성
  [key: string]: unknown; // 커스텀 의존성
}
```

---

## Session Keys (DNA-004)

SSR 상태 격리를 위한 세션 키 유틸리티입니다.

### 세션 키 생성

```typescript
import { buildSessionKey, buildCacheKey, buildChannelKey } from "@mandujs/core";

// 세션 키 생성
const sessionKey = buildSessionKey({
  scope: "user",
  namespace: "cart",
  identifier: "user-123",
});
// → "user:cart:user-123"

// 캐시 키 생성
const cacheKey = buildCacheKey({
  prefix: "api",
  resource: "users",
  id: "123",
  version: "v1",
});
// → "api:users:123:v1"

// 채널 키 생성
const channelKey = buildChannelKey({
  scope: "team",
  channel: "notifications",
  teamId: "team-456",
});
// → "team:notifications:team-456"
```

### 키 파싱 및 매칭

```typescript
import { parseSessionKey, matchKeyPattern } from "@mandujs/core";

// 키 파싱
const parsed = parseSessionKey("user:cart:user-123");
// → { scope: "user", namespace: "cart", identifier: "user-123" }

// 패턴 매칭
const matches = matchKeyPattern("user:*:user-123", "user:cart:user-123");
// → true
```

---

## UTF-16 Safe Strings (DNA-005)

이모지와 서로게이트 페어를 안전하게 처리하는 문자열 유틸리티입니다.

### 안전한 슬라이싱

```typescript
import { sliceUtf16Safe, sliceByCodePoints } from "@mandujs/core";

const text = "Hello 👋 World";

// UTF-16 안전 슬라이싱 (서로게이트 페어 보호)
sliceUtf16Safe(text, 0, 8);  // "Hello 👋"

// 코드 포인트 기준 슬라이싱
sliceByCodePoints("👋🌍🎉", 0, 2);  // "👋🌍"
```

### 안전한 트렁케이션

```typescript
import { truncateSafe, truncateByBytes } from "@mandujs/core";

// 문자 기준 트렁케이션
truncateSafe("Hello World!", { maxLength: 8 });
// → "Hello..."

// 단어 경계 유지
truncateSafe("Hello beautiful World!", {
  maxLength: 15,
  wordBoundary: true
});
// → "Hello..."

// 중간 트렁케이션
truncateSafe("Hello World!", {
  maxLength: 11,
  position: "middle"
});
// → "Hell...rld!"

// 바이트 기준 트렁케이션 (UTF-8)
truncateByBytes("Hello 👋", 7);  // "Hello "
```

### 유틸리티 함수

```typescript
import {
  lengthInCodePoints,
  stripEmoji,
  hasSurrogates,
  sanitizeSurrogates
} from "@mandujs/core";

// 코드 포인트 길이
lengthInCodePoints("👋🌍");  // 2

// 이모지 제거
stripEmoji("Hello 👋 World 🌍");  // "Hello  World "

// 서로게이트 페어 확인
hasSurrogates("Hello 👋");  // true

// 손상된 서로게이트 정리
sanitizeSurrogates("Hi\uD800there");  // "Hi\uFFFDthere"
```

---

## Config Hot Reload (DNA-006)

설정 파일 변경 시 자동 리로드 기능입니다.

### 설정 감시

```typescript
import { watchConfig, hasConfigChanged, getChangedSections } from "@mandujs/core";

const watcher = await watchConfig(
  "./",  // 프로젝트 루트
  (newConfig, event) => {
    console.log(`Config changed: ${event.path}`);

    // 변경된 섹션 확인
    const changed = getChangedSections(event.previous, event.current);
    console.log("Changed sections:", changed);

    // 특정 섹션 변경 확인
    if (hasConfigChanged(event.previous, event.current, "server")) {
      restartServer(newConfig.server);
    }
  },
  {
    debounceMs: 200,      // 디바운스 딜레이
    immediate: false,     // 즉시 콜백 호출 여부
    onError: console.error,
  }
);

// 수동 리로드
await watcher.reload();

// 현재 설정 조회
const config = watcher.getConfig();

// 감시 중지
watcher.stop();
```

---

## Error Extraction (DNA-007)

다양한 에러 소스에서 코드를 추출하고 분류하는 유틸리티입니다.

### 에러 코드 추출

```typescript
import {
  extractErrorCode,
  extractStatusCode,
  extractErrorInfo
} from "@mandujs/core";

try {
  await fs.readFile("/nonexistent");
} catch (err) {
  // 에러 코드 추출
  const code = extractErrorCode(err);  // "ENOENT"

  // HTTP 상태 코드 추출
  const status = extractStatusCode(err);  // undefined

  // 종합 정보 추출
  const info = extractErrorInfo(err);
  // {
  //   code: "ENOENT",
  //   message: "File not found",
  //   category: "system",
  //   context: { path: "/nonexistent", syscall: "open" }
  // }
}
```

### 에러 분류

```typescript
import { classifyError, isErrorCategory, isRetryableError } from "@mandujs/core";

// 에러 카테고리 분류
classifyError({ code: "ENOENT" });       // "system"
classifyError({ code: "ECONNREFUSED" }); // "network"
classifyError({ status: 401 });          // "auth"
classifyError({ status: 429 });          // "validation"

// 카테고리 확인
isErrorCategory(error, "network");  // boolean

// 재시도 가능 여부
isRetryableError(error);  // network, timeout, 429, 502, 503, 504
```

### 에러 포맷팅

```typescript
import { formatUncaughtError, serializeError } from "@mandujs/core";

// 포맷팅된 에러 메시지
const formatted = formatUncaughtError(error, true);  // verbose=true

// JSON 직렬화
const serialized = serializeError(error);
// { name, message, code, statusCode, category, stack, context }
```

---

## Structured Logging (DNA-008)

다중 전송을 지원하는 구조화된 로깅 시스템입니다.

### 로그 전송 등록

```typescript
import {
  attachLogTransport,
  detachLogTransport,
  type LogTransportRecord
} from "@mandujs/core";

// 파일 전송 등록
attachLogTransport("file", async (record: LogTransportRecord) => {
  await fs.appendFile("app.log", JSON.stringify(record) + "\n");
}, { minLevel: "info" });

// 외부 서비스 전송
attachLogTransport("datadog", async (record) => {
  await fetch("https://http-intake.logs.datadoghq.com/...", {
    method: "POST",
    body: JSON.stringify(record),
  });
}, { minLevel: "warn" });

// 전송 제거
detachLogTransport("file");
```

### 빌트인 전송

```typescript
import {
  createConsoleTransport,
  createBufferTransport,
  createBatchTransport,
  createFilteredTransport
} from "@mandujs/core";

// 콘솔 전송
const console = createConsoleTransport({ format: "json" });

// 버퍼 전송 (테스트용)
const buffer: LogTransportRecord[] = [];
const bufferTransport = createBufferTransport(buffer);

// 배치 전송 (성능 최적화)
const { transport, flush, stop } = createBatchTransport(
  async (records) => {
    await sendBatch(records);
  },
  { maxSize: 100, flushInterval: 5000 }
);

// 필터링 전송
const filtered = createFilteredTransport(
  innerTransport,
  (record) => record.status === 500
);
```

---

## CLI Terminal UI

CLI 출력을 위한 터미널 UI 컴포넌트들입니다.

### 테마 및 색상 (DNA-009)

```typescript
import { theme, colorize, MANDU_PALETTE } from "@mandujs/cli";

// 테마 사용
console.log(theme.success("✓ Done"));
console.log(theme.error("✗ Failed"));
console.log(theme.warn("⚠ Warning"));
console.log(theme.accent("Mandu"));

// 커스텀 색상
console.log(colorize("Custom", MANDU_PALETTE.info));
```

### 테이블 렌더링 (DNA-011)

```typescript
import { renderTable, renderKeyValueTable } from "@mandujs/cli";

const table = renderTable({
  columns: [
    { key: "name", header: "Name", minWidth: 10 },
    { key: "status", header: "Status", align: "center" },
    { key: "size", header: "Size", align: "right" },
  ],
  rows: [
    { name: "file1.ts", status: "✓", size: "1.2KB" },
    { name: "file2.ts", status: "✗", size: "3.4KB" },
  ],
  border: "unicode",
});
```

### 프로그레스 (DNA-012)

```typescript
import { createCliProgress, withProgress, startSpinner } from "@mandujs/cli";

// 단순 스피너
const stop = startSpinner("Loading...");
await doSomething();
stop("Done!");

// 프로그레스 바
const progress = createCliProgress({ label: "Building", total: 4 });
progress.tick();
progress.setLabel("Bundling...");
progress.tick();
progress.done("Build complete!");

// withProgress 패턴
await withProgress({ label: "Processing" }, async (p) => {
  p.setLabel("Step 1");
  await step1();
  p.tick();
  // ...
});
```

### 시맨틱 도움말 (DNA-015)

```typescript
import { renderHelp, formatHelpExample, MANDU_HELP } from "@mandujs/cli";

// 기본 도움말 렌더링
console.log(renderHelp(MANDU_HELP));

// 커스텀 도움말
const help = renderHelp({
  name: "mandu dev",
  description: "Start development server",
  options: [
    { flags: "--port", description: "Server port", default: "3000" },
  ],
  examples: [
    ["mandu dev", "Start with defaults"],
    ["mandu dev --port 4000", "Custom port"],
  ],
});
```

### Pre-Action 훅 (DNA-016)

```typescript
import { runPreAction, registerPreActionHook } from "@mandujs/cli";

// 훅 등록
const unregister = registerPreActionHook(async (ctx) => {
  if (ctx.verbose) {
    console.log(`Running ${ctx.command}...`);
  }
});

// Pre-Action 실행
const ctx = await runPreAction({
  command: "dev",
  options: { port: "3000" },
  version: "0.10.0",
});

// ctx.config, ctx.verbose 사용
```

---

## 관련 문서

- [API Reference](./api-reference.md) - 전체 API 문서
- [Configuration Guide](../guides/01_configuration.md) - 설정 가이드
- [Guard Spec](../specs/06_mandu_guard.md) - Guard 아키텍처 스펙
- [OpenClaw DNA Adoption Plan](../plans/11_openclaw_dna_adoption.md) - DNA 채택 계획
