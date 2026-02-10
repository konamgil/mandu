# Mandu FS Routes System

> **File System Routes** - 파일 구조가 곧 URL 구조가 되는 라우팅 시스템

**Status:** Draft
**Version:** 0.1.0
**Last Updated:** 2026-02-02
**Author:** Mandu Team

---

## 목차

1. [개념 소개](#1-개념-소개)
2. [왜 필요한가?](#2-왜-필요한가)
3. [프레임워크 벤치마킹](#3-프레임워크-벤치마킹)
4. [Mandu FS Routes 설계](#4-mandu-fs-routes-설계)
5. [상세 스펙](#5-상세-스펙)
6. [사용 예시](#6-사용-예시)
7. [구현 계획](#7-구현-계획)
8. [마이그레이션 가이드](#8-마이그레이션-가이드)

---

## 1. 개념 소개

### 1.1 FS Routes란?

**FS Routes (File System Routes)**는 파일 시스템의 폴더/파일 구조를 그대로 웹 애플리케이션의 URL 라우팅으로 매핑하는 방식입니다.

```
파일 시스템                          URL
─────────────────────────────────────────────
app/page.tsx                    →   /
app/about/page.tsx              →   /about
app/blog/page.tsx               →   /blog
app/blog/[slug]/page.tsx        →   /blog/:slug (동적)
app/api/users/route.ts          →   /api/users (API)
```

**핵심 원칙:** "파일을 만들면 라우트가 된다"

### 1.2 왜 "FS Routes"라고 부르는가?

| 용어 | 의미 |
|------|------|
| **FS** | File System (파일 시스템) |
| **Routes** | URL 경로 (라우팅) |

파일 시스템의 구조가 곧 라우트 구조가 되기 때문에 "File System Routes" 또는 줄여서 "FS Routes"라고 부릅니다.

### 1.3 어떻게 동작하는가?

```
1. 개발자가 파일 생성
   └── app/products/[id]/page.tsx

2. Mandu가 파일 시스템 스캔
   └── "app/products/[id]/page.tsx" 발견

3. 자동으로 라우트 패턴 생성
   └── pattern: "/products/:id"

4. 서버가 요청 매칭
   └── GET /products/123 → app/products/[id]/page.tsx 실행
       params: { id: "123" }
```

---

## 2. 왜 필요한가?

### 2.1 현재 Mandu의 라우팅 방식

v0.14.0부터 Mandu는 **FS Routes 기반**을 사용합니다:

- `app/` 디렉토리의 파일 구조가 곧 라우트 구조
- `.mandu/routes.manifest.json`이 `app/` 스캔으로 자동 생성됨
- `spec/slots/`, `spec/contracts/`는 ID 컨벤션으로 자동 연결 (auto-linking)

> 이전에는 `spec/routes.manifest.json`을 수동으로 편집하는 방식이었으나, v0.14.0에서 제거됨.

### 2.2 현재 방식의 문제점

| 문제 | 설명 | 영향 |
|------|------|------|
| **수동 관리** | 페이지 추가 시 JSON 수동 편집 필요 | 번거로움, 오타 위험 |
| **동기화 어려움** | 파일 이동/삭제 시 JSON도 수정 필요 | 불일치 발생 |
| **가독성 저하** | 프로젝트 커질수록 JSON 복잡해짐 | 유지보수 어려움 |
| **AI 비친화적** | Agent가 JSON 구조를 이해해야 함 | 코드 생성 복잡 |

### 2.3 FS Routes의 장점

| 장점 | 설명 |
|------|------|
| **Zero Config** | 설정 없이 파일만 만들면 동작 |
| **직관적** | 폴더 구조 = URL 구조 (누구나 이해 가능) |
| **자동 동기화** | 파일 변경이 곧 라우트 변경 |
| **AI 친화적** | Agent가 파일만 생성하면 라우트 완성 |
| **업계 표준** | Next.js, Remix, Fresh 등 모두 채택 |

### 2.4 Before & After 비교

**Before (현재):**
```
1. src/pages/Products.tsx 파일 생성
2. spec/routes.manifest.json 열기
3. routes 배열에 새 항목 추가
4. pattern, componentModule 등 수동 입력
5. 오타 있으면 에러...
```

**After (FS Routes):**
```
1. app/products/page.tsx 파일 생성
2. 끝! 자동으로 /products 라우트 생성됨
```

---

## 3. 프레임워크 벤치마킹

6개의 주요 프레임워크를 분석했습니다.

### 3.1 Next.js (App Router)

```
app/
├── page.tsx              → /
├── layout.tsx            → 레이아웃
├── loading.tsx           → 로딩 UI
├── error.tsx             → 에러 UI
├── about/page.tsx        → /about
├── blog/
│   ├── page.tsx          → /blog
│   └── [slug]/page.tsx   → /blog/:slug
├── (marketing)/          → 그룹 (URL 미포함)
│   └── pricing/page.tsx  → /pricing
└── api/users/route.ts    → API /api/users
```

**특징:**
- `page.tsx` = 페이지, `route.ts` = API
- `layout.tsx`로 중첩 레이아웃
- `(group)`으로 URL 영향 없이 폴더 정리
- 업계 표준으로 자리잡음

### 3.2 Fresh (Deno)

```
routes/
├── index.tsx             → /
├── about.tsx             → /about
├── blog/[slug].tsx       → /blog/:slug
├── _layout.tsx           → 레이아웃
├── _middleware.ts        → 미들웨어
└── (group)/              → 라우트 그룹
```

**특징:**
- `index.tsx` = 인덱스 페이지
- `_`로 시작 = 특수 파일 (레이아웃, 미들웨어)
- Islands Architecture 기본 지원

### 3.3 Qwik City

```
routes/
├── index.tsx             → /
├── layout.tsx            → 레이아웃
├── layout!.tsx           → 레이아웃 중단
├── index@named.tsx       → 명명된 레이아웃 사용
├── blog/[slug]/index.tsx → /blog/:slug
└── (auth)/login/index.tsx → /login (그룹)
```

**특징:**
- `routeLoader$` - 데이터 로딩
- `routeAction$` - 폼 액션
- `!` 접미사로 레이아웃 중단
- `@name`으로 특정 레이아웃 지정

### 3.4 BERTUI (Bun 기반)

```
pages/
├── index.jsx             → /
├── about.jsx             → /about
└── blog/[slug].jsx       → /blog/:slug
```

**특징:**
- 가장 단순한 구조
- `export const render = "server"` - Server Island
- `export const meta = {...}` - 메타데이터
- 빌드 시 `router.js` 자동 생성

### 3.5 분석 요약

| 프레임워크 | 폴더 | 페이지 파일 | 동적 라우트 | 레이아웃 |
|-----------|------|------------|------------|---------|
| Next.js 13+ | `app/` | `page.tsx` | `[param]` | `layout.tsx` |
| Fresh | `routes/` | `index.tsx` | `[param]` | `_layout.tsx` |
| Qwik City | `routes/` | `index.tsx` | `[param]` | `layout.tsx` |
| BERTUI | `pages/` | `파일명.tsx` | `[param]` | - |
| Remix | `app/routes/` | `파일명.tsx` | `$param` | - |
| Astro | `pages/` | `파일명.astro` | `[param]` | - |

**공통점:**
- 모두 `[param]` 또는 `$param` 문법 사용
- 폴더 기반 중첩 라우트
- 특수 파일로 레이아웃, 에러 처리

---

## 4. Mandu FS Routes 설계

### 4.1 설계 원칙

1. **Next.js App Router 호환** - 업계 표준 따름
2. **기존 시스템과 공존** - 점진적 마이그레이션
3. **Islands 통합** - Mandu의 강점 유지
4. **Zero Config** - 설정 없이 바로 사용
5. **타입 안전** - TypeScript 완벽 지원

### 4.2 폴더 구조

```
my-app/
├── app/                          # FS Routes 루트 (신규)
│   ├── page.tsx                  # / (홈)
│   ├── layout.tsx                # Root 레이아웃
│   ├── loading.tsx               # 전역 로딩
│   ├── error.tsx                 # 전역 에러
│   ├── not-found.tsx             # 404
│   │
│   ├── about/
│   │   └── page.tsx              # /about
│   │
│   ├── blog/
│   │   ├── page.tsx              # /blog
│   │   ├── layout.tsx            # /blog/* 레이아웃
│   │   └── [slug]/
│   │       ├── page.tsx          # /blog/:slug
│   │       └── comments.island.tsx  # Island 컴포넌트
│   │
│   ├── products/
│   │   ├── page.tsx              # /products
│   │   ├── [id]/
│   │   │   └── page.tsx          # /products/:id
│   │   └── [...categories]/
│   │       └── page.tsx          # /products/* (catch-all)
│   │
│   ├── api/
│   │   └── users/
│   │       └── route.ts          # API: GET/POST /api/users
│   │
│   ├── (marketing)/              # 라우트 그룹
│   │   ├── layout.tsx            # 마케팅 전용 레이아웃
│   │   ├── pricing/page.tsx      # /pricing
│   │   └── contact/page.tsx      # /contact
│   │
│   └── _components/              # 비공개 폴더 (라우트 아님)
│       └── Button.tsx
│
├── spec/                          # 비즈니스 레이어
│   ├── slots/                   # 비즈니스 로직 파일
│   └── contracts/               # 타입 안전 계약
│
└── .mandu/                        # 생성된 산출물 (자동 관리)
    ├── routes.manifest.json       # 라우트 매니페스트 (app/ 스캔 결과)
    └── spec.lock.json             # 해시 검증
```

### 4.3 핵심 결정 사항

| 항목 | 결정 | 대안 | 선택 이유 |
|------|------|------|----------|
| 루트 폴더 | `app/` | `routes/`, `pages/` | Next.js 13+ 표준, 미래 지향 |
| 페이지 파일 | `page.tsx` | `index.tsx` | 역할 명확, API(`route.ts`)와 구분 |
| 동적 라우트 | `[param]` | `$param`, `:param` | 업계 표준, 모든 프레임워크 공통 |
| API 라우트 | `route.ts` | `handler.ts`, `api.ts` | Next.js 호환 |
| 레이아웃 | `layout.tsx` | `_layout.tsx` | 밑줄 없이 깔끔 |
| Island 파일 | `*.island.tsx` | `*.client.tsx` | 기존과 구분, 의미 명확 |
| 비공개 폴더 | `_folder` | `(folder)` | 괄호는 그룹용으로 예약 |

### 4.4 설정 옵션 (Customization)

사용자가 원하는 아키텍처에 맞게 FS Routes를 커스터마이징할 수 있습니다:

```ts
// mandu.config.ts
export default {
  fsRoutes: {
    // 라우트 루트 폴더 (기본: "app")
    routesDir: "app",

    // 지원 확장자
    extensions: [".tsx", ".ts", ".jsx", ".js"],

    // 제외 패턴 (glob)
    exclude: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/_*",           // 비공개 폴더
      "**/node_modules",
    ],

    // Island 접미사 (기본: ".island")
    islandSuffix: ".island",
  },
};
```

> 현재 지원되는 키: `routesDir`, `extensions`, `exclude`, `islandSuffix`
> 참고: `mergeWithLegacy`, `legacyManifestPath`는 v0.14.0에서 제거됨 (Option D: app/이 유일한 라우트 소스)

**설정 가능한 아키텍처 패턴:**

| 패턴 | 설정 예시 | 설명 |
|------|----------|------|
| Next.js 스타일 | `routesDir: "app"` | 기본값, App Router 호환 |
| Fresh 스타일 | `routesDir: "routes"` | Deno Fresh 스타일 |
| BERTUI 스타일 | `routesDir: "pages"` | 단순 pages 폴더 |
| 커스텀 Island | `islandSuffix: ".client"` | 기존 `.client.tsx` 유지 |

---

## 5. 상세 스펙

### 5.1 파일 타입별 역할

| 파일명 | 역할 | URL 영향 | 예시 |
|--------|------|----------|------|
| `page.tsx` | 페이지 컴포넌트 | ✅ 라우트 생성 | `app/about/page.tsx` → `/about` |
| `route.ts` | API 핸들러 | ✅ API 라우트 | `app/api/users/route.ts` → `/api/users` |
| `layout.tsx` | 레이아웃 래퍼 | ❌ | 하위 라우트에 적용 |
| `loading.tsx` | Suspense 폴백 | ❌ | 로딩 중 표시 |
| `error.tsx` | Error Boundary | ❌ | 에러 시 표시 |
| `not-found.tsx` | 404 페이지 | ❌ | 라우트 없을 때 |
| `*.island.tsx` | Client Island | ❌ | 클라이언트 하이드레이션 |

### 5.2 동적 라우트 문법

| 문법 | 패턴 | 매칭 예시 | 설명 |
|------|------|----------|------|
| `[id]` | `:id` | `/products/123` | 단일 세그먼트 |
| `[...slug]` | `:slug*` | `/docs/a/b/c` | Catch-all (1개 이상) |
| `[[...slug]]` | `:slug*?` | `/docs` 또는 `/docs/a/b` | Optional catch-all |

**예시:**
```
app/blog/[slug]/page.tsx
  → /blog/hello-world    ✅ params.slug = "hello-world"
  → /blog/               ❌ (slug 필수)

app/docs/[...path]/page.tsx
  → /docs/intro          ✅ params.path = ["intro"]
  → /docs/guide/setup    ✅ params.path = ["guide", "setup"]
  → /docs/               ❌ (최소 1개 필요)

app/shop/[[...categories]]/page.tsx
  → /shop/               ✅ params.categories = undefined
  → /shop/clothes        ✅ params.categories = ["clothes"]
  → /shop/clothes/shirts ✅ params.categories = ["clothes", "shirts"]
```

### 5.3 라우트 그룹

괄호 `()`로 감싼 폴더는 URL에 포함되지 않습니다:

```
app/
├── (marketing)/
│   ├── layout.tsx        # 마케팅 레이아웃
│   ├── about/page.tsx    # /about (NOT /marketing/about)
│   └── pricing/page.tsx  # /pricing
│
└── (dashboard)/
    ├── layout.tsx        # 대시보드 레이아웃
    └── settings/page.tsx # /settings
```

**용도:**
- 다른 레이아웃 적용
- 관련 라우트 논리적 그룹화
- 코드 정리 (URL 영향 없이)

### 5.4 비공개 폴더

밑줄 `_`로 시작하는 폴더는 라우트에서 제외됩니다:

```
app/
├── _components/          # 컴포넌트 (라우트 아님)
│   └── Button.tsx
├── _utils/               # 유틸리티 (라우트 아님)
│   └── helpers.ts
└── page.tsx              # / (홈)
```

### 5.5 라우트 우선순위

라우트 매칭은 구체적인 것부터 시작합니다:

```
우선순위 (높음 → 낮음)
1. 정적 라우트        /blog/featured
2. 동적 세그먼트      /blog/[slug]
3. Catch-all         /blog/[...path]
4. Optional catch-all /blog/[[...path]]
```

### 5.6 Export 기반 설정

페이지 파일에서 named export로 설정을 정의합니다:

```tsx
// app/blog/[slug]/page.tsx

// 메타데이터 (SEO)
export const meta = {
  title: "Blog Post",
  description: "Read our latest blog post",
};

// 하이드레이션 설정
export const hydration = {
  strategy: "visible",  // "none" | "visible" | "idle" | "interaction"
  priority: "normal",
};

// 데이터 로더
export async function loader({ params, request }) {
  const post = await fetchPost(params.slug);
  return { post };
}

// 페이지 컴포넌트 (default export)
export default function BlogPost({ data, params }) {
  return (
    <article>
      <h1>{data.post.title}</h1>
      <p>{data.post.content}</p>
    </article>
  );
}
```

---

## 6. 사용 예시

### 6.1 기본 페이지

```tsx
// app/page.tsx - 홈페이지
export const meta = {
  title: "Welcome to My App",
};

export default function HomePage() {
  return (
    <div>
      <h1>Welcome!</h1>
      <p>This is the home page.</p>
    </div>
  );
}
```

### 6.2 동적 라우트 + 데이터 로딩

```tsx
// app/products/[id]/page.tsx
import type { PageProps } from "@mandujs/core";

export const meta = {
  title: "Product Detail",
};

export async function loader({ params }) {
  const product = await db.products.findById(params.id);
  if (!product) {
    throw new Response("Not Found", { status: 404 });
  }
  return { product };
}

export default function ProductPage({ data, params }: PageProps) {
  const { product } = data;

  return (
    <div>
      <h1>{product.name}</h1>
      <p>Price: ${product.price}</p>
      <p>ID: {params.id}</p>
    </div>
  );
}
```

### 6.3 레이아웃

```tsx
// app/layout.tsx - Root 레이아웃
export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="UTF-8" />
      </head>
      <body>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
        <main>{children}</main>
        <footer>© 2026 My App</footer>
      </body>
    </html>
  );
}
```

```tsx
// app/blog/layout.tsx - 블로그 레이아웃 (중첩)
export default function BlogLayout({ children }) {
  return (
    <div className="blog-container">
      <aside>
        <h3>Recent Posts</h3>
        {/* 사이드바 */}
      </aside>
      <div className="blog-content">
        {children}
      </div>
    </div>
  );
}
```

### 6.4 API 라우트

```ts
// app/api/users/route.ts
import type { RouteHandler } from "@mandujs/core";

export const GET: RouteHandler = async ({ request }) => {
  const users = await db.users.findAll();
  return Response.json(users);
};

export const POST: RouteHandler = async ({ request }) => {
  const body = await request.json();
  const user = await db.users.create(body);
  return Response.json(user, { status: 201 });
};
```

### 6.5 Island 컴포넌트

```tsx
// app/blog/[slug]/page.tsx
import CommentSection from "./comments.island";

export const hydration = { strategy: "visible" };

export default function BlogPost({ data }) {
  return (
    <article>
      <h1>{data.post.title}</h1>
      <p>{data.post.content}</p>

      {/* Island - 클라이언트에서 하이드레이션됨 */}
      <CommentSection postId={data.post.id} />
    </article>
  );
}
```

```tsx
// app/blog/[slug]/comments.island.tsx
import { Mandu } from "@mandujs/core/client";
import { useState } from "react";

interface CommentsData {
  postId: string;
}

export default Mandu.island<CommentsData>({
  setup: ({ postId }) => {
    const [comments, setComments] = useState([]);

    // 댓글 로드 로직...

    return { comments, postId };
  },
  render: ({ comments }) => (
    <section>
      <h3>Comments</h3>
      {comments.map(c => <p key={c.id}>{c.text}</p>)}
    </section>
  ),
});
```

### 6.6 라우트 그룹 활용

```tsx
// app/(auth)/layout.tsx - 인증 페이지용 레이아웃
export default function AuthLayout({ children }) {
  return (
    <div className="auth-container">
      <div className="auth-box">
        {children}
      </div>
    </div>
  );
}

// app/(auth)/login/page.tsx → /login
// app/(auth)/register/page.tsx → /register
// app/(auth)/forgot-password/page.tsx → /forgot-password
```

---

## 7. 구현 계획

### 7.1 마일스톤

```
Phase 1: 기본 스캐너 (MVP)
├── fs-scanner.ts - 재귀 파일 스캔
├── page.tsx, route.ts 인식
├── [param] 동적 라우트 파싱
├── RoutesManifest 생성
└── 예상: 1-2일

Phase 2: 매니페스트 생성 ✅
├── .mandu/routes.manifest.json 자동 생성
├── auto-linking (spec/slots/, spec/contracts/)
├── mandu routes generate CLI
└── 완료

Phase 3: 레이아웃 시스템
├── layout.tsx 인식
├── 레이아웃 체인 구성
├── (group) 라우트 그룹
└── 예상: 1-2일

Phase 4: Dev HMR 통합
├── 파일 추가/삭제 감시
├── 매니페스트 자동 재생성
├── HMR 브로드캐스트
└── 예상: 1일

Phase 5: 고급 기능
├── [...catchAll] 라우트
├── [[optional]] 라우트
├── error.tsx, loading.tsx
├── not-found.tsx
├── Export 메타데이터 추출
└── 예상: 2-3일
```

### 7.2 구현 파일 구조

```
packages/core/src/router/
├── fs-scanner.ts      # 파일 시스템 스캔
├── fs-patterns.ts     # 패턴 변환 유틸
├── fs-routes.ts       # 매니페스트 생성
├── fs-watch.ts        # HMR 파일 감시
├── fs-types.ts        # 타입 정의
└── index.ts           # Public API
```

### 7.3 Phase 1 상세 태스크

```
[ ] fs-types.ts
    - ScannedFile 인터페이스
    - RouteSegment 타입
    - FSRouteConfig 타입

[ ] fs-scanner.ts
    - scanDirectory() - 재귀 스캔
    - isPageFile() - page.tsx 판별
    - isRouteFile() - route.ts 판별
    - parseSegments() - 경로 세그먼트 파싱

[ ] fs-patterns.ts
    - pathToPattern() - "[slug]" → ":slug"
    - sortByPriority() - 우선순위 정렬
    - matchPattern() - URL 매칭

[ ] fs-routes.ts
    - generateManifest() - RoutesManifest 생성 (.mandu/routes.manifest.json)
    - resolveAutoLinks() - spec/slots/, spec/contracts/ 자동 연결

[ ] 테스트
    - tests/router/fs-scanner.test.ts
    - tests/router/fs-patterns.test.ts
```

---

## 8. 마이그레이션 가이드

### 8.1 현재 아키텍처 (v0.14.0+)

v0.14.0부터 **`app/` (FS Routes)이 유일한 라우트 소스**입니다:

- 매니페스트(`.mandu/routes.manifest.json`)는 `app/` 스캔으로 **자동 생성**
- `spec/` 디렉토리는 `slots/`와 `contracts/`만 포함 (비즈니스 레이어)
- 라우트 ID 컨벤션으로 `spec/slots/{id}.slot.ts`, `spec/contracts/{id}.contract.ts` 자동 연결 (auto-linking)

### 8.2 기존 프로젝트 마이그레이션

기존 `spec/routes.manifest.json` 기반 프로젝트를 마이그레이션하려면:

```
단계 1: app/ 폴더에 라우트 파일 재생성
        └── spec의 라우트를 app/ 파일로 변환

단계 2: spec/routes.manifest.json 삭제
        └── .mandu/routes.manifest.json이 자동 생성됨

단계 3: spec/slots/ 및 spec/contracts/ 유지
        └── auto-linking이 ID 컨벤션으로 자동 연결
```

### 8.3 Island 마이그레이션

**기존 방식:**
```
spec/slots/todos.client.tsx
src/pages/Todos.tsx
```

**새로운 방식:**
```
app/todos/page.tsx
app/todos/list.island.tsx
```

두 방식 모두 지원됩니다.

---

## 부록

### A. 타입 정의

```typescript
// fs-types.ts

export interface ScannedFile {
  /** 절대 경로 */
  absolutePath: string;
  /** app/ 기준 상대 경로 */
  relativePath: string;
  /** 파일 타입 */
  type: "page" | "layout" | "route" | "error" | "loading" | "not-found" | "island";
  /** 경로 세그먼트 */
  segments: RouteSegment[];
}

export interface RouteSegment {
  /** 세그먼트 이름 */
  name: string;
  /** 세그먼트 타입 */
  type: "static" | "dynamic" | "catchAll" | "optionalCatchAll" | "group";
  /** 파라미터 이름 (동적인 경우) */
  paramName?: string;
}

export interface FSRouteConfig {
  /** 라우트 ID */
  id: string;
  /** URL 패턴 */
  pattern: string;
  /** 라우트 종류 */
  kind: "page" | "api";
  /** 컴포넌트 모듈 경로 */
  componentModule: string;
  /** Island 모듈 경로 */
  clientModule?: string;
  /** 적용할 레이아웃 체인 */
  layoutChain: string[];
  /** 하이드레이션 설정 */
  hydration?: HydrationConfig;
  /** 메타데이터 */
  meta?: RouteMeta;
}
```

### B. 패턴 변환 규칙

| 파일 경로 | URL 패턴 | 매칭 예시 |
|----------|---------|----------|
| `app/page.tsx` | `/` | `/` |
| `app/about/page.tsx` | `/about` | `/about` |
| `app/blog/[slug]/page.tsx` | `/blog/:slug` | `/blog/hello` |
| `app/docs/[...path]/page.tsx` | `/docs/:path*` | `/docs/a/b/c` |
| `app/shop/[[...cat]]/page.tsx` | `/shop/:cat*?` | `/shop`, `/shop/a` |
| `app/(group)/foo/page.tsx` | `/foo` | `/foo` |
| `app/api/users/route.ts` | `/api/users` | `/api/users` |

### C. 참고 자료

- [Next.js App Router](https://nextjs.org/docs/app)
- [Fresh Routes](https://fresh.deno.dev/docs/concepts/routing)
- [Qwik City Routing](https://qwik.builder.io/docs/routing/)
- [Remix File Routes](https://remix.run/docs/en/main/file-conventions/routes)

---

*이 문서는 Mandu FS Routes 시스템의 기획 문서입니다. 구현 과정에서 변경될 수 있습니다.*
