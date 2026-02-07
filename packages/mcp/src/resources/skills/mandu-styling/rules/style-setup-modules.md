---
title: CSS Modules Setup
impact: CRITICAL
impactDescription: Zero-dependency styling with native Bun support
tags: styling, css-modules, setup, native
---

## CSS Modules Setup

**Impact: CRITICAL (Zero-dependency styling with native Bun support)**

외부 의존성 없이 스코프된 CSS가 필요할 때 CSS Modules를 사용하세요.

**Bun 설정:**

Bun은 CSS Modules를 네이티브로 지원합니다. 별도 설정 불필요.

```typescript
// bunfig.toml (선택적 최적화)
[build]
target = "browser"
minify = true

[build.loader]
".module.css" = "css"
```

## 사용 예시

```css
/* app/button/button.module.css */
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  font-weight: 500;
  transition: all 0.2s;
}

.default {
  background-color: var(--mandu-primary);
  color: white;
}

.default:hover {
  background-color: var(--mandu-primary-dark);
}

.outline {
  border: 1px solid var(--mandu-primary);
  color: var(--mandu-primary);
}

.outline:hover {
  background-color: var(--mandu-primary-light);
}

.sm { height: 2rem; padding: 0 0.75rem; font-size: 0.875rem; }
.md { height: 2.5rem; padding: 0 1rem; }
.lg { height: 3rem; padding: 0 1.5rem; font-size: 1.125rem; }
```

```tsx
// app/button/client.tsx
"use client";

import styles from "./button.module.css";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline";
  size?: "sm" | "md" | "lg";
}

export function ButtonIsland({
  variant = "default",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    className,
  ].filter(Boolean).join(" ");

  return <button className={classes} {...props} />;
}
```

## CSS Variables 활용

```css
/* app/globals.css */
:root {
  --mandu-primary: #3b82f6;
  --mandu-primary-dark: #2563eb;
  --mandu-primary-light: rgba(59, 130, 246, 0.1);
  --mandu-secondary: #64748b;
  --mandu-radius: 0.5rem;
}

.dark {
  --mandu-primary: #60a5fa;
  --mandu-primary-dark: #3b82f6;
  --mandu-background: #0f172a;
  --mandu-foreground: #f8fafc;
}
```

## clsx 조합

```bash
bun add clsx
```

```tsx
import clsx from "clsx";
import styles from "./card.module.css";

export function CardIsland({ highlighted }: { highlighted?: boolean }) {
  return (
    <div
      className={clsx(styles.card, {
        [styles.highlighted]: highlighted,
      })}
    >
      Content
    </div>
  );
}
```

## TypeScript 타입 정의

```typescript
// types/css.d.ts
declare module "*.module.css" {
  const classes: { [key: string]: string };
  export default classes;
}
```

## 장단점

**장점:**
- 의존성 없음 (Bun 네이티브)
- 스코프 자동 격리
- 작은 번들 크기

**단점:**
- 유틸리티 클래스 없음
- 반복 코드 발생 가능
- Tailwind 생태계 미호환

**추천 사용 케이스:**
- 최소 의존성 프로젝트
- 레거시 CSS 마이그레이션
- 특정 컴포넌트 격리

Reference: [Bun CSS Support](https://bun.sh/docs/bundler/loaders#css)
