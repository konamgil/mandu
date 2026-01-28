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

**자연어 → Spec → Generate → Slot → Guard → Report**

```
┌─────────────────────────────────────────────────────────────┐
│                        Mandu Flow                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   📝 Spec (JSON)      단일 진실 원천 (SSOT)                   │
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
| **Spec 기반 개발** | JSON 매니페스트가 단일 진실 원천 |
| **코드 생성** | spec에서 라우트, 핸들러, 컴포넌트 자동 생성 |
| **슬롯 시스템** | 에이전트가 안전하게 비즈니스 로직을 작성하는 격리 영역 |
| **Guard 시스템** | 아키텍처 규칙 강제 및 오염 방지 |
| **트랜잭션 API** | 스냅샷 기반 롤백이 가능한 원자적 변경 |
| **MCP 서버** | AI 에이전트가 프레임워크를 직접 조작 가능 |
| **Island Hydration** | 선택적 클라이언트 JavaScript로 성능 최적화 |
| **HMR 지원** | 빠른 개발을 위한 핫 모듈 교체 |
| **에러 분류 시스템** | 지능적 에러 분류와 수정 가이드 제공 |

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

# Spec 검증 및 lock 갱신
bun run spec

# 코드 생성
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
| 1 | **Spec = SSOT** | Spec(JSON)이 단일 진실 원천. 코드는 spec의 산출물 |
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
│   │   └── commands/        # init, spec-upsert, generate, guard, build, dev
│   │
│   └── mcp/                  # @mandujs/mcp
│       ├── tools/           # MCP 도구 (20개 이상)
│       └── resources/       # MCP 리소스 (5개)
│
└── tests/                    # 프레임워크 테스트
```

### 생성되는 프로젝트 구조

```
my-app/
├── spec/
│   ├── routes.manifest.json     # 라우트 정의 (SSOT)
│   ├── spec.lock.json           # 해시 검증
│   ├── slots/                   # 비즈니스 로직 파일
│   │   ├── users.slot.ts       # 서버 로직
│   │   └── users.client.ts     # 클라이언트 인터랙티브 로직
│   └── history/                 # 트랜잭션 스냅샷
│       ├── changes.json        # 변경 감사 로그
│       └── *.snapshot.json     # 롤백 스냅샷
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
| `mandu spec-upsert` | spec 검증 및 lock 파일 갱신 |
| `mandu generate` | spec에서 코드 생성 |
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
bunx mandu spec-upsert          # spec 검증
bunx mandu generate             # 코드 생성
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

## Spec 시스템

### routes.manifest.json

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
  // 데이터 로더 (SSR 시 실행)
  .loader(async (ctx) => {
    const users = await fetchUsers();
    return { users };
  })

  // 인증 가드
  .guard(async (ctx) => {
    if (!ctx.user) {
      return ctx.unauthorized("로그인이 필요합니다");
    }
    return ctx.next();
  })

  // GET /api/users
  .get((ctx) => {
    const { users } = ctx.loaderData;
    return ctx.ok({ data: users });
  })

  // POST /api/users
  .post(async (ctx) => {
    const body = await ctx.body<{ name: string; email: string }>();

    if (!body.name || !body.email) {
      return ctx.badRequest("이름과 이메일이 필요합니다");
    }

    const newUser = await createUser(body);
    return ctx.created({ data: newUser });
  })

  // GET /api/users/:id
  .get("/:id", async (ctx) => {
    const user = await findUser(ctx.params.id);

    if (!user) {
      return ctx.notFound("사용자를 찾을 수 없습니다");
    }

    return ctx.ok({ data: user });
  })

  // DELETE /api/users/:id
  .delete("/:id", async (ctx) => {
    await deleteUser(ctx.params.id);
    return ctx.noContent();
  });
```

### Context API

| 메서드 | 설명 |
|--------|------|
| `ctx.ok(data)` | 200 OK 응답 |
| `ctx.created(data)` | 201 Created 응답 |
| `ctx.noContent()` | 204 No Content 응답 |
| `ctx.badRequest(message)` | 400 Bad Request |
| `ctx.unauthorized(message)` | 401 Unauthorized |
| `ctx.forbidden(message)` | 403 Forbidden |
| `ctx.notFound(message)` | 404 Not Found |
| `ctx.body<T>()` | 요청 본문 파싱 |
| `ctx.params` | 라우트 파라미터 |
| `ctx.query` | 쿼리 스트링 파라미터 |
| `ctx.headers` | 요청 헤더 |
| `ctx.user` | 인증된 사용자 (있는 경우) |
| `ctx.loaderData` | 로더에서 가져온 데이터 |

---

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
📄 Spec 파일: /path/to/spec/routes.manifest.json

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
| `SPEC_HASH_MISMATCH` | spec.lock.json 해시가 spec과 일치 | `mandu spec-upsert` |
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
| `mandu_add_route` | 새 라우트 추가 |
| `mandu_update_route` | 기존 라우트 수정 |
| `mandu_delete_route` | 라우트 삭제 |
| `mandu_validate_spec` | 매니페스트 검증 |

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
| `mandu_analyze_error` | 에러 분석 및 수정 제안 |

#### Hydration & 빌드

| 도구 | 설명 |
|------|------|
| `mandu_build` | 클라이언트 번들 빌드 |
| `mandu_build_status` | 번들 통계 조회 |
| `mandu_list_islands` | hydration 라우트 목록 |
| `mandu_set_hydration` | hydration 전략 설정 |
| `mandu_add_client_slot` | 라우트용 클라이언트 슬롯 생성 |

#### 히스토리

| 도구 | 설명 |
|------|------|
| `mandu_list_changes` | 변경 히스토리 조회 |
| `mandu_prune_history` | 오래된 스냅샷 정리 |

### MCP 리소스

| URI | 설명 |
|-----|------|
| `mandu://spec/manifest` | 현재 routes.manifest.json |
| `mandu://spec/lock` | 현재 spec.lock.json |
| `mandu://generated/map` | 생성된 파일 매핑 |
| `mandu://transaction/active` | 활성 트랜잭션 상태 |
| `mandu://slots/{routeId}` | 슬롯 파일 내용 |

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

### v0.4.x (현재)
- [x] Island hydration 시스템
- [x] HMR (Hot Module Replacement)
- [x] 20개 이상의 도구를 포함한 MCP 서버
- [x] 스냅샷 포함 트랜잭션 API
- [x] 에러 분류 시스템
- [x] 슬롯 자동 수정

### v0.5.x (다음)
- [ ] WebSocket 플랫폼
- [ ] Channel-logic 슬롯
- [ ] Contract-first API
- [ ] 개선된 테스트 템플릿

### v1.0.x
- [ ] ISR (Incremental Static Regeneration)
- [ ] CacheStore 어댑터
- [ ] 분산 WebSocket 모드
- [ ] 프로덕션 배포 가이드

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

MIT

---

<p align="center">
  <sub>Built with 🥟 by the Mandu Team</sub>
</p>
