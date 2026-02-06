<p align="center">
  <img src="https://raw.githubusercontent.com/konamgil/mandu/main/mandu_only_simbol.png" alt="Mandu" width="200" />
</p>

<h1 align="center">@mandujs/core</h1>

<p align="center">
  <strong>Mandu Framework Core</strong><br/>
  Spec, Generator, Guard, Runtime, Filling
</p>

<p align="center">
  <a href="./README.md"><strong>English</strong></a> | 한국어
</p>

## 설치

```bash
bun add @mandujs/core
```

> 일반적으로 `@mandujs/cli`를 통해 사용합니다. 직접 사용은 고급 사용 사례입니다.

## 모듈 구조

```
@mandujs/core
├── router/    # 파일 시스템 기반 라우팅
├── guard/     # 아키텍처 검사 및 자동 수정
├── runtime/   # 서버, SSR, 스트리밍
├── filling/   # 핸들러 체인 API
├── contract/  # 타입 안전 API 계약
├── content/   # Content Layer - 빌드 타임 콘텐츠 로딩 🆕
├── bundler/   # 클라이언트 번들링, HMR
├── client/    # Island 하이드레이션, 클라이언트 라우터
├── brain/     # Doctor, Watcher, 아키텍처 분석
└── change/    # 트랜잭션 & 히스토리
```

## Spec 모듈

라우트 manifest 스키마 정의 및 로딩.

```typescript
import { loadManifest, RoutesManifest, RouteSpec } from "@mandujs/core";

// manifest 로드 및 검증
const result = await loadManifest("spec/routes.manifest.json");

if (result.success && result.data) {
  const manifest: RoutesManifest = result.data;
  manifest.routes.forEach((route: RouteSpec) => {
    console.log(route.id, route.pattern, route.kind);
  });
}
```

### Lock 파일

```typescript
import { writeLock, readLock } from "@mandujs/core";

// lock 파일 쓰기
const lock = await writeLock("spec/spec.lock.json", manifest);
console.log(lock.routesHash);

// lock 파일 읽기
const existing = await readLock("spec/spec.lock.json");
```

## Generator 모듈

Spec 기반 코드 생성.

```typescript
import { generateRoutes, GenerateResult } from "@mandujs/core";

const result: GenerateResult = await generateRoutes(manifest, "./");

console.log("생성됨:", result.created);
console.log("건너뜀:", result.skipped);  // 이미 존재하는 slot 파일
```

### 템플릿 함수

```typescript
import {
  generateApiHandler,
  generateApiHandlerWithSlot,
  generateSlotLogic,
  generatePageComponent
} from "@mandujs/core";

// API 핸들러 생성
const code = generateApiHandler(route);

// Slot이 있는 API 핸들러
const codeWithSlot = generateApiHandlerWithSlot(route);

// Slot 로직 파일
const slotCode = generateSlotLogic(route);
```

## Guard 모듈

아키텍처 규칙 검사 및 자동 수정.

```typescript
import {
  runGuardCheck,
  runAutoCorrect,
  GuardResult,
  GuardViolation
} from "@mandujs/core";

// 검사 실행
const result: GuardResult = await runGuardCheck(manifest, "./");

if (!result.passed) {
  result.violations.forEach((v: GuardViolation) => {
    console.log(`${v.rule}: ${v.message}`);
  });

  // 자동 수정 실행
  const corrected = await runAutoCorrect(result.violations, manifest, "./");
  console.log("수정됨:", corrected.steps);
  console.log("남은 위반:", corrected.remainingViolations);
}
```

### Guard 규칙

| 규칙 ID | 설명 | 자동 수정 |
|---------|------|----------|
| `SPEC_HASH_MISMATCH` | spec과 lock 해시 불일치 | ✅ |
| `GENERATED_MANUAL_EDIT` | generated 파일 수동 수정 | ✅ |
| `HANDLER_NOT_FOUND` | 핸들러 파일 없음 | ❌ |
| `COMPONENT_NOT_FOUND` | 컴포넌트 파일 없음 | ❌ |
| `SLOT_NOT_FOUND` | slot 파일 없음 | ✅ |

## Content Layer 🆕

Astro에서 영감받은 빌드 타임 콘텐츠 로딩 시스템.

```typescript
// content.config.ts
import { defineContentConfig, glob, file, api } from "@mandujs/core/content";
import { z } from "zod";

const postSchema = z.object({
  title: z.string(),
  date: z.coerce.date(),
  tags: z.array(z.string()).default([]),
});

export default defineContentConfig({
  collections: {
    // Markdown 파일 (프론트매터 지원)
    posts: {
      loader: glob({ pattern: "content/posts/**/*.md" }),
      schema: postSchema,
    },
    // 단일 JSON/YAML 파일
    settings: {
      loader: file({ path: "data/settings.json" }),
    },
    // 외부 API
    products: {
      loader: api({
        url: "https://api.example.com/products",
        cacheTTL: 3600,
      }),
    },
  },
});
```

### 콘텐츠 조회

```typescript
import { getCollection, getEntry } from "@mandujs/core/content";

// 전체 컬렉션 조회
const posts = await getCollection("posts");

// 단일 엔트리 조회
const post = await getEntry("posts", "hello-world");
console.log(post?.data.title, post?.body);
```

### 내장 로더

| 로더 | 설명 | 예시 |
|------|------|------|
| `file()` | 단일 파일 (JSON, YAML, TOML) | `file({ path: "data/config.json" })` |
| `glob()` | 패턴 매칭 (Markdown, JSON) | `glob({ pattern: "content/**/*.md" })` |
| `api()` | HTTP API (캐싱 지원) | `api({ url: "https://...", cacheTTL: 3600 })` |

### 주요 기능

- **Digest 기반 캐싱**: 변경된 파일만 재파싱
- **Zod 검증**: 스키마 기반 타입 안전 콘텐츠
- **프론트매터 지원**: Markdown YAML 프론트매터
- **Dev 모드 감시**: 콘텐츠 변경 시 자동 리로드

---

## Contract 모듈

Zod 기반 계약(Contract) 정의 및 타입 안전 클라이언트 생성.

```typescript
import { Mandu } from "@mandujs/core";
import { z } from "zod";

const userContract = Mandu.contract({
  request: {
    GET: { query: z.object({ id: z.string() }) },
    POST: { body: z.object({ name: z.string() }) },
  },
  response: {
    200: z.object({ data: z.any() }),
    400: z.object({ error: z.string() }),
  },
});

// 클라이언트에 노출할 스키마만 선택
const clientContract = Mandu.clientContract(userContract, {
  request: { POST: { body: true } },
  response: [200],
  includeErrors: true,
});
```

## Runtime 모듈

서버 시작 및 라우팅.

```typescript
import {
  startServer,
  registerApiHandler,
  registerPageLoader
} from "@mandujs/core";

// API 핸들러 등록
registerApiHandler("getUsers", async (req) => {
  return { users: [] };
});

// 페이지 로더 등록
registerPageLoader("homePage", () => import("./pages/Home"));

// 서버 시작
const server = startServer(manifest, { port: 3000 });

// 종료
server.stop();
```

## Report 모듈

Guard 결과 리포트 생성.

```typescript
import { buildGuardReport } from "@mandujs/core";

const report = buildGuardReport(guardResult, lockPath);
console.log(report);  // 포맷된 텍스트 리포트
```

## 타입

```typescript
import type {
  RoutesManifest,
  RouteSpec,
  RouteKind,
  SpecLock,
  GuardResult,
  GuardViolation,
  GenerateResult,
  AutoCorrectResult,
  // Content Layer
  DataEntry,
  ContentConfig,
  CollectionConfig,
  Loader,
} from "@mandujs/core";
```

## 요구 사항

- Bun >= 1.0.0
- React >= 19.0.0
- Zod >= 3.0.0

## 관련 패키지

- [@mandujs/cli](https://www.npmjs.com/package/@mandujs/cli) - CLI 도구

## 라이선스

MIT
