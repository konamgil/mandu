# Runtime Server Responsibility Inventory

작성일: 2026-05-18

목적: `packages/core/src/runtime/server.ts`가 직접 소유한 책임을 추적하고, 런타임 엔트리를 request lifecycle orchestration 중심으로 줄이기 위한 분리 기준을 고정한다.

## 현재 경계

| 책임 | 현재 owner | 목표 owner | 상태 |
|---|---|---|---|
| Bun listener 생성, WebSocket upgrade, graceful stop | `runtime/server.ts` | `runtime/server.ts` + adapter | 유지 |
| registry 생성과 route/API/page handler 등록 facade | `runtime/server.ts` | `runtime/registry.ts` 또는 얇은 facade | 미분리 |
| CORS preflight와 response CORS 적용 | `runtime/cors.ts` 호출 | `runtime/cors.ts` | 부분 분리 |
| 정적 파일 서빙, MIME, Cache-Control, ETag, path safety | `runtime/static-files.ts` | `runtime/static-files.ts` | 분리 완료 |
| request-level middleware chain 생성과 실행 | `runtime/request-middleware.ts` | `runtime/request-middleware.ts` | 분리 완료 |
| global `middleware.ts` 로드와 runtime-neutral fetch handler 연결 | `runtime/server.ts`, `runtime/handler.ts`, `runtime/middleware.ts` | adapter 또는 boot module | 미분리 |
| prerendered HTML pass-through와 ETag 처리 | `runtime/server.ts` + `bundler/prerender.ts` + `runtime/static-files.ts` | prerender runtime module | 미분리 |
| typed RPC dispatch | `runtime/server.ts` + `contract/rpc.ts` | RPC runtime adapter | 미분리 |
| file-system route dispatch | `runtime/server.ts`, `runtime/router.ts` | request dispatcher module | 미분리 |
| API route execution | `runtime/server.ts` | route dispatcher module | 미분리 |
| page loader, filling, SSR, streaming SSR orchestration | `runtime/server.ts`, `runtime/page-render-response.ts`, `runtime/ssr.ts`, `runtime/streaming-ssr.ts` | render orchestrator | 부분 분리 |
| metadata route dispatch | `runtime/server.ts`, `routes/metadata-routes.ts` | metadata runtime adapter | 부분 분리 |
| not-found fallback orchestration | `runtime/server.ts`, `runtime/not-found.ts` | route error adapter | 미분리 |
| rate limit policy, in-memory limiter, 429/header formatting | `runtime/rate-limit.ts` 호출 | `runtime/rate-limit.ts` | 분리 완료 |
| image optimization endpoint | `runtime/image-feature.ts`, `runtime/image-handler.ts` 호출 | target-safe optional feature adapter | 분리 완료 |
| OpenAPI endpoint | `runtime/openapi-endpoint.ts` 호출 | target-safe optional feature adapter | 부분 분리 |
| Kitchen/devtools endpoints | `runtime/devtools-adapter.ts`, `kitchen/*` | devtools runtime adapter | 분리 완료 |
| observability metrics, heap, event stream, request recording | `runtime/observability-lifecycle.ts`, `observability/*`, `runtime/devtools-adapter.ts` | observability lifecycle hook | 분리 완료 |
| tracing span wrapper | `runtime/observability-lifecycle.ts`, `observability/tracing.ts` | request lifecycle hook | 분리 완료 |
| scheduler lifecycle | `runtime/scheduler-lifecycle.ts`, `scheduler/*`, `middleware/scheduler-cron.ts` | lifecycle module | 분리 완료 |
| i18n context wiring | `runtime/server.ts`, `i18n/*` | request context module | 미분리 |

## 다음 분리 순서

1. page route cache/PPR save orchestration을 render/cache adapter로 분리한다.
2. route dispatch/API execution/not-found fallback을 request dispatcher module로 분리한다.
3. i18n context wiring을 request context module로 분리한다.

## 체크 기준

- `runtime/server.ts`에는 listener, registry wiring, request lifecycle 순서만 남긴다.
- target-specific 기능은 호출 지점과 import graph가 모두 분리되어야 한다.
- 새 모듈은 기존 테스트 또는 새 단위 테스트로 직접 검증한다.
- 체크리스트를 완료 처리할 때는 관련 파일과 검증 명령을 `docs/plans/19_code_quality_upgrade_plan.md`에 남긴다.
