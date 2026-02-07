---
title: shadcn/ui Setup
impact: HIGH
impactDescription: Production-ready UI components with full customization
tags: ui, shadcn, setup, components
---

## shadcn/ui Setup

**Impact: HIGH (Production-ready UI components with full customization)**

shadcn/ui를 Mandu 프로젝트에 설정하세요. 컴포넌트를 직접 소유하고 커스터마이징할 수 있습니다.

**초기화:**

```bash
bunx shadcn-ui@latest init
```

**선택 옵션:**
```
✔ TypeScript: yes
✔ Style: Default (또는 New York)
✔ Base color: Slate
✔ Global CSS: app/globals.css
✔ CSS variables: yes
✔ tailwind.config: tailwind.config.ts
✔ Components alias: @/components
✔ Utils alias: @/lib/utils
```

## 컴포넌트 추가

```bash
# 자주 사용하는 컴포넌트
bunx shadcn-ui@latest add button
bunx shadcn-ui@latest add input
bunx shadcn-ui@latest add card
bunx shadcn-ui@latest add dialog
bunx shadcn-ui@latest add dropdown-menu
bunx shadcn-ui@latest add form
bunx shadcn-ui@latest add toast

# 한 번에 여러 개
bunx shadcn-ui@latest add button input card dialog
```

## 생성된 구조

```
components/
└── ui/
    ├── button.tsx      # 직접 수정 가능
    ├── input.tsx
    ├── card.tsx
    └── ...

lib/
└── utils.ts            # cn() 함수
```

## 컴포넌트 커스터마이징

```tsx
// components/ui/button.tsx
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // 커스텀 variant 추가
        mandu: "bg-blue-500 text-white hover:bg-blue-600",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
        // 커스텀 size 추가
        xl: "h-14 rounded-lg px-10 text-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

// ... 컴포넌트 코드
```

## Island에서 사용

```tsx
// app/actions/client.tsx
"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

export function ActionButtonsIsland() {
  const [loading, setLoading] = useState(false);

  const handleAction = async () => {
    setLoading(true);
    try {
      await doSomething();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Button onClick={handleAction} disabled={loading}>
        {loading ? "Processing..." : "Submit"}
      </Button>
      <Button variant="outline">Cancel</Button>
    </div>
  );
}
```

## Form 통합

```bash
bunx shadcn-ui@latest add form
bun add react-hook-form @hookform/resolvers zod
```

```tsx
// app/contact/client.tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const formSchema = z.object({
  email: z.string().email("Invalid email"),
  message: z.string().min(10, "Minimum 10 characters"),
});

export function ContactFormIsland() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", message: "" },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    await fetch("/api/contact", {
      method: "POST",
      body: JSON.stringify(values),
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input placeholder="you@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Send</Button>
      </form>
    </Form>
  );
}
```

## 업데이트

```bash
# 컴포넌트 업데이트 (덮어쓰기 주의!)
bunx shadcn-ui@latest add button --overwrite

# diff 확인 후 수동 병합 권장
bunx shadcn-ui@latest diff button
```

Reference: [shadcn/ui Documentation](https://ui.shadcn.com/docs)
