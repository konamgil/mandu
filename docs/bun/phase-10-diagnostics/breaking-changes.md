---
title: "Phase 10 R0.2 — Breaking changes 0.20.8 / 0.21.6 → 0.25.x / 0.23.x"
audience: mandujs.com upgrade owner
status: draft
created: 2026-04-18
source_commits:
  - b68d28f (0.20 baseline)
  - 2100a56 (core 0.21.0 / cli 0.22.0)
  - 461a557 (Phase 9.R1, current main)
---

# Mandu 0.20.8 / 0.21.6 → core 0.25.x / cli 0.23.x

**대상 프로젝트**: `C:\Users\LamySolution\workspace\mandujs.com`
(`@mandujs/core@^0.20.8`, `@mandujs/cli@^0.21.6`, `@mandujs/mcp@^0.19.3`)

mandujs.com 은 공개 API 표면을 **거의 쓰지 않는다**. 실제 코드 사용처:
- `app/[lang]/page.tsx:6` — `import type { Metadata } from "@mandujs/core"` (타입만)
- `mandu.config.ts` — `server.port` / `dev.hmr` 두 필드만
- `package.json scripts` — `mandu dev`/`build`/`start`/`check`/`guard`/`test:auto` CLI

따라서 이번 업그레이드는 "**애플리케이션 코드 수정 없이 버전만 올려도 동작해야** 한다"가 본 문서의 첫 번째 강한 주장이다. 아래 표와 체크리스트는 그 가정이 성립하는 구간과 깨지는 구간을 분리한다.

---

## 1. Version journey 0.20.8 → 0.25.x

기준점 `b68d28f` (2026-04-12, core 0.20.0 / cli 0.21.1) → 현재 HEAD `461a557`/`7a09c6d`/`833ce7e` (2026-04-19, core 0.22.0 / cli 0.23.0).

| Phase | 커밋 | 내용 |
|-------|------|------|
| Init bump | `001eb36` → `2100a56` | activity log v1, #186 metadata, init 템플릿 TS 6, minor bump |
| 0/1/2 | `49b30e6` | `perf`, `id`, `safe-build`, cookie codec, auth/csrf/session |
| 2.6 DX | `c84f2a1` | page-loader shape, 쿠키 반영, 레이아웃 쿠키, loader redirect |
| 3 | `b63809c` | scheduler + s3, **`engines.bun ≥ 1.3.12`** |
| 4a/4b | `81c57b4` / `5499ca7` | `@mandujs/core/db`, sqlite session store |
| 4c | `c955703` → `e815ff0` | DDL emit, schema diff, migration runtime, `mandu db` |
| 5 | `024ca47` / `ce0d1a3` | OAuth middleware + email + verification/reset |
| 6 | `25a5d7a` | rate-limit + secure + `redirect`/`notFound` |
| 7.0–7.3 | `012f02c` → `1f1645f` | HMR reliability, Vite-호환 `import.meta.hot`, Fast Refresh, CSP nonce, JIT prewarm |
| 9 | `461a557` | Bun.markdown CLI UX, `bun build --compile`, webview-bun desktop, 템플릿 manifest |

**공식 breaking change 는 두 개뿐** (후술). 나머지는 전부 additive.

---

## 2. Breaking API changes

| 이전 (0.20.8) | 이후 (0.25.x) | 마이그레이션 | mandujs.com |
|--------------|--------------|-------------|------------|
| `engines.bun >= 1.0.0` | **`>= 1.3.12`** (`b63809c`) | `package.json` + CI 의 bun 을 1.3.12 이상으로 | **예.** `engines.bun` + `packageManager` 모두 bump |
| `ctx.cookies.get()` request-only | pending Set-Cookie 반영 (`c84f2a1`) | 쿠키 미사용이면 no-op | 없음 |
| page default = `{ component, filling }` 객체만 | 함수 default + `export const filling` 도 허용 (`c84f2a1`) | no-op, 기존 object 형태 계속 동작 | 이미 함수 default 사용 중 (이전엔 silent 404 리스크) |
| Layout slot 쿠키는 응답에 누락 | layout+page 쿠키 merge (`c84f2a1`) | 레이아웃이 set 안 하면 no-op | 없음 |
| (없음) | `redirect(url, {status?})` loader 지원 (`c84f2a1`) | 기존 meta-refresh 쉘 유효 | `app/page.tsx` meta-refresh 유지 가능 |
| `tailwind-merge ^2.5.2` | `^3.0.0` (템플릿) | v2 API 호환, 선택 bump | v2 유지 가능 |
| `typescript ^5.0.0` | `^6.0.0` (템플릿) | v5 그대로 가능. TS 6 에서는 `baseUrl` deprecated | `tsconfig.baseUrl` 삭제 권장 |
| tsconfig `"types": ["bun-types"]` | `"types": ["bun"]` + `@types/bun` | `bun-types` npm 패키지 deprecate | **예.** tsconfig 수정 + devDep 추가 |

**그 외 모든 변경은 additive.**

---

## 3. Runtime convention changes

mandujs.com 이 이미 준수하고 있음 (확인필):

- **`layout.tsx` 는 `<html>/<body>` 감싸지 말 것** — SSR 이 자동 생성. 현재 `app/layout.tsx:12-18`, `app/[lang]/layout.tsx:37-47` 모두 `<div>` 래퍼만 사용. OK.
- **page default export** — 함수 default + 별도 `filling` export 권장 (Phase 2.6 이후). `app/[lang]/page.tsx:23` 이미 `export default function HomePage`. OK.
- **CSS 자동 주입** — `mandu start`/`mandu build` 가 `.mandu/client/globals.css` 를 발견하면 자동 `<link>` 주입. mandujs.com 의 `src/client/shared/ui/styles.css` 라우팅은 Tailwind v4 CLI 로 처리 → OK.
- **Island API import 경로** — `island<Data>({setup, render})` 클라이언트 형태를 쓸 때 **반드시 `@mandujs/core/client` 에서 import**. mandujs.com 은 island 를 아예 쓰지 않음 → 해당 없음.

---

## 4. Deprecated / removed API

**없다.** 0.20 기준 공개 export 중 제거된 것은 **0 건**. Phase 6.4 의 v0-to-v1 migration guide (draft) 에도 "from this release forward, removal of any existing public export requires a major bump" 라고 명시. 따라서 `^0.20.8` → `^0.22.0` 업그레이드 시 "제거된 API" 걱정은 불필요.

Deprecated 경고 수준:
- `tsconfig.json:"baseUrl"` — TS 6.0 에서 non-error deprecation. 삭제 권장.
- `bun-types` npm 패키지 — `@types/bun` 으로 교체 권장.

---

## 5. Config schema 변경

`ManduConfig` (`packages/core/src/config/mandu.ts`) diff:

```diff
   dev?: {
     hmr?: boolean;
     watchDirs?: string[];
+    /** Observability SQLite 영구 저장 (기본: true) */
+    observability?: boolean;
   };
```

**그 외 모든 필드 동일**. `server.port/hostname/cors/streaming/rateLimit`, `guard.preset/srcDir/exclude/realtime/rules/contractRequired`, `build.outDir/minify/sourcemap/splitting`, `fsRoutes.*`, `seo.*`, `plugins`, `hooks` 전부 backward-compat.

`mandu.config.ts` (mandujs.com, 10 lines) 는 **수정 불필요**.

자동 생성 `.mandu/` 디렉토리:
- 기존: `manifest.json`, `routes.manifest.json`, `lockfile.json`, `client/`, `static/`
- 추가: `interaction-graph.json` (Phase 4-6 activity log), `monitor.config.json`, `scenarios/`, `reports/` (ATE), `runtime-control.json` (dev-only), `activity.log` (observability)
- **파괴적 변경 없음**. 업그레이드 후 첫 `mandu dev` 실행 시 빈 폴더들이 자동 생성.

---

## 6. Template 변경

mandujs.com 은 템플릿으로 생성된 프로젝트가 아니라 직접 작성된 앱이므로, "기본 템플릿의 diff" 는 참고용이다. 0.20 vs 현재 `templates/default/`:

| 파일 | 이전 | 현재 | 액션 |
|------|------|------|------|
| `package.json:engines.bun` | `>=1.0.0` | `>=1.3.12` | **수동으로 맞춰야 함** |
| `package.json:packageManager` | `bun@1.2.0` | `bun@1.3.12` | **수동으로 맞춰야 함** |
| `package.json:devDependencies.typescript` | `^5.0.0` | `^6.0.0` | 선택 (v5 여전히 동작) |
| `package.json:devDependencies["@types/bun"]` | (없음) | `^1.3.0` | **추가 권장** |
| `package.json:dependencies.tailwind-merge` | `^2.5.2` | `^3.0.0` | mandujs.com 은 v2 유지 가능 |
| `tsconfig.json:types` | `["bun-types"]` | `["bun"]` | **변경 필요** |
| `tsconfig.json:baseUrl` | `"."` | (삭제) | 삭제 권장 |

새 템플릿 파일 (mandujs.com 에 도입할 필요는 없음):
- `templates/auth-starter/` — Phase 6.4 에서 추가 (signup/login/dashboard/logout + CSRF)
- `templates/init-landing.md` + `templates/errors/CLI_E00{1,10,22}.md` — Phase 9 Bun.markdown 랜딩 메시지 (CLI 내부 전용, 프로젝트에 복사 X)

---

## 7. 의존성 변경

### Core package peer
```diff
 "peerDependencies": {
   "react": "^19.0.0",
   "react-dom": "^19.0.0",
+  "react-refresh": ">=0.18.0",
   "@tailwindcss/cli": ">=4.0.0",
+  "webview-bun": "^2.4.0"
 },
 "peerDependenciesMeta": {
   "@tailwindcss/cli": { "optional": true },
+  "react-refresh": { "optional": true },
+  "webview-bun": { "optional": true }
 }
```

두 신규 peer 모두 **optional**. mandujs.com 은 데스크톱/Fast Refresh 를 쓰지 않으므로 설치 불필요. Phase 7.1 Fast Refresh 는 `react-refresh` 가 **없으면 자동 비활성화** (no-op). 경고만 뜨고 기존 HMR 은 계속 동작.

### Core package deps (변경 없음)
`chokidar ^5.0.0`, `fast-glob catalog:` (0.20: `^3.3.2`), `glob ^13.0.0`, `minimatch ^10.1.1`, `ollama ^0.6.3`, `zod ^3.23.8` — **모두 동일 major**.

### CLI package deps
```diff
 "dependencies": {
-  "@mandujs/core": "^0.20.0",
+  "@mandujs/core": "^0.22.0",
-  "@mandujs/mcp": "^0.19.0",
+  "@mandujs/mcp": "^0.19.6",
-  "@mandujs/ate": "^0.18.0",
+  "@mandujs/ate": "^0.18.2",
-  "@mandujs/skills": "^1.1.0",
+  "@mandujs/skills": "^2.0.1",
   "cfonts": "^3.3.0"
 }
```

**`@mandujs/skills` 는 1.x → 2.x major bump** (peerDep range 변경: `>=0.19.0` → `>=0.21.0`). mandujs.com 은 skills 를 직접 의존하지 않으므로 CLI 의 transitive dep 로만 들어옴. no-op.

### App-side deps (mandujs.com 수정 필요)
```diff
-  "@mandujs/cli": "^0.21.6",
+  "@mandujs/cli": "^0.23.0",
-  "@mandujs/core": "^0.20.8",
+  "@mandujs/core": "^0.22.0",
-  "@mandujs/mcp": "^0.19.3",
+  "@mandujs/mcp": "^0.19.6",
+  "@types/bun": "^1.3.0",
```

---

## 8. mandujs.com 마이그레이션 체크리스트

**Tier 1 — 필수 (총 ~20분)**

1. `bun upgrade` (local + CI) 로 Bun 1.3.12+ 확보
2. `package.json`: `engines.bun` → `">=1.3.12"`, `packageManager` → `"bun@1.3.12"`
3. dep 범위 bump: `@mandujs/core ^0.22.0`, `@mandujs/cli ^0.23.0`, `@mandujs/mcp ^0.19.6`
4. `@types/bun ^1.3.0` devDep 추가
5. `tsconfig.json`: `"types": ["bun-types"]` → `["bun"]`, `"baseUrl"` 라인 삭제
6. `bun install` → lockfile 재생성
7. `rm -rf .mandu/client .mandu/static .mandu/manifest.json` (Phase 7 캐시 호환 이슈 예방)
8. `bun run build` + `bun run dev` + 브라우저 수동 검증 (`/`, `/en`, `/ko`, `/api/health`)
9. `bun run test:auto --ci` (ATE E2E 회귀)

**Tier 2 — 권장**

- `app/not-found.tsx` 생성 → 404 커스터마이징 (Phase 6.3)
- `secure()` 미들웨어 도입 (Phase 6.2) — CSP/HSTS/XFO 일괄. 단 inline `<script>` font loader 와 충돌 주의 (Risk §5)
- `app/page.tsx` meta-refresh → `redirect()` (SEO 친화)

**Tier 3 — 선택**

- `tailwind-merge ^3.0.0`, `typescript ^6.0.0` 로 순차 bump

---

## 9. Risk 지점

1. **🔴 Bun 버전 미스매치 (highest)** — CI 워커가 1.2.x 에 고정돼 있으면 `Bun.cron`/`CSRF`/`CookieMap`/`sql` 부재로 `TypeError: Bun.cron is not a function` 등으로 실패. `.github/workflows/*.yml` 의 `oven-sh/setup-bun@v2 { bun-version: 1.3.12 }` 로 고정.
2. **🟡 캐시 오염** — Phase 7 HMR + Phase 7.2 `isSafeManduUrl()` 는 구 manifest 스키마를 "fail-closed" 처리. 체크리스트 #7 의 강제 clean 필요.
3. **🟡 `import type { Metadata }`** — mandujs.com 유일한 core import. `seo/types.ts:427` 에 그대로 존재 → 호환. `moduleResolution: "bundler"` 유지.
4. **🟢 layout inline script** — `app/[lang]/layout.tsx:48-65` 의 font loader inline `<script>` 는 현재 영향 없음. **단 Tier 2 의 `secure()` 도입 시** 기본 CSP 가 차단. nonce 명시 필요.
5. **🟢 `@mandujs/skills` v1→v2** — CLI 의 transitive. `bun install` 이 해결.

---

## 핵심 정리

- **공식 breaking change 는 Bun engines bump + tsconfig types 엔트리 2개뿐**
- 나머지는 additive (새 `auth/*`, `middleware/*`, `db`, `desktop`, `email`, `scheduler`, `storage/s3`, `perf`, `id`, `scheduler`, `notFound`, `redirect`)
- mandujs.com 은 core API 를 타입 하나만 쓰므로 **10분 이내 업그레이드** 가 가능
- Phase 7 HMR + Phase 9 `bun build --compile` 은 런타임/빌드 경로 변경이 크지만 mandujs.com 의 `mandu build` → `mandu start` 흐름에서 **표면적 breaking 없음**
- 업그레이드 실패 시 **99% 는 Bun 버전 불일치** — CI yaml 의 `bun-version` 을 가장 먼저 확인
