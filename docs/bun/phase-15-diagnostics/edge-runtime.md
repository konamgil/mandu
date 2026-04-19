---
title: "Phase 15 R0 — @mandujs/edge Edge runtime adapter 설계"
status: research
created: 2026-04-18
author: Phase 15 R0 diagnostics agent
---

# Phase 15 R0 — Edge runtime adapter 설계

## 요약

Mandu 는 현재 Bun 전용이지만, `runtime/handler.ts` 의 `createFetchHandler()` 가 이미 Web Fetch 표준 위에 서 있고 `runtime/adapter.ts` 가 런타임 추상화를 정의해 둔 상태. 엣지 지원은 재작성이 아니라 **Bun-전용 의존성 폴리필 + per-runtime 어댑터**로 달성 가능. 최대 제약인 CF Workers 를 기준점으로 15.1 → 15.2 → 15.3 확장.

---

## 1. Bun 네이티브 API 매핑

### 1.1 런타임 핵심 (SSR/API 경로)

| API | 사용처 (line) | 엣지 대체 | 난이도 |
|---|---|---|---|
| `Bun.serve` | `runtime/server.ts:2552, 2562` | 런타임 entry (`export default { fetch }` / `Deno.serve`) | Low — 이미 `createFetchHandler()` 로 분리됨 |
| `Bun.CookieMap` | `filling/cookie-codec.ts:9` | 기본값 `LegacyCookieCodec` (이미 존재, runtime-neutral) | Zero |
| `Bun.password` | `auth/password.ts:52-60` (argon2id) | `@noble/hashes/argon2` 폴리필 or PBKDF2 fast-path | High — JS argon2 200ms+/call |
| `Bun.CSRF` | `middleware/csrf.ts:235-259` | 이미 WebCrypto HMAC-SHA256 폴백 존재 | Zero |
| `Bun.file` / `Bun.write` | `runtime/server.ts, env.ts, image-handler.ts, middleware.ts` | CF: KV/R2 / Deno: `Deno.readFile` / 정적은 빌드 타임 인라인 | Medium |
| `Bun.SQL` | `db/index.ts` | Neon serverless driver / `postgres.js` / CF D1 / Deno KV | Medium — provider 분기 |
| `Bun.S3Client` | `storage/s3/index.ts` | `aws4fetch` (WebCrypto, 20KB) / CF R2 binding | Medium |
| `Bun.cron` | `scheduler/index.ts` | CF Cron triggers (wrangler.toml) / Deno.cron / Vercel Cron Jobs | High — 런타임별 배포 설정 |
| `Bun.connect` (SMTP) | `email/smtp.ts` (stub) | 불가 — HTTP 이메일 API (Resend/Postmark) 만 | Skip |

### 1.2 빌드/툴링 (런타임 비영향)

빌드 타임 전용이라 엣지 대상 아님: `Bun.build`, `Bun.spawn`, bundler 의 `Bun.file`. `cli/`, `bundler/`, `change/`, `generator/`, `guard/`, `brain/`, `kitchen/` 패키지는 엣지에 번들되지 않음.

### 1.3 이미 Web Standards 로 동작

`crypto.subtle`, `crypto.getRandomValues`, `crypto.randomUUID`, `TextEncoder/Decoder`, `Request/Response/Headers/URL`, `fetch`, `FormData`, `Blob`, `ReadableStream` — Mandu 코드의 90% 가 이미 엣지 호환.

---

## 2. 런타임별 특이사항

### 2.1 Cloudflare Workers (기준점)
workerd (V8 isolates), `nodejs_compat` flag 로 부분 Node API. Entry `export default { fetch(req, env, ctx) }`. CPU Free 10ms / Standard 30s, 번들 10MB (paid) / 3MB (free), Disk 없음. 바인딩: KV / D1 (SQLite) / R2 (S3-호환) / Durable Objects / Queues — `env.X` 주입. Cron: `wrangler.toml` `[triggers] crons` + `scheduled(event, env, ctx)`.

### 2.2 Deno Deploy
Deno (V8, Web + Deno API). Entry `Deno.serve` or `export default { fetch }`. 번들 20MB, Node 호환 가장 좋음 (`node:`/`npm:` specifier). 내장: Deno KV, `Deno.cron`.

### 2.3 Vercel Edge Functions
V8 isolates + `edge-runtime` polyfill. Entry `export default handler` + `export const config = { runtime: 'edge' }`. 4MB 번들, CPU 30s, `node:crypto/buffer` 일부. 스토리지 Edge Config (RO) / Vercel KV (Upstash) / Vercel Postgres (Neon). Cron: `vercel.json` Serverless 만 (Edge 에선 없음).

### 2.4 Netlify Edge Functions
**Deno 기반** (진짜 Deno, `deno.land/x` 사용 가능). Entry `export default async (req, context)`. 20MB, CPU 50ms window. Netlify Blobs (K-V). Cron: Scheduled Functions (Edge 아님).

---

## 3. `@mandujs/edge` 패키지 구조

```
packages/edge/src/
├── index.ts                 # createEdgeHandler(manifest) — 공통
├── runtime-detect.ts        # typeof Bun/Deno/EdgeRuntime/caches
├── polyfills/
│   ├── password.ts          # noble argon2 + PBKDF2 fast-path
│   ├── db-postgres-http.ts  # @neondatabase/serverless 래퍼
│   └── storage-s3-http.ts   # aws4fetch 기반
├── workers/ {index, kv-session, d1-db, r2-storage}
├── deno/    {index, kv-session, cron}
├── vercel/  {index}
└── netlify/ {index}    # Deno entry 재사용
```

**공통 추상** — `createEdgeHandler(manifest, options?)`: 내부는 `@mandujs/core/runtime/handler.ts` 의 `createFetchHandler()` 직접 재사용. 차이점은 **초기화 DI**: `sessionStorage`, `db`, `s3` 인스턴스를 런타임별 polyfill 로 치환.

---

## 4. 기능 호환성 매트릭스

| 기능 | Bun | Workers | Deno | Vercel | Netlify |
|---|---|---|---|---|---|
| SSR / API routes | Pass | Pass | Pass | Pass | Pass |
| CSRF (HMAC 폴백) | Pass | Pass | Pass | Pass | Pass |
| Session (cookie) | Pass | Pass | Pass | Pass | Pass |
| Session (SQLite) | Pass | Fail | Fail | Fail | Fail |
| Session (KV) | N/A | CF KV | Deno KV | Vercel KV | Blobs |
| OAuth | Pass | Pass | Pass | Pass | Pass |
| Password (argon2) | Native | Slow (JS) | Slow (JS) | Slow (JS) | Slow (JS) |
| Password (PBKDF2) | Pass | Pass | Pass | Pass | Pass |
| Email (Resend) | Pass | Pass | Pass | Pass | Pass |
| Email (SMTP) | Planned | Fail | Pass | Fail | Pass |
| DB (PG native) | Bun.sql | Fail | npm:postgres | serverless drv | serverless drv |
| DB (PG HTTP) | Pass | Neon/Supabase | Pass | Pass | Pass |
| DB (SQLite local) | Pass | Fail | Fail | Fail | Fail |
| DB (D1/KV) | N/A | D1 | Deno KV | N/A | N/A |
| S3 (native) | Bun.s3 | aws4fetch | Pass | Pass | Pass |
| S3 (platform) | N/A | R2 binding | N/A | Blob | Netlify Blobs |
| Cron | Bun.cron | CF Cron | Deno.cron | Serverless only | Fail |
| HMR / dev | Pass | N/A | N/A | N/A | N/A |
| Desktop | Phase 9 | N/A | N/A | N/A | N/A |

**트레이드오프**: persistent conn 기능 (SQLite, SMTP, native argon2, Bun.cron 코드) 은 엣지 제한. HTTP 기반 대체재 (Neon/Resend/aws4fetch) 는 거의 무손실.

---

## 5. 빌드 전략

### CLI
```
mandu build --target=workers      # wrangler.toml + dist/_worker.js
mandu build --target=deno-deploy  # dist/main.ts
mandu build --target=vercel-edge  # .vercel/output/functions/*.func
mandu build --target=netlify-edge # netlify/edge-functions/*.ts
```

### Tree-shake + Polyfill 주입
- `Bun.password` → `@noble/hashes/argon2` 로 Rollup resolve 대체
- `Bun.CookieMap` → `LegacyCookieCodec` import 치환 (이미 존재)
- `Bun.sql` → 빌드 플래그 `--db-driver=neon|postgres.js|d1` 로 결정
- `scheduler/index.ts` → runtime 이 Bun 아니면 noop stub + wrangler/vercel config 자동 생성
- bundle 에서 `cli/bundler/change/guard/brain/kitchen` 제거

### Runtime Detection (dev 용)
```ts
export const runtime =
  typeof (globalThis as any).Bun !== 'undefined' ? 'bun' :
  typeof (globalThis as any).Deno !== 'undefined' ? 'deno' :
  typeof (globalThis as any).EdgeRuntime !== 'undefined' ? 'vercel' :
  (globalThis as any).navigator?.userAgent?.includes('Cloudflare-Workers') ? 'workers' :
  'unknown';
```

빌드 타임 주입 기본, 런타임 감지는 dev 편의.

### Deploy 연계 (Phase 13)
`mandu deploy` 가 `--target` 확인 후 `wrangler deploy`, `deno deploy`, `vercel deploy`, `netlify deploy` 래핑. 시크릿은 플랫폼 CLI 에 위임.

---

## 6. Phase 15 분할

### 15.1 Cloudflare Workers (1주)
가장 제약 많음 → 여기서 돌면 나머지 대부분 자동. 범위: `@mandujs/edge/workers`, D1 driver, KV session, R2 storage, Cron, `mandu build --target=workers`. 데모: `demo/edge-workers/` (auth-starter 포팅).

### 15.2 Deno Deploy (0.5주)
범위: `@mandujs/edge/deno`, Deno KV session, Deno.cron wrapper, `mandu build --target=deno-deploy`. Node 호환 덕에 저위험.

### 15.3 Vercel Edge + Netlify Edge (0.5주)
Vercel 은 Workers 와 유사 (번들 포맷만 상이). Netlify 는 Deno 기반이라 15.2 재활용. 두 플랫폼 entry + config 생성 + 데모 2종.

**총**: 2주 (Phase 11 과 병렬 가능 — `phases-11-plus.md` §1 Wave A).

---

## 7. 우선순위 + 예상 시간

| P | 항목 | 시간 | 근거 |
|---|---|---|---|
| P0 | 15.1 CF Workers | 5일 | 최대 제약, 검증되면 나머지 자동 |
| P0 | `@mandujs/edge` 스캐폴드 + runtime-detect + polyfills | 1일 | 공통 기반 |
| P1 | 15.2 Deno Deploy | 2일 | Node 호환 덕에 저위험 |
| P1 | 15.3 Vercel Edge | 1일 | Workers 와 유사 |
| P1 | 15.3 Netlify Edge | 1일 | Deno, 15.2 재활용 |
| P2 | `mandu deploy --target=*` 래퍼 | 2일 | Phase 13 연계 |
| P2 | 데모 4종 + E2E | 3일 | sandbox 배포 검증 |

---

## 8. 시장 가치 평가

**찬성**:
- 엣지는 2025+ JS 프레임워크 기본기 — Next/Remix/SvelteKit/Nuxt/Astro/Hono 모두 지원. Mandu 만 Bun-only 면 **"Bun 잠금 프레임워크"** 로 인식.
- CF Workers 330 PoP + 관대한 free tier — Asia latency 우위.
- OAuth + Email + KV session 은 엣지에 완벽 적합.

**반대**:
- Bun 고유 가치 (Bun.WebView + cron + sql + password native) 는 **엣지에서 잃음**. Lowest-common-denominator 강요.
- Hono 가 이미 엣지 특화 — Mandu 가 Hono 영역 진입은 비효율. **Bun 풀스택 DX** 가 Mandu 해자.
- 4종 런타임 E2E + polyfill drift 유지비. "Bun native 는 되는데 엣지엔 안 됨" 버그 리스크.

**권고**: **Phase 15 우선순위 하향, 15.1 CF Workers 만 MVP**.
1. CF 1종으로 "엣지 지원" 메시지 확보.
2. 코드 80% common — 15.2/.3 저비용 추가.
3. `adapter-bun` default 유지 → 엣지는 opt-in. 정체성 보존.
4. Phase 12 (Testing) / 14 (AI) 가 기존 사용자 가치 더 큼.

**타이밍**: Phase 11 과 병렬로 15.1 R1 시작. 15.2/.3 은 Phase 13 완료 후.

---

## 9. 참고 링크

- Cloudflare Workers: https://developers.cloudflare.com/workers/runtime-apis/
- CF D1: https://developers.cloudflare.com/d1/ · CF KV: https://developers.cloudflare.com/kv/ · CF R2: https://developers.cloudflare.com/r2/api/s3/api/
- Deno Deploy: https://docs.deno.com/deploy/manual/ · Deno KV: https://docs.deno.com/deploy/kv/manual/
- Vercel Edge: https://vercel.com/docs/functions/runtimes/edge
- Netlify Edge: https://docs.netlify.com/build/edge-functions/overview/
- `@neondatabase/serverless`: https://neon.tech/docs/serverless/serverless-driver
- `aws4fetch`: https://github.com/mhart/aws4fetch
- `@noble/hashes`: https://github.com/paulmillr/noble-hashes
