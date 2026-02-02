---
title: Island Style Scoping
impact: HIGH
impactDescription: Prevents style conflicts between independent Islands
tags: styling, island, scoping, isolation
---

## Island Style Scoping

**Impact: HIGH (Prevents style conflicts between independent Islands)**

Island는 독립적으로 hydrate되므로 스타일 충돌을 방지해야 합니다.

**문제 상황:**

```tsx
// ❌ 전역 클래스 충돌 가능
<div className="card">...</div>  // Island A
<div className="card">...</div>  // Island B - 다른 스타일 의도
```

## 해결 방법 1: data-island 속성

```tsx
// app/counter/client.tsx
"use client";

export function CounterIsland() {
  return (
    <div
      data-island="counter"
      className="p-4 rounded-lg bg-blue-500"
    >
      <button className="[&[data-island=counter]_&]:text-white">
        Count
      </button>
    </div>
  );
}
```

```css
/* Tailwind 커스텀 variant */
[data-island="counter"] {
  /* Island 특화 스타일 */
}
```

## 해결 방법 2: CSS Modules (권장)

```tsx
// app/counter/client.tsx
"use client";

import styles from "./counter.module.css";

export function CounterIsland() {
  return (
    <div className={styles.container}>
      <button className={styles.button}>Count</button>
    </div>
  );
}
```

```css
/* app/counter/counter.module.css */
.container {
  @apply p-4 rounded-lg bg-blue-500;
}

.button {
  @apply text-white font-medium;
}
```

## 해결 방법 3: Tailwind Prefix

```typescript
// tailwind.config.ts
export default {
  prefix: "",  // 전역은 prefix 없음
  // 또는 Island별 prefix
};
```

```tsx
// 컴포넌트별 네임스페이스
const ns = "counter";

export function CounterIsland() {
  return (
    <div className={`${ns}-container p-4`}>
      <button className={`${ns}-btn`}>Count</button>
    </div>
  );
}
```

## 해결 방법 4: CSS Layers

```css
/* app/globals.css */
@layer components {
  .island-counter {
    @apply p-4 rounded-lg;
  }
}

@layer islands.counter {
  .container {
    @apply bg-blue-500;
  }
}

@layer islands.form {
  .container {
    @apply bg-green-500;
  }
}
```

## Best Practice: Compound + Module 조합

```tsx
// app/card/client.tsx
"use client";

import { cn } from "@/lib/utils";
import styles from "./card.module.css";

export const Card = {
  Root: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn(styles.root, className)} {...props} />
  ),
  Header: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn(styles.header, className)} {...props} />
  ),
  Content: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn(styles.content, className)} {...props} />
  ),
};
```

```css
/* app/card/card.module.css */
.root {
  @apply rounded-lg border bg-white shadow-sm;
}

.header {
  @apply px-6 py-4 border-b;
}

.content {
  @apply px-6 py-4;
}
```

## 스타일 충돌 체크리스트

- [ ] 전역 클래스명 사용 금지 (`.card`, `.button` 등)
- [ ] CSS Modules 또는 data-island 속성 사용
- [ ] cn() 함수로 클래스 병합 시 순서 주의
- [ ] 다크모드 변수는 :root에 정의

Reference: [Tailwind CSS Scoping](https://tailwindcss.com/docs/adding-custom-styles)
