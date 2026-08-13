---
title: Island Style Variants
impact: HIGH
impactDescription: Conditional styling patterns for Island components
tags: styling, island, variants, cva
---

## Island Style Variants

**Impact: HIGH (Conditional styling patterns for Island components)**

Island 컴포넌트의 조건부 스타일링을 체계적으로 관리하세요.

**class-variance-authority (cva) 설치:**

```bash
bun add class-variance-authority
```

## cva 기본 패턴

```tsx
// app/button/client.tsx
"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Base styles
  "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-mandu-primary text-white hover:bg-mandu-primary/90",
        destructive: "bg-red-500 text-white hover:bg-red-500/90",
        outline: "border border-input bg-background hover:bg-accent",
        secondary: "bg-mandu-secondary text-white hover:bg-mandu-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-mandu-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function ButtonIsland({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

// Export for reuse
export { buttonVariants };
```

## 복합 Variants

```tsx
const cardVariants = cva("rounded-lg border", {
  variants: {
    variant: {
      default: "bg-white",
      elevated: "bg-white shadow-lg",
      outlined: "bg-transparent",
    },
    padding: {
      none: "",
      sm: "p-4",
      md: "p-6",
      lg: "p-8",
    },
    interactive: {
      true: "cursor-pointer hover:shadow-md transition-shadow",
      false: "",
    },
  },
  compoundVariants: [
    {
      variant: "elevated",
      interactive: true,
      className: "hover:shadow-xl",
    },
    {
      variant: "outlined",
      interactive: true,
      className: "hover:border-mandu-primary",
    },
  ],
  defaultVariants: {
    variant: "default",
    padding: "md",
    interactive: false,
  },
});
```

## Boolean Variants

```tsx
const inputVariants = cva(
  "flex h-10 w-full rounded-md border px-3 py-2 text-sm",
  {
    variants: {
      hasError: {
        true: "border-red-500 focus:ring-red-500",
        false: "border-gray-300 focus:ring-mandu-primary",
      },
      isDisabled: {
        true: "bg-gray-100 cursor-not-allowed opacity-50",
        false: "bg-white",
      },
    },
    defaultVariants: {
      hasError: false,
      isDisabled: false,
    },
  }
);

export function InputIsland({ error, disabled, ...props }: InputProps) {
  return (
    <input
      className={inputVariants({
        hasError: !!error,
        isDisabled: disabled,
      })}
      disabled={disabled}
      {...props}
    />
  );
}
```

## Responsive Variants

```tsx
// 반응형은 Tailwind 클래스로 처리
export function CardIsland({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        cardVariants({ variant: "default", padding: "md" }),
        // 반응형 오버라이드
        "md:p-8 lg:p-10",
        className
      )}
      {...props}
    />
  );
}
```

## Slot Pattern과 조합

```tsx
// app/alert/client.tsx
"use client";

import { cva } from "class-variance-authority";

const alertVariants = cva(
  "relative w-full rounded-lg border p-4",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        info: "border-blue-200 bg-blue-50 text-blue-900",
        success: "border-green-200 bg-green-50 text-green-900",
        warning: "border-yellow-200 bg-yellow-50 text-yellow-900",
        error: "border-red-200 bg-red-50 text-red-900",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const iconVariants = cva("h-5 w-5", {
  variants: {
    variant: {
      default: "text-foreground",
      info: "text-blue-600",
      success: "text-green-600",
      warning: "text-yellow-600",
      error: "text-red-600",
    },
  },
});

export const Alert = {
  Root: ({ variant, className, ...props }) => (
    <div className={cn(alertVariants({ variant }), className)} {...props} />
  ),
  Icon: ({ variant, className, ...props }) => (
    <span className={cn(iconVariants({ variant }), className)} {...props} />
  ),
  Title: ({ className, ...props }) => (
    <h5 className={cn("font-medium leading-none", className)} {...props} />
  ),
  Description: ({ className, ...props }) => (
    <div className={cn("text-sm opacity-90", className)} {...props} />
  ),
};
```

Reference: [class-variance-authority](https://cva.style/docs)
