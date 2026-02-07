---
title: UI Library Island Integration
impact: MEDIUM
impactDescription: Proper integration of UI components with Island architecture
tags: ui, island, integration, client
---

## UI Library Island Integration

**Impact: MEDIUM (Proper integration of UI components with Island architecture)**

UI 라이브러리 컴포넌트를 Mandu Island 아키텍처에 올바르게 통합하세요.

## "use client" 경계

```tsx
// components/ui/button.tsx
// shadcn/ui 컴포넌트는 이미 클라이언트 컴포넌트
"use client";

import { cn } from "@/lib/utils";
// ...
```

```tsx
// app/dashboard/page.tsx (서버 컴포넌트)
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { DashboardActionsIsland } from "./client";

export default function DashboardPage() {
  return (
    <div>
      {/* Card는 서버에서 렌더링 (정적 마크업) */}
      <Card>
        <CardHeader>
          <CardTitle>Dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          {/* 인터랙티브 부분만 Island */}
          <DashboardActionsIsland />
        </CardContent>
      </Card>
    </div>
  );
}
```

## 서버 데이터 → Island 전달

```tsx
// app/users/page.tsx
import { UserTableIsland } from "./client";
import { getUsers } from "@/lib/db";

export default async function UsersPage() {
  const users = await getUsers();

  return (
    <div>
      <h1>Users</h1>
      {/* 초기 데이터를 props로 전달 */}
      <UserTableIsland initialUsers={users} />
    </div>
  );
}
```

```tsx
// app/users/client.tsx
"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export function UserTableIsland({ initialUsers }) {
  const [users, setUsers] = useState(initialUsers);

  const handleDelete = async (id: string) => {
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    setUsers(users.filter(u => u.id !== id));
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map(user => (
          <TableRow key={user.id}>
            <TableCell>{user.name}</TableCell>
            <TableCell>{user.email}</TableCell>
            <TableCell>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDelete(user.id)}
              >
                Delete
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

## Dialog/Modal Island 패턴

```tsx
// app/users/client.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function CreateUserIsland() {
  const [open, setOpen] = useState(false);

  const handleSubmit = async (data: FormData) => {
    await fetch("/api/users", {
      method: "POST",
      body: data,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add User</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New User</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit}>
          {/* Form fields */}
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

## Toast Island

```tsx
// app/layout.tsx
import { Toaster } from "@/components/ui/toaster";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        {/* Toast는 전역 Island */}
        <Toaster />
      </body>
    </html>
  );
}
```

```tsx
// app/form/client.tsx
"use client";

import { useToast } from "@/components/ui/use-toast";

export function FormIsland() {
  const { toast } = useToast();

  const handleSubmit = async () => {
    try {
      await submitForm();
      toast({
        title: "Success",
        description: "Form submitted successfully",
      });
    } catch {
      toast({
        title: "Error",
        description: "Something went wrong",
        variant: "destructive",
      });
    }
  };

  // ...
}
```

## Island 간 UI 상태 공유

```tsx
// app/sidebar/client.tsx
"use client";

import { useIslandEvent } from "@mandujs/core/client";

export function SidebarIsland() {
  const [isOpen, setIsOpen] = useState(true);

  useIslandEvent("toggle-sidebar", () => {
    setIsOpen(prev => !prev);
  });

  return (
    <aside className={cn(isOpen ? "w-64" : "w-0", "transition-all")}>
      {/* Sidebar content */}
    </aside>
  );
}
```

```tsx
// app/header/client.tsx
"use client";

import { useIslandEvent } from "@mandujs/core/client";
import { Button } from "@/components/ui/button";

export function HeaderIsland() {
  const { emit } = useIslandEvent("toggle-sidebar");

  return (
    <header>
      <Button variant="ghost" size="icon" onClick={() => emit({})}>
        <MenuIcon />
      </Button>
    </header>
  );
}
```

Reference: [React Server Components](https://react.dev/reference/rsc/server-components)
