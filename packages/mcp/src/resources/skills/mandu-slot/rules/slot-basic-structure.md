---
title: Always Use Mandu.filling() as Default Export
impact: CRITICAL
impactDescription: Required for slot to work
tags: slot, structure, filling
---

## Always Use Mandu.filling() as Default Export

Every slot file must export a default `Mandu.filling()` chain. This is how Mandu
recognizes and processes your business logic.

**Incorrect (plain function export):**

```typescript
// spec/slots/users.slot.ts
export default async function handler(req: Request) {
  return Response.json({ users: [] });
}
```

**Correct (Mandu.filling() chain):**

```typescript
// spec/slots/users.slot.ts
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({ users: [] });
  });
```

The `Mandu.filling()` provides:
- Type-safe context API
- Built-in error handling
- Guard and lifecycle hooks
- Consistent response format
