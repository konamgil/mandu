---
title: Deploy with Supabase
impact: HIGH
impactDescription: Backend-as-a-Service with PostgreSQL and Edge Functions
tags: deployment, supabase, database, edge, baas
---

## Deploy with Supabase

**Impact: HIGH (Backend-as-a-Service with PostgreSQL and Edge Functions)**

Supabase를 사용하여 PostgreSQL 데이터베이스, 인증, Edge Functions를 통합하세요.

**프로젝트 설정:**

```bash
# Supabase CLI 설치
npm install -g supabase

# 로그인
supabase login

# 프로젝트 초기화
supabase init

# 로컬 개발 환경 시작
supabase start
```

## Supabase 클라이언트 설정

```typescript
// lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// 서버 사이드 (Service Role)
export function createServerClient() {
  return createClient<Database>(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
```

## 데이터베이스 마이그레이션

```bash
# 마이그레이션 생성
supabase migration new create_users_table
```

```sql
-- supabase/migrations/20240101000000_create_users_table.sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS 활성화
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- 정책 설정
CREATE POLICY "Users can read own data"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own data"
  ON users FOR UPDATE
  USING (auth.uid() = id);
```

```bash
# 마이그레이션 적용
supabase db push

# 타입 생성
supabase gen types typescript --local > lib/database.types.ts
```

## Mandu Slot에서 Supabase 사용

```typescript
// app/users/slot.ts
import { Mandu } from "@mandujs/core";
import { createServerClient } from "@/lib/supabase";

export default Mandu.filling({
  get: async (ctx) => {
    const supabase = createServerClient();
    const user = ctx.get<User>("user");

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error) {
      return ctx.error({ message: error.message });
    }

    return ctx.ok({ user: data });
  },

  post: async (ctx) => {
    const supabase = createServerClient();
    const body = await ctx.body<{ email: string; name: string }>();

    const { data, error } = await supabase
      .from("users")
      .insert(body)
      .select()
      .single();

    if (error) {
      return ctx.error({ message: error.message });
    }

    return ctx.created({ user: data });
  },
});
```

## Supabase Auth 통합

```typescript
// app/auth/slot.ts
import { Mandu } from "@mandujs/core";
import { supabase } from "@/lib/supabase";

export default Mandu.filling({
  // 로그인
  post: async (ctx) => {
    const { email, password } = await ctx.body<{
      email: string;
      password: string;
    }>();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return ctx.unauthorized(error.message);
    }

    return ctx.ok({
      user: data.user,
      session: data.session,
    });
  },

  // 로그아웃
  delete: async (ctx) => {
    await supabase.auth.signOut();
    return ctx.noContent();
  },
});
```

**Auth Middleware:**

```typescript
// middleware/auth.ts
import { createServerClient } from "@/lib/supabase";

export async function authMiddleware(ctx: Context) {
  const authHeader = ctx.headers.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return ctx.unauthorized("Missing token");
  }

  const token = authHeader.slice(7);
  const supabase = createServerClient();

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return ctx.unauthorized("Invalid token");
  }

  ctx.set("user", user);
}
```

## Edge Functions

```bash
# Edge Function 생성
supabase functions new hello
```

```typescript
// supabase/functions/hello/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const { name } = await req.json();

  return new Response(
    JSON.stringify({ message: `Hello ${name}!` }),
    { headers: { "Content-Type": "application/json" } }
  );
});
```

```bash
# 로컬 테스트
supabase functions serve hello

# 배포
supabase functions deploy hello
```

## 환경 변수 설정

```bash
# .env.local
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# 프로덕션 (Supabase Dashboard에서 확인)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

## Supabase + Render 배포

```yaml
# render.yaml
services:
  - type: web
    name: mandu-app
    runtime: node
    buildCommand: bun install && bun run build
    startCommand: bun run start
    envVars:
      - key: SUPABASE_URL
        sync: false  # Dashboard에서 설정
      - key: SUPABASE_ANON_KEY
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
```

## Realtime 구독 (Island)

```typescript
// app/messages/client.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function MessagesIsland() {
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    // 초기 데이터 로드
    supabase.from("messages").select("*").then(({ data }) => {
      setMessages(data || []);
    });

    // Realtime 구독
    const channel = supabase
      .channel("messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <ul>
      {messages.map((msg) => (
        <li key={msg.id}>{msg.content}</li>
      ))}
    </ul>
  );
}
```

## Storage 사용

```typescript
// 파일 업로드
const { data, error } = await supabase.storage
  .from("avatars")
  .upload(`${userId}/avatar.png`, file);

// 공개 URL 가져오기
const { data: { publicUrl } } = supabase.storage
  .from("avatars")
  .getPublicUrl(`${userId}/avatar.png`);
```

Reference: [Supabase Documentation](https://supabase.com/docs)
