---
title: Critical CSS Extraction
impact: MEDIUM
impactDescription: Improves First Contentful Paint
tags: styling, performance, critical, fcp
---

## Critical CSS Extraction

**Impact: MEDIUM (Improves First Contentful Paint)**

초기 렌더링에 필요한 CSS만 인라인으로 포함하여 FCP를 개선하세요.

## Tailwind의 자동 최적화

Tailwind CSS는 JIT 컴파일로 사용된 클래스만 생성합니다.

```typescript
// tailwind.config.ts
export default {
  content: [
    "./app/**/*.{ts,tsx}",  // 실제 사용되는 파일만 스캔
  ],
  // ...
};
```

## Above-the-fold CSS 분리

```tsx
// app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <html>
      <head>
        {/* Critical CSS: 인라인 */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              /* Above-the-fold 스타일만 */
              body { margin: 0; font-family: system-ui; }
              .header { height: 64px; background: white; }
              .hero { min-height: 50vh; }
            `,
          }}
        />

        {/* Non-critical CSS: 비동기 로드 */}
        <link
          rel="preload"
          href="/styles/main.css"
          as="style"
          onLoad="this.onload=null;this.rel='stylesheet'"
        />
        <noscript>
          <link rel="stylesheet" href="/styles/main.css" />
        </noscript>
      </head>
      <body>{children}</body>
    </html>
  );
}
```

## Lightning CSS 통합

```bash
bun add -d lightningcss
```

```typescript
// scripts/build-css.ts
import { transform, browserslistToTargets } from "lightningcss";
import browserslist from "browserslist";

const targets = browserslistToTargets(browserslist(">= 0.25%"));

const css = await Bun.file("app/globals.css").text();

const { code } = transform({
  filename: "globals.css",
  code: Buffer.from(css),
  minify: true,
  targets,
  // Critical CSS 추출
  analyzeDependencies: true,
});

await Bun.write("dist/styles.css", code);
```

## PostCSS 설정

```javascript
// postcss.config.js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
    ...(process.env.NODE_ENV === "production"
      ? {
          cssnano: {
            preset: [
              "default",
              {
                discardComments: { removeAll: true },
              },
            ],
          },
        }
      : {}),
  },
};
```

## CSS Layer 우선순위

```css
/* globals.css */
@layer reset, base, components, utilities;

/* Critical: reset과 base만 인라인 */
@layer reset {
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
}

@layer base {
  body {
    @apply bg-background text-foreground;
  }
}

/* Non-critical: 별도 파일 */
@layer components {
  /* ... */
}

@layer utilities {
  /* ... */
}
```

## Font 최적화

```tsx
// 폰트 preload로 FOIT/FOUT 방지
<link
  rel="preload"
  href="/fonts/inter-var.woff2"
  as="font"
  type="font/woff2"
  crossOrigin="anonymous"
/>

// 폰트 display 설정
<style>
  {`
    @font-face {
      font-family: 'Inter';
      src: url('/fonts/inter-var.woff2') format('woff2');
      font-display: swap;
    }
  `}
</style>
```

## 성능 측정

```typescript
// 빌드 후 CSS 크기 확인
import { gzipSync } from "bun";

const css = await Bun.file("dist/styles.css").text();
const gzipped = gzipSync(Buffer.from(css));

console.log("CSS size:", css.length, "bytes");
console.log("Gzipped:", gzipped.length, "bytes");

// 목표: < 14KB (TCP 첫 라운드트립)
```

## Inline Critical + Lazy Load 패턴

```tsx
// components/StyleLoader.tsx
"use client";

import { useEffect } from "react";

export function StyleLoader({ href }: { href: string }) {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, [href]);

  return null;
}

// 사용
<StyleLoader href="/styles/non-critical.css" />
```

Reference: [web.dev Critical CSS](https://web.dev/articles/extract-critical-css)
