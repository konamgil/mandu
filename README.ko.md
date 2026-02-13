<p align="center">
  <img src="https://raw.githubusercontent.com/konamgil/mandu/main/mandu_only_simbol.png" alt="Mandu 로고" width="180" />
</p>

<h1 align="center">Mandu</h1>

<p align="center">
  <strong>에이전트 네이티브 풀스택 프레임워크</strong><br/>
  AI 에이전트가 코딩해도 아키텍처가 무너지지 않는 개발 OS
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mandujs/core"><img src="https://img.shields.io/npm/v/@mandujs/core?label=core" alt="npm core" /></a>
  <a href="https://www.npmjs.com/package/@mandujs/cli"><img src="https://img.shields.io/npm/v/@mandujs/cli?label=cli" alt="npm cli" /></a>
  <a href="https://www.npmjs.com/package/@mandujs/mcp"><img src="https://img.shields.io/npm/v/@mandujs/mcp?label=mcp" alt="npm mcp" /></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/frontend-React-61dafb?logo=react" alt="React" />
</p>

<p align="center">
  한국어 | <a href="./README.md">English</a>
</p>

---

## Quick Start

### 사전 요구사항

- **Bun** v1.0.0 이상 ([Bun 설치하기](https://bun.sh/docs/installation))

```bash
# Bun 버전 확인
bun --version
```

### 1. 새 프로젝트 생성

```bash
bunx @mandujs/cli init my-app
cd my-app
bun install
```

실시간 채팅 스타터 템플릿:

```bash
bunx @mandujs/cli init my-chat-app --template realtime-chat
```

### 2. 개발 서버 시작

```bash
bun run dev
```

앱이 `http://localhost:3000`에서 실행됩니다.

### 3. 첫 페이지 만들기

`app/page.tsx` 파일 생성:

```tsx
export default function Home() {
  return (
    <div>
      <h1>Mandu에 오신 것을 환영합니다!</h1>
      <p>이 파일을 수정하면 변경사항이 즉시 반영됩니다.</p>
    </div>
  );
}
```

### 4. API 라우트 추가

`app/api/hello/route.ts` 파일 생성:

```typescript
export function GET() {
  return Response.json({ message: "안녕하세요, Mandu입니다!" });
}
```

이제 `http://localhost:3000/api/hello`에서 확인할 수 있습니다.

### 5. 프로덕션 빌드

```bash
bun run build
```

이게 전부입니다! Mandu로 개발할 준비가 되었습니다.

---

## 입문 가이드

Mandu를 처음 사용하신다면 이 섹션이 도움이 됩니다.

### 프로젝트 생성 후 구조

```
my-app/
├── app/                    # 코드 작성 영역 (FS Routes)
│   ├── page.tsx           # 홈 페이지 (/)
│   └── api/
│       └── health/
│           └── route.ts   # Health check API (/api/health)
├── src/                    # 아키텍처 레이어
│   ├── client/             # 클라이언트 (FSD)
│   ├── server/             # 서버 (Clean)
│   └── shared/             # 공용
│       ├── contracts/      # client-safe 계약
│       ├── types/
│       ├── utils/
│       │   ├── client/     # 클라이언트 safe 유틸
│       │   └── server/     # 서버 전용 유틸
│       ├── schema/         # 서버 전용 스키마
│       └── env/            # 서버 전용 환경
├── spec/
│   ├── slots/              # 비즈니스 로직 파일
│   └── contracts/          # 클라이언트-서버 계약
├── .mandu/                 # 자동 생성 (빌드 출력 + 매니페스트)
│   ├── routes.manifest.json  # 라우트 매니페스트 (app/에서 자동 생성)
│   └── spec.lock.json        # 해시 검증
├── package.json
└── tsconfig.json
```

### 파일 이름 규칙

| 파일 이름 | 용도 | URL |
|-----------|------|-----|
| `app/page.tsx` | 홈 페이지 | `/` |
| `app/about/page.tsx` | About 페이지 | `/about` |
| `app/users/[id]/page.tsx` | 동적 사용자 페이지 | `/users/123` |
| `app/api/users/route.ts` | 사용자 API | `/api/users` |
| `app/layout.tsx` | 공유 레이아웃 | 모든 페이지 감싸기 |

### 일반적인 작업

#### 새 페이지 추가하기

`app/about/page.tsx` 생성:

```tsx
export default function About() {
  return (
    <div>
      <h1>회사 소개</h1>
      <p>저희 사이트에 오신 것을 환영합니다!</p>
    </div>
  );
}
```

`http://localhost:3000/about` 에서 확인

#### 동적 라우트 추가하기

`app/users/[id]/page.tsx` 생성:

```tsx
export default function UserProfile({ params }: { params: { id: string } }) {
  return (
    <div>
      <h1>사용자 프로필</h1>
      <p>사용자 ID: {params.id}</p>
    </div>
  );
}
```

`http://localhost:3000/users/123` 에서 확인

#### 여러 메서드를 가진 API 추가하기

`app/api/users/route.ts` 생성:

```typescript
// GET /api/users
export function GET() {
  return Response.json({
    users: [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" }
    ]
  });
}

// POST /api/users
export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({
    message: "사용자 생성됨",
    user: body
  }, { status: 201 });
}
```

#### 레이아웃 추가하기

`app/layout.tsx` 생성:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <title>My Mandu App</title>
      </head>
      <body>
        <nav>
          <a href="/">홈</a>
          <a href="/about">소개</a>
        </nav>
        <main>{children}</main>
        <footer>© 2025 My App</footer>
      </body>
    </html>
  );
}
```

### 초보자를 위한 CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `bunx @mandujs/cli init my-app` | "my-app" 이름으로 새 프로젝트 생성 |
| `bun install` | 모든 의존성 설치 |
| `bun run dev` | http://localhost:3000 에서 개발 서버 시작 |
| `bun run build` | 프로덕션 빌드 |
| `bun run test` | 테스트 실행 |

#### 추가 CLI 명령어

```bash
# 사용 가능한 모든 명령어 확인
bunx mandu --help

# 앱의 모든 라우트 표시
bunx mandu routes list

# 아키텍처 규칙 검사
bunx mandu guard arch

# 아키텍처 위반 실시간 감시
bunx mandu guard arch --watch
```

### 기술 스택

| 기술 | 버전 | 용도 |
|------|------|------|
| **Bun** | 1.0+ | JavaScript 런타임 & 패키지 매니저 |
| **React** | 19.x | UI 라이브러리 |
| **TypeScript** | 5.x | 타입 안전성 |

### 다음 단계

1. **[FS Routes](#fs-routes) 섹션 읽기** - 라우팅 패턴 이해하기
2. **[Mandu Guard](#mandu-guard-시스템) 사용해보기** - 아키텍처 규칙 강제
3. **[MCP Server](#mcp-서버-ai-에이전트-통합) 탐색하기** - AI 에이전트 통합

### 문제 해결

| 문제 | 해결 방법 |
|------|----------|
| `command not found: bun` | Bun 설치: `curl -fsSL https://bun.sh/install \| bash` |
| 포트 3000 사용 중 | 다른 서버 중지 또는 `PORT=3001 bun run dev` |
| 변경사항 미반영 | `bun run dev`로 개발 서버 재시작 |
| TypeScript 에러 | `bun install`로 타입 설치 확인 |

---

## 문서

- `docs/README.ko.md` — 문서 인덱스
- `docs/api/api-reference.ko.md` — API 레퍼런스
- `docs/status.ko.md` — 구현 상태

## 문제 정의

### AI 코딩의 구조적 문제

현재 AI 에이전트를 활용한 개발에는 근본적인 문제가 있습니다:

- **아키텍처 붕괴**: 에이전트가 코딩할수록 폴더 구조, 레이어 규칙, 코딩 패턴이 흔들림
- **사후 수습의 한계**: Lint로 수습하려다 부작용(추가 오류)과 시간 손실 발생
- **재현성 저하**: 프로젝트마다 아키텍처가 달라져 유지보수가 급격히 나빠짐

### 우리가 해결하려는 본질

> "AI가 코딩해주는 속도"가 아니라,
> **AI가 망가뜨리지 못하는 구조(Architecture Preservation)**를 강제하는 것

---

## Mandu란?

**Mandu**는 다음 플로우를 자동화하는 **Bun + TypeScript + React 기반 풀스택 프레임워크**입니다:

**FS Routes (app/) → Manifest (자동 생성) → Generate → Slot → Guard → Report**

```
┌─────────────────────────────────────────────────────────────┐
│                        Mandu Flow                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   📁 FS Routes (app/) 단일 라우트 소스                        │
│        ↓                                                     │
│   📝 Manifest         라우트 매니페스트 자동 생성              │
│        ↓                                                     │
│   ⚙️  Generate        뼈대 코드 자동 생성                     │
│        ↓                                                     │
│   🎯 Slot             에이전트가 작업하는 허용 영역            │
│        ↓                                                     │
│   🛡️  Guard           구조 보존 검사                          │
│        ↓                                                     │
│   📊 Report           결과 리포트 + 자동 수정 안내            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 주요 기능

### 핵심 아키텍처

| 기능 | 설명 |
|------|------|
| **FS Routes 기반 개발** | app/ 디렉토리가 라우트의 단일 소스 |
| **코드 생성** | 매니페스트에서 라우트, 핸들러, 컴포넌트 자동 생성 |
| **슬롯 시스템** | 에이전트가 안전하게 비즈니스 로직을 작성하는 격리 영역 |
| **Guard 시스템** | 아키텍처 규칙 강제 및 오염 방지 |
| **Self-Healing Guard** | 위반 감지 + 자동 수정 제안 + 설명 제공 |
| **트랜잭션 API** | 스냅샷 기반 롤백이 가능한 원자적 변경 |
| **SEO 모듈** | Next.js Metadata API 호환, sitemap/robots 생성, JSON-LD 헬퍼 |
| **MCP 서버** | AI 에이전트가 프레임워크를 직접 조작 (35+ 도구) |
| **실시간 Watch** | 아키텍처 위반 시 MCP push notification으로 에이전트에 실시간 알림 |
| **Island Hydration** | 선택적 클라이언트 JavaScript로 성능 최적화 |
| **HMR 지원** | 빠른 개발을 위한 핫 모듈 교체 |
| **에러 분류 시스템** | 지능적 에러 분류와 수정 가이드 제공 |

### AI 가이드 시스템 (RFC-001) 🆕

| 기능 | 설명 |
|------|------|
| **Decision Memory** | ADR 저장 및 일관성 검사 - AI가 과거 결정을 참조 |
| **Semantic Slots** | 슬롯에 목적과 제약 명시 - AI 코드 검증 |
| **Architecture Negotiation** | 구현 전 AI-프레임워크 협상 다이얼로그 |

---

## 빠른 시작

### 1. 새 프로젝트 생성

```bash
# Bun 설치 (없는 경우)
curl -fsSL https://bun.sh/install | bash

# 새 프로젝트 생성
bunx @mandujs/cli init my-app
cd my-app
```

### 2. 의존성 설치 및 실행

```bash
bun install

# 코드 생성 (매니페스트 자동 생성 포함)
bun run generate

# 개발 서버 실행
bun run dev
```

### 3. 브라우저에서 확인

```
http://localhost:3000      → SSR 페이지
http://localhost:3000/api/health → API 응답
```

---

## 누가 무엇을 하는가

| 작업 | 👤 사람 | 🤖 Agent | 🔌 MCP | 🔧 CLI |
|------|:-------:|:--------:|:------:|:------:|
| 요구사항 | 정의 | 수신 | - | - |
| 프로젝트 생성 | 실행 | - | - | `init` |
| 라우트 추가 | 승인 | 설계 | `add_route` | - |
| 코드 생성 | - | 호출 | `generate` | `generate` |
| Slot 작성 | 리뷰 | 작성 | `write_slot` | - |
| Guard 검사 | 확인 | 호출 | `guard_check` | `guard` |
| 빌드/개발서버 | 실행 | - | - | `build`/`dev` |

```
👤 사람 ──→ 🤖 Agent ──→ 🔌 MCP ──→ 📦 Core ──→ 📁 파일
                                      ↑
👤 사람 ─────────────→ 🔧 CLI ────────┘
```

> **MCP** = Agent가 Core를 호출하는 인터페이스
> **CLI** = 사람이 Core를 호출하는 인터페이스
> 둘 다 동일한 `@mandujs/core` 함수를 호출

---

## 핵심 원칙

| # | 원칙 | 설명 |
|---|------|------|
| 1 | **FS Routes = 라우트 소스** | app/ 디렉토리가 라우트의 단일 소스. 매니페스트는 자동 생성 |
| 2 | **Generated = 재생성 가능** | generated 코드는 언제든 삭제하고 다시 생성 가능 |
| 3 | **Slot = 허용 영역** | 에이전트는 지정된 슬롯에서만 작업 |
| 4 | **Guard > Lint** | 린팅 최소화, Guard가 아키텍처의 문지기 |
| 5 | **Self-Correction** | 실패 시 자동 재시도 루프 내장 |

---

## 프로젝트 구조

### 프레임워크 (이 저장소)

```
mandu/
├── packages/
│   ├── core/                 # @mandujs/core
│   │   ├── spec/            # 스키마, 로드, 락, 검증
│   │   ├── runtime/         # 서버, 라우터, SSR
│   │   ├── generator/       # 코드 생성 엔진
│   │   ├── guard/           # 아키텍처 강제
│   │   ├── bundler/         # 클라이언트 번들링 + HMR
│   │   ├── filling/         # 비즈니스 로직 API (Mandu.filling())
│   │   ├── error/           # 에러 분류 시스템
│   │   ├── change/          # 트랜잭션 & 히스토리 관리
│   │   ├── slot/            # 슬롯 검증 & 자동 수정
│   │   └── client/          # Island hydration 런타임
│   │
│   ├── cli/                  # @mandujs/cli
│   │   └── commands/        # init, generate, guard, build, dev
│   │
│   └── mcp/                  # @mandujs/mcp
│       ├── tools/           # MCP 도구 (30개 이상)
│       └── resources/       # MCP 리소스 (5개)
│
└── tests/                    # 프레임워크 테스트
```

### 생성되는 프로젝트 구조

```
my-app/
├── app/                         # FS Routes (라우트의 단일 소스)
│   ├── page.tsx                # 홈 페이지 (/)
│   └── api/
│       └── health/
│           └── route.ts        # Health check API
│
├── spec/
│   ├── slots/                   # 비즈니스 로직 파일
│   │   ├── users.slot.ts       # 서버 로직
│   │   └── users.client.ts     # 클라이언트 인터랙티브 로직
│   └── contracts/               # 클라이언트-서버 계약
│       └── users.contract.ts
│
├── apps/
│   ├── server/
│   │   ├── main.ts              # 서버 엔트리 포인트
│   │   └── generated/routes/    # 자동 생성된 API 핸들러
│   │       └── *.route.ts
│   │
│   └── web/
│       ├── entry.tsx            # 웹 엔트리 포인트
│       ├── generated/routes/    # 자동 생성된 페이지 컴포넌트
│       │   └── *.route.tsx
│       └── components/          # 공유 컴포넌트
│
├── .mandu/
│   ├── routes.manifest.json     # 라우트 매니페스트 (자동 생성)
│   ├── spec.lock.json           # 해시 검증
│   ├── history/                 # 트랜잭션 스냅샷
│   │   ├── changes.json        # 변경 감사 로그
│   │   └── *.snapshot.json     # 롤백 스냅샷
│   ├── client/                  # 빌드된 클라이언트 번들
│   │   ├── _runtime.js         # Hydration 런타임
│   │   ├── _vendor.js          # 공유 의존성 (React)
│   │   └── *.island.js         # 라우트별 island 번들
│   └── manifest.json            # 번들 매니페스트
│
└── package.json
```

---

## CLI 명령어

### 기본 명령어

| 명령어 | 설명 |
|--------|------|
| `mandu init <name>` | 새 프로젝트 생성 |
| `mandu generate` | app/에서 매니페스트 생성 및 코드 생성 |
| `mandu guard` | 아키텍처 검사 실행 |
| `mandu build` | 프로덕션용 클라이언트 번들 빌드 |
| `mandu dev` | HMR 포함 개발 서버 실행 |

### 트랜잭션 명령어

| 명령어 | 설명 |
|--------|------|
| `mandu change begin` | 트랜잭션 시작 (스냅샷 생성) |
| `mandu change commit` | 변경 확정 |
| `mandu change rollback` | 스냅샷에서 복원 |
| `mandu change status` | 현재 트랜잭션 상태 조회 |
| `mandu change list` | 변경 히스토리 조회 |
| `mandu change prune` | 오래된 스냅샷 정리 |

### 명령어 예시

```bash
# 프로젝트 초기화
bunx @mandujs/cli init my-app

# 개발 워크플로우
bunx mandu generate             # 매니페스트 + 코드 생성
bunx mandu guard                # 아키텍처 검사
bunx mandu dev                  # 개발 서버 실행

# 프로덕션 빌드
bunx mandu build --minify       # 최적화된 번들 빌드

# 트랜잭션으로 안전한 변경
bunx mandu change begin --message "사용자 API 추가"
# ... 변경 작업 ...
bunx mandu change commit        # 성공: 확정
bunx mandu change rollback      # 실패: 스냅샷 복원
```

---

## 매니페스트 시스템 (FS Routes)

app/ 디렉토리의 파일 시스템 라우트를 스캔하여 `.mandu/routes.manifest.json`을 자동 생성합니다. 라우트는 ID 규칙에 의해 `spec/slots/{id}.slot.ts` 및 `spec/contracts/{id}.contract.ts`에 자동 연결됩니다.

### .mandu/routes.manifest.json

```json
{
  "version": 1,
  "routes": [
    {
      "id": "home",
      "pattern": "/",
      "kind": "page",
      "module": "apps/server/generated/routes/home.route.ts",
      "componentModule": "apps/web/generated/routes/home.route.tsx"
    },
    {
      "id": "users-api",
      "pattern": "/api/users",
      "kind": "api",
      "methods": ["GET", "POST"],
      "module": "apps/server/generated/routes/users-api.route.ts",
      "slotModule": "spec/slots/users.slot.ts"
    },
    {
      "id": "dashboard",
      "pattern": "/dashboard",
      "kind": "page",
      "module": "apps/server/generated/routes/dashboard.route.ts",
      "componentModule": "apps/web/generated/routes/dashboard.route.tsx",
      "slotModule": "spec/slots/dashboard.slot.ts",
      "clientModule": "spec/slots/dashboard.client.ts",
      "hydration": {
        "strategy": "island",
        "priority": "visible",
        "preload": true
      }
    }
  ]
}
```

### 라우트 속성

| 속성 | 필수 | 설명 |
|------|------|------|
| `id` | 예 | 고유 라우트 식별자 |
| `pattern` | 예 | URL 패턴 (예: `/api/users/:id`) |
| `kind` | 예 | `"api"` 또는 `"page"` |
| `methods` | 아니오 | API 라우트의 HTTP 메서드 |
| `module` | 예 | 서버 핸들러 모듈 경로 |
| `componentModule` | 페이지만 | React 컴포넌트 모듈 경로 |
| `slotModule` | 아니오 | 비즈니스 로직 모듈 경로 |
| `clientModule` | 아니오 | 클라이언트 인터랙티브 로직 |
| `hydration` | 아니오 | Hydration 설정 |
| `loader` | 아니오 | SSR 데이터 로딩 설정 |

---

## 슬롯 시스템 (비즈니스 로직)

### 슬롯 로직 작성하기

슬롯은 `Mandu.filling()` API를 사용해 비즈니스 로직을 작성하는 곳입니다:

```typescript
// spec/slots/users.slot.ts
import { Mandu } from "@mandujs/core";

interface User {
  id: number;
  name: string;
  email: string;
}

export default Mandu.filling<{ users: User[] }>()
  // 인증 가드
  .guard((ctx) => {
    const user = ctx.get<User>("user");
    if (!user) return ctx.unauthorized("로그인이 필요합니다");
    // void 반환 시 계속 진행
  })

  // GET /api/users
  .get(async (ctx) => {
    const users = await fetchUsers();
    return ctx.ok({ data: users });
  })

  // POST /api/users
  .post(async (ctx) => {
    const body = await ctx.body<{ name: string; email: string }>();

    if (!body.name || !body.email) {
      return ctx.error("이름과 이메일이 필요합니다");
    }

    const newUser = await createUser(body);
    return ctx.created({ data: newUser });
  });
```

> 참고: Path 파라미터는 `routes.manifest.json`의 pattern에서 결정됩니다.  
> `/api/users/:id`는 별도의 route/slot 파일로 분리하세요.

### API 레퍼런스

전체 API 레퍼런스: `docs/api/api-reference.ko.md`

### Context API

| 메서드 | 설명 |
|--------|------|
| `ctx.ok(data)` | 200 OK 응답 |
| `ctx.created(data)` | 201 Created 응답 |
| `ctx.noContent()` | 204 No Content 응답 |
| `ctx.error(message, details?)` | 400 Bad Request |
| `ctx.unauthorized(message)` | 401 Unauthorized |
| `ctx.forbidden(message)` | 403 Forbidden |
| `ctx.notFound(message)` | 404 Not Found |
| `ctx.fail(message)` | 500 Internal Server Error |
| `ctx.body<T>()` | 요청 본문 파싱 |
| `ctx.params` | 라우트 파라미터 |
| `ctx.query` | 쿼리 스트링 파라미터 |
| `ctx.headers` | 요청 헤더 |
| `ctx.set(key, value)` | 컨텍스트에 데이터 저장 |
| `ctx.get<T>(key)` | 저장된 데이터 조회 |

---

## 라이프사이클 훅 & 미들웨어

### 라이프사이클 훅

핸들러 전/후에 로직을 실행합니다:

```typescript
import { Mandu } from "@mandujs/core";

export default Mandu.filling()
  .onRequest((ctx) => {
    // 요청 시작 시
    ctx.set("requestId", crypto.randomUUID());
  })
  .onParse(async (ctx) => {
    // 바디가 있는 메서드에서 실행
    // 여기서 body를 읽을 때는 req.clone() 사용 권장
    const raw = await ctx.req.clone().text();
    ctx.set("rawBody", raw);
  })
  .beforeHandle((ctx) => {
    // Guard 역할: Response 반환 시 차단
    if (!ctx.get("user")) return ctx.unauthorized("로그인이 필요합니다");
  })
  .afterHandle((ctx, res) => {
    res.headers.set("X-Request-Id", ctx.get("requestId") as string);
    return res;
  })
  .mapResponse((_ctx, res) => {
    // 최종 응답 매핑
    return res;
  })
  .afterResponse((ctx) => {
    // 응답 이후 실행 (비동기)
    console.log("done", ctx.get("requestId"));
  })
  .get((ctx) => ctx.ok({ ok: true }));
```

### Compose 스타일 미들웨어

Koa/Hono 스타일의 미들웨어 체인:

```typescript
export default Mandu.filling()
  .middleware(async (_ctx, next) => {
    console.log("before");
    await next();
    console.log("after");
  })
  .get((ctx) => ctx.ok({ ok: true }));
```

### Trace (선택)

trace를 활성화하고 훅에서 이벤트를 확인할 수 있습니다:

```typescript
import { Mandu, enableTrace, TRACE_KEY } from "@mandujs/core";

export default Mandu.filling()
  .onRequest((ctx) => enableTrace(ctx))
  .afterResponse((ctx) => {
    const trace = ctx.get(TRACE_KEY);
    console.log(trace?.records);
  })
  .get((ctx) => ctx.ok({ ok: true }));
```

#### Trace 리포트

```typescript
import { buildTraceReport, formatTraceReport } from "@mandujs/core";

const report = buildTraceReport(trace);
console.log(report.entries);
console.log(formatTraceReport(report));
```

### 라이프사이클/미들웨어 API 레퍼런스

| 메서드 | 설명 |
|--------|------|
| `onRequest(fn)` | 요청 시작 시 실행 |
| `onParse(fn)` | 바디 메서드에서 핸들러 전 실행 |
| `beforeHandle(fn)` | 가드 훅 (Response 반환 시 차단) |
| `afterHandle(fn)` | 핸들러 후 실행 |
| `mapResponse(fn)` | 최종 응답 매핑 |
| `afterResponse(fn)` | 응답 후 실행 (비동기) |
| `guard(fn)` | `beforeHandle` 별칭 |
| `use(fn)` | `guard` 별칭 |
| `middleware(fn)` | compose 스타일 미들웨어 |

## Island Hydration

### Island란?

Island는 페이지의 나머지 부분은 정적 HTML로 유지하면서 클라이언트에서 hydrate되는 인터랙티브 컴포넌트입니다. 이 접근법의 장점:

- **빠른 초기 로드**: 대부분의 페이지가 정적 HTML
- **더 나은 성능**: 인터랙티브 부분만 JavaScript 로드
- **SEO 친화적**: 검색 엔진을 위한 완전한 HTML 컨텐츠

### Hydration 전략

| 전략 | 설명 | 사용 사례 |
|------|------|----------|
| `none` | 순수 정적 HTML, JavaScript 없음 | SEO 중요, 읽기 전용 페이지 |
| `island` | 부분 hydration (기본값) | 정적 + 인터랙티브 혼합 |
| `full` | 전체 페이지 hydration | SPA 같은 인터랙티브 페이지 |
| `progressive` | 지연 순차 hydration | 큰 페이지, 성능 최적화 |

### Hydration 우선순위

| 우선순위 | JavaScript 로드 시점 | 사용 사례 |
|----------|---------------------|----------|
| `immediate` | 페이지 로드 시 | 중요한 상호작용 |
| `visible` | 뷰포트에 보일 때 (기본값) | 스크롤 아래 콘텐츠 |
| `idle` | 브라우저 유휴 시간 | 비중요 기능 |
| `interaction` | 사용자 상호작용 시 | 지연 활성화 |

### Island 만들기

1. **라우트에 클라이언트 모듈 추가:**

```json
{
  "id": "counter",
  "pattern": "/counter",
  "kind": "page",
  "module": "apps/server/generated/routes/counter.route.ts",
  "componentModule": "apps/web/generated/routes/counter.route.tsx",
  "clientModule": "spec/slots/counter.client.ts",
  "hydration": {
    "strategy": "island",
    "priority": "visible"
  }
}
```

2. **클라이언트 컴포넌트 작성:**

```typescript
// spec/slots/counter.client.ts
import React, { useState } from "react";

export default function Counter({ initialCount = 0 }) {
  const [count, setCount] = useState(initialCount);

  return (
    <div className="counter-island">
      <h2>인터랙티브 카운터</h2>
      <p className="count">{count}</p>
      <button onClick={() => setCount(count - 1)}>-</button>
      <button onClick={() => setCount(count + 1)}>+</button>
    </div>
  );
}
```

3. **빌드 및 실행:**

```bash
bunx mandu build       # 클라이언트 번들 빌드
bunx mandu dev         # 또는 HMR 포함 개발 서버 실행
```

---

## Hot Module Replacement (HMR)

### HMR 작동 방식

개발 중에 Mandu는 `.client.ts` 파일의 변경을 감시하고 자동으로:

1. 영향 받은 island 번들 재빌드
2. WebSocket을 통해 연결된 브라우저에 알림
3. 페이지 새로고침 트리거 (또는 타겟 island 업데이트)

### HMR 기능

- **WebSocket 서버**: 포트 + 1에서 실행 (예: 개발 서버 3000이면 3001)
- **자동 재연결**: 연결이 끊어지면 자동으로 재연결
- **에러 오버레이**: 브라우저에서 직접 빌드 에러 표시
- **파일 감시**: `spec/slots/*.client.ts` 파일 감시

### 개발 서버 출력

```
🥟 Mandu Dev Server
📄 Manifest: /path/to/.mandu/routes.manifest.json

✅ Spec 로드 완료: 5개 라우트
  📄 Page: / -> home
  📡 API: /api/health -> health
  📄 Page: /counter -> counter 🏝️    ← Island 표시

🔥 HMR server running on ws://localhost:3001
🔨 Initial client bundle build...
✅ Built 1 island
👀 Watching for client slot changes...
🥟 Mandu Dev Server running at http://localhost:3000
🔥 HMR enabled on port 3001
```

---

## Guard 시스템

Guard는 다음을 검사하여 아키텍처 보존을 강제합니다:

| 규칙 | 검사 내용 | 수정 명령 |
|------|----------|----------|
| `SPEC_HASH_MISMATCH` | spec.lock.json 해시가 매니페스트와 일치 | `mandu generate` |
| `GENERATED_MANUAL_EDIT` | "DO NOT EDIT" 마커가 그대로인지 | `mandu generate` |
| `INVALID_GENERATED_IMPORT` | /generated/에서 import 없음 | 런타임 레지스트리 사용 |
| `FORBIDDEN_IMPORT_IN_GENERATED` | fs, child_process 등 없음 | 로직을 slot으로 이동 |
| `SLOT_NOT_FOUND` | 지정된 슬롯 파일 존재 | `mandu generate` |

### Guard 실행

```bash
# 모든 규칙 검사
bunx mandu guard

# 자동 수정 포함 검사
bunx mandu guard --auto-correct
```

---

## 설정

Mandu는 `mandu.config.ts`, `mandu.config.js`, `mandu.config.json`을 읽습니다.  
Guard 전용 설정은 `.mandu/guard.json`도 지원합니다.

- `mandu dev`, `mandu build` 실행 시 설정을 검증하고 오류를 출력합니다
- CLI 옵션이 설정값보다 우선합니다

```ts
// mandu.config.ts
export default {
  server: {
    port: 3000,
    hostname: "localhost",
    cors: false,
    streaming: false,
    rateLimit: {
      windowMs: 60_000,
      max: 100,
    },
  },
  dev: {
    hmr: true,
    watchDirs: ["src/shared", "shared"],
  },
  build: {
    outDir: ".mandu",
    minify: true,
    sourcemap: false,
  },
  guard: {
    preset: "mandu",
    srcDir: "src",
    exclude: ["**/*.test.ts"],
    realtime: true,
    // rules/contractRequired는 레거시 spec guard에서 사용
  },
  seo: {
    enabled: true,
    defaultTitle: "My App",
    titleTemplate: "%s | My App",
  },
};
```

`server.rateLimit`은 API 라우트에만 적용되며, 키는 `클라이언트 IP + 라우트`입니다. 제한 초과 시 `429`와 `X-RateLimit-*` 헤더를 반환합니다.

---

## MCP 서버 (AI 에이전트 통합)

Mandu는 AI 에이전트가 프레임워크와 직접 상호작용할 수 있는 완전한 MCP (Model Context Protocol) 서버를 포함합니다.

### 설정

프로젝트 루트에 `.mcp.json` 생성:

```json
{
  "mcpServers": {
    "mandu": {
      "command": "bunx",
      "args": ["@mandujs/mcp"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

### 사용 가능한 MCP 도구

#### Spec 관리

| 도구 | 설명 |
|------|------|
| `mandu_list_routes` | 모든 라우트 목록 조회 |
| `mandu_get_route` | 특정 라우트 상세 조회 |
| `mandu_add_route` | 새 라우트 추가 (app/ 파일 + 선택적 slot/contract 스캐폴딩) |
| `mandu_delete_route` | 라우트 삭제 |
| `mandu_validate_manifest` | 매니페스트 검증 |

#### 코드 생성

| 도구 | 설명 |
|------|------|
| `mandu_generate` | 코드 생성 실행 |

#### 트랜잭션 관리

| 도구 | 설명 |
|------|------|
| `mandu_begin` | 스냅샷과 함께 트랜잭션 시작 |
| `mandu_commit` | 변경 확정 |
| `mandu_rollback` | 스냅샷에서 복원 |
| `mandu_tx_status` | 트랜잭션 상태 조회 |

#### 슬롯 관리

| 도구 | 설명 |
|------|------|
| `mandu_read_slot` | 슬롯 파일 내용 읽기 |
| `mandu_write_slot` | 슬롯 파일 쓰기 (자동 수정 포함) |
| `mandu_validate_slot` | 슬롯 구문 검증 |

#### Guard & 검증

| 도구 | 설명 |
|------|------|
| `mandu_guard_check` | 모든 guard 검사 실행 |
| `mandu_guard_heal` | Self-Healing Guard - 위반 감지 + 자동 수정 |
| `mandu_explain_rule` | 아키텍처 규칙 설명 |
| `mandu_analyze_error` | 에러 분석 및 수정 제안 |

#### Decision Memory (RFC-001) 🆕

| 도구 | 설명 |
|------|------|
| `mandu_search_decisions` | ADR 검색 (태그, 상태) |
| `mandu_save_decision` | 새 아키텍처 결정 저장 |
| `mandu_check_consistency` | 결정과 구현 일관성 검사 |
| `mandu_get_architecture` | 압축 아키텍처 문서 조회 |

#### Semantic Slots (RFC-001) 🆕

| 도구 | 설명 |
|------|------|
| `mandu_validate_slot` | 슬롯 제약 조건 검증 |
| `mandu_validate_slots` | 여러 슬롯 일괄 검증 |

#### Architecture Negotiation (RFC-001) 🆕

| 도구 | 설명 |
|------|------|
| `mandu_negotiate` | AI-프레임워크 협상 |
| `mandu_generate_scaffold` | 구조 스캐폴드 생성 |
| `mandu_analyze_structure` | 기존 프로젝트 구조 분석 |

#### Hydration & 빌드

| 도구 | 설명 |
|------|------|
| `mandu_build` | 클라이언트 번들 빌드 |
| `mandu_build_status` | 번들 통계 조회 |
| `mandu_list_islands` | hydration 라우트 목록 |
| `mandu_set_hydration` | hydration 전략 설정 |
| `mandu_add_client_slot` | 라우트용 클라이언트 슬롯 생성 |

#### 실시간 Watch (Brain v0.1)

| 도구 | 설명 |
|------|------|
| `mandu_watch_start` | 파일 감시 시작 + MCP push notification 활성화 |
| `mandu_watch_status` | 감시 상태 및 최근 경고 조회 |
| `mandu_watch_stop` | 감시 중지 및 구독 정리 |
| `mandu_doctor` | Guard 실패 분석 및 패치 제안 |
| `mandu_check_location` | 파일 위치가 아키텍처 규칙에 맞는지 검사 |
| `mandu_check_import` | import가 아키텍처 규칙에 맞는지 검사 |
| `mandu_get_architecture` | 프로젝트 아키텍처 규칙 및 폴더 구조 조회 |

#### 히스토리

| 도구 | 설명 |
|------|------|
| `mandu_list_changes` | 변경 히스토리 조회 |
| `mandu_prune_history` | 오래된 스냅샷 정리 |

#### SEO

| 도구 | 설명 |
|------|------|
| `mandu_preview_seo` | SEO 메타데이터 HTML 미리보기 |
| `mandu_generate_sitemap_preview` | sitemap.xml 미리보기 생성 |
| `mandu_generate_robots_preview` | robots.txt 미리보기 생성 |
| `mandu_create_jsonld` | JSON-LD 구조화 데이터 생성 |
| `mandu_write_seo_file` | sitemap.ts/robots.ts 파일 생성 |
| `mandu_seo_analyze` | SEO 메타데이터 분석 및 권장사항 제공 |

### MCP 리소스

| URI | 설명 |
|-----|------|
| `mandu://spec/manifest` | 현재 routes.manifest.json |
| `mandu://spec/lock` | 현재 spec.lock.json |
| `mandu://generated/map` | 생성된 파일 매핑 |
| `mandu://transaction/active` | 활성 트랜잭션 상태 |
| `mandu://slots/{routeId}` | 슬롯 파일 내용 |
| `mandu://watch/warnings` | 최근 아키텍처 위반 경고 목록 |
| `mandu://watch/status` | Watch 상태 (활성여부, 업타임, 파일 수) |

### 에이전트 워크플로우 예시

```
User: "페이지네이션이 있는 사용자 목록 API를 만들어줘"

Agent:
1. mandu_begin({ message: "페이지네이션 포함 사용자 API 추가" })
   → 스냅샷 생성, changeId 반환

2. mandu_add_route({
     id: "users-list",
     pattern: "/api/users",
     kind: "api",
     methods: ["GET", "POST"],
     slotModule: "spec/slots/users.slot.ts"
   })
   → routes.manifest.json 업데이트

3. mandu_generate()
   → 라우트 핸들러 생성

4. mandu_write_slot({
     routeId: "users-list",
     content: `
       import { Mandu } from "@mandujs/core";

       export default Mandu.filling()
         .get(async (ctx) => {
           const page = parseInt(ctx.query.page) || 1;
           const limit = parseInt(ctx.query.limit) || 10;
           const users = await getUsers({ page, limit });
           return ctx.ok({ data: users, page, limit });
         })
         .post(async (ctx) => {
           const body = await ctx.body();
           const user = await createUser(body);
           return ctx.created({ data: user });
         });
     `,
     autoCorrect: true
   })
   → 비즈니스 로직 작성, 이슈 자동 수정

5. mandu_guard_check()
   → 아키텍처 검증

6. mandu_commit()
   → 트랜잭션 완료

결과: 완전한 롤백 가능한 새 API 준비 완료
```

### 실시간 아키텍처 모니터링

Mandu의 MCP 서버는 아키텍처 위반을 감지하면 AI 에이전트에게 **실시간 push notification**을 보냅니다. 기존의 lint-on-save 방식과 달리, 에이전트가 폴링 없이 **능동적으로 알림을 수신**합니다.

```
파일 변경 (fs.watch)
  → FileWatcher 감지
    → validateFile() 아키텍처 규칙 검사
      → MCP push notification:
          1. sendLoggingMessage()      → 에이전트가 실시간으로 경고 수신
          2. sendResourceUpdated()     → 경고 리소스 갱신 알림
```

#### 작동 방식

1. **감시 시작** — `mandu_watch_start` 호출
2. **평소처럼 개발** — watcher가 모든 파일 변경을 모니터링
3. **위반 감지** — 예: generated 파일을 수동으로 수정
4. **에이전트가 push 수신** — MCP `notifications/message`가 즉시 전달
5. **에이전트가 대응** — `mandu://watch/warnings` 리소스를 읽고 조치

#### 감시 규칙

| 규칙 | 감지 대상 |
|------|----------|
| `GENERATED_DIRECT_EDIT` | generated 파일 수동 수정 (`mandu generate` 사용 권장) |
| `WRONG_SLOT_LOCATION` | `spec/slots/` 외부의 슬롯 파일 |
| `SLOT_NAMING` | `.slot.ts`로 끝나지 않는 슬롯 파일 |
| `CONTRACT_NAMING` | `.contract.ts`로 끝나지 않는 계약 파일 |
| `FORBIDDEN_IMPORT` | generated 파일의 위험한 import (`fs`, `child_process`) |

#### Notification 메시지 포맷 (JSON-RPC)

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/message",
  "params": {
    "level": "warning",
    "logger": "mandu-watch",
    "data": {
      "type": "watch_warning",
      "ruleId": "GENERATED_DIRECT_EDIT",
      "file": "apps/server/generated/routes/home.handler.ts",
      "message": "Generated 파일이 직접 수정되었습니다",
      "event": "modify",
      "timestamp": "2026-01-30T10:15:00.000Z"
    }
  }
}
```

> **왜 이게 중요한가**: MCP 수준에서 AI 에이전트에게 실시간 아키텍처 모니터링을 제공하는 웹 프레임워크는 없습니다. 에이전트가 코드만 작성하는 게 아니라, 프로젝트를 감시하면서 아키텍처 붕괴를 실시간으로 방지합니다.

---

## 에러 처리 시스템

### 에러 분류

Mandu는 자동으로 에러를 세 가지 유형으로 분류합니다:

| 유형 | 설명 | 일반적인 원인 |
|------|------|-------------|
| `SPEC_ERROR` | 매니페스트/검증 문제 | 잘못된 JSON, 필수 필드 누락 |
| `LOGIC_ERROR` | 슬롯 런타임 실패 | 비즈니스 로직 버그, DB 에러 |
| `FRAMEWORK_BUG` | 생성된 코드 에러 | 발생하면 안됨; 프레임워크 문제 |

### 에러 응답 형식

```json
{
  "errorType": "LOGIC_ERROR",
  "code": "SLOT_RUNTIME_ERROR",
  "message": "Cannot read property 'id' of undefined",
  "summary": "users.slot.ts에서 Null 참조",
  "fix": {
    "file": "spec/slots/users.slot.ts",
    "line": 15,
    "suggestion": ".id에 접근하기 전에 user 객체가 존재하는지 확인하세요"
  },
  "route": {
    "id": "users-api",
    "pattern": "/api/users/:id"
  },
  "timestamp": "2025-01-28T12:00:00.000Z"
}
```

---

## 기술 스택

| 영역 | 기술 | 선택 이유 |
|------|------|----------|
| **Runtime** | Bun | 빠른 속도, 올인원 툴킷, 네이티브 TypeScript |
| **Language** | TypeScript | 타입 안전성, 에이전트 친화적 |
| **Frontend** | React | SSR 지원, 생태계 |
| **Rendering** | SSR (renderToString) | SEO, 성능 |
| **Validation** | Zod | 스키마 검증, 타입 추론 |
| **Protocol** | MCP | AI 에이전트 통합 |

---

## 로드맵

### v0.10.x (현재) — 74개 기능 완료

**Core Runtime**
- [x] 미들웨어 compose & 라이프사이클 훅
- [x] Streaming SSR
- [x] Filling API (guard, hooks, middleware)
- [x] 런타임 로거 & trace 시스템

**Routing**
- [x] FS Routes (스캐너, 패턴, 제너레이터, 와처)
- [x] 레이아웃 시스템 (layoutChain, loading, error)
- [x] 고급 라우트 (catch-all, optional params)
- [x] 클라이언트 라우터 (Link, NavLink, hooks)

**Architecture**
- [x] Mandu Guard 5가지 프리셋 (mandu, fsd, clean, hexagonal, atomic)
- [x] AST 기반 import 분석
- [x] 통계 & 트렌드 추적
- [x] 실시간 위반 감지

**API & Types**
- [x] Zod 기반 Contract API
- [x] 타입 안전 핸들러 & 클라이언트
- [x] OpenAPI 3.0 생성기
- [x] 스키마 정규화

**Hydration**
- [x] Island hydration (visible, idle, interaction)
- [x] Partials & slots
- [x] Error boundary & loading states
- [x] HMR 지원

**SEO (검색 엔진 최적화)**
- [x] Next.js Metadata API 호환 타입
- [x] 레이아웃 체인 메타데이터 병합
- [x] Open Graph & Twitter Cards
- [x] JSON-LD 구조화 데이터 (12개 헬퍼)
- [x] sitemap.xml & robots.txt 생성
- [x] Google SEO 최적화 (viewport, theme-color, resource hints)
- [x] SSR 통합

**AI Integration (RFC-001: Guard → Guide)** 🆕
- [x] MCP 서버 (35+ 도구, 7 리소스)
- [x] Brain (Doctor, Watcher, Architecture analyzer)
- [x] 스냅샷 포함 트랜잭션 API
- [x] 실시간 push 알림
- [x] **Decision Memory** - ADR 저장 & 일관성 검사
- [x] **Semantic Slots** - 목적 & 제약 검증
- [x] **Architecture Negotiation** - AI-프레임워크 협상
- [x] **Self-Healing Guard** - 자동 수정 제안

**Security**
- [x] Path traversal 방지
- [x] 포트 유효성 검사
- [x] LFI 취약점 방어
- [x] ReDoS 방어

### v0.11.x (다음)

**Data Layer** *(Astro 패턴)*
- [ ] Loader API (store, meta, logger, watcher 컨텍스트)
- [ ] File Loader & API Loader 구현
- [ ] DataStore & MetaStore (digest 추적)
- [ ] Cache Store 어댑터 (Redis, in-memory)
- [ ] ISR (Incremental Static Regeneration)

**Realtime** *(Phoenix 패턴)*
- [ ] WebSocket Channels (join/handle_in/handle_out)
- [ ] Channel/Socket 분리 모델
- [ ] Serializer 기반 메시지 프로토콜
- [ ] Server-sent events (SSE)

**Build & Integration** *(Astro/Fresh 패턴)*
- [ ] Build Hooks (start/setup/done 라이프사이클)
- [ ] 빌드 확장 Plugin API
- [ ] 타임아웃 경고 포함 통합 훅 & 전용 로거
- [ ] 번들 분석기

**Observability**
- [ ] 성능 벤치마크 (라우팅, SSR, hydration)
- [ ] TTFB & TTI 측정
- [ ] 자동화된 성능 테스트 모음

### v0.12.x (예정)

**AOT 최적화** *(Elysia 패턴)*
- [ ] AOT 핸들러 생성 (런타임 프리컴파일)
- [ ] Sucrose 스타일 컨텍스트 추론
- [ ] JIT/AOT 모드 선택 (`mandu build --aot`)

**고급 Hydration** *(Qwik/Fresh 패턴)*
- [ ] Client Reviver (DOM marker 기반 복원)
- [ ] Resumable POC / QRL-lite (지연 이벤트 핸들러 로딩)
- [ ] Serializer Registry (플러그인 타입 직렬화)
- [ ] Progressive Hydration 개선

**개발자 경험**
- [ ] 개발 환경 에러 오버레이
- [ ] 향상된 TypeScript 추론
- [ ] 프로젝트 템플릿 & 스캐폴딩

---

## 기여하기

```bash
# 저장소 클론
git clone https://github.com/konamgil/mandu.git
cd mandu

# 의존성 설치
bun install

# 테스트 실행
bun test

# 로컬에서 CLI 테스트
bun run packages/cli/src/main.ts --help
```

---

## 왜 "만두"인가?

만두처럼 **겉(generated 코드)은 일정하고, 속(slot)만 다양하게** 만들 수 있는 구조입니다. 에이전트가 아무리 코딩해도 만두 모양(아키텍처)은 유지됩니다. 🥟

---

## 라이선스

MPL-2.0

---

<p align="center">
  <sub>Built with 🥟 by the Mandu Team</sub>
</p>
