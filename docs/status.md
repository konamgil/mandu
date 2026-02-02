# Implementation Status

Legend: **done** = implemented, **partial** = implemented but incomplete, **not started** = not implemented, **untested** = implemented but tests not runnable.

> Last updated: 2026-02-02

---

## Core Runtime

| Item | Status | Evidence |
|------|--------|----------|
| Middleware compose | done | `packages/core/src/runtime/compose.ts` |
| Lifecycle hooks | done | `packages/core/src/runtime/lifecycle.ts` |
| Trace system | done | `packages/core/src/runtime/trace.ts` |
| Filling hooks (onRequest/onParse/before/after/map/onError/afterResponse) | done | `packages/core/src/filling/filling.ts` |
| guard/use aliases | done | `packages/core/src/filling/filling.ts` |
| compose middleware integration | done | `ManduFilling.middleware()` |
| Streaming SSR | done | `packages/core/src/runtime/streaming-ssr.ts` |
| Runtime tests | done (untested) | `tests/runtime/*` (Bun crash) |

## Contracts & OpenAPI

| Item | Status | Evidence |
|------|--------|----------|
| Contract schema & validator | done | `packages/core/src/contract/*` |
| OpenAPI generator | done | `packages/core/src/openapi/generator.ts` |
| CLI OpenAPI generate/serve | done | `packages/cli/src/commands/openapi.ts` |
| Contract type inference | done | `packages/core/src/contract/types.ts`, `handler.ts` |
| Typed Handler | done | `packages/core/src/contract/handler.ts` |
| Typed Client | done | `packages/core/src/contract/client.ts` |
| Mandu Namespace API | done | `Mandu.contract/handler/route/client/fetch` |
| Schema normalize/coerce | done | `packages/core/src/contract/normalize.ts` |
| OpenAPI examples/extra | done | `packages/core/src/openapi/generator.ts` |

## Hydration & Islands

| Item | Status | Evidence |
|------|--------|----------|
| Props serialize/deserialize | done | `packages/core/src/client/serialize.ts` |
| Island definition API | done | `packages/core/src/client/island.ts` |
| SSR island wrapper/scripts | done | `packages/core/src/runtime/ssr.ts`, `streaming-ssr.ts` |
| Client Hydration Runtime | done | `packages/core/src/bundler/build.ts` generateRuntimeSource() |
| Client partials/slots | done | `packages/core/src/client/island.ts` partial(), slot(), createPartialGroup() |

## Client-side Routing

| Item | Status | Evidence |
|------|--------|----------|
| Client router | done | `packages/core/src/client/router.ts` |
| Router hooks (useRouter, useParams, etc) | done | `packages/core/src/client/hooks.ts` |
| Link/NavLink components | done | `packages/core/src/client/Link.tsx` |
| Router runtime bundle | done | `packages/core/src/bundler/build.ts` generateRouterRuntimeSource() |

## Data & Content

| Item | Status | Evidence |
|------|--------|----------|
| Loader types/store/loaders | not started | (no `packages/core/src/loader`) |

## Integrations & Build

| Item | Status | Evidence |
|------|--------|----------|
| Client Bundler | done | `packages/core/src/bundler/build.ts` |
| Dev Server | done | `packages/core/src/bundler/dev.ts` |
| Integration hooks/logger | not started | (no `packages/core/src/integrations`) |
| Build hooks/plugins/analyzer | not started | (no `packages/core/src/bundler/hooks.ts`) |

## Routing

| Item | Status | Evidence |
|------|--------|----------|
| Server router | done | `packages/core/src/runtime/router.ts` |
| FS routes command layer | not started | (no `packages/core/src/router/fs-*`) |

## Realtime / Resumable

| Item | Status | Evidence |
|------|--------|----------|
| WebSocket channels | not started | (no `packages/core/src/ws`) |
| QRL-lite / Resumable POC | not started | (no `packages/core/src/client/qrl.ts`) |

## Observability & Perf

| Item | Status | Evidence |
|------|--------|----------|
| Runtime logger | done | `packages/core/src/runtime/logger.ts` |
| Perf tests | not started | (no `tests/perf`) |

---

## Summary

| Category | Done | Not Started |
|----------|------|-------------|
| Core Runtime | 8 | 0 |
| Contracts & OpenAPI | 9 | 0 |
| Hydration & Islands | 5 | 0 |
| Client-side Routing | 4 | 0 |
| Data & Content | 0 | 1 |
| Integrations & Build | 2 | 2 |
| Routing | 1 | 1 |
| Realtime / Resumable | 0 | 2 |
| Observability & Perf | 1 | 1 |
| **Total** | **30** | **7** |
