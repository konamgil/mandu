# Filesystem-First 아키텍처

> Mandu는 **파일시스템 기반 라우팅(FS-First)** 프레임워크다.  
> `app/` 디렉토리가 SSOT이고, `routes.manifest.json`은 파생 캐시다.

---

## 1. 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **`app/` = SSOT** | 파일 생성/삭제가 곧 라우트 정의. Manifest는 편집해도 덮어씀 |
| **Generated는 일회용** | `.mandu/generated/`는 언제든 재생성 가능 |
| **Slot에서만 작업** | AI는 `spec/slots/`, `spec/contracts/`에서만 비즈니스 로직 작성 |
| **Guard가 구조 보호** | Lint가 아닌 Guard가 아키텍처 위반을 차단 |
| **Self-Correction Loop** | ATE: 실패 시 Heal diff 제안 → 재시도 |

---

## 2. 데이터 흐름

```
app/                          ← SSOT (사용자/AI가 파일 생성)
  ├── page.tsx                    /
  ├── blog/[slug]/page.tsx        /blog/:slug
  └── api/users/route.ts          /api/users
         ↓
    FSScanner.scan()           ← 파일시스템 스캔
         ↓
    scanResultToManifest()     ← RouteSpec[] 변환
         ↓
    resolveAutoLinks()         ← spec/slots/, spec/contracts/ 자동 링크
         ↓
    .mandu/routes.manifest.json  ← 파생 캐시 (직접 편집 금지)
         ↓
    Generator / Dev Server     ← 매니페스트를 읽어 핸들러 등록
```

---

## 3. 프로젝트 디렉토리 구조

```
project/
├── app/                         ← SSOT: FS Routes
│   ├── page.tsx                 → Route: /
│   ├── layout.tsx               → Root layout
│   ├── blog/
│   │   ├── [slug]/
│   │   │   ├── page.tsx         → Route: /blog/:slug
│   │   │   └── comments.island.tsx → Island 컴포넌트
│   │   └── layout.tsx           → Nested layout
│   ├── api/
│   │   └── users/
│   │       └── route.ts         → Route: /api/users (GET|POST|...)
│   ├── (marketing)/             → Route group (URL에 미반영)
│   │   └── about/page.tsx       → Route: /about
│   └── _components/             → Private 폴더 (스캔 제외)
│
├── spec/                        ← 서버 사이드 스펙
│   ├── slots/                   → 서버 데이터 로더 (route ID로 자동 링크)
│   │   ├── index.slot.ts
│   │   └── blog-$slug.slot.ts
│   └── contracts/               → Zod API 스키마 (route ID로 자동 링크)
│       └── api-users.contract.ts
│
├── .mandu/                      ← 프레임워크 내부 (자동 생성)
│   ├── routes.manifest.json     → 파생 캐시
│   ├── generated/               → 생성된 코드 (일회용)
│   └── client/                  → 컴파일된 클라이언트 번들
│
└── mandu.config.ts              ← 프로젝트 설정
```

---

## 4. Route ID 규칙 & Auto-Linking

### Route ID 생성
파일 경로에서 자동 생성:

| 파일 경로 | Route ID | URL 패턴 |
|-----------|----------|----------|
| `app/page.tsx` | `index` | `/` |
| `app/blog/[slug]/page.tsx` | `blog-$slug` | `/blog/:slug` |
| `app/api/users/route.ts` | `api-users` | `/api/users` |
| `app/api/[userId]/route.ts` | `api-$userId` | `/api/:userId` |

### Auto-Link 컨벤션
Route ID와 파일명이 일치하면 **자동으로 연결**:

```
Route: blog-$slug
  ├── spec/slots/blog-$slug.slot.ts      → slotModule 자동 링크
  └── spec/contracts/blog-$slug.contract.ts → contractModule 자동 링크
```

매니페스트에 수동 등록할 필요 없음. 파일만 생성하면 `resolveAutoLinks()`가 처리.

---

## 5. Dev Server 흐름

```
mandu dev
  ├── 1. mandu.config.ts 로드
  ├── 2. resolveManifest() → generateManifest() → manifest 생성
  ├── 3. Guard preflight 검사
  ├── 4. 라우트 핸들러 등록 (manifest 기반)
  ├── 5. HMR WebSocket 서버 시작
  ├── 6. CSS Watcher 시작 (Tailwind)
  ├── 7. FS Routes Watcher 시작
  │      ├── app/ 변경 → rescan → manifest 재생성 → 핸들러 재등록
  │      └── spec/slots/, spec/contracts/ 변경 → auto-link 갱신
  └── 8. HTTP 서버 시작 (port 3333)
```

**핵심**: 파일 변경 시 manifest를 **매번 재생성**. manifest는 절대 수동 편집의 대상이 아님.

---

## 6. 무엇이 SSOT이고 무엇이 아닌가

### SSOT (직접 편집하는 것)
- `app/` — 라우트 구조
- `spec/slots/` — 서버 데이터 로더 (비즈니스 로직)
- `spec/contracts/` — API 스키마 (Zod)
- `mandu.config.ts` — 프로젝트 설정

### 파생물 (자동 생성, 편집 금지)
- `.mandu/routes.manifest.json` — FSScanner 출력 캐시
- `.mandu/generated/` — Generator 출력
- `.mandu/client/` — 번들러 출력

---

## 7. Guard의 역할

Guard는 manifest가 아닌 **소스 코드의 구조적 규칙**을 검증한다:

- 레이어 위반 감지 (프리셋: mandu, fsd, clean, hexagonal, atomic, cqrs)
- 순환 의존성 감지
- Import 규칙 검증
- Self-healing 제안 + auto-fix

Guard는 `src/` 디렉토리를 감시하며, manifest 변경과는 **독립적**으로 동작한다.
