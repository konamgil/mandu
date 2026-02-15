# Resource Example Demo - Design Document

This document details the design and implementation plan for the resource-example demo project.

---

## Project Goals

1. **Demonstrate Resource-Centric Architecture**
   - Multi-resource application (user, post, comment)
   - Resource relationships (1:N, N:1)
   - Slot preservation across regeneration

2. **Showcase Best Practices**
   - Type-safe API clients
   - Custom business logic in slots
   - Schema evolution patterns

3. **Provide Learning Path**
   - Progressive complexity
   - Clear customization points
   - Real-world patterns

---

## Resource Design

### 1. User Resource

**Purpose:** User authentication and profiles

**Fields:**
```typescript
{
  id: string (required, primary key)
  email: string (required, unique)
  username: string (required, unique)
  avatar: string (optional, URL)
  bio: string (optional, for schema evolution demo)
  createdAt: date (auto-generated)
}
```

**Endpoints:**
- `GET /api/users` - List all users (auth required)
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create user (signup)
- `PUT /api/users/:id` - Update user (auth + ownership)
- `DELETE /api/users/:id` - Delete user (auth + ownership)

**Custom Slots:**
- Authentication guard (check user session)
- Authorization (ownership validation)

---

### 2. Post Resource

**Purpose:** Blog posts with authorship

**Fields:**
```typescript
{
  id: string (required, primary key)
  title: string (required)
  content: string (required)
  authorId: string (required, foreign key → user.id)
  published: boolean (default: false)
  publishedAt: date (optional)
  createdAt: date (auto-generated)
  updatedAt: date (auto-generated)
}
```

**Relationships:**
```typescript
{
  author: belongsTo(user, foreignKey: authorId)
  comments: hasMany(comment, foreignKey: postId)
}
```

**Endpoints:**
- `GET /api/posts` - List published posts (public) or all (author)
- `GET /api/posts/:id` - Get post detail
- `POST /api/posts` - Create post (auth required)
- `PUT /api/posts/:id` - Update post (auth + ownership)
- `PATCH /api/posts/:id/publish` - Publish post (auth + ownership)
- `DELETE /api/posts/:id` - Delete post (auth + ownership)

**Custom Slots:**
- Publish logic (set publishedAt timestamp)
- Visibility filter (published vs drafts)
- Author population

---

### 3. Comment Resource

**Purpose:** Nested comments on posts

**Fields:**
```typescript
{
  id: string (required, primary key)
  content: string (required)
  postId: string (required, foreign key → post.id)
  authorId: string (required, foreign key → user.id)
  createdAt: date (auto-generated)
}
```

**Relationships:**
```typescript
{
  post: belongsTo(post, foreignKey: postId)
  author: belongsTo(user, foreignKey: authorId)
}
```

**Endpoints:**
- `GET /api/comments?postId=X` - List comments for post
- `POST /api/comments` - Create comment (auth required)
- `DELETE /api/comments/:id` - Delete comment (auth + ownership)

**Custom Slots:**
- Moderation logic (profanity filter)
- Post existence validation

---

## File Structure

```
demo/resource-example/
├── spec/
│   └── resources/
│       ├── user.resource.ts       # User schema definition
│       ├── post.resource.ts       # Post schema definition
│       └── comment.resource.ts    # Comment schema definition
│
├── .mandu/generated/              # AUTO-GENERATED (DO NOT EDIT)
│   ├── server/
│   │   ├── user/
│   │   │   ├── api.ts             # User API with slots
│   │   │   ├── schema.ts          # Zod validation schema
│   │   │   └── types.ts           # TypeScript interfaces
│   │   ├── post/
│   │   │   ├── api.ts
│   │   │   ├── schema.ts
│   │   │   └── types.ts
│   │   └── comment/
│   │       ├── api.ts
│   │       ├── schema.ts
│   │       └── types.ts
│   └── web/
│       ├── user/
│       │   └── client.ts          # Type-safe user client
│       ├── post/
│       │   └── client.ts
│       └── comment/
│           └── client.ts
│
├── app/                           # FS Routes
│   ├── page.tsx                   # Home: List published posts
│   ├── posts/
│   │   ├── [id]/
│   │   │   └── page.tsx           # Post detail with comments
│   │   └── new/
│   │       └── page.tsx           # Create new post (auth)
│   ├── profile/
│   │   └── [username]/
│   │       └── page.tsx           # User profile
│   └── api/
│       ├── users/
│       │   ├── route.ts           # User API endpoint
│       │   └── [id]/
│       │       └── route.ts
│       ├── posts/
│       │   ├── route.ts           # Post API endpoint
│       │   ├── [id]/
│       │   │   ├── route.ts
│       │   │   └── publish/
│       │   │       └── route.ts
│       └── comments/
│           ├── route.ts           # Comment API endpoint
│           └── [id]/
│               └── route.ts
│
├── src/
│   ├── lib/
│   │   ├── db.ts                  # Mock in-memory database
│   │   ├── auth.ts                # Simple auth helpers (demo only)
│   │   └── validation.ts          # Custom validators
│   └── components/
│       ├── PostCard.tsx           # Post preview component
│       ├── CommentList.tsx        # Comment list component
│       └── Header.tsx             # Navigation header
│
├── public/
│   └── avatars/                   # Placeholder avatars
│
├── tests/
│   ├── user.test.ts               # User API tests
│   ├── post.test.ts               # Post API tests
│   └── comment.test.ts            # Comment API tests
│
├── mandu.config.ts                # Mandu configuration
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md                      # User guide
└── DESIGN.md                      # This file
```

---

## Database Schema (Mock)

```typescript
// src/lib/db.ts - In-memory database

interface Database {
  users: Map<string, User>;
  posts: Map<string, Post>;
  comments: Map<string, Comment>;
}

const db: Database = {
  users: new Map(),
  posts: new Map(),
  comments: new Map()
};

// Seed data
db.users.set("user-1", {
  id: "user-1",
  email: "alice@example.com",
  username: "alice",
  avatar: "/avatars/alice.png",
  createdAt: new Date("2024-01-01")
});

db.posts.set("post-1", {
  id: "post-1",
  title: "Welcome to Mandu Resources!",
  content: "This is a demo of resource-centric architecture...",
  authorId: "user-1",
  published: true,
  publishedAt: new Date("2024-01-02"),
  createdAt: new Date("2024-01-02")
});

// ... more seed data
```

---

## Slot Customization Examples

### User API - Authentication Guard

```typescript
// .mandu/generated/server/user/api.ts

export default Mandu.filling()
  .guard((ctx) => {
    // @slot:auth-guard-start
    const user = ctx.get("session")?.user;
    if (!user) {
      return ctx.unauthorized("Login required");
    }
    // @slot:auth-guard-end
  })
  .get(async (ctx) => {
    // List users logic
  });
```

---

### Post API - Publish Logic

```typescript
// .mandu/generated/server/post/api.ts

export default Mandu.filling()
  .patch(async (ctx) => {
    const { id } = ctx.params;

    // @slot:publish-start
    const currentUser = ctx.get("session")?.user;
    const post = await db.posts.get(id);

    if (!post) return ctx.notFound("Post not found");
    if (post.authorId !== currentUser.id) {
      return ctx.forbidden("Only author can publish");
    }

    post.published = true;
    post.publishedAt = new Date();
    // @slot:publish-end

    await db.posts.update(id, post);
    return ctx.ok({ data: post });
  });
```

---

### Comment API - Moderation

```typescript
// .mandu/generated/server/comment/api.ts

export default Mandu.filling()
  .post(async (ctx) => {
    const body = await ctx.body();

    // @slot:moderation-start
    const forbiddenWords = ["spam", "badword", "offensive"];
    const containsForbidden = forbiddenWords.some(word =>
      body.content.toLowerCase().includes(word)
    );

    if (containsForbidden) {
      return ctx.error("Comment contains forbidden content");
    }
    // @slot:moderation-end

    const comment = await db.comments.create(body);
    return ctx.created({ data: comment });
  });
```

---

## Frontend Pages

### Home Page (Post List)

```typescript
// app/page.tsx

import { postClient } from ".mandu/generated/web/post/client";
import PostCard from "@/components/PostCard";

export default async function HomePage() {
  const { data } = await postClient.GET();

  return (
    <div>
      <h1>Blog Posts</h1>
      <div className="post-grid">
        {data.posts.map(post => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}
```

---

### Post Detail Page

```typescript
// app/posts/[id]/page.tsx

import { postClient } from ".mandu/generated/web/post/client";
import { commentClient } from ".mandu/generated/web/comment/client";
import CommentList from "@/components/CommentList";

export default async function PostPage({ params }: { params: { id: string } }) {
  const post = await postClient.GET({ params: { id: params.id } });
  const comments = await commentClient.GET({ query: { postId: params.id } });

  return (
    <article>
      <h1>{post.data.title}</h1>
      <p className="author">by {post.data.author.username}</p>
      <div>{post.data.content}</div>

      <section>
        <h2>Comments ({comments.data.comments.length})</h2>
        <CommentList comments={comments.data.comments} />
      </section>
    </article>
  );
}
```

---

## Schema Evolution Demo

**Scenario:** Add `bio` field to user resource

1. **Initial State:**
   ```typescript
   // spec/resources/user.resource.ts
   export default defineResource({
     name: "user",
     fields: [
       { name: "id", type: "string", required: true },
       { name: "email", type: "string", required: true },
       { name: "username", type: "string", required: true }
     ]
   });
   ```

2. **Add Field:**
   ```typescript
   fields: [
     // ... existing fields
     { name: "bio", type: "string" } // NEW
   ]
   ```

3. **Regenerate:**
   ```bash
   bunx mandu generate scaffold user
   ```

4. **Result:**
   - Generated schema updated
   - Generated types include `bio?: string`
   - Custom slot logic preserved
   - No breaking changes

---

## Learning Path Implementation

### Level 1: Basic Understanding (15 min)

**Goal:** Understand resource definitions

**Tasks:**
1. Read `spec/resources/user.resource.ts`
2. Explore `.mandu/generated/server/user/`
3. Identify slot markers in generated code

---

### Level 2: Customization (30 min)

**Goal:** Add custom business logic

**Tasks:**
1. Add authentication to user API
2. Implement publish logic for posts
3. Add comment moderation filter

---

### Level 3: Schema Evolution (15 min)

**Goal:** Safely modify resources

**Tasks:**
1. Add `bio` field to user resource
2. Regenerate scaffold
3. Verify custom logic preserved

---

### Level 4: Frontend Integration (30 min)

**Goal:** Use generated clients

**Tasks:**
1. Create post creation form
2. Implement comment submission
3. Add user profile page

---

## Testing Strategy

### Unit Tests

```typescript
// tests/user.test.ts
import { describe, test, expect } from "bun:test";
import { userClient } from ".mandu/generated/web/user/client";

describe("User API", () => {
  test("GET /api/users requires auth", async () => {
    const response = await userClient.GET();
    expect(response.status).toBe(401);
  });

  test("POST /api/users creates user", async () => {
    const response = await userClient.POST({
      body: {
        email: "test@example.com",
        username: "testuser"
      }
    });
    expect(response.status).toBe(201);
    expect(response.data.user.email).toBe("test@example.com");
  });
});
```

---

## Production Considerations

**What this demo includes:**
- ✅ Resource definitions
- ✅ Custom slot logic
- ✅ Type-safe clients
- ✅ Schema evolution patterns

**What's simplified (for demo):**
- ⚠️ In-memory database (use PostgreSQL in production)
- ⚠️ Simple auth (use proper JWT/session management)
- ⚠️ Basic validation (add comprehensive validators)
- ⚠️ No rate limiting (add rate limiter middleware)
- ⚠️ No pagination (implement for large datasets)

---

## Implementation Checklist

### Phase 1: Setup
- [ ] Create project directory
- [ ] Initialize with `bun init`
- [ ] Install Mandu dependencies
- [ ] Create mandu.config.ts

### Phase 2: Resources
- [ ] Define user.resource.ts
- [ ] Define post.resource.ts
- [ ] Define comment.resource.ts
- [ ] Generate scaffolds

### Phase 3: Customization
- [ ] Add auth guard to user API
- [ ] Implement publish logic in post API
- [ ] Add moderation to comment API

### Phase 4: Frontend
- [ ] Create home page (post list)
- [ ] Create post detail page
- [ ] Create user profile page
- [ ] Add post creation form

### Phase 5: Testing
- [ ] Write user API tests
- [ ] Write post API tests
- [ ] Write comment API tests
- [ ] E2E tests for critical flows

### Phase 6: Documentation
- [ ] Complete README.md
- [ ] Add inline code comments
- [ ] Create learning path guide

---

## Related Documentation

- [Resource Architecture](../../docs/resource-architecture.md)
- [API Reference](../../docs/api/defineResource.md)
- [Tutorial](../../docs/guides/resource-workflow.md)
