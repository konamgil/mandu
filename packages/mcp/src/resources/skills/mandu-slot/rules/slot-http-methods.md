---
title: Use Appropriate HTTP Methods
impact: HIGH
impactDescription: RESTful API design
tags: slot, http, methods, rest
---

## Use Appropriate HTTP Methods

Chain HTTP methods on Mandu.filling() for RESTful API design.

**Incorrect (single handler for all):**

```typescript
export default Mandu.filling()
  .get(async (ctx) => {
    const method = ctx.req.method;
    if (method === "GET") {
      return ctx.ok({ data: [] });
    } else if (method === "POST") {
      const body = await ctx.body();
      return ctx.created({ data: body });
    }
  });
```

**Correct (separate methods):**

```typescript
export default Mandu.filling()
  .get((ctx) => {
    // GET /api/users - List users
    return ctx.ok({ data: [] });
  })
  .post(async (ctx) => {
    // POST /api/users - Create user
    const body = await ctx.body<{ name: string }>();
    return ctx.created({ data: { id: 1, ...body } });
  })
  .put(async (ctx) => {
    // PUT /api/users/:id - Replace user
    const body = await ctx.body();
    return ctx.ok({ data: body });
  })
  .patch(async (ctx) => {
    // PATCH /api/users/:id - Update user
    const body = await ctx.body();
    return ctx.ok({ data: body });
  })
  .delete((ctx) => {
    // DELETE /api/users/:id - Delete user
    return ctx.noContent();
  });
```

## HTTP Method Semantics

| Method | Idempotent | Use Case |
|--------|------------|----------|
| GET | Yes | Read resource |
| POST | No | Create resource |
| PUT | Yes | Replace resource |
| PATCH | No | Partial update |
| DELETE | Yes | Remove resource |
