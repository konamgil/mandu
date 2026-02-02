---
title: Compound Component Styling
impact: HIGH
impactDescription: Consistent styling for compound component patterns
tags: styling, compound, composition, patterns
---

## Compound Component Styling

**Impact: HIGH (Consistent styling for compound component patterns)**

Mandu의 compound component 패턴에 맞는 스타일링 방법입니다.

## 기본 패턴

```tsx
// app/card/client.tsx
"use client";

import { createContext, useContext } from "react";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

// 1. Variants 정의
const cardVariants = cva("rounded-lg border", {
  variants: {
    variant: {
      default: "bg-card text-card-foreground",
      elevated: "bg-card shadow-lg",
      ghost: "border-transparent",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

// 2. Context로 variant 공유
type CardContextValue = VariantProps<typeof cardVariants>;
const CardContext = createContext<CardContextValue>({});

// 3. Compound 컴포넌트
export const Card = {
  Root: ({
    variant,
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & CardContextValue) => (
    <CardContext.Provider value={{ variant }}>
      <div className={cn(cardVariants({ variant }), className)} {...props}>
        {children}
      </div>
    </CardContext.Provider>
  ),

  Header: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  ),

  Title: ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />
  ),

  Description: ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),

  Content: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("p-6 pt-0", className)} {...props} />
  ),

  Footer: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
};
```

## 사용 예시

```tsx
<Card.Root variant="elevated">
  <Card.Header>
    <Card.Title>Card Title</Card.Title>
    <Card.Description>Card description</Card.Description>
  </Card.Header>
  <Card.Content>
    Content here
  </Card.Content>
  <Card.Footer>
    <button>Action</button>
  </Card.Footer>
</Card.Root>
```

## Context 기반 스타일 상속

```tsx
// app/alert/client.tsx
"use client";

import { createContext, useContext } from "react";

type AlertVariant = "default" | "info" | "success" | "warning" | "error";

const AlertContext = createContext<{ variant: AlertVariant }>({
  variant: "default",
});

const alertStyles = {
  default: {
    root: "bg-background text-foreground",
    icon: "text-foreground",
  },
  info: {
    root: "bg-blue-50 text-blue-900 border-blue-200",
    icon: "text-blue-600",
  },
  success: {
    root: "bg-green-50 text-green-900 border-green-200",
    icon: "text-green-600",
  },
  warning: {
    root: "bg-yellow-50 text-yellow-900 border-yellow-200",
    icon: "text-yellow-600",
  },
  error: {
    root: "bg-red-50 text-red-900 border-red-200",
    icon: "text-red-600",
  },
};

export const Alert = {
  Root: ({ variant = "default", className, ...props }) => (
    <AlertContext.Provider value={{ variant }}>
      <div
        role="alert"
        className={cn(
          "relative w-full rounded-lg border p-4",
          alertStyles[variant].root,
          className
        )}
        {...props}
      />
    </AlertContext.Provider>
  ),

  Icon: ({ className, children, ...props }) => {
    const { variant } = useContext(AlertContext);
    return (
      <span
        className={cn("h-5 w-5", alertStyles[variant].icon, className)}
        {...props}
      >
        {children}
      </span>
    );
  },

  Title: ({ className, ...props }) => (
    <h5
      className={cn("mb-1 font-medium leading-none tracking-tight", className)}
      {...props}
    />
  ),

  Description: ({ className, ...props }) => (
    <div className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />
  ),
};
```

## Slot 기반 커스터마이징

```tsx
// asChild 패턴으로 스타일 전달
import { Slot } from "@radix-ui/react-slot";

export const Button = ({
  asChild,
  className,
  variant,
  size,
  ...props
}) => {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
};

// 사용: Link에 Button 스타일 적용
<Button asChild variant="outline">
  <a href="/about">About</a>
</Button>
```

## CSS Modules와 조합

```css
/* card.module.css */
.root {
  @apply rounded-lg border;
}

.root[data-variant="elevated"] {
  @apply shadow-lg;
}

.header {
  @apply p-6;
}

.content {
  @apply p-6 pt-0;
}
```

```tsx
import styles from "./card.module.css";

export const Card = {
  Root: ({ variant, ...props }) => (
    <div className={styles.root} data-variant={variant} {...props} />
  ),
  Header: (props) => <div className={styles.header} {...props} />,
  Content: (props) => <div className={styles.content} {...props} />,
};
```

Reference: [Radix UI Primitives](https://www.radix-ui.com/primitives)
