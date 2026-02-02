---
title: Tailwind CSS Setup
impact: CRITICAL
impactDescription: Primary CSS framework for Mandu applications
tags: styling, tailwind, setup, postcss
---

## Tailwind CSS Setup

**Impact: CRITICAL (Primary CSS framework for Mandu applications)**

Tailwind CSS를 Mandu 프로젝트에 설정하세요. Bun과 PostCSS 통합을 포함합니다.

**설치:**

```bash
bun add -d tailwindcss postcss autoprefixer
bun add clsx tailwind-merge
bunx tailwindcss init -p
```

**tailwind.config.ts:**

```typescript
import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        mandu: {
          primary: "hsl(var(--mandu-primary))",
          secondary: "hsl(var(--mandu-secondary))",
          accent: "hsl(var(--mandu-accent))",
          background: "hsl(var(--mandu-background))",
          foreground: "hsl(var(--mandu-foreground))",
        },
      },
      borderRadius: {
        mandu: "var(--mandu-radius)",
      },
    },
  },
  plugins: [],
} satisfies Config;
```

**postcss.config.js:**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

**app/globals.css:**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --mandu-primary: 221.2 83.2% 53.3%;
    --mandu-secondary: 210 40% 96.1%;
    --mandu-accent: 210 40% 96.1%;
    --mandu-background: 0 0% 100%;
    --mandu-foreground: 222.2 84% 4.9%;
    --mandu-radius: 0.5rem;
  }

  .dark {
    --mandu-primary: 217.2 91.2% 59.8%;
    --mandu-secondary: 217.2 32.6% 17.5%;
    --mandu-accent: 217.2 32.6% 17.5%;
    --mandu-background: 222.2 84% 4.9%;
    --mandu-foreground: 210 40% 98%;
  }
}
```

## cn 유틸리티 함수

```typescript
// lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

## 사용 예시

```tsx
// app/button/client.tsx
"use client";

import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
}

export function ButtonIsland({
  variant = "default",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        // Base
        "inline-flex items-center justify-center rounded-mandu font-medium transition-colors",
        // Variants
        {
          default: "bg-mandu-primary text-white hover:bg-mandu-primary/90",
          outline: "border border-mandu-primary text-mandu-primary hover:bg-mandu-primary/10",
          ghost: "hover:bg-mandu-secondary",
        }[variant],
        // Sizes
        {
          sm: "h-8 px-3 text-sm",
          md: "h-10 px-4",
          lg: "h-12 px-6 text-lg",
        }[size],
        className
      )}
      {...props}
    />
  );
}
```

## VSCode 설정

```json
// .vscode/settings.json
{
  "tailwindCSS.experimental.classRegex": [
    ["cn\\(([^)]*)\\)", "'([^']*)'"]
  ],
  "editor.quickSuggestions": {
    "strings": true
  }
}
```

Reference: [Tailwind CSS Documentation](https://tailwindcss.com/docs)
