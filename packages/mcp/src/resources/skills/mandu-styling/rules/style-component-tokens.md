---
title: Design Tokens
impact: HIGH
impactDescription: Consistent design system foundation
tags: styling, tokens, design-system, variables
---

## Design Tokens

**Impact: HIGH (Consistent design system foundation)**

디자인 토큰을 사용하여 일관된 스타일 시스템을 구축하세요.

## CSS Variables 기반 토큰

```css
/* app/globals.css */
@layer base {
  :root {
    /* Colors - HSL format for opacity support */
    --mandu-background: 0 0% 100%;
    --mandu-foreground: 222.2 84% 4.9%;

    --mandu-card: 0 0% 100%;
    --mandu-card-foreground: 222.2 84% 4.9%;

    --mandu-primary: 221.2 83.2% 53.3%;
    --mandu-primary-foreground: 210 40% 98%;

    --mandu-secondary: 210 40% 96.1%;
    --mandu-secondary-foreground: 222.2 47.4% 11.2%;

    --mandu-muted: 210 40% 96.1%;
    --mandu-muted-foreground: 215.4 16.3% 46.9%;

    --mandu-accent: 210 40% 96.1%;
    --mandu-accent-foreground: 222.2 47.4% 11.2%;

    --mandu-destructive: 0 84.2% 60.2%;
    --mandu-destructive-foreground: 210 40% 98%;

    --mandu-border: 214.3 31.8% 91.4%;
    --mandu-input: 214.3 31.8% 91.4%;
    --mandu-ring: 221.2 83.2% 53.3%;

    /* Spacing */
    --mandu-spacing-xs: 0.25rem;
    --mandu-spacing-sm: 0.5rem;
    --mandu-spacing-md: 1rem;
    --mandu-spacing-lg: 1.5rem;
    --mandu-spacing-xl: 2rem;

    /* Typography */
    --mandu-font-sans: ui-sans-serif, system-ui, sans-serif;
    --mandu-font-mono: ui-monospace, monospace;

    --mandu-text-xs: 0.75rem;
    --mandu-text-sm: 0.875rem;
    --mandu-text-base: 1rem;
    --mandu-text-lg: 1.125rem;
    --mandu-text-xl: 1.25rem;

    /* Borders */
    --mandu-radius-sm: 0.25rem;
    --mandu-radius-md: 0.5rem;
    --mandu-radius-lg: 0.75rem;
    --mandu-radius-full: 9999px;

    /* Shadows */
    --mandu-shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
    --mandu-shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
    --mandu-shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);

    /* Transitions */
    --mandu-transition-fast: 150ms;
    --mandu-transition-normal: 200ms;
    --mandu-transition-slow: 300ms;
  }

  .dark {
    --mandu-background: 222.2 84% 4.9%;
    --mandu-foreground: 210 40% 98%;

    --mandu-card: 222.2 84% 4.9%;
    --mandu-card-foreground: 210 40% 98%;

    --mandu-primary: 217.2 91.2% 59.8%;
    --mandu-primary-foreground: 222.2 47.4% 11.2%;

    --mandu-secondary: 217.2 32.6% 17.5%;
    --mandu-secondary-foreground: 210 40% 98%;

    --mandu-muted: 217.2 32.6% 17.5%;
    --mandu-muted-foreground: 215 20.2% 65.1%;

    --mandu-accent: 217.2 32.6% 17.5%;
    --mandu-accent-foreground: 210 40% 98%;

    --mandu-destructive: 0 62.8% 30.6%;
    --mandu-destructive-foreground: 210 40% 98%;

    --mandu-border: 217.2 32.6% 17.5%;
    --mandu-input: 217.2 32.6% 17.5%;
    --mandu-ring: 224.3 76.3% 48%;
  }
}
```

## Tailwind 토큰 연결

```typescript
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--mandu-background))",
        foreground: "hsl(var(--mandu-foreground))",
        card: {
          DEFAULT: "hsl(var(--mandu-card))",
          foreground: "hsl(var(--mandu-card-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--mandu-primary))",
          foreground: "hsl(var(--mandu-primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--mandu-secondary))",
          foreground: "hsl(var(--mandu-secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--mandu-muted))",
          foreground: "hsl(var(--mandu-muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--mandu-accent))",
          foreground: "hsl(var(--mandu-accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--mandu-destructive))",
          foreground: "hsl(var(--mandu-destructive-foreground))",
        },
        border: "hsl(var(--mandu-border))",
        input: "hsl(var(--mandu-input))",
        ring: "hsl(var(--mandu-ring))",
      },
      borderRadius: {
        sm: "var(--mandu-radius-sm)",
        md: "var(--mandu-radius-md)",
        lg: "var(--mandu-radius-lg)",
      },
      fontFamily: {
        sans: ["var(--mandu-font-sans)"],
        mono: ["var(--mandu-font-mono)"],
      },
    },
  },
};
```

## 토큰 사용 예시

```tsx
// 자동으로 다크모드 지원
<div className="bg-background text-foreground">
  <button className="bg-primary text-primary-foreground rounded-md">
    Button
  </button>
</div>

// HSL로 opacity 조절 가능
<div className="bg-primary/50">
  50% opacity primary
</div>
```

## 토큰 타입 정의 (TypeScript)

```typescript
// types/tokens.ts
export interface DesignTokens {
  colors: {
    background: string;
    foreground: string;
    primary: string;
    secondary: string;
    // ...
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  radii: {
    sm: string;
    md: string;
    lg: string;
    full: string;
  };
}
```

Reference: [Design Tokens W3C](https://www.w3.org/community/design-tokens/)
