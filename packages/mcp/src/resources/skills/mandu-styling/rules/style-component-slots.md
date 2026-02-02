---
title: Slot-based Style Customization
impact: HIGH
impactDescription: Flexible style overrides for reusable components
tags: styling, slots, customization, override
---

## Slot-based Style Customization

**Impact: HIGH (Flexible style overrides for reusable components)**

컴포넌트의 특정 부분만 스타일을 오버라이드할 수 있는 slot 패턴입니다.

## classNames prop 패턴

```tsx
// app/input/client.tsx
"use client";

import { cn } from "@/lib/utils";

interface InputClassNames {
  root?: string;
  label?: string;
  input?: string;
  helper?: string;
  error?: string;
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
  classNames?: InputClassNames;
}

export function InputIsland({
  label,
  helper,
  error,
  classNames,
  className,
  ...props
}: InputProps) {
  return (
    <div className={cn("space-y-2", classNames?.root)}>
      {label && (
        <label
          className={cn(
            "text-sm font-medium leading-none",
            classNames?.label
          )}
        >
          {label}
        </label>
      )}

      <input
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          error && "border-destructive focus-visible:ring-destructive",
          classNames?.input,
          className
        )}
        {...props}
      />

      {helper && !error && (
        <p className={cn("text-sm text-muted-foreground", classNames?.helper)}>
          {helper}
        </p>
      )}

      {error && (
        <p className={cn("text-sm text-destructive", classNames?.error)}>
          {error}
        </p>
      )}
    </div>
  );
}
```

## 사용 예시

```tsx
<InputIsland
  label="Email"
  placeholder="you@example.com"
  classNames={{
    root: "max-w-md",
    label: "text-blue-600",
    input: "border-2",
    helper: "italic",
  }}
/>
```

## styles prop 패턴

```tsx
// app/card/client.tsx
"use client";

interface CardStyles {
  root?: React.CSSProperties;
  header?: React.CSSProperties;
  content?: React.CSSProperties;
  footer?: React.CSSProperties;
}

interface CardProps {
  styles?: CardStyles;
  // ...
}

export function CardIsland({ styles, children }: CardProps) {
  return (
    <div className="rounded-lg border" style={styles?.root}>
      {children}
    </div>
  );
}
```

## slotProps 패턴 (고급)

```tsx
// app/modal/client.tsx
"use client";

interface SlotProps<T extends React.ElementType = "div"> {
  component?: T;
  className?: string;
  style?: React.CSSProperties;
}

interface ModalSlotProps {
  root?: SlotProps;
  overlay?: SlotProps;
  content?: SlotProps<"div" | "form">;
  header?: SlotProps;
  body?: SlotProps;
  footer?: SlotProps;
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  slotProps?: ModalSlotProps;
  children: React.ReactNode;
}

export function ModalIsland({ open, onClose, slotProps, children }: ModalProps) {
  if (!open) return null;

  const OverlayComponent = slotProps?.overlay?.component || "div";
  const ContentComponent = slotProps?.content?.component || "div";

  return (
    <div
      className={cn("fixed inset-0 z-50", slotProps?.root?.className)}
      style={slotProps?.root?.style}
    >
      <OverlayComponent
        className={cn(
          "fixed inset-0 bg-black/50",
          slotProps?.overlay?.className
        )}
        style={slotProps?.overlay?.style}
        onClick={onClose}
      />

      <ContentComponent
        className={cn(
          "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
          "w-full max-w-lg rounded-lg bg-background p-6 shadow-lg",
          slotProps?.content?.className
        )}
        style={slotProps?.content?.style}
      >
        {children}
      </ContentComponent>
    </div>
  );
}
```

## 사용 예시 (고급)

```tsx
<ModalIsland
  open={isOpen}
  onClose={() => setIsOpen(false)}
  slotProps={{
    overlay: {
      className: "backdrop-blur-sm",
    },
    content: {
      component: "form",
      className: "max-w-2xl",
      style: { maxHeight: "80vh" },
    },
  }}
>
  <form onSubmit={handleSubmit}>...</form>
</ModalIsland>
```

## Tailwind merge로 안전한 오버라이드

```tsx
// cn 함수가 충돌을 해결
<button
  className={cn(
    "px-4 py-2 bg-blue-500",  // 기본
    className                   // 오버라이드: "px-6" → px-6 적용
  )}
/>
```

## 우선순위 명확화

```tsx
// 1. 기본 스타일 (lowest)
// 2. variant 스타일
// 3. classNames prop
// 4. className prop (highest)

export function Button({
  variant,
  classNames,
  className,
  ...props
}) {
  return (
    <button
      className={cn(
        // 1. Base
        "inline-flex items-center",
        // 2. Variant
        buttonVariants({ variant }),
        // 3. classNames slot
        classNames?.button,
        // 4. className (최우선)
        className
      )}
      {...props}
    />
  );
}
```

Reference: [Material UI sx prop](https://mui.com/system/getting-started/the-sx-prop/)
