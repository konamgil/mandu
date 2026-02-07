---
title: Export HTTP Method Functions for API Routes
impact: HIGH
impactDescription: RESTful API structure
tags: routes, api, methods
---

## Export HTTP Method Functions for API Routes

API routes use named exports for each HTTP method: GET, POST, PUT, PATCH, DELETE.

**Incorrect (default export handler):**

```typescript
// app/api/users/route.ts
export default function handler(req: Request) {
  if (req.method === "GET") {
    return Response.json({ users: [] });
  }
}
```

**Correct (named method exports):**

```typescript
// app/api/users/route.ts

export function GET() {
  return Response.json({ users: [] });
}

export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ created: body }, { status: 201 });
}

export function DELETE() {
  return new Response(null, { status: 204 });
}
```

## Supported Methods

```typescript
export function GET(request: Request) { }
export function POST(request: Request) { }
export function PUT(request: Request) { }
export function PATCH(request: Request) { }
export function DELETE(request: Request) { }
export function HEAD(request: Request) { }
export function OPTIONS(request: Request) { }
```

## With Dynamic Parameters

```typescript
// app/api/users/[id]/route.ts

export function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  return Response.json({ userId: params.id });
}
```
