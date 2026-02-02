/**
 * Mandu MCP Skills - Guides
 * 에이전트가 Mandu를 학습할 수 있는 가이드 문서
 */

export const GUIDE_SLOT = `# Mandu Slot 작성 가이드

## 개요

Slot은 비즈니스 로직을 작성하는 파일입니다. \`Mandu.filling()\` API를 사용합니다.

## 파일 위치

\`\`\`
spec/slots/{name}.slot.ts    # 서버 로직
spec/slots/{name}.client.ts  # 클라이언트 로직 (Island)
\`\`\`

## 기본 구조

\`\`\`typescript
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .get((ctx) => {
    return ctx.ok({ message: "Hello!" });
  });
\`\`\`

## HTTP 메서드

\`\`\`typescript
export default Mandu.filling()
  .get((ctx) => ctx.ok({ data: [] }))           // GET
  .post(async (ctx) => {                        // POST
    const body = await ctx.body();
    return ctx.created({ data: body });
  })
  .put(async (ctx) => { ... })                  // PUT
  .patch(async (ctx) => { ... })                // PATCH
  .delete((ctx) => ctx.noContent());            // DELETE
\`\`\`

## Context API

### 응답 메서드

| 메서드 | HTTP 상태 | 설명 |
|--------|-----------|------|
| \`ctx.ok(data)\` | 200 | 성공 |
| \`ctx.created(data)\` | 201 | 생성됨 |
| \`ctx.noContent()\` | 204 | 내용 없음 |
| \`ctx.error(message)\` | 400 | 잘못된 요청 |
| \`ctx.unauthorized(message)\` | 401 | 인증 필요 |
| \`ctx.forbidden(message)\` | 403 | 권한 없음 |
| \`ctx.notFound(message)\` | 404 | 찾을 수 없음 |
| \`ctx.fail(message)\` | 500 | 서버 오류 |

### 요청 데이터

\`\`\`typescript
// Request body (POST, PUT, PATCH)
const body = await ctx.body<{ name: string }>();

// URL 파라미터 (/users/:id)
const { id } = ctx.params;

// Query string (?page=1&limit=10)
const { page, limit } = ctx.query;

// Headers
const authHeader = ctx.headers.get("authorization");
\`\`\`

### 상태 저장/조회

\`\`\`typescript
// 저장
ctx.set("user", { id: 1, name: "Alice" });

// 조회
const user = ctx.get<User>("user");
\`\`\`

## 가드 (인증/권한)

\`\`\`typescript
export default Mandu.filling()
  .guard((ctx) => {
    const user = ctx.get("user");
    if (!user) {
      return ctx.unauthorized("로그인이 필요합니다");
    }
    // void 반환 시 계속 진행
  })
  .get((ctx) => {
    const user = ctx.get("user");
    return ctx.ok({ user });
  });
\`\`\`

## 라이프사이클 훅

\`\`\`typescript
export default Mandu.filling()
  .onRequest((ctx) => {
    // 요청 시작 시
    ctx.set("startTime", Date.now());
  })
  .beforeHandle((ctx) => {
    // 핸들러 전 (가드 역할)
  })
  .afterHandle((ctx, res) => {
    // 핸들러 후
    return res;
  })
  .afterResponse((ctx) => {
    // 응답 후 (로깅 등)
    console.log("Duration:", Date.now() - ctx.get("startTime"));
  })
  .get((ctx) => ctx.ok({ data: [] }));
\`\`\`

## 전체 예제: CRUD API

\`\`\`typescript
import { Mandu } from "@mandujs/core";

interface User {
  id: number;
  name: string;
  email: string;
}

const users: User[] = [];

export default Mandu.filling()
  .guard((ctx) => {
    const apiKey = ctx.headers.get("x-api-key");
    if (apiKey !== "secret") {
      return ctx.unauthorized("Invalid API key");
    }
  })
  .get((ctx) => {
    const { page = "1", limit = "10" } = ctx.query;
    const start = (parseInt(page) - 1) * parseInt(limit);
    const items = users.slice(start, start + parseInt(limit));
    return ctx.ok({ data: items, total: users.length });
  })
  .post(async (ctx) => {
    const body = await ctx.body<{ name: string; email: string }>();

    if (!body.name || !body.email) {
      return ctx.error("name과 email이 필요합니다");
    }

    const newUser: User = {
      id: users.length + 1,
      ...body,
    };
    users.push(newUser);

    return ctx.created({ data: newUser });
  });
\`\`\`
`;

export const GUIDE_FS_ROUTES = `# Mandu FS Routes 가이드

## 개요

FS Routes는 파일 시스템 기반 라우팅입니다. \`app/\` 폴더의 파일 구조가 URL이 됩니다.

## 기본 규칙

| 파일 경로 | URL |
|-----------|-----|
| \`app/page.tsx\` | \`/\` |
| \`app/about/page.tsx\` | \`/about\` |
| \`app/users/page.tsx\` | \`/users\` |
| \`app/api/health/route.ts\` | \`/api/health\` |

## 특수 파일

| 파일명 | 용도 |
|--------|------|
| \`page.tsx\` | 페이지 컴포넌트 |
| \`route.ts\` | API 핸들러 |
| \`layout.tsx\` | 레이아웃 (하위 페이지 감싸기) |
| \`loading.tsx\` | 로딩 UI |
| \`error.tsx\` | 에러 UI |
| \`slot.ts\` | 서버 비즈니스 로직 |
| \`client.tsx\` | 클라이언트 인터랙티브 컴포넌트 |

## 동적 라우트

### 단일 파라미터

\`\`\`
app/users/[id]/page.tsx  →  /users/123, /users/456
\`\`\`

\`\`\`tsx
export default function UserPage({ params }: { params: { id: string } }) {
  return <h1>User ID: {params.id}</h1>;
}
\`\`\`

### Catch-all

\`\`\`
app/docs/[...slug]/page.tsx  →  /docs/a, /docs/a/b, /docs/a/b/c
\`\`\`

\`\`\`tsx
export default function DocsPage({ params }: { params: { slug: string[] } }) {
  return <h1>Path: {params.slug.join("/")}</h1>;
}
\`\`\`

### Optional Catch-all

\`\`\`
app/shop/[[...slug]]/page.tsx  →  /shop, /shop/a, /shop/a/b
\`\`\`

## 라우트 그룹

괄호로 감싸면 URL에 포함되지 않음:

\`\`\`
app/(auth)/login/page.tsx    →  /login
app/(auth)/register/page.tsx →  /register
app/(dashboard)/home/page.tsx →  /home
\`\`\`

## API 라우트

### 기본 구조

\`\`\`typescript
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
\`\`\`

### 지원 메서드

- \`GET\`, \`POST\`, \`PUT\`, \`PATCH\`, \`DELETE\`, \`HEAD\`, \`OPTIONS\`

## 페이지 컴포넌트

### 기본 구조

\`\`\`tsx
// app/page.tsx

export default function Home() {
  return (
    <div>
      <h1>Welcome to Mandu!</h1>
    </div>
  );
}
\`\`\`

### 메타데이터

\`\`\`tsx
export const metadata = {
  title: "Home | My App",
  description: "Welcome page",
};

export default function Home() {
  return <h1>Home</h1>;
}
\`\`\`

## 레이아웃

\`\`\`tsx
// app/layout.tsx

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <title>My App</title>
      </head>
      <body>
        <nav>...</nav>
        <main>{children}</main>
        <footer>...</footer>
      </body>
    </html>
  );
}
\`\`\`

### 중첩 레이아웃

\`\`\`
app/
├── layout.tsx          # 루트 레이아웃
├── page.tsx
└── dashboard/
    ├── layout.tsx      # 대시보드 레이아웃 (루트 안에 중첩)
    └── page.tsx
\`\`\`

## 프로젝트 구조 예시

\`\`\`
app/
├── page.tsx                    # /
├── layout.tsx                  # 루트 레이아웃
├── about/
│   └── page.tsx                # /about
├── users/
│   ├── page.tsx                # /users
│   └── [id]/
│       └── page.tsx            # /users/:id
├── api/
│   ├── health/
│   │   └── route.ts            # /api/health
│   └── users/
│       ├── route.ts            # /api/users
│       └── [id]/
│           └── route.ts        # /api/users/:id
└── (auth)/
    ├── login/
    │   └── page.tsx            # /login
    └── register/
        └── page.tsx            # /register
\`\`\`
`;

export const GUIDE_HYDRATION = `# Mandu Island Hydration 가이드

## 개요

Island Hydration은 페이지의 일부분만 클라이언트에서 인터랙티브하게 만드는 기술입니다.
대부분의 페이지는 정적 HTML로 유지하고, 필요한 부분만 JavaScript를 로드합니다.

## 장점

- **빠른 초기 로드**: 대부분 정적 HTML
- **적은 JavaScript**: 필요한 부분만 로드
- **SEO 친화적**: 완전한 HTML 콘텐츠

## Hydration 전략

| 전략 | 설명 | 사용 사례 |
|------|------|----------|
| \`none\` | JavaScript 없음 | 순수 정적 페이지 |
| \`island\` | 부분 hydration (기본값) | 정적 + 인터랙티브 혼합 |
| \`full\` | 전체 hydration | SPA 스타일 페이지 |

## Hydration 우선순위

| 우선순위 | 로드 시점 | 사용 사례 |
|----------|----------|----------|
| \`immediate\` | 페이지 로드 시 | 중요한 인터랙션 |
| \`visible\` | 뷰포트 진입 시 (기본값) | 스크롤 아래 콘텐츠 |
| \`idle\` | 브라우저 유휴 시 | 비중요 기능 |
| \`interaction\` | 사용자 상호작용 시 | 클릭해야 활성화 |

## Island 만들기

### 1. 클라이언트 컴포넌트 작성

\`\`\`tsx
// app/counter/client.tsx

"use client";

import { useState } from "react";

export default function Counter({ initial = 0 }: { initial?: number }) {
  const [count, setCount] = useState(initial);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c - 1)}>-</button>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  );
}
\`\`\`

### 2. 페이지에서 사용

\`\`\`tsx
// app/counter/page.tsx

import Counter from "./client";

export default function CounterPage() {
  return (
    <div>
      <h1>Counter Demo</h1>
      <p>이 텍스트는 정적 HTML입니다.</p>

      {/* 이 부분만 hydration됩니다 */}
      <Counter initial={10} />
    </div>
  );
}
\`\`\`

## Mandu.island() API

고급 Island 패턴을 위한 API:

\`\`\`typescript
// spec/slots/todos.client.ts

import { Mandu } from "@mandujs/core/client";
import { useState, useCallback } from "react";

interface TodosData {
  todos: { id: number; text: string; done: boolean }[];
}

export default Mandu.island<TodosData>({
  // Setup: 서버 데이터로 클라이언트 상태 초기화
  setup: (serverData) => {
    const [todos, setTodos] = useState(serverData.todos);

    const addTodo = useCallback((text: string) => {
      setTodos(prev => [...prev, { id: Date.now(), text, done: false }]);
    }, []);

    const toggleTodo = useCallback((id: number) => {
      setTodos(prev => prev.map(t =>
        t.id === id ? { ...t, done: !t.done } : t
      ));
    }, []);

    return { todos, addTodo, toggleTodo };
  },

  // Render: 순수 렌더링 로직
  render: ({ todos, addTodo, toggleTodo }) => (
    <div>
      <ul>
        {todos.map(todo => (
          <li key={todo.id} onClick={() => toggleTodo(todo.id)}>
            {todo.done ? "✅" : "⬜"} {todo.text}
          </li>
        ))}
      </ul>
      <button onClick={() => addTodo("New Todo")}>Add</button>
    </div>
  ),

  // 선택: 에러 UI
  errorBoundary: (error, reset) => (
    <div>
      <p>Error: {error.message}</p>
      <button onClick={reset}>Retry</button>
    </div>
  ),

  // 선택: 로딩 UI
  loading: () => <p>Loading...</p>,
});
\`\`\`

## Island 간 통신

\`\`\`typescript
import { useIslandEvent } from "@mandujs/core/client";

// Island A: 이벤트 발송
const { emit } = useIslandEvent<{ count: number }>("counter-update");
emit({ count: 42 });

// Island B: 이벤트 수신
useIslandEvent<{ count: number }>("counter-update", (data) => {
  console.log("Received:", data.count);
});
\`\`\`

## 클라이언트 훅

\`\`\`typescript
import {
  useServerData,
  useHydrated,
  useIslandEvent,
} from "@mandujs/core/client";

// SSR 데이터 접근
const data = useServerData<UserData>("user", defaultValue);

// Hydration 완료 여부
const isHydrated = useHydrated();
\`\`\`

## 빌드

\`\`\`bash
# 클라이언트 번들 빌드
bun run build

# 개발 모드 (HMR 포함)
bun run dev
\`\`\`
`;

export const GUIDE_GUARD = `# Mandu Guard 가이드

## 개요

Mandu Guard는 아키텍처 규칙을 강제하는 시스템입니다.
레이어 간 의존성을 검사하고 위반을 실시간으로 감지합니다.

## 사용법

\`\`\`bash
# 아키텍처 검사
bunx mandu guard arch

# 실시간 감시
bunx mandu guard arch --watch

# CI 모드 (위반 시 exit 1)
bunx mandu guard arch --ci

# 특정 프리셋 사용
bunx mandu guard arch --preset fsd
\`\`\`

## 프리셋

| 프리셋 | 설명 | 사용 사례 |
|--------|------|----------|
| \`mandu\` | FSD + Clean 하이브리드 (기본값) | 풀스택 프로젝트 |
| \`fsd\` | Feature-Sliced Design | 프론트엔드 중심 |
| \`clean\` | Clean Architecture | 백엔드 중심 |
| \`hexagonal\` | Hexagonal/Ports & Adapters | 도메인 중심 |
| \`atomic\` | Atomic Design | UI 컴포넌트 라이브러리 |

## Mandu 프리셋 레이어

### 프론트엔드 (FSD)

\`\`\`
app          # 최상위: 앱 진입점
  ↓
pages        # 페이지 컴포넌트
  ↓
widgets      # 복합 UI 블록
  ↓
features     # 기능 단위
  ↓
entities     # 비즈니스 엔티티
  ↓
shared       # 공유 유틸리티
\`\`\`

### 백엔드 (Clean)

\`\`\`
api          # 최상위: API 진입점
  ↓
application  # 유스케이스
  ↓
domain       # 비즈니스 로직
  ↓
infra        # 인프라 (DB, 외부 API)
  ↓
core         # 핵심 유틸리티
  ↓
shared       # 공유
\`\`\`

## 규칙

### 의존성 방향

- 상위 레이어 → 하위 레이어 ✅
- 하위 레이어 → 상위 레이어 ❌

\`\`\`typescript
// ✅ OK: features → entities
import { User } from "@/entities/user";

// ❌ VIOLATION: entities → features
import { useAuth } from "@/features/auth";
\`\`\`

### 같은 레이어 내

- 같은 레이어 내 다른 모듈 import ❌ (일반적으로)
- shared 레이어는 예외

## 검사 규칙

| 규칙 ID | 설명 |
|---------|------|
| \`LAYER_VIOLATION\` | 레이어 의존성 위반 |
| \`GENERATED_DIRECT_EDIT\` | generated 파일 직접 수정 |
| \`WRONG_SLOT_LOCATION\` | 잘못된 slot 파일 위치 |
| \`SLOT_NAMING\` | slot 파일 이름 규칙 위반 |
| \`FORBIDDEN_IMPORT\` | 금지된 import (fs, child_process 등) |

## 설정

프로젝트 루트에 \`mandu.config.ts\` 또는 \`.mandu/guard.json\`:

\`\`\`typescript
// mandu.config.ts
export default {
  guard: {
    preset: "mandu",
    rules: {
      // 특정 규칙 비활성화
      "LAYER_VIOLATION": "warn",  // error | warn | off
    },
    ignore: [
      "**/test/**",
      "**/*.test.ts",
    ],
  },
};
\`\`\`

## MCP 도구

\`\`\`typescript
// 아키텍처 검사
mandu_guard_check()

// 파일 위치 검사
mandu_check_location({ filePath: "src/features/auth/index.ts" })

// import 검사
mandu_check_import({
  fromFile: "src/features/auth/index.ts",
  importPath: "@/entities/user"
})

// 아키텍처 규칙 조회
mandu_get_architecture()
\`\`\`

## 실시간 감시

\`\`\`bash
# CLI로 시작
bunx mandu guard arch --watch

# 또는 MCP로 시작
mandu_watch_start()
\`\`\`

### 감시 이벤트

파일 변경 시 자동으로:
1. 아키텍처 규칙 검사
2. 위반 감지 시 경고
3. MCP push notification (에이전트에게 알림)

## 리포트

\`\`\`bash
# Markdown 리포트 생성
bunx mandu guard arch --output report.md --report-format markdown

# JSON 리포트
bunx mandu guard arch --output report.json --report-format json
\`\`\`

## 자동 수정

일부 위반은 자동 수정 가능:

\`\`\`bash
bunx mandu guard arch --auto-correct
\`\`\`

또는 MCP:

\`\`\`typescript
mandu_doctor({ autoFix: true })
\`\`\`

## 폴더 구조 예시 (Mandu 프리셋)

\`\`\`
src/
├── app/                    # 앱 진입점
│   └── main.tsx
├── pages/                  # 페이지
│   ├── home/
│   └── users/
├── widgets/                # 복합 UI
│   ├── header/
│   └── sidebar/
├── features/               # 기능
│   ├── auth/
│   └── cart/
├── entities/               # 엔티티
│   ├── user/
│   └── product/
├── shared/                 # 공유
│   ├── ui/
│   ├── lib/
│   └── config/
└── api/                    # 백엔드 API
    ├── application/
    ├── domain/
    └── infra/
\`\`\`
`;

export const GUIDE_SEO = `# Mandu SEO 가이드

## 개요

Mandu SEO 모듈은 Next.js Metadata API 패턴을 따릅니다.
정적/동적 메타데이터, Open Graph, Twitter Cards, JSON-LD 구조화 데이터를 지원합니다.

## 정적 메타데이터

\`\`\`typescript
// app/layout.tsx
import type { Metadata } from '@mandujs/core'

export const metadata: Metadata = {
  metadataBase: new URL('https://example.com'),
  title: {
    template: '%s | My Site',
    default: 'My Site',
  },
  description: 'Welcome to my site',
  openGraph: {
    siteName: 'My Site',
    type: 'website',
  },
}

export default function RootLayout({ children }) {
  return <html><body>{children}</body></html>
}
\`\`\`

## 동적 메타데이터

\`\`\`typescript
// app/blog/[slug]/page.tsx
import type { Metadata, MetadataParams } from '@mandujs/core'

export async function generateMetadata({ params }: MetadataParams): Promise<Metadata> {
  const post = await getPost(params.slug)

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      images: [post.coverImage],
    },
  }
}
\`\`\`

## 타이틀 템플릿

\`\`\`typescript
// 루트 레이아웃
export const metadata: Metadata = {
  title: {
    template: '%s | My Site',  // 자식 타이틀이 %s에 삽입
    default: 'Home | My Site', // 기본값
  },
}

// 페이지 (템플릿 상속)
export const metadata: Metadata = {
  title: 'About',  // 결과: "About | My Site"
}

// 템플릿 무시
export const metadata: Metadata = {
  title: {
    absolute: 'Custom Title',  // 템플릿 무시
  },
}
\`\`\`

## Open Graph

\`\`\`typescript
export const metadata: Metadata = {
  openGraph: {
    title: 'Page Title',
    description: 'Page description',
    url: 'https://example.com/page',
    siteName: 'My Site',
    images: [
      {
        url: 'https://example.com/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'OG Image',
      },
    ],
    locale: 'ko_KR',
    type: 'website',
  },
}
\`\`\`

### Article Open Graph

\`\`\`typescript
export const metadata: Metadata = {
  openGraph: {
    type: 'article',
    publishedTime: '2024-01-15T00:00:00Z',
    modifiedTime: '2024-01-16T00:00:00Z',
    authors: ['https://example.com/author'],
    section: 'Technology',
    tags: ['React', 'Next.js'],
  },
}
\`\`\`

## Twitter Cards

\`\`\`typescript
export const metadata: Metadata = {
  twitter: {
    card: 'summary_large_image',
    title: 'Page Title',
    description: 'Page description',
    site: '@mysite',
    creator: '@author',
    images: ['https://example.com/twitter-image.jpg'],
  },
}
\`\`\`

## JSON-LD 구조화 데이터

### 헬퍼 함수 사용

\`\`\`typescript
import {
  createArticleJsonLd,
  createBreadcrumbJsonLd,
  createOrganizationJsonLd,
  createFAQJsonLd,
  createProductJsonLd,
  createLocalBusinessJsonLd,
  createVideoJsonLd,
  createEventJsonLd,
} from '@mandujs/core'

export const metadata: Metadata = {
  jsonLd: [
    createArticleJsonLd({
      headline: 'Article Title',
      author: 'John Doe',
      datePublished: new Date('2024-01-15'),
      publisher: {
        name: 'My Blog',
        logo: 'https://example.com/logo.png',
      },
    }),
    createBreadcrumbJsonLd([
      { name: 'Home', url: 'https://example.com' },
      { name: 'Blog', url: 'https://example.com/blog' },
    ]),
  ],
}
\`\`\`

### 직접 작성

\`\`\`typescript
export const metadata: Metadata = {
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'Article Title',
    author: {
      '@type': 'Person',
      name: 'John Doe',
    },
  },
}
\`\`\`

## Sitemap

\`\`\`typescript
// app/sitemap.ts
import type { Sitemap } from '@mandujs/core'

export default function sitemap(): Sitemap {
  return [
    {
      url: 'https://example.com',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: 'https://example.com/about',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: 'https://example.com/blog',
      images: ['https://example.com/blog-cover.jpg'],
      alternates: {
        languages: {
          en: 'https://example.com/en/blog',
          ko: 'https://example.com/ko/blog',
        },
      },
    },
  ]
}
\`\`\`

## Robots.txt

\`\`\`typescript
// app/robots.ts
import type { RobotsFile } from '@mandujs/core'

export default function robots(): RobotsFile {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/private'],
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
        crawlDelay: 2,
      },
    ],
    sitemap: 'https://example.com/sitemap.xml',
  }
}
\`\`\`

## Google SEO 최적화

### Viewport

\`\`\`typescript
export const metadata: Metadata = {
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    userScalable: true,
  },
}
\`\`\`

### Theme Color (다크모드 대응)

\`\`\`typescript
export const metadata: Metadata = {
  themeColor: [
    { color: '#ffffff', media: '(prefers-color-scheme: light)' },
    { color: '#000000', media: '(prefers-color-scheme: dark)' },
  ],
}
\`\`\`

### Resource Hints (성능 최적화)

\`\`\`typescript
export const metadata: Metadata = {
  resourceHints: {
    preconnect: ['https://fonts.googleapis.com'],
    dnsPrefetch: ['https://cdn.example.com'],
    preload: [
      { href: '/fonts/main.woff2', as: 'font', type: 'font/woff2' },
    ],
    prefetch: ['/next-page.js'],
  },
}
\`\`\`

### Format Detection (iOS Safari)

\`\`\`typescript
export const metadata: Metadata = {
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
}
\`\`\`

### App Links

\`\`\`typescript
export const metadata: Metadata = {
  appLinks: {
    iosAppStoreId: '123456789',
    iosAppName: 'My App',
    androidPackage: 'com.example.app',
    androidAppName: 'My App',
  },
}
\`\`\`

## MCP 도구

\`\`\`typescript
// SEO 메타데이터 미리보기
mandu_preview_seo({ metadata: { title: 'Test', description: 'Test desc' } })

// Sitemap 미리보기
mandu_generate_sitemap_preview({
  entries: [{ url: 'https://example.com', priority: 1.0 }]
})

// Robots.txt 미리보기
mandu_generate_robots_preview({
  rules: { userAgent: '*', allow: '/' },
  sitemap: 'https://example.com/sitemap.xml'
})

// JSON-LD 생성
mandu_create_jsonld({
  type: 'Article',
  data: { headline: 'Title', author: 'Name', datePublished: '2024-01-15' }
})

// SEO 파일 생성
mandu_write_seo_file({ fileType: 'sitemap' })
mandu_write_seo_file({ fileType: 'robots' })

// SEO 분석
mandu_seo_analyze({
  metadata: { title: 'Test', description: 'Test' },
  url: 'https://example.com/page'
})
\`\`\`

## SEO 체크리스트

### 필수 항목
- [ ] title (30-60자)
- [ ] description (50-160자)
- [ ] viewport 설정
- [ ] canonical URL

### 권장 항목
- [ ] Open Graph (title, description, image)
- [ ] Twitter Card
- [ ] JSON-LD 구조화 데이터
- [ ] sitemap.xml
- [ ] robots.txt
- [ ] hreflang (다국어 사이트)

### 성능 최적화
- [ ] preconnect (외부 도메인)
- [ ] dns-prefetch
- [ ] preload (중요 리소스)
`;

// 모든 가이드 목록
export const GUIDES = {
  slot: GUIDE_SLOT,
  "fs-routes": GUIDE_FS_ROUTES,
  hydration: GUIDE_HYDRATION,
  guard: GUIDE_GUARD,
  seo: GUIDE_SEO,
} as const;

export type GuideId = keyof typeof GUIDES;

export function getGuide(id: string): string | null {
  return GUIDES[id as GuideId] || null;
}

export function listGuides(): { id: string; title: string; description: string }[] {
  return [
    {
      id: "slot",
      title: "Slot 작성 가이드",
      description: "Mandu.filling() API를 사용한 비즈니스 로직 작성법",
    },
    {
      id: "fs-routes",
      title: "FS Routes 가이드",
      description: "파일 시스템 기반 라우팅 규칙과 패턴",
    },
    {
      id: "hydration",
      title: "Island Hydration 가이드",
      description: "부분 hydration과 Island 컴포넌트 작성법",
    },
    {
      id: "guard",
      title: "Guard 가이드",
      description: "아키텍처 규칙 강제와 레이어 의존성 관리",
    },
    {
      id: "seo",
      title: "SEO 가이드",
      description: "메타데이터, Open Graph, JSON-LD, Sitemap 설정법",
    },
  ];
}
