# Resource-Centric Architecture

Mandu's Resource-Centric Architecture is a code generation approach that puts **type-safe resource definitions** at the center of your API development workflow. Define your data models once, and Mandu generates all the boilerplate: API handlers, validation schemas, TypeScript types, and type-safe clients.

## Overview

Instead of manually writing manifests, API handlers, and validation logic separately, you define a **resource** (e.g., `user`, `post`, `comment`) with its fields and options. Mandu then generates:

- ✅ **Contract**: Zod validation schemas for requests/responses
- ✅ **Types**: TypeScript interfaces inferred from fields
- ✅ **Slot**: API handler with slot markers for custom logic
- ✅ **Client**: Type-safe frontend client

**Key benefit**: When you add a field to your resource, regeneration updates types and schemas automatically while **preserving your custom business logic** in slots.

### Key Concepts

**Resource**
: A data model representing a domain entity (e.g., `user`, `post`, `product`). Defined using `defineResource()` with fields and options.

**Resource Schema**
: The TypeScript definition in `spec/resources/*.resource.ts` that describes field types, validation rules, and endpoint configuration.

**Generated Code**
: Auto-generated files in `.mandu/generated/` including contracts, types, slots, and clients. Updated on regeneration.

**Slot Preservation**
: The mechanism that preserves custom business logic in slot files during regeneration. Code between `@slot:*` markers is never overwritten.

**Auto-Pluralization**
: Automatic conversion of resource names to plural form for API endpoints (e.g., `user` → `/api/users`). Can be customized or disabled.

---

## Why Resources over Manifests?

The traditional manifest-first approach requires manually maintaining JSON files and separate handler files, leading to duplication and synchronization issues. Resource-first architecture solves this by making the resource definition the single source of truth.

### Problems with Manifest-First Approach

**Manual Synchronization:**
- Route definitions in `routes.manifest.json`
- Handler logic in `spec/slots/*.slot.ts`
- Validation in handler code
- Types manually written
- Easy to get out of sync

**No Type Safety:**
- JSON manifests provide no type checking
- Field changes require manual updates everywhere
- Runtime errors instead of compile-time errors

**Difficult Schema Evolution:**
- Adding a field requires updates in 4+ places
- High risk of missing updates
- No automatic type propagation

**Poor AI Agent Experience:**
- JSON structure difficult for LLMs to reason about
- No type hints for code generation
- Separate files make context harder to maintain

### Resource-First Advantages

**Single Source of Truth:**
- Define fields once in `*.resource.ts`
- Auto-generate contracts, types, handlers, clients
- Guaranteed synchronization

**Full Type Safety:**
- TypeScript resource definition
- Zod schemas auto-generated from fields
- Type inference throughout the stack
- Compile-time error detection

**Easy Schema Evolution:**
- Add field → regenerate → types update automatically
- Slot preservation keeps custom logic safe
- Minimal manual updates required

**AI Agent Optimized:**
- TypeScript definitions easier for LLMs
- MCP tools for resource management
- Clear schema → clear generated code
- Single file context for better reasoning

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   Resource-Centric Flow                      │
└─────────────────────────────────────────────────────────────┘

1. DEFINE RESOURCE
   spec/resources/user.resource.ts
   ↓
   defineResource({
     name: "user",
     fields: { id: {...}, email: {...} }
   })

2. CLI/MCP GENERATION
   ↓
   bunx mandu generate resource user
   OR
   mandu_generate_resource (MCP tool)
   ↓
   parseResourceSchema()
   generateResourceArtifacts()

3. CODE GENERATION
   ↓
   ┌──────────────────────────────────────────┐
   │  .mandu/generated/                        │
   ├──────────────────────────────────────────┤
   │  contracts/user.contract.ts  ← Zod       │
   │  types/user.types.ts         ← TypeScript│
   │  slots/user.slot.ts          ← Handler   │ ⚠️ PRESERVED
   │  client/user.client.ts       ← Client    │
   └──────────────────────────────────────────┘

4. APPLICATION USAGE
   ↓
   app/api/users/route.ts
   import { userHandler } from ".mandu/generated/slots/user.slot"
   export { userHandler as GET, POST, ... }

5. FRONTEND CONSUMPTION
   ↓
   app/users/page.tsx
   import { userClient } from ".mandu/generated/client/user.client"
   const users = await userClient.GET()
```

---

## File Organization

The resource-centric architecture uses a specific directory structure based on `packages/core/src/paths.ts`:

```
project/
├── spec/
│   └── resources/
│       ├── user.resource.ts       # Resource definition
│       ├── post.resource.ts
│       └── comment.resource.ts
│
├── .mandu/generated/              # AUTO-GENERATED - DO NOT EDIT
│   ├── contracts/
│   │   ├── user.contract.ts       # Zod schemas + API contract
│   │   ├── post.contract.ts
│   │   └── comment.contract.ts
│   │
│   ├── types/
│   │   ├── user.types.ts          # TypeScript interfaces
│   │   ├── post.types.ts
│   │   └── comment.types.ts
│   │
│   ├── slots/
│   │   ├── user.slot.ts           # API handlers (PRESERVED!)
│   │   ├── post.slot.ts
│   │   └── comment.slot.ts
│   │
│   └── client/
│       ├── user.client.ts         # Type-safe clients
│       ├── post.client.ts
│       └── comment.client.ts
│
└── app/                           # Your application code
    ├── api/
    │   ├── users/
    │   │   └── route.ts           # Import from slots/
    │   ├── posts/
    │   │   └── route.ts
    │   └── comments/
    │       └── route.ts
    └── users/
        └── page.tsx               # Import from client/
```

**Directory Conventions:**
- `spec/resources/` - Source of truth for resource definitions
- `.mandu/generated/contracts/` - Always regenerated
- `.mandu/generated/types/` - Always regenerated
- `.mandu/generated/slots/` - **PRESERVED unless `--force`**
- `.mandu/generated/client/` - Always regenerated

---

## Generation Pipeline

The generation pipeline transforms a resource definition into production-ready code through 5 stages:

### Pipeline Stages

**Stage 1: Parse Resource Schema**

```typescript
// packages/core/src/resource/parser.ts
const parsed = await parseResourceSchema("/path/to/user.resource.ts");
// → { definition, filePath, fileName, resourceName }
```

- Imports the `*.resource.ts` file
- Validates resource definition
- Extracts metadata (name, file path)
- Returns `ParsedResource` object

**Stage 2: Validate Definition**

```typescript
// packages/core/src/resource/schema.ts
validateResourceDefinition(definition);
```

- Checks resource name format (must start with letter, alphanumeric + underscore)
- Validates at least one field exists
- Validates field names and types
- Ensures array fields have `items` property
- Throws errors if validation fails

**Stage 3: Generate Artifacts**

```typescript
// packages/core/src/resource/generator.ts
const result = await generateResourceArtifacts(parsed, {
  rootDir: process.cwd(),
  force: false
});
```

Generates 4 types of files using specialized generators:

1. **Contract** (`generators/contract.ts`)
   - Zod schemas for request/response validation
   - API contract definition
   - Always regenerated

2. **Types** (`generators/types.ts`)
   - TypeScript interfaces from fields
   - Request/Response types
   - Always regenerated

3. **Slot** (`generators/slot.ts`)
   - API handler with CRUD endpoints
   - Slot markers for custom logic
   - **PRESERVED if exists** (unless `--force`)

4. **Client** (`generators/client.ts`)
   - Type-safe frontend client
   - Inferred types from contract
   - Always regenerated

**Stage 4: Slot Preservation**

```typescript
// Critical logic in generator.ts:164-192
const slotExists = await fileExists(slotPath);

if (!slotExists || force) {
  // Create new or overwrite
  await Bun.write(slotPath, slotContent);
  result.created.push(slotPath);
} else {
  // PRESERVE existing slot
  result.skipped.push(slotPath);
  console.log(`✓ Preserving existing slot: ${slotPath}`);
}
```

- Checks if slot file already exists
- If exists and not `--force`: **SKIP** (preserve custom logic)
- If new or `--force`: Write generated content
- Logs preservation action

**Stage 5: File Output**

```typescript
// Result summary
{
  success: true,
  created: [
    ".mandu/generated/contracts/user.contract.ts",
    ".mandu/generated/types/user.types.ts",
    ".mandu/generated/client/user.client.ts"
  ],
  skipped: [
    ".mandu/generated/slots/user.slot.ts"  // ← PRESERVED
  ],
  errors: []
}
```

- Writes generated files to disk
- Creates directories if needed
- Returns summary of created/skipped/errored files
- Logs results to console

---

## Slot Preservation Strategy

**Slot preservation** is the core feature that allows safe schema evolution. When you regenerate a resource after adding fields, your custom business logic in the slot file is **never overwritten**.

### How It Works

**Preservation Logic** (`generator.ts:164-192`):

1. **Check File Existence**
   ```typescript
   const slotExists = await fileExists(slotPath);
   ```

2. **Decision Tree**
   ```
   Slot file exists?
   ├─ Yes → force flag?
   │  ├─ Yes → Overwrite (⚠️ Warning logged)
   │  └─ No  → SKIP (✓ Preserve)
   └─ No → Create new slot
   ```

3. **Preservation Action**
   ```typescript
   if (!slotExists || force) {
     await Bun.write(slotPath, slotContent);
     result.created.push(slotPath);
   } else {
     result.skipped.push(slotPath);
     console.log(`✓ Preserving existing slot: ${slotPath}`);
   }
   ```

### Slot Examples

**Initial Generation:**

```bash
$ bunx mandu generate resource user
```

Generated `user.slot.ts`:
```typescript
import { Mandu } from "@mandujs/core";
import { userContract } from "../contracts/user.contract";

export const userHandler = Mandu.handler(userContract, {
  GET: async (ctx) => {
    // @slot:list-users-start
    // Add custom logic here
    // @slot:list-users-end

    const users = await db.users.findMany();
    return { data: users };
  },

  POST: async (ctx) => {
    // @slot:create-user-start
    // Add custom logic here
    // @slot:create-user-end

    const user = await db.users.create({ data: ctx.body });
    return { data: user };
  }
});
```

**Add Custom Logic:**

Developer edits slot:
```typescript
GET: async (ctx) => {
  // @slot:list-users-start
  // Add authentication
  if (!ctx.get("user")) {
    return ctx.unauthorized("Login required");
  }
  // @slot:list-users-end

  const users = await db.users.findMany();
  return { data: users };
}
```

**Add Field to Resource:**

Edit `user.resource.ts` to add `avatar` field:
```typescript
defineResource({
  name: "user",
  fields: {
    id: { type: "uuid", required: true },
    email: { type: "email", required: true },
    avatar: { type: "url" } // ← NEW FIELD
  }
});
```

**Regenerate:**

```bash
$ bunx mandu generate resource user

✓ Created: .mandu/generated/contracts/user.contract.ts
✓ Created: .mandu/generated/types/user.types.ts
✓ Preserving existing slot: .mandu/generated/slots/user.slot.ts
✓ Created: .mandu/generated/client/user.client.ts
```

**Result:**
- ✅ Contract updated with `avatar` field
- ✅ Types updated with `avatar?: string`
- ✅ **Slot preserved** - custom authentication logic intact!
- ✅ Client updated with new type

**Force Overwrite (Dangerous):**

```bash
$ bunx mandu generate resource user --force

⚠️  Overwriting existing slot (--force): .mandu/generated/slots/user.slot.ts
```

Use `--force` only when you want to reset the slot to default template (loses custom logic!).

---

## Auto-Pluralization Rules

Resource names are automatically pluralized for API endpoints. For example, `user` resource → `/api/users` endpoint.

### Default Behavior

**Simple Pluralization** (`schema.ts:209-221`):

```typescript
export function getPluralName(definition: ResourceDefinition): string {
  if (definition.options?.pluralName) {
    return definition.options.pluralName;
  }

  if (definition.options?.autoPlural === false) {
    return definition.name;
  }

  // Simple rule: add 's'
  return `${definition.name}s`;
}
```

**Examples:**
- `user` → `users`
- `post` → `posts`
- `product` → `products`
- `comment` → `comments`

### Custom Plural Name

Override auto-pluralization:

```typescript
defineResource({
  name: "person",
  fields: { /* ... */ },
  options: {
    pluralName: "people"  // ← Custom plural
  }
});
```

Result: `/api/people` instead of `/api/persons`

### Disable Pluralization

Keep singular form:

```typescript
defineResource({
  name: "analytics",
  fields: { /* ... */ },
  options: {
    autoPlural: false  // ← Disable
  }
});
```

Result: `/api/analytics` (singular)

### Common Use Cases

| Resource | Default | Custom Override | Reason |
|----------|---------|-----------------|--------|
| `user` | `users` | - | Regular plural |
| `post` | `posts` | - | Regular plural |
| `person` | `persons` | `people` | Irregular plural |
| `child` | `childs` | `children` | Irregular plural |
| `analytics` | `analyticss` | - | `autoPlural: false` |
| `data` | `datas` | - | `autoPlural: false` |

**Note:** The current implementation uses simple `+s` rule. Irregular plurals require `pluralName` override.

---

## Backward Compatibility

Resource-centric architecture is designed to **coexist** with the traditional manifest-first approach, allowing gradual migration.

### Coexistence Model

**Both Can Work Together:**

```
project/
├── spec/
│   ├── routes.manifest.json        # Legacy routes (still works!)
│   └── resources/
│       └── user.resource.ts        # New resources
│
└── .mandu/generated/
    ├── slots/                       # Legacy slots
    │   └── old-api.slot.ts
    └── slots/                       # Resource slots
        └── user.slot.ts
```

- Existing manifest routes continue to work
- New resources can be added incrementally
- No need to migrate everything at once
- Both systems load and run independently

### No Breaking Changes

**Guarantees:**

1. ✅ **Existing manifests unaffected**
   - `routes.manifest.json` still processed normally
   - Old slots work as before
   - No changes to routing behavior

2. ✅ **Opt-in adoption**
   - Resources are additive, not replacement
   - Use resources for new features
   - Migrate old routes at your pace

3. ✅ **API compatibility**
   - Generated slots follow same `Mandu.filling()` API
   - No breaking changes to handler signatures
   - Compatible with existing middleware

### Migration Path

**Recommended Strategy:**

1. **Start with new features**
   ```bash
   bunx mandu generate resource newFeature
   ```

2. **Keep existing routes**
   - Don't touch working manifest routes
   - Test new resource-based routes

3. **Migrate incrementally**
   - Move one route at a time
   - Compare old vs new behavior
   - Remove manifest entry after migration

4. **Complete migration (optional)**
   - Once all routes migrated
   - Remove `routes.manifest.json`
   - Fully resource-based

**See:** [Migration Guide](./migration/to-resources.md) for detailed steps.

---

## Related Documentation

- [API Reference: defineResource()](./api/defineResource.md)
- [Tutorial: Resource Workflow](./guides/resource-workflow.md)
- [Migration Guide](./migration/to-resources.md)
- [Comparison: Manifest vs Resource](./comparison/manifest-vs-resource.md)
