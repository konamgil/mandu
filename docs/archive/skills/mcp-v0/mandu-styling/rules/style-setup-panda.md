---
title: Panda CSS Setup
impact: CRITICAL
impactDescription: Type-safe alternative CSS framework
tags: styling, panda, setup, type-safe
---

## Panda CSS Setup

**Impact: CRITICAL (Type-safe alternative CSS framework)**

Type-safe CSS-in-JS가 필요할 때 Panda CSS를 사용하세요. Zero-runtime으로 Island와 완벽 호환됩니다.

**설치:**

```bash
bun add -d @pandacss/dev
bunx panda init
```

**panda.config.ts:**

```typescript
import { defineConfig } from "@pandacss/dev";

export default defineConfig({
  preflight: true,
  include: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  exclude: [],

  theme: {
    extend: {
      tokens: {
        colors: {
          mandu: {
            primary: { value: "#3b82f6" },
            secondary: { value: "#64748b" },
            accent: { value: "#f59e0b" },
          },
        },
        radii: {
          mandu: { value: "0.5rem" },
        },
      },
      semanticTokens: {
        colors: {
          background: {
            value: { base: "{colors.white}", _dark: "{colors.zinc.900}" },
          },
          foreground: {
            value: { base: "{colors.zinc.900}", _dark: "{colors.white}" },
          },
        },
      },
    },
  },

  outdir: "styled-system",
});
```

**package.json 스크립트:**

```json
{
  "scripts": {
    "prepare": "panda codegen",
    "dev": "panda --watch & bun run serve"
  }
}
```

## 사용 예시

```tsx
// app/button/client.tsx
"use client";

import { css, cva } from "@/styled-system/css";

const button = cva({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "mandu",
    fontWeight: "medium",
    transition: "colors",
    cursor: "pointer",
  },
  variants: {
    variant: {
      default: {
        bg: "mandu.primary",
        color: "white",
        _hover: { bg: "mandu.primary/90" },
      },
      outline: {
        border: "1px solid",
        borderColor: "mandu.primary",
        color: "mandu.primary",
        _hover: { bg: "mandu.primary/10" },
      },
      ghost: {
        _hover: { bg: "mandu.secondary/20" },
      },
    },
    size: {
      sm: { h: "8", px: "3", fontSize: "sm" },
      md: { h: "10", px: "4" },
      lg: { h: "12", px: "6", fontSize: "lg" },
    },
  },
  defaultVariants: {
    variant: "default",
    size: "md",
  },
});

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
}

export function ButtonIsland({ variant, size, className, ...props }: ButtonProps) {
  return (
    <button className={button({ variant, size })} {...props} />
  );
}
```

## Inline Styles

```tsx
import { css } from "@/styled-system/css";

export function CardIsland() {
  return (
    <div
      className={css({
        p: "4",
        rounded: "mandu",
        bg: "background",
        shadow: "md",
        _hover: { shadow: "lg" },
      })}
    >
      Content
    </div>
  );
}
```

## Tailwind와의 비교

| 기능 | Tailwind | Panda |
|------|----------|-------|
| Type-safe | ❌ | ✅ |
| Zero-runtime | ✅ | ✅ |
| 생태계 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| DX | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 학습 곡선 | 낮음 | 중간 |

Reference: [Panda CSS Documentation](https://panda-css.com/docs)
