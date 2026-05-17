---
name: mandu-hydration
description: |
  Island import 규칙. 반드시 @mandujs/core/client에서 import.
  "use client", .island.tsx, useState, hydration 작업 시 자동 호출.
---

# Mandu Island Hydration

Island Hydration은 페이지의 일부분만 클라이언트에서 인터랙티브하게 만드는 기술입니다.

## Import Rule (CRITICAL)

Client islands MUST import from `@mandujs/core/client`, NOT `@mandujs/core`.
The main module includes server-side dependencies that break client bundles.

```typescript
// CORRECT
import { island } from "@mandujs/core/client";
import { useServerData, useHydrated, useIslandEvent } from "@mandujs/core/client";

// WRONG - will cause build errors or bloated bundles
import { island } from "@mandujs/core";
```

## Island File Conventions

| File | Purpose |
|------|---------|
| `*.island.tsx` | Island component (auto-detected for hydration) |
| `*.client.tsx` | Client-only logic file |
| `*.slot.ts` / `*.slot.tsx` | Server-side data loader |

All island files MUST have `"use client"` directive at the very top.

## island() API

`island()` takes a single definition object. Do not call
`island("visible", Component)`; that is not a supported runtime API.

### Simple component wrapper

```tsx
// app/counter.island.tsx
"use client";

import { wrapComponent } from "@mandujs/core/client";
import { useState } from "react";

function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}

export default wrapComponent(Counter);
```

### Client Island with Setup (advanced)

```tsx
// app/chat.island.tsx
"use client";

import { island } from "@mandujs/core/client";
import { useState } from "react";

export default island<ServerData>({
  setup(data) {
    const [messages, setMessages] = useState(data.initialMessages);
    return { messages, setMessages };
  },
  render({ messages, setMessages }) {
    return <div>{messages.map(m => <p key={m.id}>{m.text}</p>)}</div>;
  }
});
```

Islands are page-level client bundles. They are discovered from route/client
modules and rendered by the framework wrapper, not embedded as inline JSX. If
you need an interactive region inside a server page, use `partial()` and render
its `.Render` component.

```tsx
"use client";

import { partial } from "@mandujs/core/client";

const CounterPartial = partial({
  component: Counter,
  priority: "visible",
});

export function Header() {
  return <CounterPartial.Render initialCount={0} />;
}
```

## Hydration Priorities

| Priority | When loaded | Use case |
|----------|------------|----------|
| `"immediate"` | Page load | Critical interactions (nav, auth) |
| `"visible"` | In viewport | Default - most components |
| `"idle"` | Browser idle | Below-fold content |
| `"interaction"` | User interacts | Heavy widgets (editor, map) |

```tsx
// app/page.tsx or manifest route config
export const hydration = {
  strategy: "island",
  priority: "visible",
  preload: false,
};

// Inline client regions use partial({ priority }).
partial({ component: CommentSection, priority: "visible" });
```

## Client Hooks

```typescript
import { useServerData, useHydrated, useIslandEvent } from "@mandujs/core/client";

// Access data from server slot
const data = useServerData<UserData>("user", defaultValue);

// Check if component has hydrated (SSR-safe code branching)
const isHydrated = useHydrated();

// Cross-island communication
const { emit, on } = useIslandEvent();
emit("cart:updated", { items: newItems });
on("cart:updated", (data) => setCartItems(data.items));
```

## Server Data Flow

```typescript
// spec/slots/user-profile.slot.ts (server)
import { Mandu } from "@mandujs/core";
export default Mandu.filling()
  .get(async (ctx) => {
    const user = await db.getUser(ctx.params.id);
    return ctx.ok({ user }); // Data available to Islands
  });

// app/user-profile.island.tsx (client)
"use client";
import { useServerData } from "@mandujs/core/client";
export default function UserProfile() {
  const { user } = useServerData("user-profile");
  return <div>{user.name}</div>;
}
```

## Common Mistakes

- Importing from `@mandujs/core` instead of `@mandujs/core/client` in Islands
- Forgetting `"use client"` directive in island files
- Calling `island("visible", Component)` instead of `island({ setup, render })` or `wrapComponent(Component)`
- Rendering a page-level island as `<MyIsland />`; use `partial()` for inline client regions
- Using `useState`/`useEffect` in server components (non-island files)
- Setting all Islands to `"immediate"` priority (defeats partial hydration)
- Putting heavy server imports in `.island.tsx` files (increases bundle size)

## See also

- `mandu-mcp-verify` — island 편집 후 `mandu_doctor` (import/location 진단) drill-down

