---
title: Use Supabase as Postgres provider
impact: MEDIUM
impactDescription: Managed Postgres + optional Realtime / Storage / Auth — Mandu consumes it as a connection string, not a deploy target
tags: database, postgres, supabase, baas
---

## Use Supabase as Postgres provider

> **Supabase 는 Mandu 의 배포 타겟이 아닙니다.** Mandu 앱은 Render / Fly / Railway /
> Vercel / Docker 등으로 배포하고, Supabase 는 **Postgres 제공자 + 선택적
> BaaS 기능** (Realtime, Storage, Auth, Edge Functions) 으로만 사용합니다.
> Mandu 의 `@mandujs/core/db` 가 `Bun.SQL` wrapper 이기 때문에 Supabase 의
> pooler URL 을 그대로 꽂으면 별도 SDK 없이 바로 동작합니다.

## 1. 가장 단순한 경로 — DB-only (권장)

Supabase 를 Postgres 로만 쓰는 경우. Mandu 의 네이티브 DB 레이어가 그대로 커버합니다.

### 1.1 Connection string 획득

Supabase Dashboard → Settings → Database → **Connection pooling**
- `Transaction` 모드 URL 복사 (포트 `6543`)
- 형식: `postgres://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`

### 1.2 `.env` 에 저장

```bash
DATABASE_URL=postgres://postgres.xxxx:your-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

### 1.3 Mandu DB 핸들 생성

```typescript
// lib/db.ts
import { createDb } from "@mandujs/core/db";

export const db = createDb({
  url: process.env.DATABASE_URL!,
});
```

### 1.4 Filling 에서 쿼리

```typescript
// app/users/[id]/route.ts
import { defineFilling, notFound } from "@mandujs/core/filling";
import { db } from "@/lib/db";

export const filling = defineFilling({
  async loader({ params }) {
    const user = await db.one<{ id: string; email: string; name: string }>`
      SELECT id, email, name FROM users WHERE id = ${params.id}
    `;
    if (!user) throw notFound();
    return { user };
  },
});
```

트랜잭션:

```typescript
await db.transaction(async (tx) => {
  const user = await tx.one<{ id: string }>`
    INSERT INTO users (email, name) VALUES (${email}, ${name}) RETURNING id
  `;
  await tx`INSERT INTO profiles (user_id, bio) VALUES (${user!.id}, ${bio})`;
});
```

**필요한 Supabase-specific 의존성**: 없음. `@mandujs/core/db` 만 사용. Supabase 가 바뀌어도 connection string 교체뿐.

## 2. 마이그레이션

Mandu 의 기본 마이그레이션 러너를 사용하거나 (`@mandujs/core/db/migrations`), Supabase CLI 를 병행할 수 있습니다.

### Mandu 마이그레이션 (권장)

```sql
-- migrations/001_users.sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

```bash
bun run mandu db migrate
```

### Supabase CLI 병행

RLS (Row Level Security) / policies 등 Supabase-native 기능이 필요한 경우:

```bash
npm install -g supabase
supabase login
supabase init
supabase migration new create_users_table
# edit supabase/migrations/<timestamp>_create_users_table.sql
supabase db push
```

`ALTER TABLE users ENABLE ROW LEVEL SECURITY;` 등은 plain SQL 이므로 Mandu 마이그레이션에도 그대로 작성 가능. Supabase CLI 는 RLS policy 편집 UX 와 타입 생성 (`supabase gen types typescript`) 때문에 편리합니다.

## 3. Supabase SDK 를 함께 쓰고 싶다면 (BaaS 기능)

DB 는 `@mandujs/core/db` 로, Supabase-specific 기능 (Realtime / Storage / Edge Functions) 만 SDK 로 사용하는 하이브리드가 깔끔합니다.

### 3.1 클라이언트 설정

```bash
bun add @supabase/supabase-js
```

```typescript
// lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 서버 사이드 (Service Role) — filling 안에서만 사용
export function createServerSupabase() {
  return createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

### 3.2 Realtime (Island)

Mandu 의 client island 에서 Realtime 구독:

```tsx
// app/messages/MessagesIsland.client.tsx
import { wrapComponent } from "@mandujs/core/client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

function Messages() {
  const [messages, setMessages] = useState<Array<{ id: string; content: string }>>([]);

  useEffect(() => {
    supabase.from("messages").select("*").then(({ data }) => {
      setMessages(data ?? []);
    });

    const channel = supabase
      .channel("messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as { id: string; content: string }]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <ul>
      {messages.map((m) => <li key={m.id}>{m.content}</li>)}
    </ul>
  );
}

export default wrapComponent(Messages);
```

### 3.3 Storage

```typescript
// filling 내에서
const serverSupabase = createServerSupabase();

const { data, error } = await serverSupabase.storage
  .from("avatars")
  .upload(`${userId}/avatar.png`, file);

const { data: { publicUrl } } = serverSupabase.storage
  .from("avatars")
  .getPublicUrl(`${userId}/avatar.png`);
```

### 3.4 Edge Functions

Supabase 의 Deno 런타임에서 도는 서버리스 함수. Mandu 앱 바깥에서 별도 배포되고, Mandu 는 HTTP 로 호출만:

```typescript
const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/hello`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ name: "mandu" }),
});
```

## 4. Supabase Auth 와 Mandu auth — 선택 문제

두 가지가 겹치는 영역이라 **둘 중 하나만** 씁니다:

| Mandu 의 `@mandujs/core/auth` (native) | Supabase Auth |
|---|---|
| Bun.password (argon2id) | Bcrypt + custom hashing |
| `@mandujs/core/middleware/session` SQLite session store | JWT + cookie |
| CSRF (`@mandujs/core/middleware/csrf`) | — |
| Mandu 프로젝트 자체 사용자 테이블 | Supabase `auth.users` 테이블 |

**추천**: Mandu 앱이 Supabase 의 다른 기능 (Realtime / Storage) 을 안 쓰면 **Mandu native auth** 가 의존성 적고 예측 가능. Supabase 의 social providers (GitHub / Google OAuth UI) 가 필요하면 Supabase Auth 를 쓰고 Mandu auth 는 bypass.

병행 사용 (Supabase Auth 만 이용하면서 Mandu filling 안에서 token 검증):

```typescript
// middleware/supabase-auth.ts
import { createServerSupabase } from "@/lib/supabase";

export async function supabaseAuthMiddleware(ctx) {
  const header = ctx.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return ctx.unauthorized("Missing token");

  const token = header.slice(7);
  const supabase = createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return ctx.unauthorized("Invalid token");

  ctx.set("user", user);
}
```

## 5. 환경 변수

```bash
# .env
# DB connection (최소 요구사항)
DATABASE_URL=postgres://postgres.xxx:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# Supabase SDK 사용 시 추가
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # 서버 전용, 클라이언트에 노출 금지
```

## 6. 배포 플랫폼과 조합

Supabase 는 DB layer 이므로 **Mandu 앱 자체는 다른 곳** 에 배포합니다. `DATABASE_URL` 만 환경 변수로 주입:

### Render (`mandu deploy --target=render` 가 자동 생성)

```yaml
# render.yaml
services:
  - type: web
    name: mandu-app
    runtime: node
    buildCommand: |
      curl -fsSL https://bun.sh/install | bash
      export PATH="$HOME/.bun/bin:$PATH"
      bun install --frozen-lockfile
      bun run build
    startCommand: bun run start
    envVars:
      - key: DATABASE_URL
        sync: false           # Render 대시보드에서 Supabase pooler URL 설정
      - key: SUPABASE_URL
        sync: false           # SDK 쓸 때만
      - key: SUPABASE_ANON_KEY
        sync: false
```

### Fly / Railway

```bash
fly secrets set DATABASE_URL="postgres://..." SUPABASE_URL="..." SUPABASE_ANON_KEY="..."
railway variables set DATABASE_URL="postgres://..." SUPABASE_URL="..." SUPABASE_ANON_KEY="..."
```

## 7. 주의사항

- **Transaction mode pooler (6543) 를 사용**하세요. Session mode (5432) 는 커넥션 고정이 필요한 경우에만.
- **Service Role key 는 서버 전용**. Client island 에서 절대 import 하지 마세요 — Mandu 의 island 번들에 포함되면 공개됩니다.
- **RLS 를 켜지 않은 테이블** 은 anon key 로 전체 읽기가 가능해집니다. 항상 `ENABLE ROW LEVEL SECURITY` 적용하고 policy 를 명시.
- **Realtime 구독은 client bundle 비용**이 큽니다 (`@supabase/supabase-js` ~60 KB). 페이지 단위로 island 분리하세요.

## Reference

- [Supabase Docs](https://supabase.com/docs)
- `@mandujs/core/db` — Bun.SQL wrapper, provider-agnostic. `packages/core/src/db/index.ts`
- Deploy adapters — `packages/cli/src/commands/deploy/adapters/{render,fly,railway,vercel,netlify,docker,docker-compose,cf-pages}.ts`
