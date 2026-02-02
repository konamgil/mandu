---
title: UI Composition Patterns
impact: MEDIUM
impactDescription: Reusable and flexible component composition
tags: ui, composition, patterns, reusable
---

## UI Composition Patterns

**Impact: MEDIUM (Reusable and flexible component composition)**

재사용 가능하고 유연한 UI 컴포넌트 조합 패턴입니다.

## Slot Pattern (asChild)

```tsx
// components/ui/button.tsx
import { Slot } from "@radix-ui/react-slot";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

export function Button({ asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants())} {...props} />;
}
```

```tsx
// 사용: Link에 Button 스타일 적용
import Link from "next/link";
import { Button } from "@/components/ui/button";

<Button asChild variant="outline">
  <Link href="/about">About</Link>
</Button>

// 결과: <a> 태그에 Button 스타일이 적용됨
```

## Render Props

```tsx
// components/data-table.tsx
interface DataTableProps<T> {
  data: T[];
  renderRow: (item: T, index: number) => React.ReactNode;
  renderEmpty?: () => React.ReactNode;
}

export function DataTable<T>({ data, renderRow, renderEmpty }: DataTableProps<T>) {
  if (data.length === 0) {
    return renderEmpty?.() || <p>No data</p>;
  }

  return (
    <table>
      <tbody>
        {data.map((item, index) => (
          <tr key={index}>{renderRow(item, index)}</tr>
        ))}
      </tbody>
    </table>
  );
}
```

```tsx
// 사용
<DataTable
  data={users}
  renderRow={(user) => (
    <>
      <td>{user.name}</td>
      <td>{user.email}</td>
    </>
  )}
  renderEmpty={() => <EmptyState icon={UserIcon} message="No users found" />}
/>
```

## Polymorphic Components

```tsx
// components/ui/text.tsx
type TextProps<T extends React.ElementType = "p"> = {
  as?: T;
  size?: "sm" | "md" | "lg";
  weight?: "normal" | "medium" | "bold";
} & Omit<React.ComponentPropsWithoutRef<T>, "as" | "size" | "weight">;

export function Text<T extends React.ElementType = "p">({
  as,
  size = "md",
  weight = "normal",
  className,
  ...props
}: TextProps<T>) {
  const Component = as || "p";

  return (
    <Component
      className={cn(
        // Size
        { sm: "text-sm", md: "text-base", lg: "text-lg" }[size],
        // Weight
        { normal: "font-normal", medium: "font-medium", bold: "font-bold" }[weight],
        className
      )}
      {...props}
    />
  );
}
```

```tsx
// 사용
<Text as="h1" size="lg" weight="bold">Title</Text>
<Text as="span" size="sm">Caption</Text>
<Text>Default paragraph</Text>
```

## Container/Presenter Pattern

```tsx
// Container: 로직 담당
// app/user-profile/client.tsx
"use client";

import { useState, useEffect } from "react";
import { UserProfileView } from "./view";

export function UserProfileIsland({ userId }: { userId: string }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/users/${userId}`)
      .then(res => res.json())
      .then(data => {
        setUser(data);
        setLoading(false);
      });
  }, [userId]);

  if (loading) return <UserProfileView.Skeleton />;
  if (!user) return <UserProfileView.Error />;

  return <UserProfileView user={user} />;
}
```

```tsx
// Presenter: UI 담당
// app/user-profile/view.tsx
import { Avatar } from "@/components/ui/avatar";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface UserProfileViewProps {
  user: { name: string; email: string; avatar: string };
}

export function UserProfileView({ user }: UserProfileViewProps) {
  return (
    <Card>
      <CardHeader>
        <Avatar src={user.avatar} alt={user.name} />
        <h2>{user.name}</h2>
      </CardHeader>
      <CardContent>
        <p>{user.email}</p>
      </CardContent>
    </Card>
  );
}

UserProfileView.Skeleton = function Skeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-12 w-12 rounded-full" />
        <Skeleton className="h-4 w-32" />
      </CardHeader>
    </Card>
  );
};

UserProfileView.Error = function Error() {
  return <Card><p>Failed to load user</p></Card>;
};
```

## Layout Components

```tsx
// components/layout/stack.tsx
interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: "sm" | "md" | "lg";
  direction?: "row" | "column";
  align?: "start" | "center" | "end";
  justify?: "start" | "center" | "end" | "between";
}

export function Stack({
  gap = "md",
  direction = "column",
  align = "start",
  justify = "start",
  className,
  ...props
}: StackProps) {
  return (
    <div
      className={cn(
        "flex",
        direction === "column" ? "flex-col" : "flex-row",
        { sm: "gap-2", md: "gap-4", lg: "gap-6" }[gap],
        { start: "items-start", center: "items-center", end: "items-end" }[align],
        { start: "justify-start", center: "justify-center", end: "justify-end", between: "justify-between" }[justify],
        className
      )}
      {...props}
    />
  );
}
```

```tsx
// 사용
<Stack gap="lg" align="center">
  <Avatar />
  <Stack gap="sm">
    <Text weight="bold">{name}</Text>
    <Text size="sm">{email}</Text>
  </Stack>
</Stack>
```

## Higher-Order Island

```tsx
// hoc/withIslandState.tsx
export function withIslandState<T>(
  WrappedComponent: React.ComponentType<T & { state: any; setState: any }>
) {
  return function IslandWrapper(props: T) {
    const [state, setState] = useState({});

    return <WrappedComponent {...props} state={state} setState={setState} />;
  };
}

// 사용
const EnhancedForm = withIslandState(FormComponent);
```

Reference: [React Patterns](https://reactpatterns.com/)
