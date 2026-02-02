---
title: Island Animations
impact: HIGH
impactDescription: Client-side animations for interactive Islands
tags: styling, island, animations, transitions
---

## Island Animations

**Impact: HIGH (Client-side animations for interactive Islands)**

Island 컴포넌트에서 부드러운 애니메이션을 구현하세요.

## Tailwind 애니메이션

```typescript
// tailwind.config.ts
export default {
  theme: {
    extend: {
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "fade-out": "fadeOut 0.2s ease-out",
        "slide-in": "slideIn 0.3s ease-out",
        "slide-out": "slideOut 0.3s ease-out",
        "scale-in": "scaleIn 0.2s ease-out",
        "spin-slow": "spin 3s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        fadeOut: {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        slideIn: {
          "0%": { transform: "translateY(-10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        slideOut: {
          "0%": { transform: "translateY(0)", opacity: "1" },
          "100%": { transform: "translateY(-10px)", opacity: "0" },
        },
        scaleIn: {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
    },
  },
};
```

## 조건부 애니메이션

```tsx
// app/dropdown/client.tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function DropdownIsland() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button onClick={() => setIsOpen(!isOpen)}>
        Toggle
      </button>

      <div
        className={cn(
          "absolute top-full mt-2 w-48 rounded-md bg-white shadow-lg",
          "transition-all duration-200",
          isOpen
            ? "animate-fade-in opacity-100 translate-y-0"
            : "opacity-0 -translate-y-2 pointer-events-none"
        )}
      >
        <ul className="py-2">
          <li className="px-4 py-2 hover:bg-gray-100">Option 1</li>
          <li className="px-4 py-2 hover:bg-gray-100">Option 2</li>
        </ul>
      </div>
    </div>
  );
}
```

## CSS Transition 패턴

```tsx
// app/accordion/client.tsx
"use client";

import { useState, useRef, useEffect } from "react";

export function AccordionIsland({ title, children }) {
  const [isOpen, setIsOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setHeight(isOpen ? contentRef.current.scrollHeight : 0);
    }
  }, [isOpen]);

  return (
    <div className="border-b">
      <button
        className="flex w-full items-center justify-between py-4"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{title}</span>
        <span
          className={cn(
            "transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        >
          ▼
        </span>
      </button>

      <div
        style={{ height }}
        className="overflow-hidden transition-[height] duration-200 ease-out"
      >
        <div ref={contentRef} className="pb-4">
          {children}
        </div>
      </div>
    </div>
  );
}
```

## Loading States

```tsx
// app/button/client.tsx
"use client";

export function LoadingButtonIsland({ loading, children, ...props }) {
  return (
    <button
      disabled={loading}
      className={cn(
        "relative inline-flex items-center justify-center",
        loading && "cursor-wait"
      )}
      {...props}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <svg
            className="h-5 w-5 animate-spin text-current"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </span>
      )}
      <span className={cn(loading && "invisible")}>{children}</span>
    </button>
  );
}
```

## Skeleton Loading

```tsx
// components/skeleton.tsx
export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-gray-200 dark:bg-gray-700",
        className
      )}
      {...props}
    />
  );
}

// 사용
<div className="space-y-2">
  <Skeleton className="h-4 w-3/4" />
  <Skeleton className="h-4 w-1/2" />
</div>
```

## Page Transitions (View Transitions API)

```tsx
// app/layout.tsx
export default function Layout({ children }) {
  return (
    <html>
      <body>
        <div className="[view-transition-name:main]">
          {children}
        </div>
      </body>
    </html>
  );
}
```

```css
/* globals.css */
@media (prefers-reduced-motion: no-preference) {
  ::view-transition-old(main),
  ::view-transition-new(main) {
    animation-duration: 0.3s;
  }

  ::view-transition-old(main) {
    animation-name: fadeOut;
  }

  ::view-transition-new(main) {
    animation-name: fadeIn;
  }
}
```

## 접근성: Reduced Motion

```tsx
// hooks/useReducedMotion.ts
export function useReducedMotion() {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(mq.matches);

    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return prefersReduced;
}

// 사용
const reducedMotion = useReducedMotion();

<div className={cn(
  !reducedMotion && "animate-fade-in"
)}>
```

Reference: [Tailwind Animation](https://tailwindcss.com/docs/animation)
