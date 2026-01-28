# Implementation Status

Legend: **done** = implemented, **partial** = implemented but incomplete, **not started** = not implemented, **untested** = implemented but tests not runnable.

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
| Runtime tests | done (untested) | `tests/runtime/*` (Bun crash) |

## Contracts & OpenAPI

| Item | Status | Evidence |
|------|--------|----------|
| Contract schema & validator | done | `packages/core/src/contract/*` |
| OpenAPI generator | done | `packages/core/src/openapi/generator.ts` |
| CLI OpenAPI generate/serve | done | `packages/cli/src/commands/openapi.ts` |
| Contract type inference | not started | (no `contract/infer.ts`) |
| Schema normalize/coerce | not started | (no `contract/normalize.ts`) |
| OpenAPI examples/extra | not started | (not in generator) |

## Hydration & Islands

| Item | Status | Evidence |
|------|--------|----------|
| Props serialize/deserialize | done | `packages/core/src/client/serialize.ts` |
| Island definition API | done | `packages/core/src/client/island.ts` |
| SSR island wrapper/scripts | partial | `packages/core/src/runtime/ssr.ts` |
| Client reviver / partials / slots | not started | (no `client/reviver.ts`) |

## Data & Content

| Item | Status | Evidence |
|------|--------|----------|
| Loader types/store/loaders | not started | (no `packages/core/src/loader`) |

## Integrations & Build

| Item | Status | Evidence |
|------|--------|----------|
| Integration hooks/logger | not started | (no `packages/core/src/integrations`) |
| Build hooks/plugins/analyzer | not started | (no `packages/core/src/bundler/hooks.ts`) |

## Routing

| Item | Status | Evidence |
|------|--------|----------|
| FS routes command layer | not started | (no `packages/core/src/router/fs-*`) |

## Realtime / Resumable

| Item | Status | Evidence |
|------|--------|----------|
| WebSocket channels | not started | (no `packages/core/src/ws`) |
| QRL-lite / Resumable POC | not started | (no `packages/core/src/client/qrl.ts`) |

## Observability & Perf

| Item | Status | Evidence |
|------|--------|----------|
| Runtime logger | not started | (no `packages/core/src/runtime/logger.ts`) |
| Perf tests | not started | (no `tests/perf`) |
