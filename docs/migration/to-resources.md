# Migration Guide: To Resource-Centric Architecture

<!-- TODO: Add migration overview after implementation -->

This guide helps you migrate existing Mandu projects from manifest-first to resource-first architecture.

---

## Migration Strategy

### Recommended Approach: Gradual Migration

**Coexistence model** allows both manifests and resources to work together:

```
✅ Safe: Migrate incrementally
✅ Test each migration step
✅ No breaking changes
✅ Rollback friendly
```

---

## Prerequisites

- Mandu CLI >= <!-- TODO: add version from Phase 2 -->
- Backup your project (`git commit` or manual backup)
- Read [Comparison Guide](../comparison/manifest-vs-resource.md)

---

## Step-by-Step Migration

### Step 1: Analyze Current Routes

<!-- TODO: Add analysis tool/command from CLI -->

```bash
# List all manifest routes
bunx mandu routes list

# Generate migration report
bunx mandu migrate analyze
```

Output:
```
Found 12 routes in spec/routes.manifest.json
- 8 simple CRUD routes (easy migration)
- 3 routes with complex logic (manual review needed)
- 1 route with custom middleware (keep as manifest)
```

---

### Step 2: Choose Migration Candidates

**Easy to migrate:**
- Simple CRUD operations (GET, POST, PUT, DELETE)
- Standard validation patterns
- Predictable field types

**Keep as manifest:**
- Complex custom middleware chains
- Non-standard routing patterns
- Legacy integrations

---

### Step 3: Create Resource Definition

Convert a manifest route to resource:

**Before (manifest):**
```json
{
  "id": "users-api",
  "path": "/api/users",
  "method": "GET",
  "handler": "spec/slots/users.slot.ts"
}
```

**After (resource):**
```typescript
// spec/resources/user.resource.ts
import { defineResource } from "@mandujs/core";

export default defineResource({
  name: "user",
  fields: [
    { name: "id", type: "string", required: true },
    { name: "email", type: "string", required: true },
    { name: "name", type: "string" },
    { name: "createdAt", type: "date" }
  ]
});
```

---

### Step 4: Generate Scaffold

```bash
bunx mandu generate scaffold user
```

Generated:
```
.mandu/generated/
├── server/user/
│   ├── api.ts          # New handler with slots
│   ├── schema.ts       # Auto-generated validation
│   └── types.ts
└── web/user/
    └── client.ts
```

---

### Step 5: Migrate Custom Logic

Copy custom logic from old slot file to new slot markers:

**Old slot file:**
```typescript
// spec/slots/users.slot.ts
export default Mandu.filling()
  .guard(async (ctx) => {
    if (!ctx.get("user")) return ctx.unauthorized();
  })
  .get(async (ctx) => {
    const users = await db.users.findMany();
    return ctx.ok({ data: users });
  });
```

**New generated file:**
```typescript
// .mandu/generated/server/user/api.ts
export default Mandu.filling()
  .get(async (ctx) => {
    // @slot:get-users-start
    // PASTE YOUR CUSTOM LOGIC HERE:
    if (!ctx.get("user")) return ctx.unauthorized();
    // @slot:get-users-end

    const users = await db.users.findMany();
    return ctx.ok({ data: users });
  });
```

---

### Step 6: Update Route References

If using generated routes:

**Before:**
```typescript
// app/api/users/route.ts
export { default as GET } from "../../../spec/slots/users.slot";
```

**After:**
```typescript
// app/api/users/route.ts
export { default as GET } from "../../../.mandu/generated/server/user/api";
```

---

### Step 7: Test Migration

```bash
# Run tests
bun test

# Test endpoint manually
curl http://localhost:3000/api/users

# Check Guard compliance
bunx mandu guard arch
```

---

### Step 8: Remove Old Manifest Route

Once tested, remove from `spec/routes.manifest.json`:

```json
{
  "routes": [
    // Remove migrated route
    // { "id": "users-api", ... }
  ]
}
```

---

### Step 9: Repeat for Other Routes

Migrate one route at a time, testing after each migration.

---

## Migration Patterns

### Simple CRUD → Resource

<!-- TODO: Add pattern templates from implementation -->

**Manifest:**
```json
{
  "routes": [
    { "path": "/api/posts", "method": "GET" },
    { "path": "/api/posts", "method": "POST" },
    { "path": "/api/posts/:id", "method": "PUT" },
    { "path": "/api/posts/:id", "method": "DELETE" }
  ]
}
```

**Resource:**
```typescript
defineResource({
  name: "post",
  fields: [/* ... */]
});
```

---

### Complex Logic → Hybrid

Keep complex routes as manifest, migrate simple ones:

```
spec/
├── routes.manifest.json        # Complex routes only
└── resources/
    └── user.resource.ts        # Simple CRUD
```

---

### Relationships → Nested Resources

**One-to-Many:**
```typescript
// user.resource.ts
defineResource({
  name: "user",
  fields: [/* ... */]
});

// post.resource.ts
defineResource({
  name: "post",
  fields: [
    { name: "authorId", type: "string", required: true }
  ],
  relations: [
    { name: "author", type: "belongsTo", target: "user", foreignKey: "authorId" }
  ]
});
```

---

## Automated Migration Tool

<!-- TODO: Add CLI tool for automated migration if implemented -->

```bash
# Auto-migrate simple routes
bunx mandu migrate auto

# Dry run (show what would change)
bunx mandu migrate auto --dry-run

# Migrate specific route
bunx mandu migrate route users-api
```

---

## Common Migration Scenarios

### Scenario 1: Authentication Middleware

**Before:**
```typescript
// Middleware in manifest slot
.middleware(async (ctx, next) => {
  const user = await authenticate(ctx);
  if (!user) return ctx.unauthorized();
  ctx.set("user", user);
  await next();
});
```

**After:**
```typescript
// In resource slot marker
// @slot:guard-start
const user = await authenticate(ctx);
if (!user) return ctx.unauthorized();
ctx.set("user", user);
// @slot:guard-end
```

---

### Scenario 2: Custom Validation

**Before:**
```typescript
const body = await ctx.body();
if (!isValidEmail(body.email)) {
  return ctx.error("Invalid email");
}
```

**After:**
```typescript
// Resource definition handles validation
fields: [
  { name: "email", type: "string", validate: isValidEmail }
]
```

---

### Scenario 3: File Upload Routes

**Recommendation:** Keep as manifest for now

File upload routes often have complex custom logic. Keep them as manifest routes until you're comfortable with resource patterns.

---

## Rollback Strategy

If migration causes issues:

### Option 1: Revert Git Commit
```bash
git revert HEAD
```

### Option 2: Restore Manifest Route
1. Re-add route to `spec/routes.manifest.json`
2. Delete resource file
3. Restart dev server

### Option 3: Coexist Mode
Keep both manifest and resource versions temporarily.

---

## Benefits After Migration

<!-- TODO: Add metrics from Phase 5 testing -->

- ✅ Type safety: Catch errors at build time
- ✅ Code generation: Less boilerplate
- ✅ Schema evolution: Add fields easily
- ✅ AI agent friendly: Better LLM understanding
- ✅ Validation: Auto-generated Zod schemas

---

## Common Migration Issues

### Issue: Slot logic not preserved

**Cause:** Logic was outside slot markers

**Solution:** See [Troubleshooting Guide](../guides/resource-troubleshooting.md#slot-preservation-issues)

---

### Issue: Type errors after migration

**Cause:** Schema mismatch

**Solution:**
1. Check field types in resource definition
2. Regenerate with `bunx mandu generate scaffold`
3. Update client code to use new types

---

### Issue: Validation too strict

**Cause:** Required fields enforced

**Solution:**
- Make fields optional: `required: false`
- Use default values: `default: ""`
- Add custom validators for flexibility

---

## Migration Checklist

- [ ] Backup project (git commit)
- [ ] Analyze routes (`bunx mandu routes list`)
- [ ] Identify migration candidates
- [ ] Create resource definitions
- [ ] Generate scaffolds
- [ ] Copy custom logic to slots
- [ ] Update route references
- [ ] Run tests
- [ ] Test endpoints manually
- [ ] Check Guard compliance
- [ ] Remove old manifest entries
- [ ] Update documentation
- [ ] Deploy and monitor

---

## FAQ

### Q: Can I migrate all routes at once?

**A:** Not recommended. Migrate incrementally to reduce risk.

---

### Q: What if migration breaks production?

**A:** Use coexistence mode. Keep manifest routes active while testing resources.

---

### Q: Do I need to rewrite all tests?

**A:** No. If using type-safe clients, tests should work with minimal changes.

---

### Q: Can I migrate back to manifests?

**A:** Yes. Resources and manifests coexist. You can always revert.

---

## Related Documentation

- [Comparison: Manifest vs Resource](../comparison/manifest-vs-resource.md)
- [Resource Architecture](../resource-architecture.md)
- [Tutorial: Resource Workflow](../guides/resource-workflow.md)
- [Troubleshooting](../guides/resource-troubleshooting.md)
