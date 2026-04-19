---
title: "Phase 15.1 — Cloudflare Workers edge adapter (MVP)"
status: execution-plan
created: 2026-04-19
depends_on:
  - docs/bun/phase-15-diagnostics/edge-runtime.md
---

# Phase 15.1 — `@mandujs/edge` (Cloudflare Workers MVP)

**목표**: Mandu 앱을 Cloudflare Workers 에 배포 가능. **Hono 영역 재침범 금지** — Mandu 의 기존 filling/SSR/resource 기능을 Workers 에서도 동작하게만 하면 됨.

**R0 결정**:
- Mandu `createFetchHandler` 이미 Web Fetch 표준 → 재작성 불필요
- **폴리필 + 어댑터만** 추가
- 15.1 CF Workers 만 MVP (Deno/Vercel/Netlify 는 후속)

## 1. 스코프

### Bun 네이티브 → Workers 대체

| Bun API | 대체 | 구현 위치 |
|---|---|---|
| `Bun.serve` | `fetch` handler export | `packages/edge/src/workers/fetch-handler.ts` |
| `Bun.CookieMap` | `LegacyCookieCodec` (이미 존재) | 재사용 |
| `Bun.CSRF` | WebCrypto HMAC-SHA256 fallback | 이미 존재 |
| `Bun.password` | `@noble/hashes/argon2` (100KB) | optional peer |
| `Bun.sql` → Postgres | Neon `@neondatabase/serverless` | adapter |
| `Bun.s3` | `aws4fetch` | adapter |
| `Bun.file` / `Bun.write` | 빌드 인라인 (static assets → KV) | build step |
| `Bun.cron` | Workers Cron Trigger | `wrangler.toml` |
| SMTP | ⛔ Skip (Edge 불가, Resend 권장) | 문서화 |

### `@mandujs/edge` 패키지 구조

```
packages/edge/
├── package.json
├── src/
│   ├── workers/
│   │   ├── index.ts        — export { createWorkersHandler }
│   │   ├── fetch-handler.ts — Bun.serve → Workers fetch 변환
│   │   ├── polyfills.ts     — WebCrypto / aws4fetch wiring
│   │   └── wrangler-config.ts — wrangler.toml 템플릿
│   ├── deno/               — 15.2 stub
│   ├── vercel/             — 15.3 stub
│   └── netlify/            — 15.3 stub
└── __tests__/
```

### CLI 통합

`packages/cli/src/commands/build.ts` — `--target=workers` flag:
- `mandu build --target=workers` → `@mandujs/edge/workers` entry 생성
- `wrangler.toml` 자동 생성
- Bun-native import 자동 polyfill 치환 (Rollup plugin)

## 2. 에이전트 (1 단일, 5일)

**Agent D — Edge CF Workers MVP** (backend-architect, Wave A 병렬)

**파일 범위**:
- 신규 `packages/edge/` 패키지 전체 (workers subpath 위주)
- `packages/core/src/runtime/adapter.ts` — polyfill injection hook (minimal 추가)
- `packages/cli/src/commands/build.ts` — `--target=workers` branch
- 신규 `packages/edge/__tests__/workers-fetch.test.ts`
- 신규 `packages/edge/__tests__/wrangler-config.test.ts`
- 신규 `demo/edge-workers-starter/` — 최소 데모

**Wave A 의 Phase 11 과 파일 충돌**: **없음** (Phase 11 A/B/C 모두 이 영역 건드리지 않음).

**Output**:
- `@mandujs/edge/workers` 패키지 (publish 가능한 상태)
- `mandu build --target=workers` 명령
- `wrangler deploy` 로 실제 CF 배포 가능
- demo 배포 smoke (actual Cloudflare account 없이 `wrangler dev` 로 verify)

## 3. 의존성

- `@neondatabase/serverless` (peer, optional)
- `aws4fetch` (peer, optional)
- `@noble/hashes` (peer, optional — argon2 필요 시만)
- `wrangler` (dev-peer, 사용자 설치)

## 4. 테스트

- Unit ≥ 8: fetch-handler request/response round-trip · CookieMap polyfill · CSRF HMAC · wrangler-config 생성
- Integration ≥ 3: Mandu 최소 라우트를 workers fetch 로 처리 · static assets KV binding · cron trigger
- Smoke: `wrangler dev` 로 실제 워커 런타임에서 demo 기동

## 5. 품질 게이트

1. `bun run typecheck` 4+1 packages clean (신규 `@mandujs/edge` 포함)
2. `wrangler dev` 에서 demo 페이지 응답 200
3. 번들 크기 < 1MB (Workers free tier 제약 10MB 이므로 여유)
4. Mandu 기본 feature (filling / SSR / cookie / CSRF) 동작 확인

## 6. 예상 커밋

- `feat(edge): Phase 15.1 — @mandujs/edge/workers MVP + mandu build --target=workers`
- `test(edge): Phase 15.1 — fetch-handler + wrangler-config + demo smoke`
- `docs(edge): Phase 15.1 — CF Workers deployment guide`

## 7. 명시적 비목표 (Hono 영역 침범 금지)

❌ 라우팅 엔진 재작성
❌ 미들웨어 프레임워크 API (Mandu filling 만)
❌ 일반 Web Framework 포지셔닝 (Bun 중심 유지)
✅ **Mandu app 을 Workers 에도 배포 가능** — 오직 이것만
