# Implementation Status

Legend: **done** = implemented, **partial** = implemented but incomplete, **not started** = not implemented, **untested** = implemented but tests not runnable.

> Last updated: 2026-02-05

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
| Session Key Utilities | done | `packages/core/src/runtime/session-key.ts` (DNA-004) |
| Runtime tests | done (untested) | `tests/runtime/*` (Bun crash) |

## Plugin System (DNA-001)

| Item | Status | Evidence |
|------|--------|----------|
| Plugin types | done | `packages/core/src/plugins/types.ts` |
| Plugin registry | done | `packages/core/src/plugins/registry.ts` |
| Guard preset plugins | done | `GuardPresetPlugin` type |
| Build plugins | done | `BuildPlugin` type |
| Logger transport plugins | done | `LoggerTransportPlugin` type |
| MCP tool plugins | done | `McpToolPlugin` type |
| Middleware plugins | done | `MiddlewarePlugin` type |
| Plugin lifecycle hooks | done | `onLoad`, `onUnload` hooks |

## Dependency Injection (DNA-002)

| Item | Status | Evidence |
|------|--------|----------|
| FillingDeps type | done | `packages/core/src/filling/deps.ts` |
| createDefaultDeps() | done | `packages/core/src/filling/deps.ts` |
| createMockDeps() | done | `packages/core/src/filling/deps.ts` |
| DepsContainer | done | `packages/core/src/filling/deps.ts` |
| ManduContext deps integration | done | `packages/core/src/filling/context.ts` |

## Error Handling (DNA-007)

| Item | Status | Evidence |
|------|--------|----------|
| extractErrorCode() | done | `packages/core/src/errors/extractor.ts` |
| extractStatusCode() | done | `packages/core/src/errors/extractor.ts` |
| extractErrorInfo() | done | `packages/core/src/errors/extractor.ts` |
| classifyError() | done | `packages/core/src/errors/extractor.ts` |
| formatUncaughtError() | done | `packages/core/src/errors/extractor.ts` |
| isRetryableError() | done | `packages/core/src/errors/extractor.ts` |
| serializeError() | done | `packages/core/src/errors/extractor.ts` |

## Structured Logging (DNA-008)

| Item | Status | Evidence |
|------|--------|----------|
| LogTransport type | done | `packages/core/src/logging/transports.ts` |
| TransportRegistry | done | `packages/core/src/logging/transports.ts` |
| attachLogTransport() | done | `packages/core/src/logging/transports.ts` |
| detachLogTransport() | done | `packages/core/src/logging/transports.ts` |
| createConsoleTransport() | done | `packages/core/src/logging/transports.ts` |
| createBufferTransport() | done | `packages/core/src/logging/transports.ts` |
| createBatchTransport() | done | `packages/core/src/logging/transports.ts` |

## Configuration

| Item | Status | Evidence |
|------|--------|----------|
| ManduConfig types | done | `packages/core/src/config/mandu.ts` |
| loadManduConfig() | done | `packages/core/src/config/mandu.ts` |
| Config validation (Zod) | done | `packages/core/src/config/validate.ts` |
| Config hot reload | done | `packages/core/src/config/watcher.ts` (DNA-006) |
| watchConfig() | done | `packages/core/src/config/watcher.ts` |
| hasConfigChanged() | done | `packages/core/src/config/watcher.ts` |
| getChangedSections() | done | `packages/core/src/config/watcher.ts` |

## String Utilities (DNA-005)

| Item | Status | Evidence |
|------|--------|----------|
| sliceUtf16Safe() | done | `packages/core/src/utils/string-safe.ts` |
| truncateSafe() | done | `packages/core/src/utils/string-safe.ts` |
| lengthInCodePoints() | done | `packages/core/src/utils/string-safe.ts` |
| sliceByCodePoints() | done | `packages/core/src/utils/string-safe.ts` |
| stripEmoji() | done | `packages/core/src/utils/string-safe.ts` |
| sanitizeSurrogates() | done | `packages/core/src/utils/string-safe.ts` |
| truncateByBytes() | done | `packages/core/src/utils/string-safe.ts` |

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

## Guard (Architecture)

| Item | Status | Evidence |
|------|--------|----------|
| Preset system (fsd/clean/hexagonal/atomic/mandu) | done | `packages/core/src/guard/presets/*` |
| Import analyzer | done | `packages/core/src/guard/analyzer.ts` |
| Layer validator | done | `packages/core/src/guard/validator.ts` |
| AST analyzer | done | `packages/core/src/guard/ast-analyzer.ts` |
| Reporter (pretty/agent) | done | `packages/core/src/guard/reporter.ts` |
| Watcher (realtime) | done | `packages/core/src/guard/watcher.ts` |
| Statistics & Reports | done | `packages/core/src/guard/statistics.ts` |
| Suggestions | done | `packages/core/src/guard/suggestions.ts` |

## Guard (Self-Healing)

| Item | Status | Evidence |
|------|--------|----------|
| checkWithHealing() | done | `packages/core/src/guard/healing.ts` |
| generateHealing() | done | `packages/core/src/guard/healing.ts` |
| applyHealing() | done | `packages/core/src/guard/healing.ts` |
| healAll() | done | `packages/core/src/guard/healing.ts` |
| explainRule() | done | `packages/core/src/guard/healing.ts` |

## Guard (Decision Memory)

| Item | Status | Evidence |
|------|--------|----------|
| saveDecision() | done | `packages/core/src/guard/decision-memory.ts` |
| getAllDecisions() | done | `packages/core/src/guard/decision-memory.ts` |
| checkConsistency() | done | `packages/core/src/guard/decision-memory.ts` |
| generateCompactArchitecture() | done | `packages/core/src/guard/decision-memory.ts` |

## Guard (Semantic Slots)

| Item | Status | Evidence |
|------|--------|----------|
| validateSlotConstraints() | done | `packages/core/src/guard/semantic-slots.ts` |
| validateSlots() | done | `packages/core/src/guard/semantic-slots.ts` |
| extractSlotMetadata() | done | `packages/core/src/guard/semantic-slots.ts` |

## Guard (Architecture Negotiation)

| Item | Status | Evidence |
|------|--------|----------|
| negotiate() | done | `packages/core/src/guard/negotiation.ts` |
| generateScaffold() | done | `packages/core/src/guard/negotiation.ts` |
| analyzeExistingStructure() | done | `packages/core/src/guard/negotiation.ts` |

## Guard (Config Guard)

| Item | Status | Evidence |
|------|--------|----------|
| guardConfig() | done | `packages/core/src/guard/config-guard.ts` |
| quickConfigGuard() | done | `packages/core/src/guard/config-guard.ts` |
| calculateHealthScore() | done | `packages/core/src/guard/config-guard.ts` |

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
| Config validation (dev/build/routes) | done | `packages/core/src/config/validate.ts`, `packages/cli/src/commands/dev.ts`, `build.ts`, `routes.ts` |
| Integration hooks/logger | not started | (no `packages/core/src/integrations`) |
| Build hooks/plugins/analyzer | partial | Plugin types defined (DNA-001), implementation TBD |

## Routing

| Item | Status | Evidence |
|------|--------|----------|
| Server router | done | `packages/core/src/runtime/router.ts` |
| FS Routes scanner | done | `packages/core/src/router/fs-scanner.ts` (v0.9.32) |
| FS Routes patterns | done | `packages/core/src/router/fs-patterns.ts` (v0.9.32) |
| FS Routes generator | done | `packages/core/src/router/fs-routes.ts` (v0.9.32) |
| FS Routes watcher | done | `packages/core/src/router/fs-routes.ts` watchFSRoutes() (v0.9.32) |
| FS Routes config via mandu.config | done | `packages/core/src/router/fs-routes.ts` resolveScannerConfig() |
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
| Log transports | done | `packages/core/src/logging/transports.ts` (DNA-008) |
| Perf tests | not started | (no `tests/perf`) |

## Security

| Item | Status | Evidence |
|------|--------|----------|
| Path traversal prevention | done | `packages/core/src/runtime/server.ts` isPathSafe() (v0.9.27) |
| CLI port validation | done | `packages/cli/src/main.ts` parsePort() (v0.9.11) |
| Import validation | done | `packages/core/src/security/import-validation.ts` |

## SEO (Search Engine Optimization)

| Item | Status | Evidence |
|------|--------|----------|
| Metadata types (Next.js API compatible) | done | `packages/core/src/seo/types.ts` |
| Metadata resolution pipeline | done | `packages/core/src/seo/resolve/index.ts` |
| Title template system | done | `packages/core/src/seo/resolve/title.ts` |
| Layout chain metadata merging | done | `resolveMetadata()` in resolve/index.ts |
| Open Graph rendering | done | `packages/core/src/seo/render/opengraph.ts` |
| Twitter Cards rendering | done | `packages/core/src/seo/render/twitter.ts` |
| JSON-LD structured data | done | `packages/core/src/seo/render/jsonld.ts` |
| JSON-LD helpers (12 types) | done | Article, WebSite, Organization, Breadcrumb, FAQ, Product, LocalBusiness, Video, Review, Course, Event, SoftwareApp |
| Sitemap.xml generation | done | `packages/core/src/seo/render/sitemap.ts` |
| Sitemap index support | done | `renderSitemapIndex()` in render/sitemap.ts |
| Robots.txt generation | done | `packages/core/src/seo/render/robots.ts` |
| Route handlers (sitemap/robots) | done | `packages/core/src/seo/routes/index.ts` |
| SSR integration | done | `packages/core/src/seo/integration/ssr.ts` |
| Google meta tags | done | nositelinkssearchbox, notranslate in render/basic.ts |
| Viewport rendering | done | `renderViewport()` in render/basic.ts |
| Theme Color (with media queries) | done | `renderThemeColor()` in render/basic.ts |
| Format Detection (iOS Safari) | done | `renderFormatDetection()` in render/basic.ts |
| Resource Hints (preconnect, preload, etc.) | done | `renderResourceHints()` in render/basic.ts |
| App Links (iOS/Android) | done | `renderAppLinks()` in render/basic.ts |
| SEO module tests | done | `packages/core/tests/seo/seo.test.ts` (67 tests) |

## CLI Terminal UI (DNA-009 ~ DNA-017)

| Item | Status | Evidence |
|------|--------|----------|
| Color palette (Mandu theme) | done | `packages/cli/src/terminal/palette.ts` (DNA-009) |
| Theme system | done | `packages/cli/src/terminal/theme.ts` (DNA-009) |
| Command registry | done | `packages/cli/src/commands/registry.ts` (DNA-010) |
| ANSI-aware table | done | `packages/cli/src/terminal/table.ts` (DNA-011) |
| Multi-fallback progress | done | `packages/cli/src/terminal/progress.ts` (DNA-012) |
| Safe stream writer | done | `packages/cli/src/terminal/stream-writer.ts` (DNA-013) |
| Adaptive output format | done | `packages/cli/src/terminal/output.ts` (DNA-014) |
| Semantic help system | done | `packages/cli/src/terminal/help.ts` (DNA-015) |
| Pre-action hooks | done | `packages/cli/src/hooks/preaction.ts` (DNA-016) |
| Hero banner | done | `packages/cli/src/terminal/banner.ts` (DNA-017) |

---

## Summary

| Category | Done | Partial | Not Started |
|----------|------|---------|-------------|
| Core Runtime | 10 | 0 | 0 |
| Plugin System | 8 | 0 | 0 |
| Dependency Injection | 5 | 0 | 0 |
| Error Handling | 7 | 0 | 0 |
| Structured Logging | 7 | 0 | 0 |
| Configuration | 7 | 0 | 0 |
| String Utilities | 7 | 0 | 0 |
| Contracts & OpenAPI | 9 | 0 | 0 |
| Guard (Architecture) | 8 | 0 | 0 |
| Guard (Self-Healing) | 5 | 0 | 0 |
| Guard (Decision Memory) | 4 | 0 | 0 |
| Guard (Semantic Slots) | 3 | 0 | 0 |
| Guard (Negotiation) | 3 | 0 | 0 |
| Guard (Config Guard) | 3 | 0 | 0 |
| Hydration & Islands | 7 | 0 | 0 |
| Client-side Routing | 4 | 0 | 0 |
| Data & Content | 0 | 0 | 1 |
| Integrations & Build | 6 | 1 | 1 |
| Routing | 8 | 0 | 0 |
| Realtime / Resumable | 0 | 0 | 2 |
| Observability & Perf | 2 | 0 | 1 |
| Security | 3 | 0 | 0 |
| SEO | 21 | 0 | 0 |
| CLI Terminal UI | 10 | 0 | 0 |
| **Total** | **137** | **1** | **5** |

---

## Recent Changes (v0.9.26 ~ v0.10.0)

| Version | Package | Changes |
|---------|---------|---------|
| v0.10.0 | core | DNA-006: Config hot reload (`watchConfig`, `hasConfigChanged`, `getChangedSections`) |
| v0.10.0 | core | DNA-007: Error extraction (`extractErrorCode`, `classifyError`, `isRetryableError`) |
| v0.10.0 | core | DNA-008: Structured logging transports (`attachLogTransport`, `createBatchTransport`) |
| v0.10.0 | cli | DNA-015: Semantic help system (`renderHelp`, `formatHelpExample`, `MANDU_HELP`) |
| v0.10.0 | cli | DNA-016: Pre-action hooks (`runPreAction`, `registerPreActionHook`) |
| v0.9.46 | core | DNA-001: Plugin system (types, registry, 5 plugin categories) |
| v0.9.46 | core | DNA-002: Dependency injection (`FillingDeps`, `createDefaultDeps`, `createMockDeps`) |
| v0.9.46 | core | DNA-003: Zod .strict() for config validation |
| v0.9.46 | core | DNA-004: Session key utilities (`buildSessionKey`, `buildCacheKey`) |
| v0.9.46 | core | DNA-005: UTF-16 safe strings (`sliceUtf16Safe`, `truncateSafe`, `sanitizeSurrogates`) |
| v0.9.46 | cli | DNA-009: Mandu color palette & theme system |
| v0.9.46 | cli | DNA-010: Command registry with lazy loading |
| v0.9.46 | cli | DNA-011: ANSI-aware table rendering |
| v0.9.46 | cli | DNA-012: Multi-fallback progress (spinner/line/log) |
| v0.9.46 | cli | DNA-013: Safe stream writer (EPIPE handling) |
| v0.9.46 | cli | DNA-014: Adaptive output format (json/pretty/plain) |
| v0.9.46 | cli | DNA-017: Hero banner with cfonts |
| v0.9.41 | core | Config validation, fsRoutes config support, error/result helpers, path traversal hardening, prod CORS warning |
| v0.9.41 | core | Client router globals + LRU caches |
| v0.9.41 | cli | Config validation for dev/build/routes + guard-arch config defaults |
| v0.9.41 | core | FS scanner O(n) conflict checks, guard watcher glob cache, vendor shim parallel build |
| v0.9.41 | cli | CLI error codes + formatted output |
| v0.9.41 | core/cli | Bun-first refactor: JSON load via Bun.file().json, FS scan via Bun.Glob, HMR ESM cache-busting |
| v0.9.35 | core | SEO Module (Next.js Metadata API 호환, sitemap/robots 생성, JSON-LD 헬퍼, Google SEO 최적화) |
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
