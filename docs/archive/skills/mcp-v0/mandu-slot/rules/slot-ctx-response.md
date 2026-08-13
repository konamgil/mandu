---
title: Use Context Response Methods
impact: HIGH
impactDescription: Consistent API responses
tags: slot, context, response
---

## Use Context Response Methods

Use `ctx.ok()`, `ctx.created()`, `ctx.error()` instead of manual Response objects.
These methods ensure consistent response format across your API.

**Incorrect (manual Response):**

```typescript
export default Mandu.filling()
  .get((ctx) => {
    return new Response(JSON.stringify({ data: [] }), {
      headers: { "Content-Type": "application/json" }
    });
  })
  .post(async (ctx) => {
    return new Response(JSON.stringify({ error: "Bad request" }), {
      status: 400
    });
  });
```

**Correct (context methods):**

```typescript
export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({ data: [] });
  })
  .post(async (ctx) => {
    const body = await ctx.body();
    if (!body.name) {
      return ctx.error("name is required");
    }
    return ctx.created({ data: body });
  });
```

## Response Methods

| Method | Status | Use Case |
|--------|--------|----------|
| `ctx.ok(data)` | 200 | Success |
| `ctx.created(data)` | 201 | Resource created |
| `ctx.noContent()` | 204 | Success, no body |
| `ctx.error(msg)` | 400 | Bad request |
| `ctx.unauthorized(msg)` | 401 | Auth required |
| `ctx.forbidden(msg)` | 403 | Permission denied |
| `ctx.notFound(msg)` | 404 | Not found |
| `ctx.fail(msg)` | 500 | Server error |
