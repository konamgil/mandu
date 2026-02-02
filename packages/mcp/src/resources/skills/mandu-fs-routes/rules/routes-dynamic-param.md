---
title: Use [param] for Dynamic Route Parameters
impact: MEDIUM
impactDescription: Enables dynamic URLs
tags: routes, dynamic, params
---

## Use [param] for Dynamic Route Parameters

Wrap folder name in brackets to create dynamic routes that capture URL segments.

**Incorrect (hardcoded routes):**

```
app/users/
├── user1/page.tsx
├── user2/page.tsx
└── user3/page.tsx
```

**Correct (dynamic parameter):**

```
app/users/
└── [id]/
    └── page.tsx    → /users/:id
```

## Accessing Parameters

### In Page Components

```tsx
// app/users/[id]/page.tsx

interface Props {
  params: { id: string };
}

export default function UserPage({ params }: Props) {
  return <h1>User ID: {params.id}</h1>;
}
```

### In API Routes

```typescript
// app/api/users/[id]/route.ts

export function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  return Response.json({ userId: params.id });
}
```

## Multiple Parameters

```
app/posts/[postId]/comments/[commentId]/page.tsx
→ /posts/:postId/comments/:commentId
```

```tsx
interface Props {
  params: { postId: string; commentId: string };
}

export default function CommentPage({ params }: Props) {
  return (
    <div>
      Post: {params.postId}, Comment: {params.commentId}
    </div>
  );
}
```

## Catch-All Routes

```
app/docs/[...slug]/page.tsx → /docs/a, /docs/a/b, /docs/a/b/c
```

```tsx
interface Props {
  params: { slug: string[] };
}

export default function DocsPage({ params }: Props) {
  return <p>Path: {params.slug.join("/")}</p>;
}
```
