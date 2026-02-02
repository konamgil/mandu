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
| Server Registry (instance isolation) | done | `packages/core/src/runtime/server.ts` ServerRegistry class (v0.9.29) |
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
| Error Boundary & Loading | done | `packages/core/src/bundler/build.ts` IslandErrorBoundary, IslandLoadingWrapper (v0.9.26) |
| useIslandEvent cleanup | done | `packages/core/src/client/island.ts` IslandEventHandle (v0.9.26) |

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
| Dev Watch (common dirs) | done | `packages/core/src/bundler/dev.ts` DEFAULT_COMMON_DIRS, watchDirs option (v0.9.30) |
| HMR common file reload | done | `packages/cli/src/commands/dev.ts` type: "reload" broadcast (v0.9.31) |
| Manifest always saved | done | `packages/core/src/bundler/build.ts` empty manifest written (v0.9.28) |
| Integration hooks/logger | not started | (no `packages/core/src/integrations`) |
| Build hooks/plugins/analyzer | not started | (no `packages/core/src/bundler/hooks.ts`) |

## Routing

| Item | Status | Evidence |
|------|--------|----------|
| Server router | done | `packages/core/src/runtime/router.ts` |
| FS Routes scanner | done | `packages/core/src/router/fs-scanner.ts` (v0.9.32) |
| FS Routes patterns | done | `packages/core/src/router/fs-patterns.ts` (v0.9.32) |
| FS Routes generator | done | `packages/core/src/router/fs-routes.ts` (v0.9.32) |
| FS Routes watcher | done | `packages/core/src/router/fs-routes.ts` watchFSRoutes() (v0.9.32) |
| FS Routes CLI | done | `packages/cli/src/commands/routes.ts` routes generate/list/watch (v0.9.13) |
| FS Routes dev integration | done | `packages/cli/src/commands/dev.ts` FS Routes 기반 dev 서버 (v0.9.13) |

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

## Security

| Item | Status | Evidence |
|------|--------|----------|
| Path traversal prevention | done | `packages/core/src/runtime/server.ts` isPathSafe() (v0.9.27) |
| CLI port validation | done | `packages/cli/src/main.ts` parsePort() (v0.9.11) |

---

## Summary

| Category | Done | Not Started |
|----------|------|-------------|
| Core Runtime | 9 | 0 |
| Contracts & OpenAPI | 9 | 0 |
| Hydration & Islands | 7 | 0 |
| Client-side Routing | 4 | 0 |
| Data & Content | 0 | 1 |
| Integrations & Build | 5 | 2 |
| Routing | 7 | 0 |
| Realtime / Resumable | 0 | 2 |
| Observability & Perf | 1 | 1 |
| Security | 2 | 0 |
| **Total** | **44** | **6** |

---

## Recent Changes (v0.9.26 ~ v0.9.34)

| Version | Package | Changes |
|---------|---------|---------|
| v0.9.34 | core | Advanced routes (catch-all `:param*`, optional `:param*?`, boundary components) |
| v0.9.33 | core | Layout System (layoutChain, loadingModule, errorModule in RouteSpec) |
| v0.9.14 | cli | Layout HMR support (registerLayoutLoader, clearDefaultRegistry on reload) |
| v0.9.32 | core | FS Routes system (scanner, patterns, generator, watcher) |
| v0.9.13 | cli | FS Routes CLI (routes generate/list/watch, dev 통합) |
| v0.9.31 | core | HMR common file reload support |
| v0.9.30 | core | Dev bundler common dirs watch |
| v0.9.29 | core | Server registry instance isolation |
| v0.9.28 | core | Always write manifest.json |
| v0.9.27 | core | Path traversal security fix |
| v0.9.26 | core | Hydration improvements (ErrorBoundary, Loading, cleanup) |
| v0.9.12 | cli | HMR reload broadcast for common files |
| v0.9.11 | cli | Port validation fix |
