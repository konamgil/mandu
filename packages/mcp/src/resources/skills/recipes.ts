/**
 * Mandu MCP Skills - Recipes
 * 작업별 step-by-step 레시피
 */

export const RECIPE_ADD_API_ROUTE = `# API 라우트 추가하기

## 목표
새로운 REST API 엔드포인트를 추가합니다.

## Step 1: 파일 생성

\`app/api/{name}/route.ts\` 파일을 생성합니다.

예시: 사용자 API를 만들려면 \`app/api/users/route.ts\`

## Step 2: 핸들러 작성

\`\`\`typescript
// app/api/users/route.ts

// GET /api/users
export function GET() {
  const users = [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ];
  return Response.json({ data: users });
}

// POST /api/users
export async function POST(request: Request) {
  const body = await request.json();

  // 유효성 검사
  if (!body.name) {
    return Response.json(
      { error: "name is required" },
      { status: 400 }
    );
  }

  const newUser = { id: Date.now(), ...body };
  return Response.json(
    { data: newUser },
    { status: 201 }
  );
}
\`\`\`

## Step 3: 개발 서버 실행

\`\`\`bash
bun run dev
\`\`\`

## Step 4: 테스트

\`\`\`bash
# GET 요청
curl http://localhost:3000/api/users

# POST 요청
curl -X POST http://localhost:3000/api/users \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Charlie"}'
\`\`\`

## 추가 메서드

필요에 따라 다른 HTTP 메서드도 추가할 수 있습니다:

\`\`\`typescript
export function PUT(request: Request) { ... }
export function PATCH(request: Request) { ... }
export function DELETE(request: Request) { ... }
\`\`\`

## 동적 라우트

특정 ID의 사용자를 처리하려면:

\`\`\`typescript
// app/api/users/[id]/route.ts

export function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  return Response.json({ userId: id });
}

export function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  // 삭제 로직
  return new Response(null, { status: 204 });
}
\`\`\`

## 완료!

API가 다음 URL에서 사용 가능합니다:
- GET/POST: \`http://localhost:3000/api/users\`
- GET/DELETE: \`http://localhost:3000/api/users/:id\`
`;

export const RECIPE_ADD_PAGE = `# 페이지 추가하기

## 목표
새로운 페이지를 추가합니다.

## Step 1: 파일 생성

\`app/{path}/page.tsx\` 파일을 생성합니다.

예시:
- \`app/about/page.tsx\` → \`/about\`
- \`app/products/page.tsx\` → \`/products\`
- \`app/blog/posts/page.tsx\` → \`/blog/posts\`

## Step 2: 페이지 컴포넌트 작성

\`\`\`tsx
// app/about/page.tsx

export default function AboutPage() {
  return (
    <div>
      <h1>About Us</h1>
      <p>Welcome to our company!</p>

      <section>
        <h2>Our Mission</h2>
        <p>Building great software.</p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>Email: hello@example.com</p>
      </section>
    </div>
  );
}
\`\`\`

## Step 3: 메타데이터 추가 (선택)

\`\`\`tsx
// app/about/page.tsx

export const metadata = {
  title: "About Us | My App",
  description: "Learn about our company and mission",
};

export default function AboutPage() {
  return (
    <div>
      <h1>About Us</h1>
      {/* ... */}
    </div>
  );
}
\`\`\`

## Step 4: 확인

\`\`\`bash
bun run dev
# http://localhost:3000/about 접속
\`\`\`

## 동적 페이지

URL 파라미터를 받는 페이지:

\`\`\`tsx
// app/users/[id]/page.tsx

interface Props {
  params: { id: string };
}

export default function UserPage({ params }: Props) {
  return (
    <div>
      <h1>User Profile</h1>
      <p>User ID: {params.id}</p>
    </div>
  );
}
\`\`\`

## 스타일 추가

\`\`\`tsx
// app/about/page.tsx

export default function AboutPage() {
  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <h1 style={{ color: "#333" }}>About Us</h1>
      <p style={{ lineHeight: 1.6 }}>Welcome!</p>
    </div>
  );
}
\`\`\`

또는 CSS 파일 사용:

\`\`\`tsx
import "./about.css";

export default function AboutPage() {
  return (
    <div className="about-container">
      <h1 className="about-title">About Us</h1>
    </div>
  );
}
\`\`\`

## 레이아웃 적용

페이지에 레이아웃을 적용하려면 같은 폴더에 \`layout.tsx\` 생성:

\`\`\`tsx
// app/about/layout.tsx

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="about-layout">
      <nav>About Section Nav</nav>
      <main>{children}</main>
    </div>
  );
}
\`\`\`

## 완료!

페이지가 \`http://localhost:3000/about\`에서 사용 가능합니다.
`;

export const RECIPE_ADD_AUTH = `# 인증 추가하기

## 목표
API에 인증(Authentication)을 추가합니다.

## Step 1: 인증 유틸리티 생성

\`\`\`typescript
// app/lib/auth.ts

export interface User {
  id: number;
  email: string;
  name: string;
}

// 간단한 토큰 검증 (실제로는 JWT 등 사용)
export function verifyToken(token: string): User | null {
  // 예시: "Bearer user_1" 형식
  if (token.startsWith("Bearer user_")) {
    const userId = parseInt(token.replace("Bearer user_", ""));
    return {
      id: userId,
      email: \`user\${userId}@example.com\`,
      name: \`User \${userId}\`,
    };
  }
  return null;
}

export function getAuthUser(request: Request): User | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;
  return verifyToken(authHeader);
}
\`\`\`

## Step 2: 인증이 필요한 API 작성

\`\`\`typescript
// app/api/me/route.ts

import { getAuthUser } from "@/app/lib/auth";

export function GET(request: Request) {
  const user = getAuthUser(request);

  if (!user) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  return Response.json({ user });
}
\`\`\`

## Step 3: 미들웨어로 공통 처리 (선택)

\`\`\`typescript
// app/api/protected/route.ts

import { getAuthUser } from "@/app/lib/auth";

// 인증 체크 헬퍼
function requireAuth(request: Request) {
  const user = getAuthUser(request);
  if (!user) {
    return {
      error: Response.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    };
  }
  return { error: null, user };
}

export function GET(request: Request) {
  const { error, user } = requireAuth(request);
  if (error) return error;

  return Response.json({
    message: \`Hello, \${user!.name}!\`,
    user,
  });
}

export async function POST(request: Request) {
  const { error, user } = requireAuth(request);
  if (error) return error;

  const body = await request.json();
  return Response.json({
    message: "Created by " + user!.name,
    data: body,
  });
}
\`\`\`

## Step 4: Slot을 사용한 인증 (권장)

Mandu.filling()의 guard를 사용하면 더 깔끔합니다:

\`\`\`typescript
// spec/slots/protected.slot.ts

import { Mandu } from "@mandujs/core";
import { getAuthUser, type User } from "@/app/lib/auth";

export default Mandu.filling()
  .onRequest((ctx) => {
    // 모든 요청에서 사용자 확인
    const user = getAuthUser(ctx.req);
    if (user) {
      ctx.set("user", user);
    }
  })
  .guard((ctx) => {
    const user = ctx.get<User>("user");
    if (!user) {
      return ctx.unauthorized("로그인이 필요합니다");
    }
  })
  .get((ctx) => {
    const user = ctx.get<User>("user");
    return ctx.ok({ user });
  })
  .post(async (ctx) => {
    const user = ctx.get<User>("user");
    const body = await ctx.body();
    return ctx.created({
      createdBy: user!.name,
      data: body,
    });
  });
\`\`\`

## Step 5: 테스트

\`\`\`bash
# 인증 없이 (401 에러)
curl http://localhost:3000/api/me

# 인증 포함 (성공)
curl http://localhost:3000/api/me \\
  -H "Authorization: Bearer user_1"

# POST 요청
curl -X POST http://localhost:3000/api/protected \\
  -H "Authorization: Bearer user_1" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "Hello"}'
\`\`\`

## 로그인 API 추가

\`\`\`typescript
// app/api/login/route.ts

export async function POST(request: Request) {
  const { email, password } = await request.json();

  // 실제로는 DB에서 사용자 확인
  if (email === "admin@example.com" && password === "password") {
    return Response.json({
      token: "Bearer user_1",
      user: { id: 1, email, name: "Admin" },
    });
  }

  return Response.json(
    { error: "Invalid credentials" },
    { status: 401 }
  );
}
\`\`\`

## 완료!

인증 시스템이 추가되었습니다:
- \`POST /api/login\` - 로그인
- \`GET /api/me\` - 현재 사용자 정보
- 보호된 API는 \`Authorization\` 헤더 필요
`;

export const RECIPE_ADD_ISLAND = `# Island 컴포넌트 추가하기

## 목표
인터랙티브한 Island 컴포넌트를 페이지에 추가합니다.

## Step 1: 클라이언트 컴포넌트 생성

\`"use client"\` 지시어를 사용하여 클라이언트 컴포넌트를 만듭니다.

\`\`\`tsx
// app/counter/client.tsx

"use client";

import { useState } from "react";

interface CounterProps {
  initial?: number;
  step?: number;
}

export default function Counter({ initial = 0, step = 1 }: CounterProps) {
  const [count, setCount] = useState(initial);

  return (
    <div style={{ padding: "20px", border: "1px solid #ccc", borderRadius: "8px" }}>
      <h2>Interactive Counter</h2>
      <p style={{ fontSize: "2rem", fontWeight: "bold" }}>{count}</p>
      <div style={{ display: "flex", gap: "10px" }}>
        <button onClick={() => setCount(c => c - step)}>-{step}</button>
        <button onClick={() => setCount(initial)}>Reset</button>
        <button onClick={() => setCount(c => c + step)}>+{step}</button>
      </div>
    </div>
  );
}
\`\`\`

## Step 2: 페이지에서 사용

\`\`\`tsx
// app/counter/page.tsx

import Counter from "./client";

export default function CounterPage() {
  return (
    <div style={{ padding: "20px" }}>
      <h1>Counter Demo</h1>
      <p>아래 카운터는 클라이언트에서 hydration됩니다.</p>

      {/* Island 컴포넌트 */}
      <Counter initial={10} step={5} />

      <p style={{ marginTop: "20px", color: "#666" }}>
        이 텍스트는 정적 HTML입니다.
      </p>
    </div>
  );
}
\`\`\`

## Step 3: 확인

\`\`\`bash
bun run dev
# http://localhost:3000/counter 접속
\`\`\`

버튼을 클릭하면 카운터가 동작합니다!

## 더 복잡한 Island 예제

### Form Island

\`\`\`tsx
// app/contact/client.tsx

"use client";

import { useState } from "react";

export default function ContactForm() {
  const [formData, setFormData] = useState({ name: "", email: "", message: "" });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        setStatus("success");
        setFormData({ name: "", email: "", message: "" });
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>Name</label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>
      <div>
        <label>Email</label>
        <input
          type="email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          required
        />
      </div>
      <div>
        <label>Message</label>
        <textarea
          value={formData.message}
          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
          required
        />
      </div>
      <button type="submit" disabled={status === "loading"}>
        {status === "loading" ? "Sending..." : "Send"}
      </button>
      {status === "success" && <p style={{ color: "green" }}>Sent!</p>}
      {status === "error" && <p style={{ color: "red" }}>Failed to send</p>}
    </form>
  );
}
\`\`\`

### Data Fetching Island

\`\`\`tsx
// app/users/client.tsx

"use client";

import { useState, useEffect } from "react";

interface User {
  id: number;
  name: string;
}

export default function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/users")
      .then((res) => res.json())
      .then((data) => {
        setUsers(data.data);
        setLoading(false);
      });
  }, []);

  if (loading) return <p>Loading...</p>;

  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
\`\`\`

## Mandu.island() API (고급)

서버 데이터와 클라이언트 상태를 분리하려면:

\`\`\`typescript
// spec/slots/todos.client.ts

import { Mandu } from "@mandujs/core/client";
import { useState } from "react";

interface ServerData {
  todos: { id: number; text: string; done: boolean }[];
}

export default Mandu.island<ServerData>({
  setup: (serverData) => {
    const [todos, setTodos] = useState(serverData.todos);

    const toggle = (id: number) => {
      setTodos(prev => prev.map(t =>
        t.id === id ? { ...t, done: !t.done } : t
      ));
    };

    return { todos, toggle };
  },

  render: ({ todos, toggle }) => (
    <ul>
      {todos.map(todo => (
        <li key={todo.id} onClick={() => toggle(todo.id)}>
          {todo.done ? "✅" : "⬜"} {todo.text}
        </li>
      ))}
    </ul>
  ),
});
\`\`\`

## 완료!

Island 컴포넌트가 추가되었습니다:
- 정적 HTML 부분은 서버에서 렌더링
- 인터랙티브 부분만 클라이언트에서 hydration
- JavaScript 번들 크기 최소화
`;

export const RECIPE_ADD_DATABASE = `# 데이터베이스 연결하기

## 목표
API에 데이터베이스를 연결합니다.

## Step 1: 데이터베이스 클라이언트 설치

\`\`\`bash
# SQLite (간단한 시작)
bun add better-sqlite3

# 또는 PostgreSQL
bun add pg

# 또는 Prisma (ORM)
bun add prisma @prisma/client
\`\`\`

## Step 2: 데이터베이스 설정

### SQLite 예시

\`\`\`typescript
// app/lib/db.ts

import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "data.db"));

// 테이블 생성
db.exec(\`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
\`);

export default db;
\`\`\`

### Prisma 예시

\`\`\`bash
# Prisma 초기화
bunx prisma init
\`\`\`

\`\`\`prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model User {
  id        Int      @id @default(autoincrement())
  name      String
  email     String   @unique
  createdAt DateTime @default(now())
}
\`\`\`

\`\`\`bash
# 마이그레이션
bunx prisma migrate dev --name init
\`\`\`

\`\`\`typescript
// app/lib/db.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default prisma;
\`\`\`

## Step 3: API에서 사용

### SQLite 직접 사용

\`\`\`typescript
// app/api/users/route.ts

import db from "@/app/lib/db";

export function GET() {
  const users = db.prepare("SELECT * FROM users").all();
  return Response.json({ data: users });
}

export async function POST(request: Request) {
  const { name, email } = await request.json();

  try {
    const result = db
      .prepare("INSERT INTO users (name, email) VALUES (?, ?)")
      .run(name, email);

    return Response.json(
      { id: result.lastInsertRowid, name, email },
      { status: 201 }
    );
  } catch (error) {
    return Response.json(
      { error: "Email already exists" },
      { status: 400 }
    );
  }
}
\`\`\`

### Prisma 사용

\`\`\`typescript
// app/api/users/route.ts

import prisma from "@/app/lib/db";

export async function GET() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ data: users });
}

export async function POST(request: Request) {
  const { name, email } = await request.json();

  try {
    const user = await prisma.user.create({
      data: { name, email },
    });
    return Response.json(user, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: "Email already exists" },
      { status: 400 }
    );
  }
}
\`\`\`

## Step 4: Slot에서 사용

\`\`\`typescript
// spec/slots/users.slot.ts

import { Mandu } from "@mandujs/core";
import prisma from "@/app/lib/db";

export default Mandu.filling()
  .get(async (ctx) => {
    const { page = "1", limit = "10" } = ctx.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count(),
    ]);

    return ctx.ok({
      data: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
      },
    });
  })
  .post(async (ctx) => {
    const body = await ctx.body<{ name: string; email: string }>();

    if (!body.name || !body.email) {
      return ctx.error("name과 email이 필요합니다");
    }

    try {
      const user = await prisma.user.create({
        data: body,
      });
      return ctx.created({ data: user });
    } catch {
      return ctx.error("이미 존재하는 이메일입니다");
    }
  });
\`\`\`

## Step 5: 테스트

\`\`\`bash
# 사용자 생성
curl -X POST http://localhost:3000/api/users \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Alice", "email": "alice@example.com"}'

# 사용자 목록
curl http://localhost:3000/api/users

# 페이지네이션
curl "http://localhost:3000/api/users?page=1&limit=5"
\`\`\`

## 완료!

데이터베이스가 연결되었습니다:
- SQLite 또는 PostgreSQL 선택
- Prisma ORM으로 타입 안전한 쿼리
- API에서 CRUD 작업 가능
`;

// 모든 레시피 목록
export const RECIPES = {
  "add-api-route": RECIPE_ADD_API_ROUTE,
  "add-page": RECIPE_ADD_PAGE,
  "add-auth": RECIPE_ADD_AUTH,
  "add-island": RECIPE_ADD_ISLAND,
  "add-database": RECIPE_ADD_DATABASE,
} as const;

export type RecipeId = keyof typeof RECIPES;

export function getRecipe(id: string): string | null {
  return RECIPES[id as RecipeId] || null;
}

export function listRecipes(): { id: string; title: string; description: string }[] {
  return [
    {
      id: "add-api-route",
      title: "API 라우트 추가하기",
      description: "새로운 REST API 엔드포인트를 추가하는 방법",
    },
    {
      id: "add-page",
      title: "페이지 추가하기",
      description: "새로운 페이지를 추가하는 방법",
    },
    {
      id: "add-auth",
      title: "인증 추가하기",
      description: "API에 인증(Authentication)을 추가하는 방법",
    },
    {
      id: "add-island",
      title: "Island 컴포넌트 추가하기",
      description: "인터랙티브한 Island 컴포넌트를 추가하는 방법",
    },
    {
      id: "add-database",
      title: "데이터베이스 연결하기",
      description: "SQLite/PostgreSQL/Prisma로 데이터베이스를 연결하는 방법",
    },
  ];
}
