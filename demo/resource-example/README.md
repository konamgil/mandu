# Resource Example Demo

<!-- TODO: Add overview after Phase 1-3 implementation -->

A comprehensive example demonstrating Mandu's resource-centric architecture with a multi-resource blog application.

---

## What This Demonstrates

### Core Features

1. **Multi-Resource Application**
   - `user` - User authentication and profiles
   - `post` - Blog posts with authorship
   - `comment` - Nested comments on posts

2. **Resource Relationships**
   - User has many Posts (1:N)
   - Post has many Comments (1:N)
   - Comment belongs to User and Post (N:1)

3. **Custom Slot Logic**
   - Authentication guards
   - Authorization checks
   - Business logic customization

4. **Schema Evolution**
   - Adding fields to existing resources
   - Slot preservation across regeneration

5. **Generated Client Usage**
   - Type-safe API calls
   - Frontend integration patterns

---

## Quick Start

### Prerequisites

- Bun >= 1.0.0
- Basic understanding of TypeScript

### Installation

```bash
# Clone or navigate to demo
cd demo/resource-example

# Install dependencies
bun install

# Generate resources
bunx mandu generate scaffold user
bunx mandu generate scaffold post
bunx mandu generate scaffold comment

# Start development server
bun run dev
```

Visit `http://localhost:3000`

---

## Architecture

### Directory Structure

```
demo/resource-example/
├── spec/
│   └── resources/
│       ├── user.resource.ts       # User schema
│       ├── post.resource.ts       # Post schema
│       └── comment.resource.ts    # Comment schema
├── .mandu/generated/              # Auto-generated (DO NOT EDIT)
│   ├── server/
│   │   ├── user/
│   │   │   ├── api.ts             # User API with slots
│   │   │   ├── schema.ts          # Zod validation
│   │   │   └── types.ts           # TypeScript types
│   │   ├── post/
│   │   └── comment/
│   └── web/
│       ├── user/
│       │   └── client.ts          # Type-safe client
│       ├── post/
│       └── comment/
├── app/
│   ├── page.tsx                   # Home page (list posts)
│   ├── posts/
│   │   └── [id]/
│   │       └── page.tsx           # Post detail with comments
│   └── api/
│       ├── users/
│       │   └── route.ts           # User API endpoint
│       ├── posts/
│       └── comments/
├── src/
│   └── lib/
│       └── db.ts                  # Mock database (demo only)
├── mandu.config.ts
├── package.json
└── README.md
```

---

## Resource Definitions

### User Resource

<!-- TODO: Add actual resource definition from implementation -->

```typescript
// spec/resources/user.resource.ts
import { defineResource } from "@mandujs/core";

export default defineResource({
  name: "user",
  fields: [
    { name: "id", type: "string", required: true },
    { name: "email", type: "string", required: true },
    { name: "username", type: "string", required: true },
    { name: "avatar", type: "string" },
    { name: "createdAt", type: "date" }
  ]
});
```

---

### Post Resource

<!-- TODO: Add actual resource definition -->

```typescript
// spec/resources/post.resource.ts
import { defineResource } from "@mandujs/core";

export default defineResource({
  name: "post",
  fields: [
    { name: "id", type: "string", required: true },
    { name: "title", type: "string", required: true },
    { name: "content", type: "string", required: true },
    { name: "authorId", type: "string", required: true },
    { name: "published", type: "boolean", default: false },
    { name: "createdAt", type: "date" }
  ],
  relations: [
    {
      name: "author",
      type: "belongsTo",
      target: "user",
      foreignKey: "authorId"
    }
  ]
});
```

---

### Comment Resource

<!-- TODO: Add actual resource definition -->

```typescript
// spec/resources/comment.resource.ts
import { defineResource } from "@mandujs/core";

export default defineResource({
  name: "comment",
  fields: [
    { name: "id", type: "string", required: true },
    { name: "content", type: "string", required: true },
    { name: "postId", type: "string", required: true },
    { name: "authorId", type: "string", required: true },
    { name: "createdAt", type: "date" }
  ],
  relations: [
    {
      name: "post",
      type: "belongsTo",
      target: "post",
      foreignKey: "postId"
    },
    {
      name: "author",
      type: "belongsTo",
      target: "user",
      foreignKey: "authorId"
    }
  ]
});
```

---

## Customization Points

### 1. Authentication Guard (User API)

<!-- TODO: Add actual slot customization example -->

```typescript
// .mandu/generated/server/user/api.ts

export default Mandu.filling()
  .get(async (ctx) => {
    // @slot:get-users-start
    // Custom authentication check
    const currentUser = ctx.get("user");
    if (!currentUser) {
      return ctx.unauthorized("Login required");
    }
    // @slot:get-users-end

    const users = await db.users.findMany();
    return ctx.ok({ data: users });
  });
```

---

### 2. Publish Logic (Post API)

<!-- TODO: Add publish logic example -->

```typescript
// .mandu/generated/server/post/api.ts

export default Mandu.filling()
  .post(async (ctx) => {
    const body = await ctx.body();

    // @slot:create-post-start
    // Only published posts visible to non-authors
    const currentUser = ctx.get("user");
    if (body.published && body.authorId !== currentUser.id) {
      return ctx.forbidden("Cannot publish other's posts");
    }
    // @slot:create-post-end

    const post = await db.posts.create({ data: body });
    return ctx.created({ data: post });
  });
```

---

### 3. Moderation (Comment API)

<!-- TODO: Add moderation example -->

```typescript
// .mandu/generated/server/comment/api.ts

export default Mandu.filling()
  .post(async (ctx) => {
    const body = await ctx.body();

    // @slot:create-comment-start
    // Simple profanity filter (demo only)
    const forbidden = ["spam", "badword"];
    if (forbidden.some(word => body.content.includes(word))) {
      return ctx.error("Comment contains forbidden content");
    }
    // @slot:create-comment-end

    const comment = await db.comments.create({ data: body });
    return ctx.created({ data: comment });
  });
```

---

## Frontend Integration

### List Posts (Home Page)

<!-- TODO: Add actual frontend code -->

```typescript
// app/page.tsx
import { postClient } from ".mandu/generated/web/post/client";

export default async function HomePage() {
  const { data } = await postClient.GET();

  return (
    <div>
      <h1>Blog Posts</h1>
      <ul>
        {data.posts.map(post => (
          <li key={post.id}>
            <a href={`/posts/${post.id}`}>
              {post.title}
            </a>
            <span>by {post.author.username}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

### Post Detail with Comments

<!-- TODO: Add post detail page -->

```typescript
// app/posts/[id]/page.tsx
import { postClient } from ".mandu/generated/web/post/client";
import { commentClient } from ".mandu/generated/web/comment/client";

export default async function PostPage({ params }: { params: { id: string } }) {
  const post = await postClient.GET({ params: { id: params.id } });
  const comments = await commentClient.GET({ query: { postId: params.id } });

  return (
    <article>
      <h1>{post.data.title}</h1>
      <p>{post.data.content}</p>

      <section>
        <h2>Comments</h2>
        {comments.data.comments.map(comment => (
          <div key={comment.id}>
            <p>{comment.content}</p>
            <span>by {comment.author.username}</span>
          </div>
        ))}
      </section>
    </article>
  );
}
```

---

## Learning Path

### 1. Basic Usage (15 min)

- Read resource definitions
- Explore generated code structure
- Understand slot markers

### 2. Customization (30 min)

- Add authentication to user API
- Implement publish logic for posts
- Add comment moderation

### 3. Schema Evolution (15 min)

- Add `bio` field to user resource
- Regenerate scaffold
- Verify slots preserved

### 4. Frontend Integration (30 min)

- Use generated clients
- Implement post creation form
- Add comment submission

---

## Common Tasks

### Add a New Field

```typescript
// spec/resources/user.resource.ts
export default defineResource({
  name: "user",
  fields: [
    // ... existing fields
    { name: "bio", type: "string" } // NEW FIELD
  ]
});
```

```bash
bunx mandu generate scaffold user
```

**Result:** Custom slot logic preserved, schema updated!

---

### Add a New Resource

```bash
bunx mandu generate resource profile
```

Edit `spec/resources/profile.resource.ts`, then:

```bash
bunx mandu generate scaffold profile
```

---

### Test Slot Preservation

1. Add custom logic to a slot
2. Modify resource schema (add field)
3. Regenerate
4. Verify custom logic still present

---

## Testing

```bash
# Run all tests
bun test

# Test specific resource
bun test user

# E2E tests
bun test:e2e
```

---

## Production Notes

**This is a demo project with simplified patterns:**

- Uses in-memory database (not persistent)
- Simplified authentication (no real JWT)
- Basic validation only
- No rate limiting

**For production:**
- Use real database (PostgreSQL, MySQL)
- Implement proper authentication
- Add comprehensive validation
- Add rate limiting and security headers

---

## Troubleshooting

### Generated files not found

Run generation:
```bash
bunx mandu generate scaffold user
bunx mandu generate scaffold post
bunx mandu generate scaffold comment
```

---

### Custom logic overwritten

Ensure code is between slot markers:
```typescript
// @slot:custom-logic-start
// Your code here
// @slot:custom-logic-end
```

---

### Type errors

Regenerate after schema changes:
```bash
bunx mandu generate scaffold [resource-name]
```

---

## Next Steps

- Read [Resource Architecture](../../docs/resource-architecture.md)
- Follow [Tutorial](../../docs/guides/resource-workflow.md)
- Check [API Reference](../../docs/api/defineResource.md)
- See [Migration Guide](../../docs/migration/to-resources.md)

---

## Related Resources

- [Mandu Documentation](../../README.md)
- [Troubleshooting Guide](../../docs/guides/resource-troubleshooting.md)
- [Comparison: Manifest vs Resource](../../docs/comparison/manifest-vs-resource.md)

---

<p align="center">
  <sub>Built with 🥟 by the Mandu Team</sub>
</p>
