# Comparison: Manifest vs Resource

<!-- TODO: Add overview after Phase 1 implementation -->

This guide compares the traditional manifest-first approach with the new resource-centric architecture.

---

## Quick Comparison

| Aspect | Manifest-First | Resource-First |
|--------|----------------|----------------|
| **Definition** | JSON file | TypeScript code |
| **Type Safety** | ❌ No inference | ✅ Full inference |
| **Schema Evolution** | <!-- TODO --> | <!-- TODO --> |
| **Slot Preservation** | <!-- TODO --> | <!-- TODO --> |
| **AI Agent Friendly** | <!-- TODO --> | <!-- TODO --> |
| **Code Generation** | <!-- TODO --> | <!-- TODO --> |
| **Validation** | <!-- TODO --> | <!-- TODO --> |

---

## Manifest-First Approach (Legacy)

### How It Works

<!-- TODO: Explain current manifest.json workflow -->

```json
// spec/routes.manifest.json
{
  "routes": [
    {
      "id": "get-users",
      "path": "/api/users",
      "method": "GET",
      "handler": "spec/slots/users.slot.ts"
    }
  ]
}
```

### Workflow

1. Manually create `routes.manifest.json`
2. Define route metadata (path, method, handler)
3. Manually create slot files
4. Write handler logic
5. Manually maintain consistency

---

### Advantages

<!-- TODO: List manifest-first benefits -->

- Explicit route configuration
- Simple JSON structure
- Direct control over routing

---

### Disadvantages

<!-- TODO: List manifest-first pain points -->

- No type safety
- Manual schema maintenance
- No code generation
- Error-prone updates
- Difficult schema evolution

---

## Resource-First Approach (New)

### How It Works

<!-- TODO: Explain defineResource workflow after Phase 1 -->

```typescript
// spec/resources/user.resource.ts
import { defineResource } from "@mandujs/core";

export default defineResource({
  name: "user",
  fields: [
    { name: "id", type: "string", required: true },
    { name: "email", type: "string", required: true },
    { name: "name", type: "string" }
  ]
});
```

### Workflow

1. Define resource with `defineResource()`
2. Run `bunx mandu generate scaffold user`
3. Generated code includes:
   - API handler with slots
   - Zod validation schema
   - TypeScript types
   - Type-safe client
4. Customize logic in slots
5. Add fields → regenerate → slots preserved

---

### Advantages

<!-- TODO: List resource-first benefits from implementation -->

- Full type safety
- Automatic code generation
- Schema-driven validation
- Slot preservation
- Easy schema evolution
- AI agent optimized

---

### Disadvantages

<!-- TODO: List resource-first limitations -->

- Learning curve for new pattern
- Generated code dependency
- Requires understanding of slots

---

## Side-by-Side Example

### Creating a User API

#### Manifest-First

```json
// 1. spec/routes.manifest.json
{
  "routes": [
    {
      "id": "create-user",
      "path": "/api/users",
      "method": "POST",
      "handler": "spec/slots/create-user.slot.ts"
    }
  ]
}
```

```typescript
// 2. spec/slots/create-user.slot.ts (manual)
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .post(async (ctx) => {
    const body = await ctx.body();
    // Manual validation
    if (!body.email) return ctx.error("Email required");

    const user = await db.users.create({ data: body });
    return ctx.created({ data: user });
  });
```

---

#### Resource-First

```typescript
// 1. spec/resources/user.resource.ts
import { defineResource } from "@mandujs/core";

export default defineResource({
  name: "user",
  fields: [
    { name: "email", type: "string", required: true },
    { name: "name", type: "string" }
  ]
});
```

```bash
# 2. Generate code
bunx mandu generate scaffold user
```

```typescript
// 3. .mandu/generated/server/user/api.ts (auto-generated)
import { Mandu } from "@mandujs/core";
import { userSchema } from "./schema";

export default Mandu.filling()
  .post(async (ctx) => {
    const body = await ctx.body();

    // Auto-generated validation
    const validated = userSchema.parse(body);

    // @slot:create-user-start
    // Your custom logic here
    // @slot:create-user-end

    const user = await db.users.create({ data: validated });
    return ctx.created({ data: user });
  });
```

---

## Migration Decision Matrix

| Your Situation | Recommended Approach |
|----------------|---------------------|
| New project | ✅ Resource-First |
| Existing small project (<10 routes) | ✅ Resource-First (easy migration) |
| Existing large project (>50 routes) | ⚠️ Gradual migration (coexist) |
| Complex custom routing logic | ⚠️ Manifest-First (or hybrid) |
| AI agent heavy workflow | ✅ Resource-First |
| Need rapid prototyping | ✅ Resource-First |

---

## Coexistence Model

<!-- TODO: Explain how both can work together -->

Resources and manifests can coexist in the same project:

```
spec/
├── routes.manifest.json        # Legacy routes
└── resources/
    ├── user.resource.ts        # New resources
    └── post.resource.ts
```

Both are loaded and merged at runtime.

---

## Migration Path

### Gradual Migration (Recommended)

<!-- TODO: Add step-by-step migration guide -->

1. Keep existing manifest routes
2. Create new features as resources
3. Migrate one route at a time
4. Test thoroughly
5. Remove manifest routes when confident

### Full Migration

<!-- TODO: Add full migration script/tool reference -->

For automated migration, see [Migration Guide](../migration/to-resources.md)

---

## Performance Comparison

<!-- TODO: Add performance metrics from Phase 5 testing -->

| Metric | Manifest-First | Resource-First |
|--------|----------------|----------------|
| Route registration | <!-- TODO --> | <!-- TODO --> |
| Request handling | <!-- TODO --> | <!-- TODO --> |
| Type checking (build time) | <!-- TODO --> | <!-- TODO --> |
| Bundle size | <!-- TODO --> | <!-- TODO --> |

---

## When to Use Each Approach

### Use Manifest-First When:

<!-- TODO: List specific use cases -->

- Migrating from existing systems
- Need maximum control over routing
- Complex custom middleware chains

### Use Resource-First When:

<!-- TODO: List specific use cases -->

- Starting new projects
- Want type safety
- Working with AI agents
- Need rapid prototyping
- Schema evolves frequently

---

## Related Documentation

- [Resource Architecture](../resource-architecture.md)
- [Migration Guide](../migration/to-resources.md)
- [Tutorial: Resource Workflow](../guides/resource-workflow.md)
- [API Reference](../api/defineResource.md)
