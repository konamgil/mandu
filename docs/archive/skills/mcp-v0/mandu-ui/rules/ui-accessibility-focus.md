---
title: Focus Management
impact: HIGH
impactDescription: Keyboard navigation and focus handling
tags: ui, accessibility, focus, keyboard
---

## Focus Management

**Impact: HIGH (Keyboard navigation and focus handling)**

키보드 사용자를 위한 포커스 관리와 네비게이션을 구현하세요.

## Focus Visible 스타일

```css
/* globals.css */
@layer base {
  /* 키보드 포커스만 표시 (마우스 클릭은 제외) */
  *:focus {
    outline: none;
  }

  *:focus-visible {
    @apply outline-2 outline-offset-2 outline-ring;
  }

  /* 커스텀 focus ring */
  .focus-ring {
    @apply focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2;
  }
}
```

## Tailwind Focus 유틸리티

```tsx
<button
  className={cn(
    "rounded-md px-4 py-2",
    // focus-visible만 스타일링 (키보드 포커스)
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  )}
>
  Click me
</button>
```

## Focus Trap

```bash
bun add focus-trap-react
```

```tsx
// app/modal/client.tsx
"use client";

import FocusTrap from "focus-trap-react";
import { useEffect, useRef } from "react";

export function ModalIsland({ open, onClose, children }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // ESC로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, onClose]);

  if (!open) return null;

  return (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: () => closeButtonRef.current,
        allowOutsideClick: true,
      }}
    >
      <div className="fixed inset-0 z-50">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        <div
          role="dialog"
          aria-modal="true"
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg"
        >
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="absolute top-4 right-4"
          >
            Close
          </button>
          {children}
        </div>
      </div>
    </FocusTrap>
  );
}
```

## Roving Focus

```tsx
// app/toolbar/client.tsx
"use client";

import { useState, useRef, KeyboardEvent } from "react";

export function ToolbarIsland() {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const items = ["Bold", "Italic", "Underline"];

  const handleKeyDown = (e: KeyboardEvent, index: number) => {
    let newIndex = index;

    switch (e.key) {
      case "ArrowRight":
        newIndex = (index + 1) % items.length;
        break;
      case "ArrowLeft":
        newIndex = (index - 1 + items.length) % items.length;
        break;
      case "Home":
        newIndex = 0;
        break;
      case "End":
        newIndex = items.length - 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    setFocusedIndex(newIndex);
    buttonsRef.current[newIndex]?.focus();
  };

  return (
    <div role="toolbar" aria-label="Text formatting">
      {items.map((item, index) => (
        <button
          key={item}
          ref={(el) => (buttonsRef.current[index] = el)}
          tabIndex={focusedIndex === index ? 0 : -1}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onFocus={() => setFocusedIndex(index)}
          className="px-3 py-1 rounded hover:bg-gray-100 focus-visible:ring-2"
        >
          {item}
        </button>
      ))}
    </div>
  );
}
```

## Skip Link

```tsx
// app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {/* 첫 번째 요소로 Skip Link */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:rounded-md focus:shadow-lg"
        >
          Skip to main content
        </a>

        <header>{/* ... */}</header>

        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}
```

## 포커스 복원

```tsx
// hooks/useFocusReturn.ts
import { useRef, useEffect } from "react";

export function useFocusReturn(isOpen: boolean) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // 열릴 때 현재 포커스 저장
      previousFocusRef.current = document.activeElement as HTMLElement;
    } else if (previousFocusRef.current) {
      // 닫힐 때 포커스 복원
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);
}

// 사용
export function DialogIsland({ open, onClose }) {
  useFocusReturn(open);

  // ...
}
```

## Tab Order 관리

```tsx
// 올바른 tabIndex 사용
<div>
  {/* tabIndex="0": 자연스러운 탭 순서에 포함 */}
  <div tabIndex={0} role="button">Focusable div</div>

  {/* tabIndex="-1": 프로그래밍으로만 포커스 가능 */}
  <div tabIndex={-1} ref={focusTargetRef}>Focus target</div>

  {/* 양수 tabIndex는 피하기 */}
  {/* ❌ tabIndex={1} - 탭 순서 혼란 */}
</div>
```

Reference: [WAI-ARIA Focus Management](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
