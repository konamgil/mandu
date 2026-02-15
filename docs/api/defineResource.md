# API Reference: defineResource()

The `defineResource()` function is the main API for defining resources in Mandu's resource-centric architecture. It creates a typed resource definition that is used to generate API handlers, validation schemas, TypeScript types, and type-safe clients.

## Function Signature

```typescript
function defineResource(definition: ResourceDefinition): ResourceDefinition
```

**Import:**
```typescript
import { defineResource } from "@mandujs/core";
```

---

## Parameters

### ResourceDefinition

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | ✅ | - | Resource name (singular, lowercase). Must start with a letter and contain only letters, numbers, and underscores. |
| `fields` | `Record<string, ResourceField>` | ✅ | - | Field definitions as key-value pairs. At least one field required. |
| `options` | `ResourceOptions` | ❌ | `{}` | Additional resource configuration options. |

**Example:**
```typescript
const UserResource = defineResource({
  name: "user",
  fields: {
    id: { type: "uuid", required: true },
    email: { type: "email", required: true },
    name: { type: "string" }
  },
  options: {
    description: "User management API",
    auth: true
  }
});
```

---

## Field Types

Mandu supports 10 built-in field types:

### Primitive Fields

| Type | Description | Zod Schema | Example |
|------|-------------|------------|---------|
| `string` | Text data | `z.string()` | `{ type: "string", required: true }` |
| `number` | Numeric data | `z.number()` | `{ type: "number", default: 0 }` |
| `boolean` | True/false | `z.boolean()` | `{ type: "boolean", default: false }` |
| `date` | ISO 8601 date | `z.coerce.date()` | `{ type: "date", required: true }` |
| `uuid` | UUID v4 string | `z.string().uuid()` | `{ type: "uuid", required: true }` |
| `email` | Email address | `z.string().email()` | `{ type: "email", required: true }` |
| `url` | URL string | `z.string().url()` | `{ type: "url" }` |

### Complex Fields

| Type | Description | Zod Schema | Example |
|------|-------------|------------|---------|
| `json` | JSON data | `z.any()` | `{ type: "json" }` |
| `array` | Array of items | `z.array(...)` | `{ type: "array", items: "string" }` |
| `object` | Object/record | `z.record(...)` | `{ type: "object" }` |

**Note:** `array` type requires `items` property to specify element type.

```typescript
fields: {
  tags: { type: "array", items: "string" }, // string[]
  metadata: { type: "json" }, // any
}
```

### Custom Validators

<!-- TODO: Explain custom validation support -->

---

## ResourceField

Each field in the `fields` object has the following properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | `FieldType` | ✅ | Field type (see Field Types above) |
| `required` | `boolean` | ❌ | Whether field is required (default: `false`) |
| `default` | `unknown` | ❌ | Default value if not provided |
| `description` | `string` | ❌ | Field description for documentation |
| `items` | `FieldType` | ❌ | Element type for `array` fields (required for arrays) |
| `schema` | `z.ZodType` | ❌ | Custom Zod schema for advanced validation |

**Examples:**

```typescript
fields: {
  // Required field
  email: { type: "email", required: true },

  // Optional with default
  role: { type: "string", default: "user" },

  // With description
  name: {
    type: "string",
    required: true,
    description: "User's full name"
  },

  // Array field
  tags: { type: "array", items: "string" },

  // Custom schema
  age: {
    type: "number",
    schema: z.number().int().min(0).max(120)
  }
}
```

---

## ResourceOptions

Additional configuration for the resource:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `description` | `string` | - | Resource description for documentation |
| `tags` | `string[]` | `[]` | API tags for grouping |
| `autoPlural` | `boolean` | `true` | Automatically pluralize resource name |
| `pluralName` | `string` | - | Custom plural name (overrides auto-pluralization) |
| `endpoints` | `object` | All `true` | Enable/disable specific endpoints |
| `auth` | `boolean` | `false` | Require authentication for all endpoints |
| `pagination` | `object` | See below | Pagination settings |

### Endpoints Configuration

```typescript
endpoints: {
  list?: boolean;   // GET /api/{resource}
  get?: boolean;    // GET /api/{resource}/:id
  create?: boolean; // POST /api/{resource}
  update?: boolean; // PUT /api/{resource}/:id
  delete?: boolean; // DELETE /api/{resource}/:id
}
```

**Default:** All endpoints enabled (`true`)

**Example:**
```typescript
options: {
  endpoints: {
    list: true,
    get: true,
    create: true,
    update: false,  // Disable update
    delete: false   // Disable delete
  }
}
```

### Pagination Configuration

```typescript
pagination: {
  defaultLimit?: number; // Default: 10
  maxLimit?: number;     // Default: 100
}
```

---

## Return Value

Returns a validated `ResourceDefinition` with normalized options:

```typescript
interface ResourceDefinition {
  name: string;
  fields: Record<string, ResourceField>;
  options: ResourceOptions; // With defaults applied
}
```

The returned definition is used by:
- `generateResourceArtifacts()` - Code generation
- CLI commands - Interactive resource creation
- MCP tools - AI agent integration

---

## Examples

### Basic Resource

```typescript
// spec/resources/user.resource.ts
import { defineResource } from "@mandujs/core";

export default defineResource({
  name: "user",
  fields: {
    id: { type: "uuid", required: true },
    email: { type: "email", required: true },
    name: { type: "string", required: true },
    avatar: { type: "url" },
    createdAt: { type: "date", required: true }
  }
});
```

### Resource with Options

```typescript
// spec/resources/post.resource.ts
import { defineResource } from "@mandujs/core";

export default defineResource({
  name: "post",
  fields: {
    id: { type: "uuid", required: true },
    title: { type: "string", required: true },
    content: { type: "string", required: true },
    authorId: { type: "uuid", required: true },
    published: { type: "boolean", default: false },
    publishedAt: { type: "date" },
    createdAt: { type: "date", required: true }
  },
  options: {
    description: "Blog post management API",
    tags: ["posts", "content"],
    auth: true,
    pagination: {
      defaultLimit: 20,
      maxLimit: 100
    }
  }
});
```

### Resource with Custom Validation

```typescript
import { defineResource } from "@mandujs/core";
import { z } from "zod";

export default defineResource({
  name: "user",
  fields: {
    id: { type: "uuid", required: true },
    email: { type: "email", required: true },

    // Custom age validation
    age: {
      type: "number",
      required: true,
      schema: z.number().int().min(13).max(120),
      description: "User age (13-120)"
    },

    // Custom username validation
    username: {
      type: "string",
      required: true,
      schema: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/),
      description: "Username (3-20 chars, lowercase, alphanumeric + underscore)"
    }
  }
});
```

### Resource with Array Fields

```typescript
import { defineResource } from "@mandujs/core";

export default defineResource({
  name: "article",
  fields: {
    id: { type: "uuid", required: true },
    title: { type: "string", required: true },

    // Array of strings
    tags: { type: "array", items: "string" },

    // JSON metadata
    metadata: { type: "json" },

    // Array of numbers
    ratings: { type: "array", items: "number" }
  }
});
```

### Resource with Selective Endpoints

```typescript
import { defineResource } from "@mandujs/core";

export default defineResource({
  name: "analytics",
  fields: {
    id: { type: "uuid", required: true },
    event: { type: "string", required: true },
    timestamp: { type: "date", required: true }
  },
  options: {
    // Read-only resource (no create/update/delete)
    endpoints: {
      list: true,
      get: true,
      create: false,
      update: false,
      delete: false
    }
  }
});
```

---

## Validation Rules

The `defineResource()` function validates the definition before returning:

### Name Validation

- **Required**: Name must be provided
- **Format**: Must start with a letter, contain only letters, numbers, and underscores
- **Case**: Any case allowed, but lowercase recommended

**Valid names:**
- ✅ `user`
- ✅ `blogPost`
- ✅ `user_profile`
- ✅ `product2`

**Invalid names:**
- ❌ `2user` (starts with number)
- ❌ `user-profile` (contains hyphen)
- ❌ `user.profile` (contains dot)
- ❌ ` ` (empty or whitespace)

### Field Validation

- **At least one field** required
- **Field names** must follow same rules as resource name
- **Field types** must be one of the 10 supported types
- **Array fields** must include `items` property
- **Custom schemas** must be valid Zod schemas

### Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| `Resource name is required` | Missing `name` | Provide `name` field |
| `Invalid resource name: "..."` | Name doesn't match pattern | Use letters, numbers, underscores only |
| `Resource "..." must have at least one field` | Empty `fields` object | Add at least one field |
| `Invalid field name: "..."` | Field name doesn't match pattern | Fix field name format |
| `Invalid field type: "..."` | Unknown field type | Use one of: `string`, `number`, `boolean`, `date`, `uuid`, `email`, `url`, `json`, `array`, `object` |
| `Field "..." is array type but missing "items"` | Array without items | Add `items: "string"` (or other type) |

---

## Code Generation

After defining a resource, use CLI or MCP tools to generate code artifacts:

### CLI Command

```bash
bunx mandu generate resource user
```

### MCP Tool (for AI agents)

```json
{
  "tool": "mandu_generate_resource",
  "arguments": {
    "resourceName": "user",
    "rootDir": "/path/to/project"
  }
}
```

### Generated Files

For a resource named `user`, the following files are generated:

```
.mandu/generated/
├── contracts/
│   └── user.contract.ts      # Zod validation schema + API contract
├── types/
│   └── user.types.ts          # TypeScript interfaces
├── slots/
│   └── user.slot.ts           # API handler with slot markers (PRESERVED)
└── client/
    └── user.client.ts         # Type-safe client for frontend
```

### File Details

**Contract** (`user.contract.ts`):
- Zod schema for request/response validation
- Contract definition for type-safe API
- Auto-regenerated on every generation

**Types** (`user.types.ts`):
- TypeScript interfaces from field definitions
- Inferred from Zod schemas
- Auto-regenerated on every generation

**Slot** (`user.slot.ts`):
- API handler with CRUD endpoints
- Slot markers for custom logic
- **PRESERVED** on regeneration (unless `--force`)

**Client** (`user.client.ts`):
- Type-safe client for API calls
- Inferred request/response types
- Auto-regenerated on every generation

---

## Type Inference

TypeScript automatically infers types from your resource definition:

```typescript
// Define resource
const UserResource = defineResource({
  name: "user",
  fields: {
    id: { type: "uuid", required: true },
    email: { type: "email", required: true },
    name: { type: "string" }, // optional
    age: { type: "number" }
  }
});

// Generated types (in user.types.ts)
export interface User {
  id: string;           // required
  email: string;        // required
  name?: string;        // optional
  age?: number;         // optional
}

export interface CreateUserRequest {
  email: string;        // required fields only
  name?: string;
  age?: number;
}

export interface UpdateUserRequest {
  email?: string;       // all optional
  name?: string;
  age?: number;
}
```

**Type mapping:**
- `string`, `uuid`, `email`, `url` → `string`
- `number` → `number`
- `boolean` → `boolean`
- `date` → `Date`
- `json` → `any`
- `array` with `items: "T"` → `T[]`
- `object` → `Record<string, any>`
- `required: true` → required property
- `required: false` (or omitted) → optional property (`?`)

---

## Error Handling

### Definition Errors

**Error thrown during `defineResource()`:**

```typescript
try {
  const resource = defineResource({
    name: "invalid-name",  // Contains hyphen
    fields: {
      id: { type: "uuid" }
    }
  });
} catch (error) {
  // Error: Invalid resource name: "invalid-name".
  // Must start with a letter and contain only letters, numbers, and underscores.
}
```

**Common definition errors:**
- Invalid resource name format
- Missing or empty fields
- Invalid field type
- Array field missing `items`
- Invalid field name format

### Generation Errors

**Error during code generation:**

```typescript
import { generateResourceArtifacts, parseResourceSchema } from "@mandujs/core";

try {
  const parsed = await parseResourceSchema("/path/to/user.resource.ts");
  const result = await generateResourceArtifacts(parsed, {
    rootDir: process.cwd()
  });

  if (!result.success) {
    console.error("Generation errors:", result.errors);
  }
} catch (error) {
  // Handle file not found, import errors, etc.
}
```

**Common generation errors:**
- Resource file not found
- File doesn't export default ResourceDefinition
- File system permission errors
- Invalid project structure

### Validation Errors (Runtime)

**Zod validation errors when using generated contract:**

```typescript
import { userContract } from ".mandu/generated/contracts/user.contract";

try {
  const validated = userContract.request.POST.body.parse({
    email: "invalid-email",  // Not a valid email
    name: "John"
  });
} catch (error) {
  // ZodError: Invalid email at "email"
}
```

---

## Related Documentation

- [Architecture Overview](../resource-architecture.md)
- [Tutorial: Resource Workflow](../guides/resource-workflow.md)
- [Troubleshooting](../guides/resource-troubleshooting.md)
