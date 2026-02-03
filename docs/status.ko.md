# 구현 상태

범례: **완료** = 구현됨, **부분** = 일부만 구현, **미시작** = 아직 없음, **미검증** = 구현되었으나 테스트 실행 불가.

> 최종 업데이트: 2026-02-03

---

## Core Runtime

| 항목 | 상태 | 근거 |
|------|------|------|
| 미들웨어 compose | 완료 | `packages/core/src/runtime/compose.ts` |
| 라이프사이클 훅 | 완료 | `packages/core/src/runtime/lifecycle.ts` |
| Trace 시스템 | 완료 | `packages/core/src/runtime/trace.ts` |
| Filling 훅 (onRequest/onParse/before/after/map/onError/afterResponse) | 완료 | `packages/core/src/filling/filling.ts` |
| guard/use 별칭 | 완료 | `packages/core/src/filling/filling.ts` |
| compose 미들웨어 연동 | 완료 | `ManduFilling.middleware()` |
| Streaming SSR | 완료 | `packages/core/src/runtime/streaming-ssr.ts` |
| Server Registry (인스턴스 격리) | 완료 | `packages/core/src/runtime/server.ts` ServerRegistry 클래스 (v0.9.29) |
| 런타임 테스트 | 완료(미검증) | `tests/runtime/*` (Bun crash) |

## Contracts & OpenAPI

| 항목 | 상태 | 근거 |
|------|------|------|
| Contract 스키마/검증 | 완료 | `packages/core/src/contract/*` |
| OpenAPI 생성기 | 완료 | `packages/core/src/openapi/generator.ts` |
| CLI OpenAPI generate/serve | 완료 | `packages/cli/src/commands/openapi.ts` |
| Contract 타입 추론 | 완료 | `packages/core/src/contract/types.ts`, `handler.ts` |
| Typed Handler | 완료 | `packages/core/src/contract/handler.ts` |
| Typed Client | 완료 | `packages/core/src/contract/client.ts` |
| Mandu Namespace API | 완료 | `Mandu.contract/handler/route/client/fetch` |
| 스키마 정규화/coerce | 완료 | `packages/core/src/contract/normalize.ts` |
| OpenAPI examples/extra | 완료 | `packages/core/src/openapi/generator.ts` |

## Hydration & Islands

| 항목 | 상태 | 근거 |
|------|------|------|
| props 직렬화/역직렬화 | 완료 | `packages/core/src/client/serialize.ts` |
| Island 정의 API | 완료 | `packages/core/src/client/island.ts` |
| SSR island 래퍼/스크립트 | 완료 | `packages/core/src/runtime/ssr.ts`, `streaming-ssr.ts` |
| 클라이언트 Hydration Runtime | 완료 | `packages/core/src/bundler/build.ts` generateRuntimeSource() |
| 클라이언트 partials/slots | 완료 | `packages/core/src/client/island.ts` partial(), slot(), createPartialGroup() |
| Error Boundary & Loading | 완료 | `packages/core/src/bundler/build.ts` IslandErrorBoundary, IslandLoadingWrapper (v0.9.26) |
| useIslandEvent cleanup | 완료 | `packages/core/src/client/island.ts` IslandEventHandle (v0.9.26) |

## Client-side Routing

| 항목 | 상태 | 근거 |
|------|------|------|
| 클라이언트 라우터 | 완료 | `packages/core/src/client/router.ts` |
| 라우터 훅 (useRouter, useParams 등) | 완료 | `packages/core/src/client/hooks.ts` |
| Link/NavLink 컴포넌트 | 완료 | `packages/core/src/client/Link.tsx` |
| 라우터 런타임 번들 | 완료 | `packages/core/src/bundler/build.ts` generateRouterRuntimeSource() |

## Data & Content

| 항목 | 상태 | 근거 |
|------|------|------|
| Loader types/store/loaders | 미시작 | (`packages/core/src/loader` 없음) |

## Integrations & Build

| 항목 | 상태 | 근거 |
|------|------|------|
| Client Bundler | 완료 | `packages/core/src/bundler/build.ts` |
| Dev Server | 완료 | `packages/core/src/bundler/dev.ts` |
| Dev Watch (common dirs) | 완료 | `packages/core/src/bundler/dev.ts` DEFAULT_COMMON_DIRS, watchDirs 옵션 (v0.9.30) |
| HMR common file reload | 완료 | `packages/cli/src/commands/dev.ts` type: "reload" 브로드캐스트 (v0.9.31) |
| Manifest always saved | 완료 | `packages/core/src/bundler/build.ts` 빈 매니페스트 기록 (v0.9.28) |
| 설정 검증 (dev/build/routes) | 완료 | `packages/core/src/config/validate.ts`, `packages/cli/src/commands/dev.ts`, `build.ts`, `routes.ts` |
| Integration hooks/logger | 미시작 | (`packages/core/src/integrations` 없음) |
| Build hooks/plugins/analyzer | 미시작 | (`packages/core/src/bundler/hooks.ts` 없음) |

## Routing

| 항목 | 상태 | 근거 |
|------|------|------|
| 서버 라우터 | 완료 | `packages/core/src/runtime/router.ts` |
| FS Routes 스캐너 | 완료 | `packages/core/src/router/fs-scanner.ts` (v0.9.32) |
| FS Routes 패턴 | 완료 | `packages/core/src/router/fs-patterns.ts` (v0.9.32) |
| FS Routes 제너레이터 | 완료 | `packages/core/src/router/fs-routes.ts` (v0.9.32) |
| FS Routes 와처 | 완료 | `packages/core/src/router/fs-routes.ts` watchFSRoutes() (v0.9.32) |
| FS Routes 설정 (mandu.config) | 완료 | `packages/core/src/router/fs-routes.ts` resolveScannerConfig() |
| FS Routes CLI | 완료 | `packages/cli/src/commands/routes.ts` routes generate/list/watch (v0.9.13) |
| FS Routes dev 통합 | 완료 | `packages/cli/src/commands/dev.ts` FS Routes 기반 dev 서버 (v0.9.13) |

## Realtime / Resumable

| 항목 | 상태 | 근거 |
|------|------|------|
| WebSocket 채널 | 미시작 | (`packages/core/src/ws` 없음) |
| QRL-lite / Resumable POC | 미시작 | (`packages/core/src/client/qrl.ts` 없음) |

## Observability & Perf

| 항목 | 상태 | 근거 |
|------|------|------|
| 런타임 로거 | 완료 | `packages/core/src/runtime/logger.ts` |
| Perf 테스트 | 미시작 | (`tests/perf` 없음) |

## Security

| 항목 | 상태 | 근거 |
|------|------|------|
| Path traversal 방지 | 완료 | `packages/core/src/runtime/server.ts` isPathSafe() (v0.9.27) |
| CLI 포트 검증 | 완료 | `packages/cli/src/main.ts` parsePort() (v0.9.11) |

## SEO (검색 엔진 최적화)

| 항목 | 상태 | 근거 |
|------|------|------|
| Metadata 타입 (Next.js API 호환) | 완료 | `packages/core/src/seo/types.ts` |
| Metadata 해석 파이프라인 | 완료 | `packages/core/src/seo/resolve/index.ts` |
| 타이틀 템플릿 시스템 | 완료 | `packages/core/src/seo/resolve/title.ts` |
| 레이아웃 체인 메타데이터 병합 | 완료 | resolve/index.ts의 `resolveMetadata()` |
| Open Graph 렌더링 | 완료 | `packages/core/src/seo/render/opengraph.ts` |
| Twitter Cards 렌더링 | 완료 | `packages/core/src/seo/render/twitter.ts` |
| JSON-LD 구조화 데이터 | 완료 | `packages/core/src/seo/render/jsonld.ts` |
| JSON-LD 헬퍼 (12종) | 완료 | Article, WebSite, Organization, Breadcrumb, FAQ, Product, LocalBusiness, Video, Review, Course, Event, SoftwareApp |
| Sitemap.xml 생성 | 완료 | `packages/core/src/seo/render/sitemap.ts` |
| Sitemap index 지원 | 완료 | render/sitemap.ts의 `renderSitemapIndex()` |
| Robots.txt 생성 | 완료 | `packages/core/src/seo/render/robots.ts` |
| 라우트 핸들러 (sitemap/robots) | 완료 | `packages/core/src/seo/routes/index.ts` |
| SSR 통합 | 완료 | `packages/core/src/seo/integration/ssr.ts` |
| Google 메타 태그 | 완료 | render/basic.ts의 nositelinkssearchbox, notranslate |
| Viewport 렌더링 | 완료 | render/basic.ts의 `renderViewport()` |
| Theme Color (미디어 쿼리 지원) | 완료 | render/basic.ts의 `renderThemeColor()` |
| Format Detection (iOS Safari) | 완료 | render/basic.ts의 `renderFormatDetection()` |
| Resource Hints (preconnect, preload 등) | 완료 | render/basic.ts의 `renderResourceHints()` |
| App Links (iOS/Android) | 완료 | render/basic.ts의 `renderAppLinks()` |
| SEO 모듈 테스트 | 완료 | `packages/core/tests/seo/seo.test.ts` (67개 테스트) |

---

## 요약

| 카테고리 | 완료 | 미시작 |
|----------|------|--------|
| Core Runtime | 9 | 0 |
| Contracts & OpenAPI | 9 | 0 |
| Hydration & Islands | 7 | 0 |
| Client-side Routing | 4 | 0 |
| Data & Content | 0 | 1 |
| Integrations & Build | 6 | 2 |
| Routing | 8 | 0 |
| Realtime / Resumable | 0 | 2 |
| Observability & Perf | 1 | 1 |
| Security | 2 | 0 |
| SEO | 21 | 0 |
| **총계** | **67** | **6** |

---

## 최근 변경 (v0.9.26 ~ v0.9.41)

| 버전 | 패키지 | 변경 사항 |
|------|--------|----------|
| v0.9.41 | core | 설정 검증, fsRoutes 설정 지원, error/result 유틸, path traversal 강화, 프로덕션 CORS 경고 |
| v0.9.41 | core | 클라이언트 라우터 전역 상태 분리 + LRU 캐시 |
| v0.9.41 | cli | dev/build/routes 설정 검증 + guard-arch 기본값 적용 |
| v0.9.41 | core | FS 스캐너 충돌 검사 O(n), guard watcher glob 캐싱, vendor shim 병렬 빌드 |
| v0.9.41 | cli | CLI 에러 코드 + 포맷 개선 |
| v0.9.41 | core/cli | Bun-first 전환: Bun.file().json 로딩, Bun.Glob FS 스캔, HMR ESM 캐시 무효화 |
| v0.9.35 | core | SEO 모듈 (Next.js Metadata API 호환, sitemap/robots 생성, JSON-LD 헬퍼, Google SEO 최적화) |
| v0.9.34 | core | 고급 라우트 (catch-all `:param*`, optional `:param*?`, boundary 컴포넌트) |
| v0.9.33 | core | 레이아웃 시스템 (layoutChain, loadingModule, errorModule in RouteSpec) |
| v0.9.14 | cli | 레이아웃 HMR 지원 (registerLayoutLoader, clearDefaultRegistry on reload) |
| v0.9.32 | core | FS Routes 시스템 (스캐너, 패턴, 제너레이터, 와처) |
| v0.9.13 | cli | FS Routes CLI (routes generate/list/watch, dev 통합) |
| v0.9.31 | core | HMR common 파일 리로드 지원 |
| v0.9.30 | core | Dev bundler common dirs watch |
| v0.9.29 | core | Server registry 인스턴스 격리 |
| v0.9.28 | core | 항상 manifest.json 기록 |
| v0.9.27 | core | Path traversal 보안 수정 |
| v0.9.26 | core | Hydration 개선 (ErrorBoundary, Loading, cleanup) |
| v0.9.12 | cli | HMR reload broadcast for common files |
| v0.9.11 | cli | 포트 검증 수정 |
