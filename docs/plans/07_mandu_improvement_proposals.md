# Mandu 프레임워크 개선 제안서

> **문서 ID**: MANDU-IMPROVEMENT-001  
> **버전**: 1.1  
> **작성일**: 2025-02-03  
> **검토일**: 2026-02-03  
> **기준 버전**: v0.9.41  
> **상태**: Draft

---

## 1. 개요

### 1.1 문서 목적

Mandu 프레임워크 v0.9.x 코드 전수 분석을 기반으로, 아키텍처/성능/코드 품질/DX/보안 영역의 구체적인 개선점을 코드 레벨로 제시한다.

### 1.2 분석 범위

```
packages/
├── core/src/
│   ├── runtime/    (server.ts, compose.ts, lifecycle.ts, ssr.ts)
│   ├── router/     (fs-routes.ts, fs-scanner.ts, fs-patterns.ts)
│   ├── guard/      (check.ts, analyzer.ts, watcher.ts, presets/)
│   ├── client/     (island.ts, router.ts, runtime.ts)
│   ├── contract/   (client.ts, types.ts, handler.ts, schema.ts)
│   ├── filling/    (filling.ts, context.ts)
│   ├── bundler/    (dev.ts, build.ts) - 1200+ lines
│   ├── seo/        (index.ts, render.ts, resolve.ts)
│   └── brain/      (brain.ts, doctor/, memory.ts)
├── cli/src/        (main.ts, commands/dev.ts)
└── mcp/src/        (server.ts, tools/)
```

### 1.3 분석 방법

- 전체 코드 리뷰 (100+ TypeScript 파일)
- 주요 모듈 상세 분석 (runtime, router, guard, bundler, brain)
- 패턴 및 안티패턴 식별
- 성능 병목 지점 탐지

---

## 2. 아키텍처 / 설계 개선

### 2.1 에러 처리 일관성 통합

#### 현재 상태

`server.ts`에서 여러 에러 처리 패턴이 혼재되어 있음:

```typescript
// packages/core/src/runtime/server.ts:627-635 (현재)
if (!match) {
  const error = createNotFoundResponse(pathname);
  const response = formatErrorResponse(error, {
    isDev: process.env.NODE_ENV !== "production",
  });
  return Response.json(response, { status: 404 });
}
```

**문제점:**
- 에러 생성과 HTTP status 결정이 분리되어 동일 패턴이 반복됨 (`formatErrorResponse` + `Response.json`)
- `ManduError`는 존재하지만, 함수 경계에서 성공/실패 흐름이 명확히 표현되지 않음
- 에러 응답 생성/로깅 유틸이 분산되어 테스트/추적이 어려움

#### 개선 제안: 기존 error 모듈 확장 + Result<T> 패턴 적용

**신규 파일: `packages/core/src/error/result.ts` (기존 error 모듈 확장)**

```typescript
import type { ManduError } from "./types";
import { ErrorCode } from "./types";
import { formatErrorResponse } from "./formatter";

/**
 * Result 타입 - 성공/실패를 명시적으로 표현
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: ManduError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (error: ManduError): Result<never> => ({ ok: false, error });

/**
 * ManduError -> HTTP status 매핑
 * (또는 ManduError에 httpStatus?: number 추가 후 우선 사용)
 */
export function statusFromError(error: ManduError): number {
  if (typeof (error as ManduError & { httpStatus?: number }).httpStatus === "number") {
    return (error as ManduError & { httpStatus?: number }).httpStatus!;
  }

  switch (error.code) {
    case ErrorCode.SPEC_ROUTE_NOT_FOUND:
      return 404;
    case ErrorCode.SLOT_VALIDATION_ERROR:
      return 400;
    default:
      return 500;
  }
}

export function errorToResponse(error: ManduError, isDev: boolean): Response {
  return Response.json(formatErrorResponse(error, { isDev }), {
    status: statusFromError(error),
  });
}
```

**보완 제안 (선택): `ManduError`에 `httpStatus?: number` 추가**
- `createNotFoundResponse`, `createPageLoadErrorResponse` 등 생성 함수에서 명시하면 `statusFromError` 단순화 가능

**수정 대상: `packages/core/src/runtime/server.ts`**

```typescript
// Before
async function handleRequest(req: Request, router: Router, registry: ServerRegistry) {
  // ... 중간 생략 ...
  if (!match) {
    const error = createNotFoundResponse(pathname);
    const response = formatErrorResponse(error, { isDev });
    return Response.json(response, { status: 404 });
  }
  // ...
}

// After
import { Result, ok, err, errorToResponse } from "../error/result";
import {
  createNotFoundResponse,
  createHandlerNotFoundResponse,
  createPageLoadErrorResponse,
  createSSRErrorResponse,
} from "../error";

async function handleRequest(
  req: Request,
  router: Router,
  registry: ServerRegistry
): Promise<Response> {
  const result = await handleRequestInternal(req, router, registry);
  if (!result.ok) {
    return errorToResponse(result.error, registry.settings.isDev);
  }
  return result.value;
}

async function handleRequestInternal(
  req: Request,
  router: Router,
  registry: ServerRegistry
): Promise<Result<Response>> {
  const pathname = new URL(req.url).pathname;
  const settings = registry.settings;

  // 정적 파일 처리
  const staticResponse = await serveStaticFile(pathname, settings);
  if (staticResponse) return ok(staticResponse);

  // 라우트 매칭
  const match = router.match(pathname);
  if (!match) return err(createNotFoundResponse(pathname));

  // API 핸들러
  if (match.route.kind === "api") {
    const handler = registry.apiHandlers.get(match.route.id);
    if (!handler) {
      return err(createHandlerNotFoundResponse(match.route.id, match.route.pattern));
    }

    try {
      const response = await handler(req, match.params);
      return ok(response);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      return err(createSSRErrorResponse(match.route.id, match.route.pattern, error));
    }
  }

  // 페이지 핸들러/로더 처리 중 에러는 createPageLoadErrorResponse로 통합
  // ... 페이지 처리 ...
}
```

---

### 2.2 전역 상태 의존성 개선

#### 현재 상태

여러 파일에서 `window` 전역 객체에 직접 접근:

```typescript
// packages/core/src/client/router.ts:38-43 (현재)
declare global {
  interface Window {
    __MANDU_ROUTER_STATE__?: RouterState;
    __MANDU_ROUTER_LISTENERS__?: Set<RouterListener>;
  }
}

// packages/core/src/client/island.ts (현재)
const data = (window as any).__MANDU_DATA__;
```

**문제점:**
- `(window as any)` 패턴으로 타입 안전성 상실
- 전역 선언이 여러 파일에 분산
- 테스트 시 모킹이 어려움

#### 개선 제안: 전용 타입 선언 및 접근자 함수

> **주의:** 현재 `tsconfig.json`의 `include`는 `.ts/.tsx`만 포함하므로  
> `globals.d.ts`를 쓰려면 `packages/**/*.d.ts` 추가가 필요합니다.  
> 아래처럼 `globals.ts`로 두는 편이 안전합니다.

**신규 파일: `packages/core/src/client/globals.ts` (또는 globals.d.ts + tsconfig include 추가)**

```typescript
/**
 * Mandu 전역 타입 선언
 * 클라이언트 측 전역 상태의 타입 정의
 */
import type { Root } from "react-dom/client";
import type { RouterState } from "./router";

interface ManduRouteInfo {
  id: string;
  pattern: string;
  params: Record<string, string>;
}

interface ManduDataEntry {
  serverData: unknown;
  timestamp?: number;
}

declare global {
  interface Window {
    /** 서버에서 전달된 데이터 (routeId → data) */
    __MANDU_DATA__?: Record<string, ManduDataEntry>;

    /** 직렬화된 서버 데이터 (raw JSON) */
    __MANDU_DATA_RAW__?: string;

    /** 현재 라우트 정보 */
    __MANDU_ROUTE__?: ManduRouteInfo;

    /** 클라이언트 라우터 상태 */
    __MANDU_ROUTER_STATE__?: RouterState;

    /** 라우터 상태 변경 리스너 */
    __MANDU_ROUTER_LISTENERS__?: Set<(state: RouterState) => void>;

    /** Hydrated roots 추적 (unmount용) */
    __MANDU_ROOTS__?: Map<string, Root>;

    /** React 인스턴스 공유 */
    __MANDU_REACT__?: typeof import("react");
  }
}

export {};
```

**신규 파일: `packages/core/src/client/window-state.ts`**

```typescript
/**
 * 타입 안전 전역 상태 접근자
 * window 객체 직접 접근 대신 이 모듈의 함수 사용
 */
import type { Root } from "react-dom/client";
import type { RouterState } from "./router";

// ============================================
// 환경 체크
// ============================================

export function isBrowser(): boolean {
  return typeof window !== "undefined";
}

// ============================================
// Router State
// ============================================

export function getRouterState(): RouterState | undefined {
  if (!isBrowser()) return undefined;
  return window.__MANDU_ROUTER_STATE__;
}

export function setRouterState(state: RouterState): void {
  if (!isBrowser()) return;
  window.__MANDU_ROUTER_STATE__ = state;
}

export function getRouterListeners(): Set<(state: RouterState) => void> {
  if (!isBrowser()) return new Set();
  
  if (!window.__MANDU_ROUTER_LISTENERS__) {
    window.__MANDU_ROUTER_LISTENERS__ = new Set();
  }
  return window.__MANDU_ROUTER_LISTENERS__;
}

// ============================================
// Route & Data
// ============================================

export function getManduRoute(): { id: string; pattern: string; params: Record<string, string> } | undefined {
  if (!isBrowser()) return undefined;
  return window.__MANDU_ROUTE__;
}

export function getManduData(): Record<string, { serverData: unknown; timestamp?: number }> | undefined {
  if (!isBrowser()) return undefined;
  return window.__MANDU_DATA__;
}

export function getManduDataRaw(): string | undefined {
  if (!isBrowser()) return undefined;
  return window.__MANDU_DATA_RAW__;
}

/**
 * 특정 라우트의 서버 데이터 조회 (타입 안전)
 */
export function getServerData<T>(routeId: string): T | undefined {
  const data = getManduData();
  return data?.[routeId]?.serverData as T | undefined;
}

/**
 * 서버 데이터 설정
 */
export function setServerData(routeId: string, data: unknown): void {
  if (!isBrowser()) return;
  
  if (!window.__MANDU_DATA__) {
    window.__MANDU_DATA__ = {};
  }
  window.__MANDU_DATA__[routeId] = { serverData: data };
}

// ============================================
// Hydration Roots
// ============================================

export function getHydratedRoots(): Map<string, Root> {
  if (!isBrowser()) return new Map();
  
  if (!window.__MANDU_ROOTS__) {
    window.__MANDU_ROOTS__ = new Map();
  }
  return window.__MANDU_ROOTS__;
}

export function setHydratedRoot(id: string, root: Root): void {
  getHydratedRoots().set(id, root);
}

export function removeHydratedRoot(id: string): boolean {
  return getHydratedRoots().delete(id);
}
```

---

### 2.3 ServerRegistry 책임 분리

#### 현재 상태

`ServerRegistry` 클래스가 500+ 라인으로 비대화:

```typescript
// packages/core/src/runtime/server.ts:195-220 (현재)
export class ServerRegistry {
  readonly apiHandlers: Map<string, ApiHandler> = new Map();
  readonly pageLoaders: Map<string, PageLoader> = new Map();
  readonly pageHandlers: Map<string, PageHandler> = new Map();
  readonly routeComponents: Map<string, RouteComponent> = new Map();
  readonly layoutComponents: Map<string, LayoutComponent> = new Map();
  readonly layoutLoaders: Map<string, LayoutLoader> = new Map();
  readonly loadingComponents: Map<string, LoadingComponent> = new Map();
  readonly loadingLoaders: Map<string, LoadingLoader> = new Map();
  readonly errorComponents: Map<string, ErrorComponent> = new Map();
  readonly errorLoaders: Map<string, ErrorLoader> = new Map();
  // ... 300+ lines more (settings, methods, utilities...)
}
```

> **참고:** v0.9.29에서 레지스트리 인스턴스 분리는 이미 적용됨.  
> 본 항목은 **내부 책임 분리(SRP)**와 **테스트 용이성 개선**에 초점을 둠.

**문제점:**
- 단일 클래스가 핸들러, 컴포넌트, 설정 모두 관리 (SRP 위반)
- 테스트 시 전체 Registry 모킹 필요
- 의존성 주입이 어려움

#### 개선 제안: 역할별 레지스트리 분리

**신규 파일: `packages/core/src/runtime/registry/handler-registry.ts`**

```typescript
/**
 * API/Page 핸들러 관리 전용 레지스트리
 */
import type { ApiHandler, PageHandler, PageLoader } from "../types";

export class HandlerRegistry {
  private apiHandlers = new Map<string, ApiHandler>();
  private pageHandlers = new Map<string, PageHandler>();
  private pageLoaders = new Map<string, PageLoader>();

  // ============================================
  // API Handlers
  // ============================================

  registerApiHandler(routeId: string, handler: ApiHandler): void {
    if (this.apiHandlers.has(routeId)) {
      console.warn(`[HandlerRegistry] Overwriting API handler: ${routeId}`);
    }
    this.apiHandlers.set(routeId, handler);
  }

  getApiHandler(routeId: string): ApiHandler | undefined {
    return this.apiHandlers.get(routeId);
  }

  hasApiHandler(routeId: string): boolean {
    return this.apiHandlers.has(routeId);
  }

  // ============================================
  // Page Handlers
  // ============================================

  registerPageHandler(routeId: string, handler: PageHandler): void {
    this.pageHandlers.set(routeId, handler);
  }

  getPageHandler(routeId: string): PageHandler | undefined {
    return this.pageHandlers.get(routeId);
  }

  // ============================================
  // Page Loaders
  // ============================================

  registerPageLoader(routeId: string, loader: PageLoader): void {
    this.pageLoaders.set(routeId, loader);
  }

  getPageLoader(routeId: string): PageLoader | undefined {
    return this.pageLoaders.get(routeId);
  }

  // ============================================
  // Utilities
  // ============================================

  clear(): void {
    this.apiHandlers.clear();
    this.pageHandlers.clear();
    this.pageLoaders.clear();
  }

  getStats(): { apiCount: number; pageCount: number; loaderCount: number } {
    return {
      apiCount: this.apiHandlers.size,
      pageCount: this.pageHandlers.size,
      loaderCount: this.pageLoaders.size,
    };
  }
}
```

**신규 파일: `packages/core/src/runtime/registry/component-registry.ts`**

```typescript
/**
 * 컴포넌트 (Layout, Loading, Error) 관리 전용 레지스트리
 */
import type {
  LayoutComponent,
  LayoutLoader,
  LoadingComponent,
  LoadingLoader,
  ErrorComponent,
  ErrorLoader,
} from "../types";

export class ComponentRegistry {
  // Layout
  private layoutCache = new Map<string, LayoutComponent>();
  private layoutLoaders = new Map<string, LayoutLoader>();
  
  // Loading
  private loadingCache = new Map<string, LoadingComponent>();
  private loadingLoaders = new Map<string, LoadingLoader>();
  
  // Error
  private errorCache = new Map<string, ErrorComponent>();
  private errorLoaders = new Map<string, ErrorLoader>();

  // ============================================
  // Layout Components
  // ============================================

  registerLayoutLoader(modulePath: string, loader: LayoutLoader): void {
    this.layoutLoaders.set(modulePath, loader);
  }

  async getLayoutComponent(modulePath: string): Promise<LayoutComponent | null> {
    // 캐시 확인
    const cached = this.layoutCache.get(modulePath);
    if (cached) return cached;

    // 로더로 로드
    const loader = this.layoutLoaders.get(modulePath);
    if (!loader) return null;

    try {
      const module = await loader();
      const component = module.default;
      this.layoutCache.set(modulePath, component);
      return component;
    } catch (error) {
      console.error(`[ComponentRegistry] Layout load failed: ${modulePath}`, error);
      return null;
    }
  }

  // ============================================
  // Loading Components
  // ============================================

  registerLoadingLoader(modulePath: string, loader: LoadingLoader): void {
    this.loadingLoaders.set(modulePath, loader);
  }

  async getLoadingComponent(modulePath: string): Promise<LoadingComponent | null> {
    const cached = this.loadingCache.get(modulePath);
    if (cached) return cached;

    const loader = this.loadingLoaders.get(modulePath);
    if (!loader) return null;

    try {
      const module = await loader();
      const component = module.default;
      this.loadingCache.set(modulePath, component);
      return component;
    } catch (error) {
      console.error(`[ComponentRegistry] Loading component load failed: ${modulePath}`, error);
      return null;
    }
  }

  // ============================================
  // Error Components
  // ============================================

  registerErrorLoader(modulePath: string, loader: ErrorLoader): void {
    this.errorLoaders.set(modulePath, loader);
  }

  async getErrorComponent(modulePath: string): Promise<ErrorComponent | null> {
    const cached = this.errorCache.get(modulePath);
    if (cached) return cached;

    const loader = this.errorLoaders.get(modulePath);
    if (!loader) return null;

    try {
      const module = await loader();
      const component = module.default;
      this.errorCache.set(modulePath, component);
      return component;
    } catch (error) {
      console.error(`[ComponentRegistry] Error component load failed: ${modulePath}`, error);
      return null;
    }
  }

  // ============================================
  // Utilities
  // ============================================

  clearCaches(): void {
    this.layoutCache.clear();
    this.loadingCache.clear();
    this.errorCache.clear();
  }

  clear(): void {
    this.clearCaches();
    this.layoutLoaders.clear();
    this.loadingLoaders.clear();
    this.errorLoaders.clear();
  }
}
```

**신규 파일: `packages/core/src/runtime/registry/index.ts`**

```typescript
/**
 * ServerRegistry Facade
 * 하위 호환성 유지하면서 내부적으로 분리된 레지스트리 사용
 */
import { HandlerRegistry } from "./handler-registry";
import { ComponentRegistry } from "./component-registry";
import type { ServerRegistrySettings } from "../types";

export class ServerRegistry {
  readonly handlers = new HandlerRegistry();
  readonly components = new ComponentRegistry();
  
  private _settings: ServerRegistrySettings = {
    rootDir: process.cwd(),
    isDev: process.env.NODE_ENV !== "production",
  };

  // ============================================
  // Settings
  // ============================================

  get settings(): Readonly<ServerRegistrySettings> {
    return this._settings;
  }

  configure(settings: Partial<ServerRegistrySettings>): void {
    this._settings = { ...this._settings, ...settings };
  }

  // ============================================
  // Facade Methods (하위 호환성)
  // ============================================

  registerApiHandler(routeId: string, handler: ApiHandler): void {
    this.handlers.registerApiHandler(routeId, handler);
  }

  registerPageLoader(routeId: string, loader: PageLoader): void {
    this.handlers.registerPageLoader(routeId, loader);
  }

  registerLayoutLoader(modulePath: string, loader: LayoutLoader): void {
    this.components.registerLayoutLoader(modulePath, loader);
  }

  async getLayoutComponent(modulePath: string): Promise<LayoutComponent | null> {
    return this.components.getLayoutComponent(modulePath);
  }

  // ============================================
  // Utilities
  // ============================================

  clear(): void {
    this.handlers.clear();
    this.components.clear();
  }

  getStats(): object {
    return {
      handlers: this.handlers.getStats(),
      settings: this._settings,
    };
  }
}

export function createServerRegistry(): ServerRegistry {
  return new ServerRegistry();
}

// Re-export sub-registries for direct use
export { HandlerRegistry } from "./handler-registry";
export { ComponentRegistry } from "./component-registry";
```

---

**주의사항:**
- `server.ts`는 하위 호환을 위해 `apiHandlers`, `pageLoaders` 등을 export하고 있음 → 분리 후에도 동일 export 유지 필요
- `createAppFn`, `routeComponents`, `settings`는 Facade에 유지하여 runtime 동작 보장

### 2.4 MCP 패키지 순환 의존성 제거

#### 현재 상태

```typescript
// packages/mcp/src/server.ts:27 (현재)
import { startWatcher } from "../../core/src/index.js";
```

**문제점:**
- 상대 경로로 모노레포 내 다른 패키지 직접 참조
- 패키지 독립성 훼손
- 빌드/배포 시 문제 발생 가능

#### 개선 제안

**수정: `packages/mcp/src/server.ts`**

```typescript
// Before
import { startWatcher } from "../../core/src/index.js";

// After
import { startWatcher } from "@mandujs/core";
```

**수정: `packages/mcp/package.json`**

```json
{
  "dependencies": {
    "@mandujs/core": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.25.3"
  }
}
```

---

## 3. 성능 최적화

### 3.1 Guard 검사 병렬화

#### 현재 상태

```typescript
// packages/core/src/guard/check.ts:367-427 (현재)
export async function runGuardCheck(
  manifest: RoutesManifest,
  rootDir: string
): Promise<GuardCheckResult> {
  const violations: GuardViolation[] = [];
  
  // 순차 실행 (비효율)
  const hashViolation = await checkSpecHashMismatch(manifest, lockPath);
  if (hashViolation) violations.push(hashViolation);

  const editViolations = await checkGeneratedManualEdit(rootDir, generatedMap);
  violations.push(...editViolations);

  const importViolations = await checkInvalidGeneratedImport(rootDir);
  violations.push(...importViolations);
  
  // ... 더 많은 순차 검사
}
```

**문제점:**
- 독립적인 검사들이 직렬로 수행됨
- 검사 수 증가 시 선형적 시간 증가
- CI 파이프라인 병목

#### 개선 제안: 병렬 실행

```typescript
// packages/core/src/guard/check.ts (개선)
export async function runGuardCheck(
  manifest: RoutesManifest,
  rootDir: string
): Promise<GuardCheckResult> {
  const config = await loadManduConfig(rootDir);
  const lockPath = path.join(rootDir, "spec/spec.lock.json");
  const mapPath = path.join(rootDir, "packages/core/map/generated.map.json");

  // ============================================
  // Phase 1: 독립적인 검사 병렬 실행
  // ============================================
  const [
    hashViolation,
    importViolations,
    slotViolations,
    specDirViolations,
    islandViolations,
  ] = await Promise.all([
    checkSpecHashMismatch(manifest, lockPath),
    checkInvalidGeneratedImport(rootDir),
    checkSlotFileExists(manifest, rootDir),
    checkSpecDirNaming(rootDir),
    checkIslandFirstIntegrity(manifest, rootDir),
  ]);

  const violations: GuardViolation[] = [];
  if (hashViolation) violations.push(hashViolation);
  violations.push(...importViolations);
  violations.push(...slotViolations);
  violations.push(...specDirViolations);
  violations.push(...islandViolations);

  // ============================================
  // Phase 2: generatedMap 의존 검사 (순차 로드 후 병렬 실행)
  // ============================================
  let generatedMap: GeneratedMap | null = null;
  if (await fileExists(mapPath)) {
    try {
      const mapContent = await Bun.file(mapPath).text();
      generatedMap = JSON.parse(mapContent);
    } catch {}
  }

  if (generatedMap) {
    const [editViolations, forbiddenViolations] = await Promise.all([
      checkGeneratedManualEdit(rootDir, generatedMap),
      checkForbiddenImportsInGenerated(rootDir, generatedMap),
    ]);
    violations.push(...editViolations);
    violations.push(...forbiddenViolations);
  }

  // ============================================
  // Phase 3: Slot + Contract 검사 병렬
  // ============================================
  const [slotContentViolations, contractViolations] = await Promise.all([
    checkSlotContentValidation(manifest, rootDir),
    runContractGuardCheck(manifest, rootDir),
  ]);
  violations.push(...slotContentViolations);
  violations.push(...contractViolations);

  // 결과 처리
  const resolvedViolations = applyRuleSeverity(violations, config.guard ?? {});
  const passed = resolvedViolations.every((v) => v.severity !== "error");

  return { passed, violations: resolvedViolations };
}
```

**예상 효과:**
- 검사 시간 2-3배 단축
- CI 파이프라인 속도 향상

---

### 3.2 Bundler Shim 병렬 빌드

#### 현재 상태

```typescript
// packages/core/src/bundler/build.ts:857-933 (현재)
async function buildVendorShims(outDir, options): Promise<VendorBuildResult> {
  const shims = [
    { name: "_react", ... },
    { name: "_react-dom", ... },
    { name: "_react-dom-client", ... },
    { name: "_jsx-runtime", ... },
    { name: "_jsx-dev-runtime", ... },
  ];

  // 순차 빌드
  for (const shim of shims) {
    // ... 각 shim 빌드
  }
}
```

**문제점:**
- 5개의 독립적인 shim을 순차적으로 빌드
- 초기 빌드 시간 증가

#### 개선 제안: 병렬 빌드

```typescript
// packages/core/src/bundler/build.ts (개선)
async function buildVendorShims(
  outDir: string,
  options: BundlerOptions
): Promise<VendorBuildResult> {
  const shims = [
    { name: "_react", source: generateReactShimSource(), key: "react", external: [] },
    { name: "_react-dom", source: generateReactDOMShimSource(), key: "reactDom", external: ["react"] },
    { name: "_react-dom-client", source: generateReactDOMClientShimSource(), key: "reactDomClient", external: ["react"] },
    { name: "_jsx-runtime", source: generateJsxRuntimeShimSource(), key: "jsxRuntime", external: ["react"] },
    { name: "_jsx-dev-runtime", source: generateJsxDevRuntimeShimSource(), key: "jsxDevRuntime", external: ["react"] },
  ];

  // 병렬 빌드
  const buildPromises = shims.map(async (shim) => {
    const srcPath = path.join(outDir, `${shim.name}.src.js`);
    const outputName = `${shim.name}.js`;

    try {
      await Bun.write(srcPath, shim.source);

      const result = await Bun.build({
        entrypoints: [srcPath],
        outdir: outDir,
        naming: outputName,
        minify: options.minify ?? process.env.NODE_ENV === "production",
        sourcemap: options.sourcemap ? "external" : "none",
        target: "browser",
        external: shim.external,
        define: {
          "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
          ...options.define,
        },
      });

      await fs.unlink(srcPath).catch(() => {});

      if (!result.success) {
        return { key: shim.key, path: "", error: result.logs.map((l) => l.message).join(", ") };
      }

      return { key: shim.key, path: `/.mandu/client/${outputName}`, error: null };
    } catch (error) {
      await fs.unlink(srcPath).catch(() => {});
      return { key: shim.key, path: "", error: String(error) };
    }
  });

  const results = await Promise.all(buildPromises);

  // 결과 집계
  const errors: string[] = [];
  const paths: Record<string, string> = {};

  for (const result of results) {
    if (result.error) {
      errors.push(`[${result.key}] ${result.error}`);
    } else {
      paths[result.key] = result.path;
    }
  }

  return {
    success: errors.length === 0,
    react: paths.react || "",
    reactDom: paths.reactDom || "",
    reactDomClient: paths.reactDomClient || "",
    jsxRuntime: paths.jsxRuntime || "",
    jsxDevRuntime: paths.jsxDevRuntime || "",
    errors,
  };
}
```

---

### 3.3 FSScanner 최적화: O(n²) → O(n)

#### 현재 상태

```typescript
// packages/core/src/router/fs-scanner.ts:189-278 (현재)
private createRouteConfigs(files: ScannedFile[], rootDir: string) {
  // 매번 Map 생성
  const layoutMap = this.buildLayoutMap(files);      // O(n)
  const loadingMap = this.buildSpecialFileMap(files, "loading");  // O(n)
  const errorMap = this.buildSpecialFileMap(files, "error");      // O(n)
  const islandMap = this.buildIslandMap(files);      // O(n)

  for (const file of files) {  // O(n)
    // ... 각 파일마다 map 조회
    const layoutChain = this.resolveLayoutChain(file.segments, layoutMap);
    const loadingModule = this.findClosestSpecialFile(file.segments, loadingMap);
    const errorModule = this.findClosestSpecialFile(file.segments, errorMap);
  }
}
```

**문제점:**
- 각 Map 생성이 O(n)
- 전체 복잡도 O(n) × 4 + O(n) = O(5n) ≈ O(n) (상수 계수 높음)
- `findClosestSpecialFile`이 각 파일마다 조상 경로 탐색

#### 개선 제안: 단일 패스 처리

```typescript
// packages/core/src/router/fs-scanner.ts (개선)
private createRouteConfigs(files: ScannedFile[], rootDir: string) {
  // 단일 패스로 모든 맵 구축
  const { layoutMap, loadingMap, errorMap, islandMap, pageFiles, routeFiles } = 
    this.categorizeFiles(files);

  const routes: FSRouteConfig[] = [];
  const routeErrors: ScanError[] = [];
  const patternMap = new Map<string, FSRouteConfig>();

  // 페이지/API 파일만 순회
  for (const file of [...pageFiles, ...routeFiles]) {
    // ... 라우트 생성
  }

  return { routes, routeErrors };
}

/**
 * 단일 패스로 파일 분류
 */
private categorizeFiles(files: ScannedFile[]): {
  layoutMap: Map<string, ScannedFile>;
  loadingMap: Map<string, ScannedFile>;
  errorMap: Map<string, ScannedFile>;
  islandMap: Map<string, ScannedFile[]>;
  pageFiles: ScannedFile[];
  routeFiles: ScannedFile[];
} {
  const layoutMap = new Map<string, ScannedFile>();
  const loadingMap = new Map<string, ScannedFile>();
  const errorMap = new Map<string, ScannedFile>();
  const islandMap = new Map<string, ScannedFile[]>();
  const pageFiles: ScannedFile[] = [];
  const routeFiles: ScannedFile[] = [];

  // 단일 순회
  for (const file of files) {
    const dirPath = this.getDirPath(file.relativePath);

    switch (file.type) {
      case "layout":
        layoutMap.set(dirPath, file);
        break;
      case "loading":
        loadingMap.set(dirPath, file);
        break;
      case "error":
        errorMap.set(dirPath, file);
        break;
      case "island":
        const existing = islandMap.get(dirPath) || [];
        existing.push(file);
        islandMap.set(dirPath, existing);
        break;
      case "page":
        pageFiles.push(file);
        break;
      case "route":
        routeFiles.push(file);
        break;
    }
  }

  return { layoutMap, loadingMap, errorMap, islandMap, pageFiles, routeFiles };
}
```

---

### 3.4 LRU 캐시 적용

#### 현재 상태

```typescript
// packages/core/src/client/router.ts:120 (현재)
const patternCache = new Map<string, CompiledPattern>();
```

**문제점:**
- 무제한 캐시 증가
- 대규모 앱에서 메모리 누수 가능
- `prefetchedUrls`도 무제한 Set으로 누적

#### 개선 제안

**신규 파일: `packages/core/src/utils/lru-cache.ts`**

```typescript
/**
 * 간단한 LRU (Least Recently Used) 캐시 구현
 */
export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private readonly maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 최근 접근으로 이동 (삭제 후 재삽입)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // 이미 존재하면 삭제 (순서 갱신용)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 가장 오래된 항목 제거 (Map의 첫 번째 항목)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  /** 캐시 적중률 계산용 통계 */
  private _hits = 0;
  private _misses = 0;

  getWithStats(key: K): V | undefined {
    const value = this.get(key);
    if (value !== undefined) {
      this._hits++;
    } else {
      this._misses++;
    }
    return value;
  }

  getStats(): { hits: number; misses: number; hitRate: number } {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      hitRate: total > 0 ? this._hits / total : 0,
    };
  }

  resetStats(): void {
    this._hits = 0;
    this._misses = 0;
  }
}
```

**적용: `packages/core/src/client/router.ts`**

```typescript
import { LRUCache } from "../utils/lru-cache";

const PATTERN_CACHE_SIZE = 200;
const patternCache = new LRUCache<string, CompiledPattern>(PATTERN_CACHE_SIZE);

function compilePattern(pattern: string): CompiledPattern {
  const cached = patternCache.get(pattern);
  if (cached) return cached;

  // ... 컴파일 로직 ...

  patternCache.set(pattern, compiled);
  return compiled;
}
```

**추가 개선: Prefetch URL 캐시 상한 적용**

```typescript
const PREFETCH_CACHE_SIZE = 500;
const prefetchedUrls = new LRUCache<string, true>(PREFETCH_CACHE_SIZE);

export async function prefetch(url: string): Promise<void> {
  if (prefetchedUrls.has(url)) return;

  try {
    const dataUrl = `${url}${url.includes("?") ? "&" : "?"}_data=1`;
    await fetch(dataUrl, { priority: "low" } as RequestInit);
    prefetchedUrls.set(url, true);
  } catch {
    // Prefetch 실패는 무시
  }
}
```

---

### 3.5 Guard Watcher: glob 모듈 캐싱

#### 현재 상태

```typescript
// packages/core/src/guard/watcher.ts:169-170 (현재)
async function scanAll(): Promise<ViolationReport> {
  const { glob } = await import("glob");  // 매번 동적 import
  // ...
}
```

**문제점:**
- `scanAll()` 호출마다 동적 import 실행
- 불필요한 오버헤드

#### 개선 제안

```typescript
// packages/core/src/guard/watcher.ts (개선)

// 모듈 레벨 캐싱
let globModule: typeof import("glob") | null = null;

async function getGlobModule() {
  if (!globModule) {
    globModule = await import("glob");
  }
  return globModule;
}

async function scanAll(): Promise<ViolationReport> {
  const { glob } = await getGlobModule();
  // ...
}
```

---

## 4. 코드 품질 향상

### 4.1 상수 관리 통합

#### 현재 상태: 매직 넘버 분산

| 위치 | 값 | 용도 |
|------|-----|------|
| `filling.ts:85` | `5000` | Loader 타임아웃 |
| `dev.ts:329` | `port + 1` | HMR 포트 오프셋 |
| `client.ts:179` | `30000` | API 클라이언트 타임아웃 |
| `watcher.ts:91` | `100` | 디바운스 딜레이 |
| `build.ts:317` | `"visible"` | 기본 hydration priority |

#### 개선 제안

**신규 파일: `packages/core/src/constants.ts`**

```typescript
/**
 * Mandu 프레임워크 전역 상수
 * 매직 넘버/문자열을 중앙 집중 관리
 */

// ============================================
// Timeouts (milliseconds)
// ============================================

export const TIMEOUTS = {
  /** SSR Loader 기본 타임아웃 */
  LOADER_DEFAULT: 5000,
  /** API 클라이언트 기본 타임아웃 */
  CLIENT_DEFAULT: 30000,
  /** Guard 워처 디바운스 */
  WATCHER_DEBOUNCE: 100,
  /** HMR 재연결 대기 */
  HMR_RECONNECT_DELAY: 1000,
  /** HMR 최대 재연결 시도 */
  HMR_MAX_RECONNECT: 10,
  /** 파일 워처 디바운스 */
  FILE_WATCHER_DEBOUNCE: 100,
} as const;

// ============================================
// Ports
// ============================================

export const PORTS = {
  /** 개발 서버 기본 포트 */
  DEV_SERVER: 3000,
  /** CLI 기본 포트 */
  CLI_DEFAULT: 3333,
  /** HMR 오프셋 (dev port + offset) */
  HMR_OFFSET: 1,
  /** OpenAPI 서버 기본 포트 */
  OPENAPI_SERVER: 8080,
} as const;

// ============================================
// Limits
// ============================================

export const LIMITS = {
  /** 패턴 캐시 최대 크기 */
  PATTERN_CACHE_SIZE: 200,
  /** 레이아웃 프리로드 동시성 */
  LAYOUT_PRELOAD_CONCURRENCY: 5,
  /** 최대 레이아웃 중첩 깊이 */
  MAX_LAYOUT_DEPTH: 10,
  /** 번들 청크 최대 크기 (bytes) */
  BUNDLE_CHUNK_SIZE_LIMIT: 500 * 1024,
} as const;

// ============================================
// File Extensions
// ============================================

export const FILE_EXTENSIONS = {
  /** Guard 분석 대상 */
  WATCH: [".ts", ".tsx", ".js", ".jsx"],
  /** 클라이언트 번들 대상 */
  CLIENT: [".client.ts", ".client.tsx"],
  /** 라우트 파일 */
  ROUTE: [".ts", ".tsx", ".js", ".jsx"],
  /** 스타일 파일 */
  STYLE: [".css", ".scss", ".sass", ".less"],
} as const;

// ============================================
// Hydration
// ============================================

export const HYDRATION = {
  /** 기본 hydration 전략 */
  DEFAULT_STRATEGY: "island" as const,
  /** 기본 hydration 우선순위 */
  DEFAULT_PRIORITY: "visible" as const,
  /** 지원되는 우선순위 */
  PRIORITIES: ["immediate", "visible", "idle", "interaction"] as const,
} as const;

// ============================================
// MIME Types
// ============================================

export const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".ts": "application/typescript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".wasm": "application/wasm",
} as const;

// ============================================
// Cache Keys
// ============================================

export const CACHE_KEYS = {
  /** 라우트 매니페스트 */
  ROUTES_MANIFEST: "mandu:routes",
  /** 번들 매니페스트 */
  BUNDLE_MANIFEST: "mandu:bundles",
  /** Guard 분석 결과 */
  GUARD_ANALYSIS: "mandu:guard",
} as const;
```

---

### 4.2 테스트 커버리지 확대

#### 현재 테스트 현황

| 모듈 | 테스트 파일 | 상태 |
|------|------------|------|
| contract/ | 7개 | ✅ 양호 |
| guard/ | 2개 | ⚠️ 부족 |
| runtime/ | 2개 (logger, router) | ⚠️ 부족 |
| client/ | 0개 | ❌ 없음 |
| bundler/ | 0개 | ❌ 없음 |

#### 개선 제안: 핵심 모듈 테스트 추가

**신규 파일: `packages/core/src/runtime/compose.test.ts`**

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { compose, createMiddleware, MiddlewareChain } from "./compose";
import { ManduContext } from "../filling/context";

describe("compose", () => {
  function createMockContext(url = "http://localhost:3000/test"): ManduContext {
    return new ManduContext(new Request(url), {});
  }

  test("executes middleware in order (onion model)", async () => {
    const order: number[] = [];
    
    const middleware = createMiddleware([
      async (ctx, next) => { 
        order.push(1); 
        await next(); 
        order.push(4); 
      },
      async (ctx, next) => { 
        order.push(2); 
        await next(); 
        order.push(3); 
      },
      async (ctx) => ctx.json({ ok: true }),
    ]);

    const handler = compose(middleware);
    await handler(createMockContext());

    expect(order).toEqual([1, 2, 3, 4]);
  });

  test("stops chain when middleware returns Response", async () => {
    const afterCalled = mock(() => {});

    const middleware = createMiddleware([
      async (ctx) => ctx.json({ early: true }),
      async (ctx, next) => { 
        afterCalled(); 
        await next(); 
      },
    ]);

    const handler = compose(middleware);
    const response = await handler(createMockContext());
    const data = await response.json();

    expect(data).toEqual({ early: true });
    expect(afterCalled).not.toHaveBeenCalled();
  });

  test("throws on multiple next() calls", async () => {
    const middleware = createMiddleware([
      async (ctx, next) => {
        await next();
        await next();
      },
    ]);

    const handler = compose(middleware);
    
    await expect(handler(createMockContext())).rejects.toThrow(
      "next() called multiple times"
    );
  });

  test("calls onError handler on exception", async () => {
    const testError = new Error("Test error");
    
    const middleware = createMiddleware([
      async () => { throw testError; },
    ]);

    const handler = compose(middleware, {
      onError: (err, ctx) => ctx.json({ error: err.message }, 500),
    });

    const response = await handler(createMockContext());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: "Test error" });
  });

  test("calls onNotFound when no response", async () => {
    const middleware = createMiddleware([
      async (ctx, next) => { await next(); },
    ]);

    const handler = compose(middleware, {
      onNotFound: (ctx) => ctx.json({ error: "Not found" }, 404),
    });

    const response = await handler(createMockContext());
    expect(response.status).toBe(404);
  });
});

describe("MiddlewareChain", () => {
  test("builds chain with fluent API", async () => {
    const logs: string[] = [];

    const chain = new MiddlewareChain()
      .use(async (ctx, next) => { 
        logs.push("before"); 
        await next(); 
        logs.push("after"); 
      })
      .use(async (ctx) => {
        logs.push("handler");
        return ctx.json({ ok: true });
      })
      .onError((err, ctx) => ctx.json({ error: err.message }, 500))
      .build();

    const ctx = new ManduContext(new Request("http://localhost/"), {});
    const response = await chain(ctx);

    expect(response.status).toBe(200);
    expect(logs).toEqual(["before", "handler", "after"]);
  });

  test("getMiddleware returns copy of middleware list", () => {
    const chain = new MiddlewareChain()
      .use(async (ctx) => ctx.json({}), "handler1")
      .use(async (ctx) => ctx.json({}), "handler2");

    const middleware = chain.getMiddleware();
    
    expect(middleware).toHaveLength(2);
    expect(middleware[0].name).toBe("handler1");
    expect(middleware[1].name).toBe("handler2");
  });
});
```

**신규 파일: `packages/core/src/runtime/lifecycle.test.ts`**

```typescript
import { describe, test, expect, mock } from "bun:test";
import {
  createLifecycleStore,
  executeLifecycle,
  LifecycleBuilder,
  deduplicateHooks,
} from "./lifecycle";
import { ManduContext } from "../filling/context";

describe("executeLifecycle", () => {
  function createMockContext(): ManduContext {
    return new ManduContext(new Request("http://localhost:3000/test"), {});
  }

  test("executes hooks in correct order", async () => {
    const order: string[] = [];

    const lifecycle = createLifecycleStore();
    lifecycle.onRequest.push({ 
      fn: async () => { order.push("onRequest"); }, 
      scope: "local" 
    });
    lifecycle.beforeHandle.push({ 
      fn: async () => { order.push("beforeHandle"); }, 
      scope: "local" 
    });
    lifecycle.afterHandle.push({ 
      fn: async (ctx, res) => { order.push("afterHandle"); return res; }, 
      scope: "local" 
    });
    lifecycle.afterResponse.push({ 
      fn: async () => { order.push("afterResponse"); }, 
      scope: "local" 
    });

    const ctx = createMockContext();
    await executeLifecycle(
      lifecycle,
      ctx,
      async () => {
        order.push("handler");
        return ctx.json({ ok: true });
      }
    );

    // afterResponse는 queueMicrotask로 실행되므로 약간 대기
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(order).toEqual([
      "onRequest",
      "beforeHandle",
      "handler",
      "afterHandle",
      "afterResponse",
    ]);
  });

  test("beforeHandle can short-circuit with Response", async () => {
    const lifecycle = createLifecycleStore();
    const handlerCalled = mock(() => {});

    lifecycle.beforeHandle.push({
      fn: async (ctx) => ctx.json({ blocked: true }, 403),
      scope: "local",
    });

    const ctx = createMockContext();
    const response = await executeLifecycle(
      lifecycle,
      ctx,
      async () => {
        handlerCalled();
        return ctx.json({ ok: true });
      }
    );

    expect(response.status).toBe(403);
    expect(handlerCalled).not.toHaveBeenCalled();
  });

  test("onError handles exceptions", async () => {
    const lifecycle = createLifecycleStore();
    const testError = new Error("Test error");

    lifecycle.onError.push({
      fn: async (ctx, error) => ctx.json({ error: error.message }, 500),
      scope: "local",
    });

    const ctx = createMockContext();
    const response = await executeLifecycle(
      lifecycle,
      ctx,
      async () => { throw testError; }
    );

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Test error");
  });
});

describe("LifecycleBuilder", () => {
  test("builds lifecycle with fluent API", () => {
    const lifecycle = new LifecycleBuilder()
      .onRequest(async () => {})
      .beforeHandle(async () => {})
      .afterHandle(async (ctx, res) => res)
      .onError(async () => {})
      .build();

    expect(lifecycle.onRequest).toHaveLength(1);
    expect(lifecycle.beforeHandle).toHaveLength(1);
    expect(lifecycle.afterHandle).toHaveLength(1);
    expect(lifecycle.onError).toHaveLength(1);
  });

  test("merge combines two lifecycles", () => {
    const lifecycle1 = new LifecycleBuilder()
      .onRequest(async () => {})
      .build();

    const lifecycle2 = new LifecycleBuilder()
      .onRequest(async () => {})
      .beforeHandle(async () => {})
      .merge(lifecycle1)
      .build();

    expect(lifecycle2.onRequest).toHaveLength(2);
    expect(lifecycle2.beforeHandle).toHaveLength(1);
  });
});

describe("deduplicateHooks", () => {
  test("removes duplicate hooks by checksum", () => {
    const hooks = [
      { fn: async () => {}, scope: "local" as const, checksum: 123 },
      { fn: async () => {}, scope: "local" as const, checksum: 456 },
      { fn: async () => {}, scope: "local" as const, checksum: 123 },
    ];

    const deduped = deduplicateHooks(hooks);
    expect(deduped).toHaveLength(2);
  });

  test("keeps hooks without checksum", () => {
    const hooks = [
      { fn: async () => {}, scope: "local" as const },
      { fn: async () => {}, scope: "local" as const },
    ];

    const deduped = deduplicateHooks(hooks);
    expect(deduped).toHaveLength(2);
  });
});
```

---

## 5. 개발자 경험 (DX) 개선

### 5.1 CLI 에러 메시지 개선

#### 현재 상태

```bash
# 현재 CLI 에러 출력
Error: Port 3000 is already in use
```

**문제점:**
- 에러 코드 없음
- 해결 방법 안내 없음
- 문서 링크 없음

#### 개선 제안

**신규 파일: `packages/cli/src/errors/codes.ts`**

```typescript
/**
 * CLI 에러 코드 정의
 */
export const CLI_ERROR_CODES = {
  // Init 에러 (E001-E009)
  INIT_DIR_EXISTS: "CLI_E001",
  INIT_BUN_NOT_FOUND: "CLI_E002",
  INIT_TEMPLATE_NOT_FOUND: "CLI_E003",

  // Dev 에러 (E010-E019)
  DEV_PORT_IN_USE: "CLI_E010",
  DEV_MANIFEST_NOT_FOUND: "CLI_E011",
  DEV_APP_DIR_NOT_FOUND: "CLI_E012",

  // Guard 에러 (E020-E029)
  GUARD_CONFIG_INVALID: "CLI_E020",
  GUARD_PRESET_NOT_FOUND: "CLI_E021",
  GUARD_VIOLATION_FOUND: "CLI_E022",

  // Build 에러 (E030-E039)
  BUILD_ENTRY_NOT_FOUND: "CLI_E030",
  BUILD_BUNDLE_FAILED: "CLI_E031",
  BUILD_OUTDIR_NOT_WRITABLE: "CLI_E032",

  // Config 에러 (E040-E049)
  CONFIG_PARSE_FAILED: "CLI_E040",
  CONFIG_VALIDATION_FAILED: "CLI_E041",
} as const;

export type CLIErrorCode = typeof CLI_ERROR_CODES[keyof typeof CLI_ERROR_CODES];
```

**신규 파일: `packages/cli/src/errors/messages.ts`**

```typescript
import { CLI_ERROR_CODES, type CLIErrorCode } from "./codes";

interface ErrorInfo {
  message: string;
  suggestion: string;
  docLink?: string;
}

export const ERROR_MESSAGES: Record<CLIErrorCode, ErrorInfo> = {
  [CLI_ERROR_CODES.INIT_DIR_EXISTS]: {
    message: "Directory '{name}' already exists",
    suggestion: "Use a different project name or delete the existing directory",
    docLink: "https://mandu.dev/docs/cli/init",
  },

  [CLI_ERROR_CODES.INIT_BUN_NOT_FOUND]: {
    message: "Bun runtime not found",
    suggestion: "Install Bun from https://bun.sh and ensure it's in your PATH",
    docLink: "https://mandu.dev/docs/getting-started",
  },

  [CLI_ERROR_CODES.DEV_PORT_IN_USE]: {
    message: "Port {port} is already in use",
    suggestion: "Use --port option to specify a different port, or stop the process using port {port}",
    docLink: "https://mandu.dev/docs/cli/dev",
  },

  [CLI_ERROR_CODES.DEV_APP_DIR_NOT_FOUND]: {
    message: "app/ directory not found",
    suggestion: "Create an app/ directory with page.tsx files, or use --legacy flag for spec-based routing",
    docLink: "https://mandu.dev/docs/routing",
  },

  [CLI_ERROR_CODES.GUARD_PRESET_NOT_FOUND]: {
    message: "Unknown architecture preset: '{preset}'",
    suggestion: "Available presets: mandu, fsd, clean, hexagonal, atomic. Use --list-presets to see details",
    docLink: "https://mandu.dev/docs/guard",
  },

  [CLI_ERROR_CODES.GUARD_VIOLATION_FOUND]: {
    message: "{count} architecture violation(s) found",
    suggestion: "Fix the violations above before continuing. Use --guard-format=agent for AI-friendly output",
    docLink: "https://mandu.dev/docs/guard/violations",
  },

  [CLI_ERROR_CODES.BUILD_BUNDLE_FAILED]: {
    message: "Bundle build failed for '{routeId}'",
    suggestion: "Check the error details above. Common issues: missing dependencies, syntax errors",
    docLink: "https://mandu.dev/docs/build",
  },

  [CLI_ERROR_CODES.CONFIG_VALIDATION_FAILED]: {
    message: "Invalid configuration in mandu.config.ts",
    suggestion: "Check the validation errors above. See documentation for valid config options",
    docLink: "https://mandu.dev/docs/config",
  },
  
  // ... 기타 에러
};

/**
 * CLI 에러 포맷팅
 */
export function formatCLIError(
  code: CLIErrorCode, 
  context?: Record<string, string | number>
): string {
  const info = ERROR_MESSAGES[code];
  if (!info) {
    return `Unknown error: ${code}`;
  }

  let message = info.message;
  let suggestion = info.suggestion;

  // 컨텍스트 변수 치환
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      message = message.replace(`{${key}}`, String(value));
      suggestion = suggestion.replace(`{${key}}`, String(value));
    }
  }

  const lines = [
    ``,
    `❌ Error [${code}]`,
    `   ${message}`,
    ``,
    `💡 ${suggestion}`,
  ];

  if (info.docLink) {
    lines.push(`📖 ${info.docLink}`);
  }

  lines.push(``);

  return lines.join("\n");
}

/**
 * CLIError 클래스
 */
export class CLIError extends Error {
  readonly code: CLIErrorCode;
  readonly context?: Record<string, string | number>;

  constructor(code: CLIErrorCode, context?: Record<string, string | number>) {
    super(formatCLIError(code, context));
    this.code = code;
    this.context = context;
    this.name = "CLIError";
  }
}

/**
 * CLI 에러 핸들러
 */
export function handleCLIError(error: unknown): never {
  if (error instanceof CLIError) {
    console.error(error.message);
    process.exit(1);
  }

  if (error instanceof Error) {
    console.error(`\n❌ Unexpected error: ${error.message}\n`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }

  console.error(`\n❌ Unknown error occurred\n`);
  process.exit(1);
}
```

**적용 예시: `packages/cli/src/commands/dev.ts`**

```typescript
import { CLIError, CLI_ERROR_CODES, handleCLIError } from "../errors";

export async function dev(options: DevOptions = {}): Promise<void> {
  try {
    const port = options.port || Number(process.env.PORT) || 3333;

    // 포트 사용 중 체크
    const isPortInUse = await checkPort(port);
    if (isPortInUse) {
      throw new CLIError(CLI_ERROR_CODES.DEV_PORT_IN_USE, { port });
    }

    // app 디렉토리 체크
    const appDir = path.resolve(rootDir, "app");
    if (!await isDirectory(appDir)) {
      throw new CLIError(CLI_ERROR_CODES.DEV_APP_DIR_NOT_FOUND);
    }

    // ... 나머지 로직
  } catch (error) {
    handleCLIError(error);
  }
}
```

---

### 5.2 설정 검증 시스템

#### 개선 제안

**신규 파일: `packages/core/src/config/validate.ts`**

```typescript
import { z, ZodError } from "zod";
import path from "path";
import fs from "fs/promises";
import { pathToFileURL } from "url";
import { CONFIG_FILES, coerceConfig } from "./mandu"; // export 필요

/**
 * Mandu 설정 스키마
 */
export const ManduConfigSchema = z.object({
  server: z.object({
    port: z.number().min(1).max(65535).default(3000),
    hostname: z.string().default("localhost"),
    cors: z.union([
      z.boolean(),
      z.object({
        origin: z.union([z.string(), z.array(z.string())]).optional(),
        methods: z.array(z.string()).optional(),
        credentials: z.boolean().optional(),
      }),
    ]).default(false),
    streaming: z.boolean().default(false),
  }).default({}),

  guard: z.object({
    preset: z.enum(["mandu", "fsd", "clean", "hexagonal", "atomic"]).default("mandu"),
    srcDir: z.string().default("src"),
    exclude: z.array(z.string()).default([]),
    realtime: z.boolean().default(true),
    rules: z.record(z.enum(["error", "warn", "warning", "off"])).optional(),
  }).default({}),

  build: z.object({
    outDir: z.string().default(".mandu"),
    minify: z.boolean().default(true),
    sourcemap: z.boolean().default(false),
    splitting: z.boolean().default(false),
  }).default({}),

  dev: z.object({
    hmr: z.boolean().default(true),
    watchDirs: z.array(z.string()).default([]),
  }).default({}),

  seo: z.object({
    enabled: z.boolean().default(true),
    defaultTitle: z.string().optional(),
    titleTemplate: z.string().optional(),
  }).default({}),
}).passthrough(); // 향후 확장 여지 확보 (strict 사용 시 새 키 즉시 에러)

export type ManduConfig = z.infer<typeof ManduConfigSchema>;

/**
 * 검증 결과
 */
export interface ValidationResult {
  valid: boolean;
  config?: ManduConfig;
  errors?: Array<{
    path: string;
    message: string;
  }>;
  source?: string;
}

/**
 * 설정 파일 검증
 */
export async function validateConfig(rootDir: string): Promise<ValidationResult> {
  for (const fileName of CONFIG_FILES) {
    const filePath = path.join(rootDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      continue;
    }

    try {
      let raw: unknown;
      if (fileName.endsWith(".json")) {
        raw = JSON.parse(await Bun.file(filePath).text());
      } else {
        const module = await import(pathToFileURL(filePath).href);
        raw = module?.default ?? module;
      }

      const config = ManduConfigSchema.parse(coerceConfig(raw ?? {}, fileName));
      return { valid: true, config, source: fileName };
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        }));
        return { valid: false, errors, source: fileName };
      }

      return {
        valid: false,
        errors: [{
          path: "",
          message: `Failed to load config: ${error instanceof Error ? error.message : String(error)}`,
        }],
        source: fileName,
      };
    }
  }

  // 설정 파일 없음 - 기본값 사용
  return { valid: true, config: ManduConfigSchema.parse({}) };
}

/**
 * CLI용 검증 및 리포트
 */
export async function validateAndReport(rootDir: string): Promise<ManduConfig | null> {
  const result = await validateConfig(rootDir);

  if (!result.valid) {
    console.error(`\n❌ Invalid config${result.source ? ` (${result.source})` : ""}:\n`);
    for (const error of result.errors || []) {
      const location = error.path ? `  ${error.path}: ` : "  ";
      console.error(`${location}${error.message}`);
    }
    console.error("");
    return null;
  }

  return result.config!;
}
```

**보완 제안**
- 현재 `loadManduConfig()`는 `guard`만 소비하므로 `server/dev/build/seo`를 사용하려면 해당 모듈에서 설정을 읽도록 연결 필요
- `CONFIG_FILES`, `coerceConfig`를 재사용하려면 `mandu.ts`에서 export 추가

---

## 6. 보안 강화

### 6.1 Path Traversal 추가 검증

#### 현재 상태

```typescript
// packages/core/src/runtime/server.ts:507-513 (현재)
function isPathSafe(filePath: string, allowedDir: string): boolean {
  const resolvedPath = path.resolve(filePath);
  const resolvedAllowedDir = path.resolve(allowedDir);
  return resolvedPath.startsWith(resolvedAllowedDir + path.sep) ||
         resolvedPath === resolvedAllowedDir;
}
```

**문제점:**
- symlink를 통한 우회 가능
- `path.resolve`만으로는 실제 파일 경로 확인 불가
- URL 디코딩/선행 `/` 처리 미흡 시 베이스 디렉토리 우회 가능
- `publicDir` 옵션이 `/public/` 경로에 일관되게 적용되지 않음

#### 개선 제안

```typescript
// packages/core/src/runtime/server.ts (개선)
import fs from "fs/promises";

/**
 * 경로 안전성 검증 (symlink 해결 포함)
 */
async function isPathSafe(filePath: string, allowedDir: string): Promise<boolean> {
  try {
    // 1단계: 기본 경로 검증
    const resolvedPath = path.resolve(filePath);
    const resolvedAllowedDir = path.resolve(allowedDir);

    if (!resolvedPath.startsWith(resolvedAllowedDir + path.sep) &&
        resolvedPath !== resolvedAllowedDir) {
      return false;
    }

    // 2단계: 파일 존재 여부 확인
    try {
      await fs.access(resolvedPath);
    } catch {
      // 파일이 없으면 안전 (존재하지 않는 경로)
      return true;
    }

    // 3단계: Symlink 해결 후 재검증
    const realPath = await fs.realpath(resolvedPath);
    const realAllowedDir = await fs.realpath(resolvedAllowedDir);

    return realPath.startsWith(realAllowedDir + path.sep) ||
           realPath === realAllowedDir;
  } catch (error) {
    // 에러 발생 시 안전하지 않음으로 처리
    console.warn(`[Security] Path validation failed: ${filePath}`, error);
    return false;
  }
}

/**
 * 정적 파일 서빙 (보안 강화)
 */
async function serveStaticFile(
  pathname: string,
  settings: ServerRegistrySettings
): Promise<Response | null> {
  // allowedBaseDir / relativePath는 prefix 분기에서 결정
  // (예: /public/* -> settings.publicDir 사용)

  // URL 디코딩 (실패 시 차단)
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch {
    return null;
  }

  // 정규화 + Null byte 방지
  const normalizedPath = path.posix.normalize(decodedPath);
  if (normalizedPath.includes("\0")) {
    console.warn(`[Security] Null byte attack detected: ${pathname}`);
    return null;
  }

  // 선행 슬래시 제거 → path.join이 base를 무시하지 않도록 보장
  const safeRelativePath = normalizedPath.replace(/^\/+/, "");

  // 상대 경로 탈출 차단
  if (safeRelativePath.startsWith("..")) {
    return null;
  }

  const filePath = path.join(allowedBaseDir, safeRelativePath);

  // 경로 검증 (비동기)
  if (!(await isPathSafe(filePath, allowedBaseDir))) {
    console.warn(`[Security] Path traversal attempt blocked: ${pathname}`);
    return null;
  }

  // ... 파일 서빙 로직
}
```

---

### 6.2 CORS 프로덕션 경고

#### 개선 제안

```typescript
// packages/core/src/runtime/server.ts (개선)
export function startServer(manifest: RoutesManifest, options: ServerOptions = {}): ManduServer {
  const { cors, port = 3000 } = options;
  const isDev = process.env.NODE_ENV !== "production";

  // CORS 보안 경고
  if (cors === true && !isDev) {
    console.warn("⚠️  [Security Warning] CORS is set to allow all origins");
    console.warn("   This is not recommended for production environments.");
    console.warn("   Consider specifying allowed origins explicitly:");
    console.warn("   cors: { origin: ['https://yourdomain.com'] }");
    console.warn("");
  }

  // ... 나머지 서버 시작 로직
}
```

---

## 7. 파일 변경 요약

### 7.1 신규 생성 파일

| 파일 경로 | 설명 | 우선순위 |
|-----------|------|----------|
| `packages/core/src/error/result.ts` | Result 타입 + errorToResponse/status 매핑 | P1 |
| `packages/core/src/client/globals.ts` | Window 전역 타입 선언 | P0 |
| `packages/core/src/client/window-state.ts` | 타입 안전 전역 상태 접근 | P0 |
| `packages/core/src/runtime/registry/handler-registry.ts` | 핸들러 레지스트리 | P1 |
| `packages/core/src/runtime/registry/component-registry.ts` | 컴포넌트 레지스트리 | P1 |
| `packages/core/src/runtime/registry/index.ts` | 레지스트리 Facade | P1 |
| `packages/core/src/utils/lru-cache.ts` | LRU 캐시 유틸리티 | P1 |
| `packages/core/src/constants.ts` | 중앙 상수 관리 | P0 |
| `packages/core/src/config/validate.ts` | 설정 검증 | P2 |
| `packages/cli/src/errors/codes.ts` | CLI 에러 코드 | P1 |
| `packages/cli/src/errors/messages.ts` | CLI 에러 메시지 | P1 |
| `packages/core/src/runtime/compose.test.ts` | compose 테스트 | P2 |
| `packages/core/src/runtime/lifecycle.test.ts` | lifecycle 테스트 | P2 |

### 7.2 수정 대상 파일

| 파일 경로 | 수정 내용 | 우선순위 |
|-----------|-----------|----------|
| `packages/core/src/guard/check.ts` | 검사 병렬화 | P0 |
| `packages/core/src/bundler/build.ts` | Shim 병렬 빌드 | P1 |
| `packages/core/src/router/fs-scanner.ts` | 단일 패스 최적화 | P1 |
| `packages/core/src/client/router.ts` | LRU 캐시, 전역 상태 분리 | P0 |
| `packages/core/src/client/island.ts` | 전역 상태 접근자 적용 | P0 |
| `packages/core/src/client/runtime.ts` | 전역 타입 이동/접근자 적용 | P0 |
| `packages/core/src/guard/watcher.ts` | glob 모듈 캐싱 | P2 |
| `packages/core/src/runtime/server.ts` | 에러 처리, 보안 강화(publicDir 포함) | P1 |
| `packages/core/src/error/types.ts` | httpStatus 선택적 필드 추가 | P1 |
| `packages/core/src/error/formatter.ts` | 에러 생성 함수에 httpStatus 적용 | P1 |
| `packages/core/src/config/mandu.ts` | CONFIG_FILES/coerceConfig export | P2 |
| `packages/mcp/src/server.ts` | 패키지 경로 import | P1 |
| `packages/mcp/package.json` | 의존성 업데이트 | P1 |
| `packages/cli/src/commands/dev.ts` | 에러 시스템 연동 | P1 |

---

## 8. 구현 우선순위

### P0: 즉시 적용 권장

1. **Guard 검사 병렬화** - `check.ts` 수정으로 검사 시간 2-3배 단축
2. **전역 타입 선언 정리** - `globals.ts` 추가로 타입 안전성 확보 (또는 tsconfig include 수정)
3. **상수 관리 통합** - `constants.ts`로 매직 넘버 제거

### P1: 단기 (1-2주)

4. ServerRegistry 책임 분리
5. MCP 패키지 의존성 정리
6. CLI 에러 메시지 개선
7. Bundler Shim 병렬 빌드
8. LRU 캐시 적용

### P2: 중기 (2-4주)

9. Result<T> + status 매핑 (기존 error 모듈 확장)
10. FSScanner O(n) 최적화
11. 테스트 커버리지 확대
12. 설정 검증 시스템

### P3: 장기 (로드맵 연계)

13. 증분 빌드 시스템 (의존성 그래프 기반)
14. 레이아웃 프리로딩
15. JSDoc 일관성 작업

---

## 9. 검증 기준 (DoD)

| 개선 항목 | 검증 방법 |
|-----------|-----------|
| Guard 병렬화 | 검사 시간 측정 (2배 이상 개선 확인) |
| 전역 타입 | TypeScript 컴파일 에러 없음, `(window as any)` 패턴 제거, globals 파일 포함 확인 |
| 상수 관리 | 매직 넘버 grep 결과 0건 |
| Registry 분리 | 기존 테스트 통과, 멀티 인스턴스 테스트 |
| CLI 에러 | 에러 코드 + 해결 가이드 출력 확인 |
| 보안 강화 | symlink + 인코딩 경로 + 절대경로 우회 차단, `publicDir` 적용 확인 |
| 테스트 | 신규 테스트 파일 전체 통과 |

---

## 10. 관련 문서

- `docs/plans/06_mandu_dna_master_plan.md` - DNA 통합 계획
- `docs/architecture/02_mandu_technical_architecture.md` - 기술 아키텍처
- `docs/specs/06_mandu_guard.md` - Guard 시스템 스펙
- `docs/api/api-reference.md` - API 레퍼런스

---

## 부록 A: Brain 시스템 개선 제안

### 현재 상태

```typescript
// packages/core/src/brain/brain.ts (현재)
export class Brain {
  private static instance: Brain | null = null;
  private _initialized: boolean = false;

  static getInstance(options?: BrainInitOptions): Brain {
    if (!Brain.instance) {
      Brain.instance = new Brain(options);
    }
    return Brain.instance;
  }

  async initialize(): Promise<boolean> {
    // 비동기 초기화
  }
}
```

### 문제점

- `getInstance()` 호출 후 `initialize()` 전에 `enabled` 접근 시 항상 `false`
- Singleton + async 초기화 패턴의 레이스 컨디션 가능성

### 개선 제안

```typescript
// packages/core/src/brain/brain.ts (개선)
export class Brain {
  private static instance: Brain | null = null;
  private static initPromise: Promise<Brain> | null = null;

  /**
   * 초기화된 Brain 인스턴스 획득 (권장)
   */
  static async getInitializedInstance(options?: BrainInitOptions): Promise<Brain> {
    if (Brain.initPromise) {
      return Brain.initPromise;
    }

    Brain.initPromise = (async () => {
      const brain = Brain.getInstance(options);
      await brain.initialize();
      return brain;
    })();

    return Brain.initPromise;
  }

  /**
   * 동기 인스턴스 획득 (초기화 여부 확인 필요)
   * @deprecated getInitializedInstance() 사용 권장
   */
  static getInstance(options?: BrainInitOptions): Brain {
    if (!Brain.instance) {
      Brain.instance = new Brain(options);
    }
    return Brain.instance;
  }
}
```

---

## 부록 B: 의존성 그래프 기반 증분 빌드 (장기)

### 설계 개요

```typescript
// packages/core/src/bundler/dependency-graph.ts (장기 계획)

export interface DependencyGraph {
  /** 파일 → 해당 파일을 import하는 파일들 */
  dependents: Map<string, Set<string>>;
  /** 파일 → 해당 파일이 import하는 파일들 */
  dependencies: Map<string, Set<string>>;
}

/**
 * 의존성 그래프 구축
 */
export async function buildDependencyGraph(
  entryFiles: string[],
  rootDir: string
): Promise<DependencyGraph>;

/**
 * 변경된 파일에 영향받는 Entry 파일들 찾기
 */
export function findAffectedEntries(
  changedFile: string,
  entryFiles: Set<string>,
  graph: DependencyGraph
): Set<string>;
```

이 기능은 v0.10.x 로드맵의 "Build Hooks" 기능과 연계하여 구현 예정.

---

*문서 끝*
