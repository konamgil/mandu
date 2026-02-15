# Resource Workflow Tutorial

This step-by-step tutorial teaches you how to use Mandu's Resource-Centric Architecture. You'll create a `user` resource, customize it, and use it in your application.

**What you'll learn:**
- Define resources with type-safe schemas
- Generate code automatically
- Customize business logic with slots
- Test slot preservation (the killer feature!)
- Use generated clients in frontend

**Time:** 15-20 minutes

---

## Prerequisites

- Mandu project initialized (`bunx @mandujs/cli init my-app`)
- Basic understanding of TypeScript and REST APIs

---

## Step 1: Create Your First Resource

### Using CLI (Recommended)

```bash
bunx mandu generate resource user
```

**Interactive prompts:**
```
? Resource name: user
? Add field "id" (uuid): Yes
? Add field "email" (email): Yes
? Add field "name" (string): Yes
? Add timestamps (createdAt, updatedAt)? Yes
? Enable all endpoints (GET, POST, PUT, DELETE)? Yes
```

**Or use flags for quick creation:**
```bash
bunx mandu generate resource user \
  --fields "id:uuid!,email:email!,name:string" \
  --timestamps \
  --methods "GET,POST,PUT,DELETE"
```

### Using MCP (for AI Agents)

```json
{
  "tool": "mandu_generate_resource",
  "arguments": {
    "resourceName": "user",
    "rootDir": "/path/to/project",
    "fields": {
      "id": { "type": "uuid", "required": true },
      "email": { "type": "email", "required": true },
      "name": { "type": "string" }
    },
    "timestamps": true
  }
}
```

**Result:**
```
✓ Created: spec/resources/user.resource.ts
```

---

## Step 2: Define Resource Schema

Open `spec/resources/user.resource.ts` and review the generated schema:

```typescript
import { defineResource } from "@mandujs/core";

export default defineResource({
  name: "user",
  fields: {
    id: { type: "uuid", required: true },
    email: { type: "email", required: true },
    name: { type: "string" },
    createdAt: { type: "date", required: true },
    updatedAt: { type: "date", required: true }
  },
  options: {
    description: "User management API",
    auth: false,
    endpoints: {
      list: true,
      get: true,
      create: true,
      update: true,
      delete: true
    }
  }
});
```

**Customize if needed:**

```typescript
// Add authentication requirement
options: {
  auth: true,  // ← Require auth for all endpoints
}

// Disable some endpoints
options: {
  endpoints: {
    list: true,
    get: true,
    create: true,
    update: false,  // ← Disable update
    delete: false   // ← Disable delete
  }
}
```

---

## Step 3: Generate Code

Run the code generator:

```bash
bunx mandu generate resource user
```

**Output:**
```
📦 Resource Generation Summary:
  ✅ Created: 4 files
  ⏭️  Skipped: 0 files

  Created files:
    - .mandu/generated/contracts/user.contract.ts
    - .mandu/generated/types/user.types.ts
    - .mandu/generated/slots/user.slot.ts
    - .mandu/generated/client/user.client.ts
```

**Generated files:**

```
.mandu/generated/
├── contracts/
│   └── user.contract.ts      # Zod schemas + API contract
├── types/
│   └── user.types.ts          # TypeScript interfaces
├── slots/
│   └── user.slot.ts           # API handler with slots
└── client/
    └── user.client.ts         # Type-safe client
```

**Quick peek at generated types:**

```typescript
// .mandu/generated/types/user.types.ts
export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserRequest {
  email: string;
  name?: string;
}

export interface UpdateUserRequest {
  email?: string;
  name?: string;
}
```

---

## Step 4: Customize Slot Logic

Open `.mandu/generated/slots/user.slot.ts` and add your custom business logic.

**Generated slot structure:**

```typescript
import { Mandu } from "@mandujs/core";
import { userContract } from "../contracts/user.contract";

export const userHandler = Mandu.handler(userContract, {
  // List users
  GET: async (ctx) => {
    // @slot:list-users-start
    // Add custom logic here (auth, filtering, etc.)
    // @slot:list-users-end

    const users = await db.users.findMany();
    return { data: users };
  },

  // Create user
  POST: async (ctx) => {
    // @slot:create-user-start
    // Add custom logic here (validation, etc.)
    // @slot:create-user-end

    const user = await db.users.create({ data: ctx.body });
    return { data: user };
  },

  // ... PUT, DELETE handlers
});
```

**Add authentication:**

Edit the slot to add auth check:

```typescript
GET: async (ctx) => {
  // @slot:list-users-start
  // Check authentication
  const currentUser = ctx.get("user");
  if (!currentUser) {
    return ctx.unauthorized("Login required");
  }
  // @slot:list-users-end

  const users = await db.users.findMany();
  return { data: users };
}
  return ctx.unauthorized("Login required");
}
// @slot:get-users-end
```

---

## Step 5: Add Fields (Slot Preservation Test)

**This is the killer feature!** Let's test that your custom logic is preserved when you add fields.

### Add a New Field

Edit `spec/resources/user.resource.ts` and add `avatar` field:

```typescript
export default defineResource({
  name: "user",
  fields: {
    id: { type: "uuid", required: true },
    email: { type: "email", required: true },
    name: { type: "string" },
    avatar: { type: "url" },        // ✨ NEW FIELD
    bio: { type: "string" },         // ✨ NEW FIELD
    createdAt: { type: "date", required: true },
    updatedAt: { type: "date", required: true }
  }
});
```

### Regenerate

```bash
bunx mandu generate resource user
```

**Output:**
```
📦 Resource Generation Summary:
  ✅ Created: 3 files
  ⏭️  Skipped: 1 file

  Created files:
    - .mandu/generated/contracts/user.contract.ts   ← Updated
    - .mandu/generated/types/user.types.ts          ← Updated
    - .mandu/generated/client/user.client.ts        ← Updated

  Skipped (preserved):
    - .mandu/generated/slots/user.slot.ts           ← PRESERVED!

✓ Preserving existing slot: .mandu/generated/slots/user.slot.ts
```

### Verify Preservation

Check `.mandu/generated/slots/user.slot.ts`:

```typescript
GET: async (ctx) => {
  // @slot:list-users-start
  // YOUR CUSTOM AUTH CODE IS STILL HERE! ✓
  const currentUser = ctx.get("user");
  if (!currentUser) {
    return ctx.unauthorized("Login required");
  }
  // @slot:list-users-end

  const users = await db.users.findMany();
  return { data: users };
}
```

**Result:**
- ✅ Contract updated with `avatar` and `bio`
- ✅ Types updated: `User` interface now has `avatar?: string` and `bio?: string`
- ✅ Client updated with new fields
- ✅ **Slot preserved** - your custom authentication logic is intact!

**Magic!** Your business logic is never lost during schema evolution.

---

## Step 6: Use in Frontend

The generated client provides type-safe API calls with full IntelliSense.

### Import the Client

```typescript
// app/users/page.tsx
import { userClient } from ".mandu/generated/client/user.client";
```

### List Users

```typescript
export default async function UsersPage() {
  // Type-safe GET request
  const { data } = await userClient.GET();

  // data.users is fully typed!
  // TypeScript knows: User[] with id, email, name, avatar, bio, etc.

  return (
    <div>
      <h1>Users</h1>
      <ul>
        {data.users.map(user => (
          <li key={user.id}>
            <img src={user.avatar} alt={user.name} />
            <h3>{user.name}</h3>
            <p>{user.email}</p>
            <p>{user.bio}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Create User

```typescript
async function createUser(formData: FormData) {
  "use server";

  const { data, error } = await userClient.POST({
    body: {
      email: formData.get("email") as string,
      name: formData.get("name") as string,
      avatar: formData.get("avatar") as string,
      bio: formData.get("bio") as string
    }
  });

  if (error) {
    return { error: error.message };
  }

  return { user: data.user };
}
```

### Update User

```typescript
async function updateUser(id: string, updates: Partial<User>) {
  const { data } = await userClient.PUT({
    params: { id },
    body: updates  // Type-safe partial updates
  });

  return data.user;
}
```

**Benefits:**
- ✅ Full TypeScript type inference
- ✅ IntelliSense for all fields
- ✅ Compile-time error checking
- ✅ No manual type definitions needed

---

## Step 7: Add Relationships (Preview)

You can define relationships between resources using foreign keys.

### Create Related Resource

```bash
bunx mandu generate resource post
```

### Define Relationship

```typescript
// spec/resources/post.resource.ts
import { defineResource } from "@mandujs/core";

export default defineResource({
  name: "post",
  fields: {
    id: { type: "uuid", required: true },
    title: { type: "string", required: true },
    content: { type: "string", required: true },
    authorId: { type: "uuid", required: true },  // ← Foreign key
    published: { type: "boolean", default: false },
    createdAt: { type: "date", required: true }
  },
  options: {
    description: "Blog posts by users"
  }
});
```

### Use in Slots

```typescript
// .mandu/generated/slots/post.slot.ts
POST: async (ctx) => {
  // @slot:create-post-start
  // Verify author exists
  const author = await db.users.findUnique({
    where: { id: ctx.body.authorId }
  });

  if (!author) {
    return ctx.error("Author not found");
  }
  // @slot:create-post-end

  const post = await db.posts.create({
    data: ctx.body,
    include: { author: true }  // Include author in response
  });

  return { data: post };
}
```

**Note:** Full relationship support (automatic joins, cascades, etc.) is planned for future versions. For now, manage relationships manually in slots.

---

## Best Practices

### 1. Slot Discipline

**DO:**
```typescript
GET: async (ctx) => {
  // @slot:list-users-start
  if (!ctx.get("user")) {
    return ctx.unauthorized();
  }
  // @slot:list-users-end

  const users = await db.users.findMany();
  return { data: users };
}
```

**DON'T:**
```typescript
GET: async (ctx) => {
  // Custom logic OUTSIDE slot markers = WILL BE LOST!
  if (!ctx.get("user")) {
    return ctx.unauthorized();
  }

  // @slot:list-users-start
  // @slot:list-users-end

  const users = await db.users.findMany();
  return { data: users };
}
```

### 2. Schema Evolution

- ✅ Add fields incrementally
- ✅ Test regeneration after each change
- ✅ Verify slot preservation
- ❌ Don't add many fields at once without testing

### 3. Type Safety

- ✅ Always use generated clients
- ✅ Trust TypeScript inference
- ❌ Don't manually type API responses

### 4. Validation

- ✅ Use `required: true` in resource definition
- ✅ Add custom schemas for complex validation
- ✅ Validate in slots before business logic

### 5. Naming Conventions

- ✅ Use singular names: `user`, `post`, `comment`
- ✅ Use camelCase: `blogPost`, `userProfile`
- ❌ Don't use plural: `users`, `posts`
- ❌ Don't use hyphens: `blog-post`

### 6. Generated Code

- ✅ Read generated code to understand structure
- ✅ Preserve slots (`user.slot.ts`)
- ❌ **NEVER** edit `contract.ts`, `types.ts`, or `client.ts` directly
- ❌ Don't commit `.mandu/generated/` (add to `.gitignore`)

---

## Common Patterns

### Authentication Guard

```typescript
// .mandu/generated/slots/user.slot.ts
GET: async (ctx) => {
  // @slot:list-users-start
  const currentUser = ctx.get("session")?.user;
  if (!currentUser) {
    return ctx.unauthorized("Login required");
  }

  // Admin-only
  if (currentUser.role !== "admin") {
    return ctx.forbidden("Admin access required");
  }
  // @slot:list-users-end

  const users = await db.users.findMany();
  return { data: users };
}
```

### Pagination

```typescript
GET: async (ctx) => {
  // @slot:list-users-start
  const page = parseInt(ctx.query.page || "1");
  const limit = parseInt(ctx.query.limit || "10");
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    db.users.findMany({ skip, take: limit }),
    db.users.count()
  ]);

  return {
    data: users,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
  // @slot:list-users-end
}
```

### Filtering

```typescript
GET: async (ctx) => {
  // @slot:list-users-start
  const { search, role, active } = ctx.query;

  const where: any = {};

  if (search) {
    where.OR = [
      { email: { contains: search } },
      { name: { contains: search } }
    ];
  }

  if (role) {
    where.role = role;
  }

  if (active !== undefined) {
    where.active = active === "true";
  }

  const users = await db.users.findMany({ where });
  return { data: users };
  // @slot:list-users-end
}
```

### Soft Delete

```typescript
DELETE: async (ctx) => {
  // @slot:delete-user-start
  const { id } = ctx.params;

  // Soft delete instead of hard delete
  const user = await db.users.update({
    where: { id },
    data: { deletedAt: new Date(), active: false }
  });

  return { data: user };
  // @slot:delete-user-end
}
```

---

## Next Steps

- [API Reference: defineResource()](../api/defineResource.md)
- [Architecture Overview](../resource-architecture.md)
- [Troubleshooting Guide](./resource-troubleshooting.md)
- [Demo Project](../../demo/resource-example/README.md)
