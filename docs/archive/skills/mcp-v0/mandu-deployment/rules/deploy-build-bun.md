---
title: Bun Production Build
impact: CRITICAL
impactDescription: Build failure blocks deployment
tags: deployment, build, bun, bundler
---

## Bun Production Build

**Impact: CRITICAL (Build failure blocks deployment)**

Bun 번들러를 사용하여 프로덕션 최적화된 빌드를 생성하세요.

**bunfig.toml 설정:**

```toml
[build]
target = "bun"
minify = true
sourcemap = "external"

[build.define]
"process.env.NODE_ENV" = "'production'"
```

**빌드 스크립트:**

```typescript
// scripts/build.ts
import { $ } from "bun";

// 클린 빌드
await $`rm -rf dist`;

// 서버 빌드
await Bun.build({
  entrypoints: ["./src/server.ts"],
  outdir: "./dist",
  target: "bun",
  minify: true,
  sourcemap: "external",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

// 클라이언트 빌드 (Islands)
await Bun.build({
  entrypoints: ["./app/**/client.tsx"],
  outdir: "./dist/public",
  target: "browser",
  minify: true,
  splitting: true,
  sourcemap: "external",
});

console.log("✅ Build complete");
```

## package.json 스크립트

```json
{
  "scripts": {
    "build": "bun run scripts/build.ts",
    "start": "NODE_ENV=production bun run dist/server.js",
    "preview": "bun run build && bun run start"
  }
}
```

## 빌드 최적화 옵션

```typescript
await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",

  // 필수 최적화
  minify: true,           // 코드 압축
  splitting: true,        // 코드 분할

  // 선택적 최적화
  treeshaking: true,      // 미사용 코드 제거 (기본값)

  // 외부 패키지 처리
  external: ["better-sqlite3"],  // 네이티브 모듈 제외

  // 환경 변수 주입
  define: {
    "process.env.API_URL": JSON.stringify(process.env.API_URL),
  },
});
```

## 빌드 검증

```bash
# 빌드 크기 확인
du -sh dist/

# 번들 분석
bun build --analyze ./src/server.ts

# 빌드 테스트
bun run dist/server.js
```

Reference: [Bun Bundler](https://bun.sh/docs/bundler)
