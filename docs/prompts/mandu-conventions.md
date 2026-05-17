---
name: mandu-conventions
version: 1.0.0
audience: AI Agents
last_verified: 2026-04-18
---

# Mandu Conventions Reference

Concrete, code-oriented reference for the three core building blocks.

## 1. Slots (Server-side data loaders)

```typescript
// spec/slots/users.slot.ts
import { Mandu } from "@mandujs/core";

export default Mandu.slot(async (ctx) => {
  // Runs on the server BEFORE page render.
  // Return value becomes typed props for the Island.
  const users = await ctx.resources.user.list();
  return { users };
});
```

- One slot per data concern.
- Must be synchronous in declaration — the callback is async.
- Redirect via `return ctx.redirect("/login")`.
- Set cookies via `ctx.cookies.set(...)` — they flow into the final response.

## 2. Islands (Client-side interactive components)

```tsx
// spec/slots/user-list.client.tsx
import { island, useServerData } from "@mandujs/core/client";

export default island<{ users: User[] }>({
  setup: ({ users }) => ({ users }),
  render: ({ users }) => (
    <ul>
      {users.map((u) => (
        <li key={u.id}>{u.name}</li>
      ))}
    </ul>
  ),
});
```

- **MUST** import from `@mandujs/core/client` (NOT `@mandujs/core`).
  The main barrel pulls in server-only dependencies.
- Alternative declarative syntax:
  `wrapComponent(Component)` or `island({ setup, render })` from
  `@mandujs/core/client`; set route hydration priority on the page/manifest.

## 3. Contracts (Typed request/response schemas)

```typescript
// shared/contracts/users.contract.ts
import { z } from "zod";
import { defineContract } from "@mandujs/core/contract";

export const UserListContract = defineContract({
  route: "/api/users",
  method: "GET",
  request: z.object({
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
  response: z.object({
    users: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
  normalize: "strip",
});
```

- `normalize` = `"strip" | "strict" | "passthrough"`:
  - `strip`: unknown fields silently dropped.
  - `strict`: unknown fields throw.
  - `passthrough`: unknown fields kept as-is.
- Contracts auto-register with the OpenAPI exporter.
- Contracts also seed ATE's L2 oracle — change the contract → regenerate tests.

## 4. API Route Handler

```typescript
// app/api/users/route.ts
import { Mandu } from "@mandujs/core";
import { UserListContract } from "@/shared/contracts/users.contract";

export default Mandu.filling()
  .contract(UserListContract)
  .get(async (ctx) => {
    const { limit } = ctx.request;
    const users = await ctx.resources.user.list({ limit });
    return ctx.ok({ users });
  });
```

## 5. Page Route

```tsx
// app/users/page.tsx
export default function UsersPage({ users }: { users: User[] }) {
  return (
    <main>
      <h1>Users</h1>
      {/* Island will hydrate this section */}
      <div data-island="user-list" />
    </main>
  );
}
```

## 6. Layout (no html/head/body!)

```tsx
// app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-white">{children}</div>;
}
```

## Critical "Don'ts"

- Don't import React state hooks in page components; only in islands.
- Don't wrap layouts in `<html>`/`<head>`/`<body>` — Mandu does that.
- Don't mutate `.mandu/manifest.json` by hand — it's regenerated.
- Don't export both a filling chain AND a raw handler — pick one (the filling chain).
- Don't place slot or client files outside `spec/slots/`.
