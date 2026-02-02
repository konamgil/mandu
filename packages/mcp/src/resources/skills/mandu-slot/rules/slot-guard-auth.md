---
title: Use .guard() for Authentication
impact: MEDIUM
impactDescription: Clean auth separation
tags: slot, guard, authentication
---

## Use .guard() for Authentication

Use `.guard()` to check authentication before handlers run. Return a response
to block the request, or return void/undefined to continue.

**Incorrect (auth check in every handler):**

```typescript
export default Mandu.filling()
  .get((ctx) => {
    const user = ctx.get("user");
    if (!user) {
      return ctx.unauthorized("Login required");
    }
    return ctx.ok({ data: [] });
  })
  .post(async (ctx) => {
    const user = ctx.get("user");
    if (!user) {
      return ctx.unauthorized("Login required");
    }
    // ... create logic
  });
```

**Correct (single guard):**

```typescript
export default Mandu.filling()
  .guard((ctx) => {
    const user = ctx.get("user");
    if (!user) {
      return ctx.unauthorized("Login required");
    }
    // void return = continue to handlers
  })
  .get((ctx) => {
    const user = ctx.get("user");
    return ctx.ok({ data: [], user });
  })
  .post(async (ctx) => {
    const body = await ctx.body();
    return ctx.created({ data: body });
  });
```

## Guard Rules

1. Return response → Request blocked
2. Return void → Continue to handler
3. Guard runs before ALL HTTP method handlers
4. Use `.onRequest()` to set user before guard runs
