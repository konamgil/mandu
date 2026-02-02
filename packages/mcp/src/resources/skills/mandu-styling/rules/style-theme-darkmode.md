---
title: Dark Mode Implementation
impact: MEDIUM
impactDescription: User preference and accessibility support
tags: styling, theme, darkmode, accessibility
---

## Dark Mode Implementation

**Impact: MEDIUM (User preference and accessibility support)**

다크모드를 구현하여 사용자 선호도와 접근성을 지원하세요.

## CSS Variables 기반 테마

```css
/* app/globals.css */
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --border: 214.3 31.8% 91.4%;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --border: 217.2 32.6% 17.5%;
  }
}
```

## Tailwind dark: 활성화

```typescript
// tailwind.config.ts
export default {
  darkMode: "class",  // 또는 "media"
  // ...
};
```

## 테마 Provider Island

```tsx
// app/theme/client.tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProviderIsland({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    // 저장된 테마 복원
    const stored = localStorage.getItem("theme") as Theme | null;
    if (stored) {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    if (theme === "system") {
      const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setResolvedTheme(systemDark ? "dark" : "light");
      root.classList.toggle("dark", systemDark);
    } else {
      setResolvedTheme(theme);
      root.classList.toggle("dark", theme === "dark");
    }

    localStorage.setItem("theme", theme);
  }, [theme]);

  // System 변경 감지
  useEffect(() => {
    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setResolvedTheme(e.matches ? "dark" : "light");
      document.documentElement.classList.toggle("dark", e.matches);
    };

    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProviderIsland");
  }
  return context;
}
```

## 테마 토글 컴포넌트

```tsx
// app/theme/toggle.tsx
"use client";

import { useTheme } from "./client";

export function ThemeToggleIsland() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  return (
    <button
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="p-2 rounded-md hover:bg-muted"
      aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
    >
      {resolvedTheme === "dark" ? "🌙" : "☀️"}
    </button>
  );
}
```

## 플래시 방지 스크립트

```tsx
// app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 다크모드 플래시 방지 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const theme = localStorage.getItem('theme');
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

                if (theme === 'dark' || (!theme && prefersDark)) {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body>
        <ThemeProviderIsland>
          {children}
        </ThemeProviderIsland>
      </body>
    </html>
  );
}
```

## Island 간 테마 동기화

```tsx
// useIslandEvent로 테마 변경 전파
import { useIslandEvent } from "@mandujs/core/client";

export function ThemeProviderIsland({ children }) {
  const { emit } = useIslandEvent<{ theme: string }>("theme-change");
  const [theme, setTheme] = useState("system");

  const handleSetTheme = (newTheme: Theme) => {
    setTheme(newTheme);
    emit({ theme: newTheme });  // 다른 Island에 전파
  };

  // ...
}

// 다른 Island에서 수신
export function AnotherIsland() {
  useIslandEvent<{ theme: string }>("theme-change", (data) => {
    console.log("Theme changed to:", data.theme);
  });
}
```

## 다크모드 특화 스타일

```tsx
// Tailwind dark: 접두사 사용
<div className="bg-white dark:bg-gray-900">
  <p className="text-gray-900 dark:text-gray-100">
    Content
  </p>
</div>

// 복잡한 경우 CSS Variables 활용
<div className="bg-[hsl(var(--background))]">
  {/* 자동으로 테마 반영 */}
</div>
```

Reference: [Tailwind Dark Mode](https://tailwindcss.com/docs/dark-mode)
