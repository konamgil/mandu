---
title: Build Output Configuration
impact: HIGH
impactDescription: Affects bundle size and load performance
tags: deployment, build, output, optimization
---

## Build Output Configuration

**Impact: HIGH (Affects bundle size and load performance)**

빌드 출력을 최적화하여 번들 크기를 줄이고 로딩 성능을 개선하세요.

**디렉토리 구조:**

```
dist/
├── server.js          # 서버 엔트리포인트
├── public/
│   ├── islands/       # Island 컴포넌트 청크
│   │   ├── counter-abc123.js
│   │   └── form-def456.js
│   ├── shared/        # 공유 청크
│   │   └── react-vendor-xyz789.js
│   └── assets/        # 정적 자산
│       ├── styles.css
│       └── images/
└── server.js.map      # 소스맵 (프로덕션 디버깅용)
```

**청크 분할 설정:**

```typescript
// scripts/build.ts
await Bun.build({
  entrypoints: ["./app/**/client.tsx"],
  outdir: "./dist/public/islands",
  target: "browser",
  splitting: true,        // 공유 코드 자동 분리
  minify: true,
  naming: {
    chunk: "[name]-[hash].js",
    entry: "[name]-[hash].js",
    asset: "[name]-[hash][ext]",
  },
});
```

## 정적 자산 처리

```typescript
// 정적 파일 복사
import { $ } from "bun";

// public 폴더 복사
await $`cp -r public/* dist/public/`;

// CSS 최적화 (optional)
await $`bunx lightningcss --minify public/styles.css -o dist/public/styles.css`;
```

## Gzip/Brotli 압축

```typescript
// 프로덕션 서버에서 압축
import { gzipSync } from "bun";

// 또는 빌드 시 사전 압축
import { $ } from "bun";

const files = await Array.fromAsync(
  new Bun.Glob("dist/public/**/*.{js,css}").scan()
);

for (const file of files) {
  const content = await Bun.file(file).arrayBuffer();
  await Bun.write(`${file}.gz`, gzipSync(new Uint8Array(content)));
}
```

## 빌드 매니페스트

```typescript
// 빌드 후 매니페스트 생성
const manifest = {
  version: process.env.BUILD_VERSION || Date.now().toString(),
  files: {},
};

const files = await Array.fromAsync(
  new Bun.Glob("dist/public/**/*").scan()
);

for (const file of files) {
  const hash = Bun.hash(await Bun.file(file).arrayBuffer());
  manifest.files[file] = hash.toString(16);
}

await Bun.write("dist/manifest.json", JSON.stringify(manifest, null, 2));
```

## 번들 크기 모니터링

```bash
# 번들 크기 리포트
bun run scripts/bundle-size.ts

# CI에서 크기 제한 체크
if [ $(du -sb dist/public | cut -f1) -gt 1048576 ]; then
  echo "Bundle size exceeds 1MB limit"
  exit 1
fi
```

Reference: [Bun Build Naming](https://bun.sh/docs/bundler#naming)
