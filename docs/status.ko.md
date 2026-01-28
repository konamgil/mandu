# 구현 상태

범례: **완료** = 구현됨, **부분** = 일부만 구현, **미시작** = 아직 없음, **미검증** = 구현되었으나 테스트 실행 불가.

---

## Core Runtime

| 항목 | 상태 | 근거 |
|------|------|------|
| 미들웨어 compose | 완료 | `packages/core/src/runtime/compose.ts` |
| 라이프사이클 훅 | 완료 | `packages/core/src/runtime/lifecycle.ts` |
| Trace 시스템 | 완료 | `packages/core/src/runtime/trace.ts` |
| Filling 훅(onRequest/onParse/before/after/map/onError/afterResponse) | 완료 | `packages/core/src/filling/filling.ts` |
| guard/use 별칭 | 완료 | `packages/core/src/filling/filling.ts` |
| compose 미들웨어 연동 | 완료 | `ManduFilling.middleware()` |
| 런타임 테스트 | 완료(미검증) | `tests/runtime/*` (Bun crash) |

## Contracts & OpenAPI

| 항목 | 상태 | 근거 |
|------|------|------|
| Contract 스키마/검증 | 완료 | `packages/core/src/contract/*` |
| OpenAPI 생성기 | 완료 | `packages/core/src/openapi/generator.ts` |
| CLI OpenAPI generate/serve | 완료 | `packages/cli/src/commands/openapi.ts` |
| Contract 타입 추론 | 미시작 | (`contract/infer.ts` 없음) |
| 스키마 정규화/coerce | 미시작 | (`contract/normalize.ts` 없음) |
| OpenAPI examples/extra | 미시작 | (generator 미지원) |

## Hydration & Islands

| 항목 | 상태 | 근거 |
|------|------|------|
| props 직렬화/역직렬화 | 완료 | `packages/core/src/client/serialize.ts` |
| Island 정의 API | 완료 | `packages/core/src/client/island.ts` |
| SSR island 래퍼/스크립트 | 부분 | `packages/core/src/runtime/ssr.ts` |
| 클라이언트 reviver/partials/slots | 미시작 | (`client/reviver.ts` 없음) |

## Data & Content

| 항목 | 상태 | 근거 |
|------|------|------|
| Loader types/store/loaders | 미시작 | (`packages/core/src/loader` 없음) |

## Integrations & Build

| 항목 | 상태 | 근거 |
|------|------|------|
| Integration hooks/logger | 미시작 | (`packages/core/src/integrations` 없음) |
| Build hooks/plugins/analyzer | 미시작 | (`packages/core/src/bundler/hooks.ts` 없음) |

## Routing

| 항목 | 상태 | 근거 |
|------|------|------|
| FS routes 명령 레이어 | 미시작 | (`packages/core/src/router/fs-*` 없음) |

## Realtime / Resumable

| 항목 | 상태 | 근거 |
|------|------|------|
| WebSocket 채널 | 미시작 | (`packages/core/src/ws` 없음) |
| QRL-lite / Resumable POC | 미시작 | (`packages/core/src/client/qrl.ts` 없음) |

## Observability & Perf

| 항목 | 상태 | 근거 |
|------|------|------|
| Runtime 로거 | 미시작 | (`packages/core/src/runtime/logger.ts` 없음) |
| Perf 테스트 | 미시작 | (`tests/perf` 없음) |
