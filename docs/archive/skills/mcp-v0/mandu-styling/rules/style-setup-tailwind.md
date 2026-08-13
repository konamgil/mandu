---
title: Tailwind CSS v4 Setup
impact: CRITICAL
impactDescription: Primary CSS framework for Mandu applications (v4 required)
tags: styling, tailwind, setup, v4, css-first
---

## Tailwind CSS v4 Setup

**Impact: CRITICAL (Primary CSS framework for Mandu applications)**

Tailwind CSS v4를 Mandu 프로젝트에 설정합니다. v4는 Oxide Engine(Rust)으로 재작성되어 빌드 속도가 3.5~5배 향상되었습니다.

## 설치

```bash
bun add -d tailwindcss@^4.1 @tailwindcss/cli@^4.1
bun add clsx tailwind-merge
```

> **Note:** PostCSS, autoprefixer는 불필요합니다. Tailwind v4가 내장 처리합니다.

## app/globals.css (CSS-first Configuration)

```css
@import "tailwindcss";

/*
 * Tailwind CSS v4 - CSS-first Configuration
 * JavaScript 설정 파일 대신 CSS에서 직접 테마 정의
 */

@theme {
  /* Colors - shadcn/ui compatible */
  --color-background: hsl(0 0% 100%);
  --color-foreground: hsl(222.2 84% 4.9%);
  --color-card: hsl(0 0% 100%);
  --color-card-foreground: hsl(222.2 84% 4.9%);
  --color-primary: hsl(222.2 47.4% 11.2%);
  --color-primary-foreground: hsl(210 40% 98%);
  --color-secondary: hsl(210 40% 96.1%);
  --color-secondary-foreground: hsl(222.2 47.4% 11.2%);
  --color-muted: hsl(210 40% 96.1%);
  --color-muted-foreground: hsl(215.4 16.3% 46.9%);
  --color-accent: hsl(210 40% 96.1%);
  --color-accent-foreground: hsl(222.2 47.4% 11.2%);
  --color-destructive: hsl(0 84.2% 60.2%);
  --color-destructive-foreground: hsl(210 40% 98%);
  --color-border: hsl(214.3 31.8% 91.4%);
  --color-input: hsl(214.3 31.8% 91.4%);
  --color-ring: hsl(222.2 84% 4.9%);

  /* Radius */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;

  /* Fonts */
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
}

/* Base styles */
* {
  border-color: var(--color-border);
}

body {
  background-color: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-sans);
}
```

## Mandu 자동 통합

Mandu는 Tailwind v4를 자동으로 감지하고 처리합니다:

```
mandu dev 실행 시:
1. app/globals.css에서 @import "tailwindcss" 감지
2. bunx @tailwindcss/cli --watch 자동 시작
3. 출력: .mandu/client/globals.css
4. SSR에서 <link> 태그 자동 주입
5. CSS 변경 시 HMR 핫 리로드
```

## cn 유틸리티 함수

```typescript
// src/client/shared/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

## Island 컴포넌트 스타일링

```tsx
// src/client/features/counter/CounterIsland.tsx
"use client";

import { cn } from "@/shared/lib/utils";

interface CounterProps {
  variant?: "default" | "outline";
}

export function CounterIsland({ variant = "default" }: CounterProps) {
  const variants = {
    default: "bg-primary text-primary-foreground",
    outline: "border-2 border-primary text-primary",
  };

  return (
    <button className={cn(
      "px-4 py-2 rounded-md transition-colors",
      variants[variant]
    )}>
      Count: 0
    </button>
  );
}
```

## Custom Utilities (v4 방식)

```css
/* @layer utilities 대신 @utility 사용 */
@utility text-balance {
  text-wrap: balance;
}

@utility scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
```

## VSCode 설정

```json
// .vscode/settings.json
{
  "tailwindCSS.experimental.classRegex": [
    ["cn\\(([^)]*)\\)", "'([^']*)'"],
    ["cva\\(([^)]*)\\)", "[\"'`]([^\"'`]*).*?[\"'`]"]
  ],
  "editor.quickSuggestions": {
    "strings": true
  },
  "files.associations": {
    "*.css": "tailwindcss"
  }
}
```

## 삭제할 파일 (v3에서 마이그레이션 시)

```bash
rm -f tailwind.config.ts tailwind.config.js
rm -f postcss.config.js postcss.config.ts
```

Reference: [Tailwind CSS v4 Documentation](https://tailwindcss.com/docs)
