# Prisma Guide (Official)

This guide shows how to add Prisma to a Mandu project with a clean, Guard-friendly structure.

## Prerequisites

- Bun installed
- A database URL (SQLite is easiest for local dev)

## 1) Install Prisma

```bash
bun add @prisma/client
bun add -d prisma
```

## 2) Initialize Prisma

```bash
bunx prisma init
```

This creates:

- `prisma/schema.prisma`
- `.env` (with `DATABASE_URL`)

If `bunx` fails for any reason, use:

```bash
npx prisma init
```

## 3) Define Schema

Example `prisma/schema.prisma` (SQLite):

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
}
```

Example `.env`:

```env
DATABASE_URL="file:./dev.db"
```

## 4) Migrate + Generate Client

```bash
bunx prisma migrate dev --name init
```

If `bunx` fails, run:

```bash
npx prisma migrate dev --name init
```

## 5) Create Prisma Client (Server Layer)

Create `src/server/infra/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

Why this pattern:

- Prevents multiple clients during dev reloads
- Keeps DB access in `server/infra` (Guard-friendly)

## 6) Use Prisma in an API Route

Example `app/api/users/route.ts`:

```ts
import { prisma } from "../../../src/server/infra/prisma";

export async function GET() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ data: users });
}

export async function POST(request: Request) {
  const body = await request.json();
  const user = await prisma.user.create({
    data: {
      email: body.email,
      name: body.name,
    },
  });
  return Response.json({ data: user }, { status: 201 });
}
```

## 7) Use Prisma in Slot/Filling (Optional)

Example `spec/slots/users.slot.ts`:

```ts
import { Mandu } from "@mandujs/core";
import { prisma } from "../../src/server/infra/prisma";

export default Mandu.filling()
  .get(async (ctx) => {
    const users = await prisma.user.findMany();
    return ctx.ok({ data: users });
  })
  .post(async (ctx) => {
    const body = await ctx.body<{ email: string; name?: string }>();
    const user = await prisma.user.create({ data: body });
    return ctx.created({ data: user });
  });
```

## 8) Common Commands

```bash
# Create a new migration
bunx prisma migrate dev --name add_user_fields

# Generate client only
bunx prisma generate

# Open Prisma Studio
bunx prisma studio
```

## 9) Guard Notes (Layering)

Recommended location for Prisma:

- `src/server/infra/prisma.ts`

Then import it only from:

- `app/api/*` routes
- `spec/slots/*`
- `src/server/*` modules

This keeps all DB access on the server side and avoids Guard violations.

## 10) Troubleshooting

**Prisma CLI fails under Bun**  
Use `npx prisma ...` (Prisma CLI runs in Node).

**Multiple connections in dev**  
Use the singleton pattern shown in step 5.

**Guard violation importing Prisma from client code**  
Ensure Prisma usage stays in `server` or `app/api` only.
