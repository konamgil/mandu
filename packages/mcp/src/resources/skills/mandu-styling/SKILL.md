---
name: Mandu Styling
description: CSS framework integration and Island styling patterns
metadata:
  version: "1.0.0"
  author: mandu
globs:
  - "tailwind.config.{js,ts}"
  - "panda.config.{js,ts}"
  - "postcss.config.{js,ts}"
  - "**/*.css"
  - "**/*.module.css"
---

# Mandu Styling Skill

Mandu Island 아키텍처에 최적화된 CSS 스타일링 가이드입니다.

## 핵심 원칙

1. **Zero-Runtime**: 빌드 타임 CSS 생성 (SSR 호환)
2. **Island 격리**: 컴포넌트 간 스타일 충돌 방지
3. **Composition**: Tailwind utility + 컴포넌트 패턴
4. **Performance**: Critical CSS, Tree-shaking

## 권장 스택

```
Primary:   Tailwind CSS + clsx/tailwind-merge
Alternative: Panda CSS (type-safe 선호 시)
Fallback:  CSS Modules (최소 의존성)
```

## 빠른 시작

### Tailwind CSS 설정

```bash
bun add -d tailwindcss postcss autoprefixer
bunx tailwindcss init -p
```

```typescript
// tailwind.config.ts
import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        mandu: {
          primary: "#3b82f6",
          secondary: "#64748b",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
```

```css
/* app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### Island 스타일링

```tsx
// app/counter/client.tsx
"use client";

import { cn } from "@/lib/utils";

interface CounterProps {
  variant?: "default" | "outline";
}

export function CounterIsland({ variant = "default" }: CounterProps) {
  const variants = {
    default: "bg-mandu-primary text-white",
    outline: "border-2 border-mandu-primary text-mandu-primary",
  };

  return (
    <button className={cn("px-4 py-2 rounded-lg", variants[variant])}>
      Count: 0
    </button>
  );
}
```

## cn 유틸리티

```typescript
// lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

## 규칙 카테고리

| Category | Description | Rules |
|----------|-------------|-------|
| Setup | 프레임워크 설정 | 3 |
| Island | Island 스타일 패턴 | 3 |
| Component | 컴포넌트 스타일 | 3 |
| Performance | 최적화 | 2 |
| Theme | 테마/다크모드 | 1 |

→ 세부 규칙은 `rules/` 폴더 참조
