import type { Server } from "bun";
import type { RoutesManifest, RouteSpec, HydrationConfig, StaticParamSetSchema } from "../spec/schema";
import type { BundleManifest } from "../bundler/types";
import type { ManduFilling, RenderMode } from "../filling/filling";
import { ManduContext, CookieManager } from "../filling/context";
import { Router } from "./router";
import { renderSSR, renderStreamingResponse, resolveAsyncElement } from "./ssr";
import {
  resolveMetadata,
  renderMetadata,
  renderTitle,
  type Metadata,
  type MetadataItem,
  type GenerateMetadata,
} from "../seo";
import { type ErrorFallbackProps } from "./boundary";
import React, { type ReactNode } from "react";
import path from "path";
import fs from "fs/promises";
import { PORTS } from "../constants";
import {
  type CacheStore,
  type CacheStoreStats,
  type CacheLookupResult,
  type CacheConfig,
  MemoryCacheStore,
  lookupCache,
  createCacheEntry,
  createCachedResponse,
  computeCacheControl,
  getCacheStoreStats,
  setGlobalCache,
  setGlobalCacheDefaults,
  getGlobalCacheDefaults,
  createCacheStoreFromConfig,
} from "./cache";
import {
  createNotFoundResponse,
  createHandlerNotFoundResponse,
  createPageLoadErrorResponse,
  createSSRErrorResponse,
  errorToResponse,
  err,
  ok,
  type Result,
} from "../error";
import {
  type CorsOptions,
  isPreflightRequest,
  handlePreflightRequest,
  applyCorsToResponse,
  isCorsRequest,
} from "./cors";
import { validateImportPath } from "./security";
import { KITCHEN_PREFIX, KitchenHandler, recordRequest } from "../kitchen/kitchen-handler";
import { eventBus } from "../observability/event-bus";
import {
  HEAP_ENDPOINT,
  METRICS_ENDPOINT,
  buildMetricsResponse,
  collectHeapSnapshot,
  isObservabilityExposed,
  recordHttpRequest,
} from "../observability/metrics";
import {
  handleOpenAPIRequest,
  isOpenAPIEndpointEnabled,
  resolveOpenAPIEndpointSettings,
} from "./openapi-endpoint";
// Phase 18.ψ — user-facing perf marks dashboard append. We include a
// `perf` block on the `/_mandu/heap` payload when the feature is active
// so operators see a unified view (heap + caches + perf histogram).
// Importing the snapshot collector (rather than the whole module) keeps
// the tree-shake footprint tight when perf is gated off.
import { collectPerfSnapshot } from "../perf/user-marks";
// Phase 18.θ — request tracing. Tracer lifecycle is owned by
// `startServer()`; `runWithSpan` is used at the absolute TOP of the
// request handler so every downstream await (middleware, filling
// loader, SSR render) inherits the active span via AsyncLocalStorage.
import {
  Tracer,
  createTracerFromConfig,
  runWithSpan,
  setTracer,
} from "../observability/tracing";
import {
  type MiddlewareFn,
  type MiddlewareConfig,
  loadMiddlewareSync,
} from "./middleware";
// Phase 18.ε — canonical request-level middleware composition API.
// See `packages/core/src/middleware/{define,compose,bridge}.ts`.
import {
  compose as composeMiddleware,
  type ComposedHandler,
} from "../middleware/compose";
import type { Middleware } from "../middleware/define";
// Phase 18.λ — scheduler wiring (statically imported so `startServer` stays
// synchronous; the cost of unused code is trivial — `defineCron` is a thin
// wrapper around `Bun.cron`).
import { defineCron as schedulerDefineCron } from "../scheduler";
import { setActiveSchedulerRegistration } from "../middleware/scheduler-cron";
import { createFetchHandler } from "./handler";
import { wrapBunWebSocket, type WSUpgradeData } from "../filling/ws";
import { handleImageRequest } from "./image-handler";
import { extractShellHtml, createPPRResponse } from "./ppr";
import { isRedirectResponse } from "./redirect";
import { isNotFoundResponse } from "./not-found";
import { newId } from "../id";
// Phase 18.κ — typed RPC dispatch (tRPC-like). See
// `packages/core/src/contract/rpc.ts` + `docs/architect/typed-rpc.md`.
import {
  matchRpcPath,
  dispatchRpc,
  registerRpc,
  clearRpcRegistry,
} from "../contract/rpc";
import { handleMetadataRoute as dispatchMetadataRoute } from "../routes/metadata-routes";
import {
  DEFAULT_PRERENDER_DIR,
  DEFAULT_PRERENDER_CACHE_CONTROL,
  loadPrerenderIndex,
  resolvePrerenderedFile,
  type PrerenderIndex,
} from "../bundler/prerender";
import {
  buildOverlayErrorHtml,
  buildPayloadFromError,
  shouldInjectOverlay,
} from "../dev-error-overlay";
// Phase 18.μ — i18n dispatch. `resolveLocale()` is pure (no side effects),
// `createTranslator()` binds a per-request `t()` to the registry.
import {
  resolveLocale,
  createTranslator,
  isI18nDefinition,
  isMessageRegistry,
} from "../i18n";
import type {
  I18nDefinition,
  ResolvedLocale,
  Translator,
} from "../i18n/types";
import type { MessageRegistry } from "../i18n/message-registry";

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  statusCode?: number;
  headers?: boolean;
  /**
   * Reverse proxy 헤더를 신뢰할지 여부
   * - false(기본): X-Forwarded-For 등을 읽지만 spoofing 가능성을 표시
   * - true: 전달된 클라이언트 IP를 완전히 신뢰
   * 주의: trustProxy: false여도 클라이언트 구분을 위해 헤더를 사용하므로
   *       IP spoofing이 가능합니다. 신뢰할 수 있는 프록시 뒤에서만 사용하세요.
   */
  trustProxy?: boolean;
  /**
   * 메모리 보호를 위한 최대 key 수
   * - 초과 시 오래된 key부터 제거
   */
  maxKeys?: number;
}

interface NormalizedRateLimitOptions {
  windowMs: number;
  max: number;
  message: string;
  statusCode: number;
  headers: boolean;
  trustProxy: boolean;
  maxKeys: number;
}

interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

class MemoryRateLimiter {
  private readonly store = new Map<string, { count: number; resetAt: number }>();
  private lastCleanupAt = 0;

  consume(req: Request, routeId: string, options: NormalizedRateLimitOptions): RateLimitDecision {
    const now = Date.now();
    this.maybeCleanup(now, options);

    const key = `${this.getClientKey(req, options)}:${routeId}`;
    const current = this.store.get(key);

    if (!current || current.resetAt <= now) {
      const resetAt = now + options.windowMs;
      this.store.set(key, { count: 1, resetAt });
      this.enforceMaxKeys(options.maxKeys);
      return { allowed: true, limit: options.max, remaining: Math.max(0, options.max - 1), resetAt };
    }

    current.count += 1;
    this.store.set(key, current);

    return {
      allowed: current.count <= options.max,
      limit: options.max,
      remaining: Math.max(0, options.max - current.count),
      resetAt: current.resetAt,
    };
  }

  private maybeCleanup(now: number, options: NormalizedRateLimitOptions): void {
    if (now - this.lastCleanupAt < Math.max(1_000, options.windowMs)) {
      return;
    }

    this.lastCleanupAt = now;
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
      }
    }
  }

  private enforceMaxKeys(maxKeys: number): void {
    while (this.store.size > maxKeys) {
      const oldestKey = this.store.keys().next().value;
      if (!oldestKey) break;
      this.store.delete(oldestKey);
    }
  }

  private getClientKey(req: Request, options: NormalizedRateLimitOptions): string {
    const candidates = [
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      req.headers.get("x-real-ip")?.trim(),
      req.headers.get("cf-connecting-ip")?.trim(),
      req.headers.get("true-client-ip")?.trim(),
      req.headers.get("fly-client-ip")?.trim(),
    ];

    for (const candidate of candidates) {
      if (candidate) {
        const sanitized = candidate.slice(0, 64);
        // trustProxy: false면 경고를 위해 prefix 추가 (spoofing 가능)
        return options.trustProxy ? sanitized : `unverified:${sanitized}`;
      }
    }

    // 헤더가 전혀 없는 경우만 fallback (로컬 개발 환경)
    return "default";
  }
}

function normalizeRateLimitOptions(options: boolean | RateLimitOptions | undefined): NormalizedRateLimitOptions | false {
  if (!options) return false;
  if (options === true) {
    return {
      windowMs: 60_000,
      max: 100,
      message: "Too Many Requests",
      statusCode: 429,
      headers: true,
      trustProxy: false,
      maxKeys: 10_000,
    };
  }

  const windowMs = Number.isFinite(options.windowMs) ? Math.max(1_000, options.windowMs!) : 60_000;
  const max = Number.isFinite(options.max) ? Math.max(1, Math.floor(options.max!)) : 100;
  const statusCode = Number.isFinite(options.statusCode)
    ? Math.min(599, Math.max(400, Math.floor(options.statusCode!)))
    : 429;
  const maxKeys = Number.isFinite(options.maxKeys)
    ? Math.max(100, Math.floor(options.maxKeys!))
    : 10_000;

  return {
    windowMs,
    max,
    message: options.message ?? "Too Many Requests",
    statusCode,
    headers: options.headers ?? true,
    trustProxy: options.trustProxy ?? false,
    maxKeys,
  };
}

function appendRateLimitHeaders(response: Response, decision: RateLimitDecision, options: NormalizedRateLimitOptions): Response {
  if (!options.headers) return response;

  const headers = new Headers(response.headers);
  const retryAfterSec = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000));

  headers.set("X-RateLimit-Limit", String(decision.limit));
  headers.set("X-RateLimit-Remaining", String(decision.remaining));
  headers.set("X-RateLimit-Reset", String(Math.floor(decision.resetAt / 1000)));
  headers.set("Retry-After", String(retryAfterSec));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function createRateLimitResponse(decision: RateLimitDecision, options: NormalizedRateLimitOptions): Response {
  const response = Response.json(
    {
      error: "rate_limit_exceeded",
      message: options.message,
      limit: decision.limit,
      remaining: decision.remaining,
      retryAfter: Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000)),
    },
    { status: options.statusCode }
  );

  return appendRateLimitHeaders(response, decision, options);
}

// ========== MIME Types ==========
const MIME_TYPES: Record<string, string> = {
  // JavaScript
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".ts": "application/typescript",
  // CSS
  ".css": "text/css",
  // HTML
  ".html": "text/html",
  ".htm": "text/html",
  // JSON
  ".json": "application/json",
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  // Fonts
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  // Documents
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".xml": "application/xml",
  // Media
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  // Archives
  ".zip": "application/zip",
  ".gz": "application/gzip",
  // WebAssembly
  ".wasm": "application/wasm",
  // Source maps
  ".map": "application/json",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

// ========== Server Options ==========
export interface ServerOptions {
  port?: number;
  hostname?: string;
  /** 프로젝트 루트 디렉토리 */
  rootDir?: string;
  /** 개발 모드 여부 */
  isDev?: boolean;
  /** HMR 포트 (개발 모드에서 사용) */
  hmrPort?: number;
  /** 번들 매니페스트 (Island hydration용) */
  bundleManifest?: BundleManifest;
  /** Public 디렉토리 경로 (기본: 'public') */
  publicDir?: string;
  /**
   * CORS 설정
   * - true: 모든 Origin 허용
   * - false: CORS 비활성화 (기본값)
   * - CorsOptions: 세부 설정
   */
  cors?: boolean | CorsOptions;
  /**
   * Streaming SSR 활성화
   * - true: 모든 페이지에 Streaming SSR 적용
   * - false: 기존 renderToString 사용 (기본값)
   */
  streaming?: boolean;
  /**
   * API 라우트 Rate Limit 설정
   */
  rateLimit?: boolean | RateLimitOptions;
  /**
   * CSS 파일 경로 (SSR 링크 주입용)
   * - string: 해당 경로로 <link> 주입 (예: "/.mandu/client/globals.css")
   * - false: CSS 링크 주입 비활성화 (Tailwind 미사용 시)
   * - undefined: false로 처리 (404 방지, dev/build에서 명시적 전달 필요)
   */
  cssPath?: string | false;
  /**
   * 커스텀 레지스트리 (핸들러/설정 분리)
   * - 제공하지 않으면 기본 전역 레지스트리 사용
   * - 테스트나 멀티앱 시나리오에서 createServerRegistry()로 생성한 인스턴스 전달
   */
  registry?: ServerRegistry;
  /**
   * Guard config for Kitchen dev dashboard (dev mode only)
   */
  guardConfig?: import("../guard/types").GuardConfig | null;
  /**
   * SSR 캐시 설정 (ISR/SWR 용).
   *
   * Phase 18.ζ — `CacheConfig` 객체를 추가로 지원한다.
   * - `true`         : 기본 메모리 캐시 (LRU 1000 엔트리)
   * - `CacheStore`   : 커스텀 캐시 구현체 (e.g. redis 어댑터)
   * - `CacheConfig`  : `{ defaultMaxAge, defaultSwr, maxEntries, store }`
   *                    전역 기본값을 설정 — loader 가 `_cache` 를 안 내도
   *                    자동으로 캐싱됨 (Next.js `export const revalidate` 등가).
   * - `false`/undefined : 캐시 비활성화
   */
  cache?: boolean | CacheStore | CacheConfig;
  /**
   * Internal management token for local CLI/runtime control endpoints.
   * When set, token-protected endpoints such as `/_mandu/cache` become available.
   */
  managementToken?: string;
  /**
   * Issue #192 — enable CSS View Transitions auto-inject (default `true`).
   * When `true`, every SSR response gets
   * `<style>@view-transition{navigation:auto}</style>` in its `<head>`,
   * giving supported browsers a default crossfade on cross-document
   * navigation. Pass `false` to suppress (typically wired from
   * `ManduConfig.transitions`).
   */
  transitions?: boolean;
  /**
   * Issue #192 — enable the hover prefetch helper (default `true`).
   * When `true`, every SSR response gets a ~500-byte inline script that
   * prefetches same-origin links on hover. Pass `false` to suppress
   * (typically wired from `ManduConfig.prefetch`). Individual links can
   * also opt out via `data-no-prefetch`.
   */
  prefetch?: boolean;
  /**
   * Issue #193 / #208 — enable opt-out SPA navigation (default `true`).
   * When `true`, every SSR response gets (a) the `window.__MANDU_SPA__`
   * global elided (the router's default) and (b) the inline SPA-nav
   * IIFE (~1.6 KB) that intercepts internal `<a>` clicks with pushState
   * + fetch + View-Transitions DOM-swap, so `hydration: "none"` projects
   * still feel like a SPA. `false` reverts to legacy full-reload (and
   * the full router's opt-in `data-mandu-link` requirement). Wired from
   * `ManduConfig.spa`; per-link opt-out lives on `data-no-spa`.
   */
  spa?: boolean;
  /**
   * Issue #191 — override dev-mode `_devtools.js` injection.
   * Wired from `ManduConfig.dev.devtools`.
   *   - `true`      → force inject on every page (SSR-only + Kitchen).
   *   - `false`     → force skip on every page.
   *   - `undefined` → default. Inject iff the page's route has at least
   *                   one island. Pure-SSR pages download zero devtools.
   */
  devtools?: boolean;
  /**
   * Phase 17 — observability endpoints.
   *   - `heapEndpoint`    → `/_mandu/heap` JSON dump of process.memoryUsage()
   *                         + registered cache sizes. In dev this is on by
   *                         default; in prod it requires `MANDU_DEBUG_HEAP=1`
   *                         OR this flag set to `true`.
   *   - `metricsEndpoint` → `/_mandu/metrics` Prometheus text exposition.
   *                         Same gating as `heapEndpoint`.
   * Passing `false` for either in dev force-disables it (useful for
   * isolating test environments that count listeners).
   */
  observability?: {
    heapEndpoint?: boolean;
    metricsEndpoint?: boolean;
    /**
     * Phase 18.θ — OpenTelemetry-compatible request tracing. See
     * `@mandujs/core/observability` {@link import("../observability/tracing").TracerConfig}
     * for field semantics. `undefined` leaves tracing disabled;
     * `{ enabled: true }` opens a root span for every request and
     * propagates the trace context across `await`s via
     * AsyncLocalStorage. The `MANDU_OTEL_ENDPOINT` env var forces
     * tracing on with the OTLP exporter when the config is omitted.
     */
    tracing?: {
      enabled?: boolean;
      exporter?: "console" | "otlp";
      endpoint?: string;
      headers?: Record<string, string>;
      serviceName?: string;
    };
  };
  /**
   * Production-grade OpenAPI endpoint.
   *
   * When enabled, the runtime serves the contracts-derived OpenAPI 3.0.3
   * document at `<path>.json` / `<path>.yaml` (default base path
   * `/__mandu/openapi`). The body is loaded once from the build-time
   * artifacts under `.mandu/openapi.{json,yaml}` (emitted by
   * `mandu build`) and cached for the lifetime of the server.
   *
   *   - `enabled` — default `false`. Security-conscious: production
   *     deployments must explicitly opt in, or set
   *     `MANDU_OPENAPI_ENABLED=1` in the environment.
   *   - `path` — base URL path (with or without `.json` suffix).
   *     Default `/__mandu/openapi`.
   *
   * Wired from `ManduConfig.openapi`. The response carries
   * `Cache-Control: public, max-age=0, must-revalidate` + a SHA-256
   * ETag so CDNs / browsers revalidate on every deploy without holding
   * stale specs.
   */
  openapi?: {
    enabled?: boolean;
    path?: string;
  };
  /**
   * Phase 18 — prerendered HTML pass-through (SSG).
   *
   * When enabled (default), the server looks for a prerender index
   * under `<rootDir>/<dir>/_manifest.json` (written by `mandu build`)
   * and, for every request whose pathname maps to a prerendered file,
   * serves that HTML directly, bypassing SSR entirely, with a
   * conditional-GET friendly `Cache-Control` + strong `ETag` pair.
   *
   *   - `true`      enabled with defaults (dir `.mandu/prerendered`,
   *                 Cache-Control `public, max-age=0, must-revalidate`
   *                 — Issue #221; prerendered URLs are stable, so
   *                 `immutable` would pin stale HTML across deploys).
   *   - `false`     disabled. Every request goes through SSR.
   *   - object      overrides. `dir` chooses a different output;
   *                 `cacheControl` lets adapters tune the CDN hint.
   *
   * Wired from `ManduConfig.build.prerender`; see
   * `@mandujs/core/bundler/prerender` for the build-side contract.
   */
  prerender?:
    | boolean
    | {
        dir?: string;
        cacheControl?: string;
      };
  /**
   * Phase 18.ε — canonical request-level middleware chain.
   *
   * Middleware execute in declaration order (outermost first) BEFORE
   * route dispatch. Each layer may short-circuit by returning a
   * Response without calling `next()`, or wrap the downstream Response
   * after `next()` returns. Composed via `compose()`.
   *
   * Typically wired from `ManduConfig.middleware`. See
   * `@mandujs/core/middleware` for `defineMiddleware` / `compose`
   * helpers plus bridge wrappers (`csrfMiddleware`, `sessionMiddleware`,
   * `secureMiddleware`, `rateLimitMiddleware`).
   */
  middleware?: Middleware[];
  /**
   * Phase 18.τ — plugins contributing `defineMiddlewareChain()` +
   * lifecycle observers. Plugin middleware are PREPENDED to
   * `options.middleware` so they run BEFORE user-declared layers. Both
   * fields are optional; omission is a zero-overhead passthrough.
   */
  plugins?: readonly import("../plugins/hooks").ManduPlugin[];
  configHooks?: Partial<import("../plugins/hooks").ManduHooks>;
  /**
   * Phase 18.κ — tRPC-like typed RPC endpoints.
   *
   * Keys map to `/api/rpc/<name>/<method>` routes. Each value is a
   * `defineRpc()` result (see `@mandujs/core/contract/rpc`). Populating
   * this field at `startServer()` time registers every endpoint with
   * the global RPC registry; the dispatcher runs BEFORE β's route
   * matcher so RPC routes never collide with file-system API routes.
   *
   * Typically threaded from `ManduConfig.rpc.endpoints`.
   */
  rpc?: {
    endpoints?: Record<string, import("../contract/rpc").RpcDefinition<import("../contract/rpc").RpcProcedureRecord>>;
  };
  /**
   * Phase 18.λ — declarative cron scheduler.
   *
   * When `jobs` is non-empty and `disabled !== true`, `startServer()`
   * instantiates a `CronRegistration` via `defineCron(jobs)`, calls
   * `.start()` after the HTTP listener is bound, and wires the handle
   * into `stop()` so the returned `ManduServer.stop()` also drains any
   * in-flight cron tick before returning. Jobs whose `runOn` omits
   * `"bun"` are registered but never fire on the local Bun host — they
   * still appear in `status()` so dashboards can render their existence.
   *
   * Typically threaded from `ManduConfig.scheduler`.
   */
  scheduler?: {
    jobs?: import("../scheduler").CronDef[];
    disabled?: boolean;
  };
  /**
   * Phase 18.μ — first-class i18n. Threaded from `ManduConfig.i18n`.
   *
   * When populated, the runtime dispatcher:
   *   1. resolves the active locale BEFORE route dispatch (via
   *      {@link resolveLocale}) using the configured strategy;
   *   2. attaches `ctx.locale` (ResolvedLocale) + `ctx.t` (typed
   *      translator) to every loader / handler invocation;
   *   3. stamps `Vary: Accept-Language` + `Content-Language` on all
   *      page responses so upstream caches key on locale;
   *   4. when `strategy === "path-prefix"` and the incoming URL
   *      carries no locale prefix AND no override cookie, redirects
   *      `/` → `/<defaultLocale>` so browsers reach a locale-scoped
   *      URL (Next.js parity).
   *
   * Omitting this block keeps the runtime branch-free — the hot path
   * incurs zero overhead when i18n is disabled.
   */
  i18n?: I18nDefinition;
  /**
   * Phase 18.μ — optional message registry bound to `ctx.t`. Created via
   * `defineMessages({ en: {...}, ko: {...} })`. When omitted but `i18n`
   * is set, `ctx.locale` is populated but `ctx.t` stays `undefined` —
   * projects that manage their own translation layer (e.g. react-intl)
   * use `ctx.locale.code` and ignore `ctx.t`.
   */
  messages?: MessageRegistry;
  /**
   * Issue #217 — suppress the "🥟 Mandu server listening"/"🥟 Mandu Dev
   * Server listening" banner printed at boot. The HTTP listener still
   * binds and `ManduServer.server.port` still reports the chosen port;
   * only the stdout banner (plus its auxiliary lines — HMR hint, CORS
   * hint, static-file hint, streaming hint, Kitchen hint, "also
   * reachable at" hint) is gated.
   *
   * Intended for internal callers such as the build-time prerender
   * orchestrator that spin up a transient listener on an ephemeral
   * port (`port: 0`) and tear it down seconds later — the banner's
   * URL is always wrong by the time a human (or an LLM reading build
   * logs) tries to curl it, so printing it causes confusion.
   *
   * User-facing commands (`mandu dev`, `mandu start`) leave this
   * `undefined` / `false` to preserve the normal banner. Default:
   * `false`.
   */
  silent?: boolean;
}

export interface ManduServer {
  server: Server<undefined>;
  router: Router;
  /** 이 서버 인스턴스의 레지스트리 */
  registry: ServerRegistry;
  stop: () => void;
}

export type ApiHandler = (req: Request, params: Record<string, string>) => Response | Promise<Response>;
export type PageLoader = () => Promise<{ default: React.ComponentType<{ params: Record<string, string> }> }>;

/**
 * Layout 컴포넌트 타입
 * children을 받아서 감싸는 구조
 */
export type LayoutComponent = React.ComponentType<{
  children: React.ReactNode;
  params?: Record<string, string>;
}>;

/**
 * Layout 로더 타입
 */
export type LayoutLoader = () => Promise<{ default: LayoutComponent }>;

/**
 * Loading 컴포넌트 타입
 */
export type LoadingComponent = React.ComponentType<Record<string, never>>;

/**
 * Error 컴포넌트 타입
 */
export type ErrorComponent = React.ComponentType<ErrorFallbackProps>;

/**
 * Loading/Error 로더 타입
 */
export type LoadingLoader = () => Promise<{ default: LoadingComponent }>;
export type ErrorLoader = () => Promise<{ default: ErrorComponent }>;

/**
 * Page 등록 정보
 * - component: React 컴포넌트
 * - filling: Slot의 ManduFilling 인스턴스 (loader 포함)
 */
export interface PageRegistration {
  component: React.ComponentType<{ params: Record<string, string>; loaderData?: unknown }>;
  filling?: ManduFilling<unknown>;
  /** #186: page 모듈의 static `metadata` export (선택) */
  metadata?: Metadata;
  /** #186: page 모듈의 `generateMetadata` 함수 export (선택) */
  generateMetadata?: GenerateMetadata;
}

/**
 * Page Handler - 컴포넌트와 filling을 함께 반환
 */
export type PageHandler = () => Promise<PageRegistration>;

/**
 * Issue #206 — Metadata route handler. A thunk that returns the
 * imported user module (or its `default` export) so the dispatcher
 * in `handleMetadataRoute` can invoke the user-supplied function with
 * the correct Content-Type + cache headers. The indirection keeps dev
 * HMR cheap: the handler only imports on the request that needs it.
 */
export type MetadataHandler = () => Promise<unknown>;

export interface AppContext {
  routeId: string;
  url: string;
  params: Record<string, string>;
  /** SSR loader에서 로드한 데이터 */
  loaderData?: unknown;
}

type RouteComponent = (props: { params: Record<string, string>; loaderData?: unknown }) => React.ReactElement;
type CreateAppFn = (context: AppContext) => React.ReactElement;

// ========== Server Registry (인스턴스별 분리) ==========

/**
 * 서버 인스턴스별 핸들러/설정 레지스트리
 * 같은 프로세스에서 여러 서버를 띄울 때 핸들러가 섞이는 문제 방지
 */
export interface ServerRegistrySettings {
  isDev: boolean;
  hmrPort?: number;
  bundleManifest?: BundleManifest;
  rootDir: string;
  publicDir: string;
  cors?: CorsOptions | false;
  streaming: boolean;
  rateLimit?: NormalizedRateLimitOptions | false;
  /**
   * CSS 파일 경로 (SSR 링크 주입용)
   * - string: 해당 경로로 <link> 주입
   * - false: CSS 링크 주입 비활성화
   * - undefined: false로 처리 (404 방지)
   */
  cssPath?: string | false;
  /** ISR/SWR 캐시 스토어 */
  cacheStore?: CacheStore;
  /** Internal management token for local runtime control */
  managementToken?: string;
  /**
   * Edge runtime flag — disables filesystem-dependent features (static file
   * serving, Kitchen dashboard, image optimization, SSG fallback loaders).
   * Set by `@mandujs/edge` adapters (Cloudflare Workers, Deno Deploy, Vercel Edge).
   * Default: false (Bun/Node runtime with full FS access).
   */
  edge?: boolean;
  /**
   * Issue #192 — threaded from `ServerOptions.transitions`.
   * `undefined` is treated as `true` at the SSR call-site (enabled by
   * default); `false` suppresses the `<style>@view-transition>` injection.
   */
  transitions?: boolean;
  /**
   * Issue #192 — threaded from `ServerOptions.prefetch`.
   * `undefined` is treated as `true` at the SSR call-site (enabled by
   * default); `false` suppresses the hover prefetch `<script>` injection.
   */
  prefetch?: boolean;
  /**
   * Issue #193 / #208 — threaded from `ServerOptions.spa`.
   * `undefined` is treated as `true` at the SSR call-site (default SPA
   * nav on, helper injected). `false` both disables the full client
   * router (opt-in via `data-mandu-link` only) AND omits the inline
   * SPA-nav IIFE from `<head>`.
   */
  spa?: boolean;
  /**
   * Issue #191 — threaded from `ServerOptions.devtools`. `undefined`
   * means "use default (islands → inject)"; `true` / `false` force the
   * dev-mode `_devtools.js` `<script>` injection on / off. No-op in prod.
   */
  devtools?: boolean;
  /**
   * Phase 18.α — threaded from `ManduConfig.dev.errorOverlay`. `undefined`
   * means "use default (enabled in dev)"; `false` suppresses both the
   * in-head `<script>` and the 500-response HTML overlay. No-op in prod.
   */
  errorOverlay?: boolean;
  /**
   * Phase 17 — `/_mandu/heap` JSON exposure. `undefined` uses the
   * default for the current mode (dev → on, prod → MANDU_DEBUG_HEAP).
   */
  heapEndpoint?: boolean;
  /**
   * Phase 17 — `/_mandu/metrics` Prometheus exposure. Same defaulting
   * as `heapEndpoint`.
   */
  metricsEndpoint?: boolean;
  /**
   * Phase 18.θ — resolved request-tracing state. `undefined` means
   * tracing is disabled (the hot path is branch-free). When set, every
   * request opens a root span via `tracer.startSpanFromRequest()`.
   */
  tracer?: import("../observability/tracing").Tracer;
  /**
   * Production OpenAPI endpoint — resolved from `ServerOptions.openapi`.
   * `undefined` means the endpoint is disabled (hot path branch-free).
   * When populated, every request whose pathname matches
   * `<basePath>.json` / `<basePath>.yaml` short-circuits before route
   * dispatch to serve the cached spec body.
   */
  openapi?: import("./openapi-endpoint").OpenAPIEndpointSettings;
  /**
   * Phase 18 — resolved prerender pass-through state. `undefined`
   * means the feature is disabled for this server instance.
   */
  prerender?: {
    /** Absolute output directory containing `_manifest.json`. */
    dir: string;
    /** `Cache-Control` header to stamp on served prerendered HTML. */
    cacheControl: string;
    /**
     * Loaded index. `undefined` = not yet attempted; `null` = attempted
     * and missing / unreadable (fall through to SSR). Populated lazily
     * on the first request so `startServer` stays synchronous.
     */
    index?: PrerenderIndex | null;
    /** In-flight load promise so concurrent requests share one read. */
    pending?: Promise<PrerenderIndex | null>;
  };
  /**
   * Phase 18.ε — precompiled request-level middleware chain. `undefined`
   * means "no middleware configured" (zero overhead — the pipeline falls
   * straight through to route dispatch). Wired from
   * `ServerOptions.middleware` at {@link startServer} time.
   */
  middlewareChain?: ComposedHandler;
  /**
   * Phase 18.μ — resolved i18n definition. `undefined` means "no i18n
   * configured at boot" (hot path is branch-free). Wired from
   * `ServerOptions.i18n`.
   */
  i18n?: I18nDefinition;
  /**
   * Phase 18.μ — message registry bound to {@link i18n}. When both are
   * set, the runtime builds a per-request `ctx.t` via
   * `createTranslator()`. When only `i18n` is set, `ctx.t` stays
   * `undefined` and user code is responsible for its own translations.
   */
  messages?: MessageRegistry;
}

export class ServerRegistry {
  readonly apiHandlers: Map<string, ApiHandler> = new Map();
  readonly pageLoaders: Map<string, PageLoader> = new Map();
  readonly pageHandlers: Map<string, PageHandler> = new Map();
  readonly pageFillings: Map<string, ManduFilling<unknown>> = new Map();
  readonly routeComponents: Map<string, RouteComponent> = new Map();
  /**
   * Issue #206 — metadata-route handlers keyed by `route.id`
   * (`metadata-sitemap` / `metadata-robots` / `metadata-llms-txt` /
   * `metadata-manifest`). Each handler is a thunk that imports the
   * user module lazily so dev HMR can swap it without restarting the
   * server. The dispatcher in `handleMetadataRoute()` extracts the
   * default export and invokes it.
   */
  readonly metadataHandlers: Map<string, MetadataHandler> = new Map();
  /** Layout 컴포넌트 캐시 (모듈 경로 → 컴포넌트) */
  readonly layoutComponents: Map<string, LayoutComponent> = new Map();
  /** Layout 로더 (모듈 경로 → 로더 함수) */
  readonly layoutLoaders: Map<string, LayoutLoader> = new Map();
  /** Loading 컴포넌트 캐시 (모듈 경로 → 컴포넌트) */
  readonly loadingComponents: Map<string, LoadingComponent> = new Map();
  /** Loading 로더 (모듈 경로 → 로더 함수) */
  readonly loadingLoaders: Map<string, LoadingLoader> = new Map();
  /** Error 컴포넌트 캐시 (모듈 경로 → 컴포넌트) */
  readonly errorComponents: Map<string, ErrorComponent> = new Map();
  /** Error 로더 (모듈 경로 → 로더 함수) */
  readonly errorLoaders: Map<string, ErrorLoader> = new Map();
  createAppFn: CreateAppFn | null = null;
  rateLimiter: MemoryRateLimiter | null = null;
  /**
   * Phase 6.3: app-level `not-found.tsx` handler. Returns the React
   * component used for 404 rendering. Set via {@link registerNotFoundHandler}.
   * Global — one per app, registered at startup. Unresolved → fall back
   * to the framework's built-in 404 JSON error.
   */
  notFoundHandler: PageHandler | null = null;
  /** Kitchen dev dashboard handler (dev mode only) */
  kitchen: KitchenHandler | null = null;
  /** 라우트별 캐시 옵션 (filling.loader()의 cacheOptions에서 등록) */
  readonly cacheOptions: Map<string, { revalidate?: number; staleWhileRevalidate?: number; tags?: string[] }> = new Map();
  /** 라우트별 렌더 모드 */
  readonly renderModes: Map<string, RenderMode> = new Map();
  /** Layout slot 파일 경로 캐시 (모듈 경로 → slot 경로 | null) */
  readonly layoutSlotPaths: Map<string, string | null> = new Map();
  /** WebSocket 핸들러 (라우트 ID → WSHandlers) */
  readonly wsHandlers: Map<string, import("../filling/ws").WSHandlers> = new Map();
  /**
   * Metadata API 캐시 (#186)
   * - pageMetadata: routeId → page 모듈의 static `metadata` export
   * - pageGenerateMetadata: routeId → `generateMetadata` 함수
   * - layoutMetadata: layout 모듈 경로 → static `metadata` export (null = 시도했지만 없음)
   * - layoutGenerateMetadata: layout 모듈 경로 → `generateMetadata` 함수
   */
  readonly pageMetadata: Map<string, import("../seo").Metadata> = new Map();
  readonly pageGenerateMetadata: Map<string, import("../seo").GenerateMetadata> = new Map();
  readonly layoutMetadata: Map<string, import("../seo").Metadata | null> = new Map();
  readonly layoutGenerateMetadata: Map<string, import("../seo").GenerateMetadata> = new Map();
  settings: ServerRegistrySettings = {
    isDev: false,
    rootDir: process.cwd(),
    publicDir: "public",
    cors: false,
    streaming: false,
    rateLimit: false,
  };

  registerApiHandler(routeId: string, handler: ApiHandler): void {
    this.apiHandlers.set(routeId, handler);
  }

  /**
   * Issue #206 — register a metadata-route loader. The handler must
   * be a thunk returning either the raw user function or the
   * module namespace (`{ default: fn }`). The dispatcher accepts both
   * shapes so callers don't have to care whether they imported with
   * `import("./sitemap")` or a bundled variant.
   */
  registerMetadataHandler(routeId: string, handler: MetadataHandler): void {
    this.metadataHandlers.set(routeId, handler);
  }

  registerPageLoader(routeId: string, loader: PageLoader): void {
    this.pageLoaders.set(routeId, loader);
  }

  registerPageHandler(routeId: string, handler: PageHandler): void {
    this.pageHandlers.set(routeId, handler);
  }

  registerRouteComponent(routeId: string, component: RouteComponent): void {
    this.routeComponents.set(routeId, component);
  }

  /**
   * Layout 로더 등록
   */
  registerLayoutLoader(modulePath: string, loader: LayoutLoader): void {
    this.layoutLoaders.set(modulePath, loader);
  }

  /**
   * Loading 로더 등록
   */
  registerLoadingLoader(modulePath: string, loader: LoadingLoader): void {
    this.loadingLoaders.set(modulePath, loader);
  }

  /**
   * Error 로더 등록
   */
  registerErrorLoader(modulePath: string, loader: ErrorLoader): void {
    this.errorLoaders.set(modulePath, loader);
  }

  /**
   * Phase 6.3: register the app-level not-found handler. Follows the
   * same factory shape as `registerPageHandler` (async component loader)
   * so users can lazy-import their `app/not-found.tsx`. Only one handler
   * is retained — later calls overwrite earlier ones.
   */
  registerNotFoundHandler(handler: PageHandler): void {
    this.notFoundHandler = handler;
  }

  /**
   * 제네릭 컴포넌트 로더 (DRY)
   * 캐시 → 로더 → 동적 import 순서로 시도
   */
  private async getComponentByType<T>(
    type: "layout" | "loading" | "error",
    modulePath: string
  ): Promise<T | null> {
    // 타입별 캐시/로더 맵 선택
    const cacheMap = {
      layout: this.layoutComponents,
      loading: this.loadingComponents,
      error: this.errorComponents,
    }[type] as Map<string, T>;

    const loaderMap = {
      layout: this.layoutLoaders,
      loading: this.loadingLoaders,
      error: this.errorLoaders,
    }[type] as Map<string, () => Promise<{ default: T }>>;

    // 1. 캐시 확인
    const cached = cacheMap.get(modulePath);
    if (cached) return cached;

    // #186: layout인 경우 metadata / generateMetadata export를 함께 캐싱
    const cacheLayoutMetadata = (mod: unknown) => {
      if (type !== "layout") return;
      if (this.layoutMetadata.has(modulePath)) return;
      const modObj = (mod && typeof mod === "object" ? (mod as Record<string, unknown>) : null);
      const staticMeta = modObj?.metadata;
      const generateFn = modObj?.generateMetadata;
      this.layoutMetadata.set(
        modulePath,
        staticMeta && typeof staticMeta === "object" ? (staticMeta as Metadata) : null,
      );
      if (typeof generateFn === "function") {
        this.layoutGenerateMetadata.set(modulePath, generateFn as GenerateMetadata);
      }
    };

    // 2. 등록된 로더 시도
    const loader = loaderMap.get(modulePath);
    if (loader) {
      try {
        const module = await loader();
        const component = module.default;
        cacheMap.set(modulePath, component);
        cacheLayoutMetadata(module);
        return component;
      } catch (error) {
        console.error(`[Mandu] Failed to load ${type}: ${modulePath}`, error);
        return null;
      }
    }

    // 3. 동적 import 시도 (보안 검증 포함)
    const validation = validateImportPath(this.settings.rootDir, modulePath);
    if (!validation.ok) {
      console.error(`[Mandu Security] ${validation.error.message}`);
      return null;
    }

    try {
      const module = await import(validation.value);
      const component = module.default;
      cacheMap.set(modulePath, component);
      cacheLayoutMetadata(module);
      return component;
    } catch (error) {
      // layout은 에러 로깅, loading/error는 조용히 실패
      if (type === "layout") {
        console.error(`[Mandu] Failed to load ${type}: ${modulePath}`, error);
      }
      return null;
    }
  }

  /**
   * Layout 컴포넌트 가져오기
   */
  async getLayoutComponent(modulePath: string): Promise<LayoutComponent | null> {
    return this.getComponentByType<LayoutComponent>("layout", modulePath);
  }

  /**
   * Loading 컴포넌트 가져오기
   */
  async getLoadingComponent(modulePath: string): Promise<LoadingComponent | null> {
    return this.getComponentByType<LoadingComponent>("loading", modulePath);
  }

  /**
   * Error 컴포넌트 가져오기
   */
  async getErrorComponent(modulePath: string): Promise<ErrorComponent | null> {
    return this.getComponentByType<ErrorComponent>("error", modulePath);
  }

  setCreateApp(fn: CreateAppFn): void {
    this.createAppFn = fn;
  }

  /**
   * 모든 핸들러/컴포넌트 초기화 (테스트용)
   */
  clear(): void {
    this.apiHandlers.clear();
    this.pageLoaders.clear();
    this.pageHandlers.clear();
    this.routeComponents.clear();
    this.layoutComponents.clear();
    this.layoutLoaders.clear();
    this.loadingComponents.clear();
    this.loadingLoaders.clear();
    this.errorComponents.clear();
    this.errorLoaders.clear();
    this.pageMetadata.clear();
    this.pageGenerateMetadata.clear();
    this.layoutMetadata.clear();
    this.layoutGenerateMetadata.clear();
    this.metadataHandlers.clear();
    this.createAppFn = null;
    this.rateLimiter = null;
    this.notFoundHandler = null;
  }
}

/**
 * 기본 전역 레지스트리 (하위 호환성)
 */
const defaultRegistry = new ServerRegistry();

/**
 * 새 레지스트리 인스턴스 생성
 * 테스트나 멀티앱 시나리오에서 사용
 */
export function createServerRegistry(): ServerRegistry {
  return new ServerRegistry();
}

/**
 * 기본 레지스트리 초기화 (테스트용)
 */
export function clearDefaultRegistry(): void {
  defaultRegistry.clear();
}

// ========== 하위 호환성을 위한 전역 함수들 (defaultRegistry 사용) ==========

export function registerApiHandler(routeId: string, handler: ApiHandler): void {
  defaultRegistry.registerApiHandler(routeId, handler);
}

/**
 * Issue #206 — register a metadata route handler on the default
 * registry. See {@link ServerRegistry.registerMetadataHandler} for
 * the handler contract. Exposed at module scope so the CLI handlers
 * wiring (`packages/cli/src/util/handlers.ts`) can reach it without
 * threading a registry reference.
 */
export function registerMetadataHandler(routeId: string, handler: MetadataHandler): void {
  defaultRegistry.registerMetadataHandler(routeId, handler);
}

export function registerPageLoader(routeId: string, loader: PageLoader): void {
  defaultRegistry.registerPageLoader(routeId, loader);
}

/**
 * Page Handler 등록 (컴포넌트 + filling)
 * filling이 있으면 loader를 실행하여 serverData 전달
 */
export function registerPageHandler(routeId: string, handler: PageHandler): void {
  defaultRegistry.registerPageHandler(routeId, handler);
}

export function registerRouteComponent(routeId: string, component: RouteComponent): void {
  defaultRegistry.registerRouteComponent(routeId, component);
}

export function setCreateApp(fn: CreateAppFn): void {
  defaultRegistry.setCreateApp(fn);
}

/**
 * Layout 로더 등록 (전역)
 */
export function registerLayoutLoader(modulePath: string, loader: LayoutLoader): void {
  defaultRegistry.registerLayoutLoader(modulePath, loader);
}

/**
 * Loading 로더 등록 (전역)
 */
export function registerLoadingLoader(modulePath: string, loader: LoadingLoader): void {
  defaultRegistry.registerLoadingLoader(modulePath, loader);
}

/**
 * Error 로더 등록 (전역)
 */
export function registerErrorLoader(modulePath: string, loader: ErrorLoader): void {
  defaultRegistry.registerErrorLoader(modulePath, loader);
}

/**
 * Phase 6.3: register the app-level not-found handler on the default
 * registry. Called once at app init (either by codegen or manually)
 * with a PageHandler that resolves to the `not-found.tsx` component.
 */
export function registerNotFoundHandler(handler: PageHandler): void {
  defaultRegistry.registerNotFoundHandler(handler);
}

export function registerWSHandler(routeId: string, handlers: import("../filling/ws").WSHandlers): void {
  defaultRegistry.wsHandlers.set(routeId, handlers);
}

/**
 * 레이아웃 체인으로 컨텐츠 래핑
 *
 * @param content 페이지 컴포넌트로 렌더된 React Element
 * @param layoutChain 레이아웃 모듈 경로 배열 (외부 → 내부)
 * @param registry ServerRegistry 인스턴스
 * @param params URL 파라미터
 * @returns 래핑된 React Element
 */
async function wrapWithLayouts(
  content: React.ReactElement,
  layoutChain: string[],
  registry: ServerRegistry,
  params: Record<string, string>,
  layoutData?: Map<string, unknown>
): Promise<React.ReactElement> {
  if (!layoutChain || layoutChain.length === 0) {
    return content;
  }

  // 레이아웃 로드 (병렬)
  const layouts = await Promise.all(
    layoutChain.map((modulePath) => registry.getLayoutComponent(modulePath))
  );

  // 내부 → 외부 순서로 래핑 (역순)
  let wrapped = content;
  for (let i = layouts.length - 1; i >= 0; i--) {
    const Layout = layouts[i];
    if (Layout) {
      // layout별 loader 데이터가 있으면 props로 전달
      const data = layoutData?.get(layoutChain[i]);
      const baseProps = { params, children: wrapped };
      if (data && typeof data === "object") {
        // data에서 children/params 키 제거 → 구조적 props 보호
        const { children: _, params: __, ...safeData } = data as Record<string, unknown>;
        wrapped = React.createElement(Layout as React.ComponentType<Record<string, unknown>>, { ...safeData, ...baseProps });
      } else {
        wrapped = React.createElement(Layout, baseProps);
      }
    }
  }

  return wrapped;
}

// Default createApp implementation (registry 기반)
function createDefaultAppFactory(registry: ServerRegistry) {
  return function defaultCreateApp(context: AppContext): React.ReactElement {
    const Component = registry.routeComponents.get(context.routeId);

    if (!Component) {
      return React.createElement("div", null,
        React.createElement("h1", null, "404 - Route Not Found"),
        React.createElement("p", null, `Route ID: ${context.routeId}`)
      );
    }

    return React.createElement(Component, {
      params: context.params,
      loaderData: context.loaderData,
    });
  };
}

// ========== Static File Serving ==========

interface StaticFileResult {
  handled: boolean;
  response?: Response;
}

const INTERNAL_CACHE_ENDPOINT = "/_mandu/cache";
const INTERNAL_EVENTS_ENDPOINT = "/__mandu/events";

function handleEventsStreamRequest(req: Request): Response {
  const url = new URL(req.url);
  const filterType = url.searchParams.get("type") || undefined;
  const filterSeverity = url.searchParams.get("severity") || undefined;
  const filterSource = url.searchParams.get("source") || undefined;
  const filterTrace = url.searchParams.get("trace") || undefined;

  const matches = (e: import("../observability/event-bus").ObservabilityEvent): boolean => {
    if (filterType && e.type !== filterType) return false;
    if (filterSeverity && e.severity !== filterSeverity) return false;
    if (filterSource && e.source !== filterSource) return false;
    if (filterTrace && e.correlationId !== filterTrace) return false;
    return true;
  };

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string, eventName?: string) => {
        try {
          const prefix = eventName ? `event: ${eventName}\n` : "";
          controller.enqueue(encoder.encode(`${prefix}data: ${data}\n\n`));
        } catch {
          // Stream closed
        }
      };

      // Replay recent events that match filters
      const recent = eventBus.getRecent();
      for (const e of recent) {
        if (matches(e)) send(JSON.stringify(e));
      }

      // Subscribe to live events
      unsubscribe = eventBus.on("*", (event) => {
        if (matches(event)) send(JSON.stringify(event));
      });

      // Heartbeat (comment line) every 15s to keep connection alive
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          // ignore
        }
      }, 15000);

      // Tear down when client disconnects
      const signal = req.signal;
      if (signal) {
        signal.addEventListener("abort", () => {
          if (unsubscribe) { unsubscribe(); unsubscribe = null; }
          if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
          try { controller.close(); } catch { /* noop */ }
        });
      }
    },
    cancel() {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function handleEventsRecentRequest(req: Request): Response {
  const url = new URL(req.url);
  const count = url.searchParams.get("count");
  const type = url.searchParams.get("type") || undefined;
  const severity = url.searchParams.get("severity") || undefined;
  const windowParam = url.searchParams.get("windowMs");
  const windowMs = windowParam ? Number(windowParam) : undefined;

  const events = eventBus.getRecent(
    count ? Number(count) : undefined,
    {
      type: type as import("../observability/event-bus").EventType | undefined,
      severity: severity as import("../observability/event-bus").ObservabilitySeverity | undefined,
    },
  );
  const stats = eventBus.getStats(windowMs);
  return Response.json({ events, stats });
}

function createStaticErrorResponse(status: 400 | 403 | 404 | 500): Response {
  const body = {
    400: "Bad Request",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
  }[status];

  return new Response(body, { status });
}

// ═══════════════════════════════════════════════════════════════════════════
// Static asset cache policy — Issue #218
//
// The `immutable` Cache-Control directive is a *contract* with browsers:
// "the bytes at this URL will never change." Violating it (by overwriting a
// stable-name file between builds) means users keep stale CSS/JS until they
// hard-refresh. Mandu historically emitted `/.mandu/client/globals.css`
// and `/.mandu/client/runtime*.js` with fixed URLs but stamped the response
// with `immutable`, which is the exact failure mode.
//
// Policy:
//   - Hashed URL  (e.g. `.../chunk.a1b2c3d4.js`) → `immutable` is safe,
//     1-year max-age.
//   - Stable URL  (no hash in filename) → `max-age=0, must-revalidate`.
//     The client revalidates on every request; a matching `If-None-Match`
//     short-circuits to 304 with no body, so the cost is one HEAD-sized
//     round-trip, not a full re-download.
//
// Strong ETag (content-hash) is emitted for every `/.mandu/client/*`
// response so conditional GETs are cheap. We use `Bun.hash` (wyhash, ~5GB/s)
// for the digest and cache results keyed by `path + size + mtime` to avoid
// re-hashing on every hit.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Heuristic: does the filename look like it carries a content hash?
 *
 * Matches:
 *   - `name.<hash>.ext`      where hash is >=8 hex chars (e.g. `chunk.a1b2c3d4.js`)
 *   - `name-<hash>.ext`      (e.g. `vendor-8f3a2b9c.js`)
 *   - `name.<hash>.chunk.ext` common bundler shape
 *
 * A hash segment is 8+ lowercase hex chars. Longer digests (16, 20, 32) also
 * match. We deliberately avoid matching ALL-hex short names like `abc.js`
 * (requires min length 8).
 */
function hasContentHashInFilename(filename: string): boolean {
  // `.` or `-` separator, 8+ hex chars, then `.` before extension
  // Examples that match: chunk.a1b2c3d4.js, vendor-8f3a2b9c.js, app.1234567890abcdef.css
  // Examples that DON'T match: globals.css, runtime.js, chunk.js
  return /[.\-][a-f0-9]{8,}\.[a-z0-9]+$/i.test(filename);
}

/**
 * Compute Cache-Control for a static asset.
 *
 * - Dev: no caching (always refetch).
 * - Prod, hashed filename: `public, max-age=31536000, immutable` (1 year).
 * - Prod, stable filename: `public, max-age=0, must-revalidate` (force
 *   revalidation; 304 via `If-None-Match` keeps it cheap).
 */
function computeStaticCacheControl(filename: string, isDev: boolean): string {
  if (isDev) return "no-cache, no-store, must-revalidate";
  if (hasContentHashInFilename(filename)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=0, must-revalidate";
}

/**
 * In-process ETag cache keyed by absolute filePath. Entry is invalidated
 * when `size` or `mtime` changes. Avoids re-hashing hot files on every
 * request. The hot path is a single lookup + two scalar compares.
 */
interface EtagCacheEntry {
  size: number;
  mtime: number;
  etag: string;
}
const etagCache = new Map<string, EtagCacheEntry>();
const ETAG_CACHE_MAX = 2048;

/** Cheap LRU eviction: drop oldest insert when over cap. */
function evictEtagCacheIfNeeded(): void {
  if (etagCache.size <= ETAG_CACHE_MAX) return;
  const oldestKey = etagCache.keys().next().value;
  if (oldestKey !== undefined) etagCache.delete(oldestKey);
}

/**
 * Compute a strong ETag from file bytes (Bun.hash / wyhash). Cached by
 * `path + size + mtime` so we only re-hash when the file changes.
 *
 * Strong (not weak `W/`) because we actually hashed the payload — this
 * preserves byte-range / delta semantics per RFC 7232.
 */
async function computeStrongEtag(
  filePath: string,
  file: import("bun").BunFile,
): Promise<string> {
  const size = file.size;
  const mtime = file.lastModified;

  const cached = etagCache.get(filePath);
  if (cached && cached.size === size && cached.mtime === mtime) {
    return cached.etag;
  }

  // Bun.hash returns a number/bigint; stringify in base36 for compact ETag.
  // Fall back to size+mtime-derived ETag if hashing ever throws (edge-runtime
  // polyfills etc. — `Bun.hash` is a Bun-native primitive).
  let digest: string;
  try {
    const bytes = await file.arrayBuffer();
    const h = Bun.hash(bytes);
    digest = typeof h === "bigint" ? h.toString(36) : Number(h).toString(36);
  } catch {
    digest = `${size.toString(36)}-${mtime.toString(36)}`;
  }

  const etag = `"${digest}"`;
  etagCache.set(filePath, { size, mtime, etag });
  evictEtagCacheIfNeeded();
  return etag;
}

/** Exposed for tests — allows clearing the ETag cache between cases. */
export function __clearStaticEtagCacheForTests(): void {
  etagCache.clear();
}

/**
 * RFC 7232 §3.2 — `If-None-Match` comparison.
 *
 * Accepts:
 *   - `*` wildcard (matches any current representation)
 *   - a single ETag (`"abc"` or `W/"abc"`)
 *   - a comma-separated list
 *
 * Uses weak-comparison semantics (strip leading `W/`) because that is the
 * RFC-prescribed form for `If-None-Match`; a strong server-side ETag still
 * matches a weak client token if the opaque-string portion is equal.
 */
function matchesEtag(ifNoneMatch: string, currentEtag: string): boolean {
  const trimmed = ifNoneMatch.trim();
  if (trimmed === "*") return true;

  const normalize = (tag: string): string => {
    const t = tag.trim();
    return t.startsWith("W/") ? t.slice(2) : t;
  };

  const currentNormalized = normalize(currentEtag);
  for (const part of trimmed.split(",")) {
    if (normalize(part) === currentNormalized) return true;
  }
  return false;
}

/**
 * 경로가 허용된 디렉토리 내에 있는지 검증
 * Path traversal 공격 방지
 */
async function isPathSafe(filePath: string, allowedDir: string): Promise<boolean> {
  try {
    const resolvedPath = path.resolve(filePath);
    const resolvedAllowedDir = path.resolve(allowedDir);

    if (!resolvedPath.startsWith(resolvedAllowedDir + path.sep) &&
        resolvedPath !== resolvedAllowedDir) {
      return false;
    }

    // 파일이 없으면 안전 (존재하지 않는 경로)
    try {
      await fs.access(resolvedPath);
    } catch {
      return true;
    }

    // Symlink 해결 후 재검증
    const realPath = await fs.realpath(resolvedPath);
    const realAllowedDir = await fs.realpath(resolvedAllowedDir);

    return realPath.startsWith(realAllowedDir + path.sep) ||
           realPath === realAllowedDir;
  } catch (error) {
    console.warn(`[Mandu Security] Path validation failed: ${filePath}`, error);
    return false;
  }
}

/**
 * 정적 파일 서빙
 * - /.mandu/client/* : 클라이언트 번들 (Island hydration)
 * - /public/* : 정적 에셋 (이미지, CSS 등)
 * - /favicon.ico : 파비콘
 *
 * 보안: Path traversal 공격 방지를 위해 모든 경로를 검증합니다.
 */
async function serveStaticFile(pathname: string, settings: ServerRegistrySettings, request?: Request): Promise<StaticFileResult> {
  let filePath: string | null = null;
  let isBundleFile = false;
  let allowedBaseDir: string;
  let relativePath: string;

  // 1. 클라이언트 번들 파일 (/.mandu/client/*)
  if (pathname.startsWith("/.mandu/client/")) {
    // pathname에서 prefix 제거 후 안전하게 조합
    relativePath = pathname.slice("/.mandu/client/".length);
    allowedBaseDir = path.join(settings.rootDir, ".mandu", "client");
    isBundleFile = true;
  }
  // 2. Public 폴더 파일 (/public/*)
  else if (pathname.startsWith("/public/")) {
    relativePath = pathname.slice("/public/".length);
    allowedBaseDir = path.join(settings.rootDir, settings.publicDir);
  }
  // 3. .well-known/ 디렉토리 (#178: RFC 8615 표준 — Chrome DevTools, ACME, etc.)
  else if (pathname.startsWith("/.well-known/")) {
    relativePath = pathname.slice(1); // ".well-known/..."
    allowedBaseDir = path.join(settings.rootDir, settings.publicDir);
  }
  // 4. Public 폴더의 루트 파일 (favicon.ico, robots.txt 등)
  else if (
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.json"
  ) {
    relativePath = path.basename(pathname);
    allowedBaseDir = path.join(settings.rootDir, settings.publicDir);
  } else {
    return { handled: false }; // 정적 파일이 아님
  }

  // URL 디코딩 (실패 시 차단)
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch {
    return { handled: true, response: createStaticErrorResponse(400) };
  }

  // 정규화 + Null byte 방지
  const normalizedPath = path.posix.normalize(decodedPath);
  if (normalizedPath.includes("\0")) {
    console.warn(`[Mandu Security] Null byte attack detected: ${pathname}`);
    return { handled: true, response: createStaticErrorResponse(400) };
  }

  const normalizedSegments = normalizedPath.split("/");
  if (normalizedSegments.some((segment) => segment === "..")) {
    return { handled: true, response: createStaticErrorResponse(403) };
  }

  // 선행 슬래시 제거 → path.join이 base를 무시하지 않도록 보장
  const safeRelativePath = normalizedPath.replace(/^\/+/, "");
  filePath = path.join(allowedBaseDir, safeRelativePath);

  // 최종 경로 검증: 허용된 디렉토리 내에 있는지 확인
  if (!(await isPathSafe(filePath, allowedBaseDir!))) {
    console.warn(`[Mandu Security] Path traversal attempt blocked: ${pathname}`);
    return { handled: true, response: createStaticErrorResponse(403) };
  }

  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      return { handled: true, response: createStaticErrorResponse(404) };
    }

    const mimeType = getMimeType(filePath);
    const filename = path.basename(filePath);

    // Cache-Control — Issue #218: `immutable` is only safe when the URL
    // contains a content hash. Stable-name bundles (globals.css, runtime.js)
    // must use `max-age=0, must-revalidate` or clients will serve stale
    // bytes until a hard refresh.
    //
    // Bundle files go through the hash-aware policy; non-bundle assets
    // (public/*, favicon, etc.) keep the conservative 1-day cache they had
    // before — they're user-controlled and unlikely to change per deploy.
    let cacheControl: string;
    if (settings.isDev) {
      cacheControl = "no-cache, no-store, must-revalidate";
    } else if (isBundleFile) {
      cacheControl = computeStaticCacheControl(filename, /* isDev */ false);
    } else {
      cacheControl = "public, max-age=86400";
    }

    // Strong ETag from content hash for bundle files — enables cheap 304
    // round-trips when the client revalidates (`If-None-Match`).
    // Non-bundle static files keep a weak size+mtime validator (same as
    // pre-#218 behaviour) — we don't pay the hash cost for user-owned
    // `public/*` content the framework doesn't control.
    const etag = isBundleFile
      ? await computeStrongEtag(filePath, file)
      : `W/"${file.size.toString(36)}-${file.lastModified.toString(36)}"`;

    // 304 Not Modified — unnecessary transfer avoidance. We compare the
    // full `If-None-Match` string; RFC 7232 also allows a comma-separated
    // list and `*`, so handle those two forms explicitly.
    const ifNoneMatch = request?.headers.get("If-None-Match");
    if (ifNoneMatch && matchesEtag(ifNoneMatch, etag)) {
      return {
        handled: true,
        response: new Response(null, {
          status: 304,
          headers: { "ETag": etag, "Cache-Control": cacheControl },
        }),
      };
    }

    return {
      handled: true,
      response: new Response(file, {
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": cacheControl,
          "ETag": etag,
        },
      }),
    };
  } catch {
    return { handled: true, response: createStaticErrorResponse(500) };
  }
}

// ========== Request Handler ==========

function unauthorizedControlResponse(): Response {
  return Response.json({ error: "Unauthorized runtime control request" }, { status: 401 });
}

function resolveInternalCacheTarget(payload: Record<string, unknown>): string {
  if (typeof payload.path === "string" && payload.path.length > 0) {
    return `path=${payload.path}`;
  }
  if (typeof payload.tag === "string" && payload.tag.length > 0) {
    return `tag=${payload.tag}`;
  }
  if (payload.all === true) {
    return "all";
  }
  return "unknown";
}

async function handleInternalCacheControlRequest(
  req: Request,
  settings: ServerRegistrySettings
): Promise<Response> {
  const expectedToken = settings.managementToken;
  const providedToken = req.headers.get("x-mandu-control-token");

  if (!expectedToken || providedToken !== expectedToken) {
    return unauthorizedControlResponse();
  }

  const store = settings.cacheStore ?? null;
  if (!store) {
    return Response.json({
      enabled: false,
      message: "Runtime cache is disabled for this server instance.",
      stats: null,
    });
  }

  if (req.method === "GET") {
    const stats = getCacheStoreStats(store);
    return Response.json({
      enabled: true,
      message: "Runtime cache is available.",
      stats,
    });
  }

  if (req.method === "POST" || req.method === "DELETE") {
    let payload: Record<string, unknown> = {};
    if (req.method === "POST") {
      try {
        payload = await req.json() as Record<string, unknown>;
      } catch (parseErr) {
        const detail = parseErr instanceof Error ? parseErr.message : "Invalid JSON";
        return Response.json({ error: "Invalid JSON body", detail, hint: "Ensure the request body is valid JSON (e.g., no trailing commas, unquoted keys, or truncated input)." }, { status: 400 });
      }
    } else {
      payload = { all: true };
    }

    const before = store.size;
    if (typeof payload.path === "string" && payload.path.length > 0) {
      store.deleteByPath(payload.path);
    } else if (typeof payload.tag === "string" && payload.tag.length > 0) {
      store.deleteByTag(payload.tag);
    } else if (payload.all === true) {
      store.clear();
    } else {
      return Response.json({
        error: "Provide one of: { path }, { tag }, or { all: true }",
      }, { status: 400 });
    }

    const after = store.size;
    const stats: CacheStoreStats | null = getCacheStoreStats(store);

    return Response.json({
      enabled: true,
      cleared: Math.max(0, before - after),
      target: resolveInternalCacheTarget(payload),
      stats,
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed", allowed: ["GET", "POST", "DELETE"], hint: `Received '${req.method}'. This endpoint accepts GET (read stats), POST (clear by path/tag), and DELETE (clear all).` }), { status: 405, headers: { "Content-Type": "application/json", "Allow": "GET, POST, DELETE" } });
}

async function handleRequest(req: Request, router: Router, registry: ServerRegistry): Promise<Response> {
  const requestStart = Date.now();
  // Phase 1-4: Correlation ID — 한 요청에서 발생하는 모든 이벤트를 추적
  const correlationId = req.headers.get("x-mandu-request-id") ?? newId();

  // ─── Phase 18.θ — TRACING wrap (absolute TOP of request handler) ─────────
  // Opens a root server span BEFORE γ's prerendered check, BEFORE ζ's
  // cache check, BEFORE any other Phase 18 logic. The span is bound to
  // AsyncLocalStorage so every downstream `await` (middleware chain,
  // filling loader, SSR render, sandbox exec) inherits it transparently
  // via `getActiveSpan()` / `ctx.span`.
  //
  // Parent context: honours an incoming W3C `traceparent` header so
  // upstream gateways / load balancers can correlate traces across
  // service boundaries. Missing / malformed header → a new root trace-id.
  //
  // Zero overhead when tracing is disabled: `settings.tracer` is
  // `undefined`, the `if` falls through, and we call the uninstrumented
  // path exactly as before.
  const tracer = registry.settings.tracer;
  if (tracer && tracer.enabled) {
    const url = new URL(req.url);
    const rootSpan = tracer.startSpanFromRequest("http.request", req, {
      kind: "server",
      attributes: {
        "http.method": req.method,
        "http.url": req.url,
        "http.target": url.pathname,
        "http.scheme": url.protocol.replace(":", ""),
        "http.host": url.host,
        "mandu.correlation_id": correlationId,
      },
    });
    try {
      const response = await runWithSpan(rootSpan, () =>
        handleRequestWithTracing(req, router, registry, requestStart, correlationId)
      );
      rootSpan.setAttribute("http.status_code", response.status);
      if (response.status >= 500) {
        rootSpan.setStatus("error", `HTTP ${response.status}`);
      } else if (rootSpan.status === "unset") {
        rootSpan.setStatus("ok");
      }
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rootSpan.setStatus("error", msg);
      throw err;
    } finally {
      rootSpan.end();
    }
  }
  // ─── End Phase 18.θ ──────────────────────────────────────────────────────

  return await handleRequestWithTracing(req, router, registry, requestStart, correlationId);
}

/**
 * Phase 18.θ — inner request handler. Extracted from {@link handleRequest}
 * so the tracing wrap at the top can run the body inside a
 * `runWithSpan()` scope without a giant indent level. Preserves the
 * exact pre-tracing semantics (correlation-id logging, Cache-Control
 * stamping, eventBus emission).
 */
async function handleRequestWithTracing(
  req: Request,
  router: Router,
  registry: ServerRegistry,
  requestStart: number,
  correlationId: string
): Promise<Response> {
  const result = await handleRequestInternal(req, router, registry);

  if (!result.ok) {
    const errorResponse = errorToResponse(result.error, registry.settings.isDev);
    if (registry.settings.isDev) {
      // #177: dev 모드 에러 응답도 캐시 방지
      if (!errorResponse.headers.has("Cache-Control")) {
        errorResponse.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
      }
      const url = new URL(req.url);
      const p = url.pathname;
      if (!p.startsWith("/.mandu/") && !p.startsWith("/__kitchen") && !p.startsWith("/__mandu/")) {
        const elapsed = Date.now() - requestStart;
        console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${p} ${errorResponse.status} ${elapsed}ms`);
        recordRequest({ id: correlationId, method: req.method, path: p, status: errorResponse.status, duration: elapsed, timestamp: Date.now() });
        // Phase 1-2: HTTP 요청 → EventBus
        eventBus.emit({
          type: "http",
          severity: errorResponse.status >= 500 ? "error" : errorResponse.status >= 400 ? "warn" : "info",
          source: "server",
          correlationId,
          message: `${req.method} ${p} ${errorResponse.status}`,
          duration: elapsed,
          data: { method: req.method, path: p, status: errorResponse.status, error: true },
        });
      }
    }
    // Phase 18.μ — stamp locale hint on error responses too.
    const errI18nState = i18nRequestState.get(req);
    if (errI18nState && !errorResponse.headers.has("Content-Language")) {
      try {
        errorResponse.headers.set("Content-Language", errI18nState.locale.code);
      } catch {
        // Some adapters freeze headers on error responses — ignore.
      }
    }
    return errorResponse;
  }

  if (registry.settings.isDev) {
    const url = new URL(req.url);
    const p = url.pathname;

    // #177: dev 모드에서 SSR HTML 응답에 Cache-Control 헤더 추가
    // 브라우저가 오래된 HTML을 캐시하여 변경사항이 반영 안 되는 문제 방지
    if (!result.value.headers.has("Cache-Control")) {
      result.value.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
    }

    if (!p.startsWith("/.mandu/") && !p.startsWith("/__kitchen") && !p.startsWith("/__mandu/")) {
      const elapsed = Date.now() - requestStart;
      const status = result.value.status;
      const cacheHdr = result.value.headers.get("X-Mandu-Cache") ?? "";
      const cacheTag = cacheHdr ? ` ${cacheHdr}` : "";
      console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${p} ${status} ${elapsed}ms${cacheTag}`);
      recordRequest({ id: correlationId, method: req.method, path: p, status, duration: elapsed, timestamp: Date.now(), cacheStatus: cacheHdr || undefined });
      // Phase 1-2: HTTP 요청 → EventBus
      eventBus.emit({
        type: "http",
        severity: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        source: "server",
        correlationId,
        message: `${req.method} ${p} ${status}${cacheTag}`,
        duration: elapsed,
        data: { method: req.method, path: p, status, cache: cacheHdr || undefined },
      });
    }
  }

  // Phase 18.μ — stamp locale-sensitive caching hints onto the final
  // response. `Vary: Accept-Language, Cookie` ensures upstream caches
  // key correctly per locale signal; `Content-Language` surfaces the
  // resolved locale for SEO / screen-reader parity. Only stamped when
  // i18n is configured AND the request was actually resolved — the hot
  // path is branch-free when `i18n` is absent.
  const i18nState = i18nRequestState.get(req);
  if (i18nState) {
    const existingVary = result.value.headers.get("Vary");
    const varyParts = new Set(
      (existingVary ? existingVary.split(",") : [])
        .map((s) => s.trim())
        .filter(Boolean)
    );
    varyParts.add("Accept-Language");
    varyParts.add("Cookie");
    result.value.headers.set("Vary", [...varyParts].join(", "));
    if (!result.value.headers.has("Content-Language")) {
      result.value.headers.set("Content-Language", i18nState.locale.code);
    }
  }

  return result.value;
}

// ---------- API Route Handler ----------

/**
 * API 라우트 처리
 */
async function handleApiRoute(
  req: Request,
  route: { id: string; pattern: string },
  params: Record<string, string>,
  registry: ServerRegistry
): Promise<Result<Response>> {
  const handler = registry.apiHandlers.get(route.id);

  if (!handler) {
    return err(createHandlerNotFoundResponse(route.id, route.pattern));
  }

  try {
    const response = await handler(req, params);
    return ok(response);
  } catch (errValue) {
    const error = errValue instanceof Error ? errValue : new Error(String(errValue));
    return err(createSSRErrorResponse(route.id, route.pattern, error));
  }
}

// ---------- Metadata Route Handler (Issue #206) ----------

/**
 * Dispatch a metadata route (sitemap / robots / llms.txt / manifest).
 *
 * The registry stores a thunk that lazily imports the user module
 * on the first request. We delegate the actual validation + render
 * + Response assembly to `dispatchMetadataRoute()` from
 * `@mandujs/core/routes` so the pipeline stays testable in isolation.
 *
 * A missing registration falls through to the framework's
 * "handler not found" 500 response — typically only reachable if the
 * scanner detected the file but `registerManifestHandlers` skipped it
 * (which would be a framework bug).
 */
async function handleMetadataRouteRequest(
  route: RouteSpec,
  registry: ServerRegistry
): Promise<Result<Response>> {
  if (route.kind !== "metadata") {
    return err(createHandlerNotFoundResponse(route.id, route.pattern));
  }
  const handler = registry.metadataHandlers.get(route.id);
  if (!handler) {
    return err(createHandlerNotFoundResponse(route.id, route.pattern));
  }

  try {
    const userExport = await handler();
    const response = await dispatchMetadataRoute({
      kind: route.metadataKind,
      userExport,
      sourceFile: route.module,
    });
    return ok(response);
  } catch (errValue) {
    const error = errValue instanceof Error ? errValue : new Error(String(errValue));
    return err(createSSRErrorResponse(route.id, route.pattern, error));
  }
}

// ---------- Page Data Loader ----------

/**
 * Merge any pending Set-Cookie headers from ctx.cookies into the given
 * Response. Used when a loader short-circuits via `redirect(...)` — session
 * mutations made before the redirect call must still be emitted.
 *
 * CookieManager.applyToResponse already handles the no-op case (empty
 * cookie set); we guard first anyway to avoid cloning the Response body
 * unnecessarily (Response.redirect's body is always null, but keeping
 * this cheap).
 */
function mergeCookiesIntoResponse(response: Response, cookies: CookieManager): Response {
  if (!cookies.hasPendingCookies()) return response;
  return cookies.applyToResponse(response);
}

/**
 * Phase 6.3: derive a short opaque digest for an Error so dev and prod
 * renders can both reference the same log entry. Not a security token —
 * just a correlation aid. We hash `message + top stack frame` for a
 * stable-ish 8-char hex that survives the same error thrown twice.
 *
 * Exported for unit testing. Not part of the public API.
 */
export function computeErrorDigest(error: Error): string {
  const source = `${error.message ?? ""}::${(error.stack ?? "").split("\n")[1] ?? ""}`;
  // FNV-1a 32-bit — cheap, no deps, deterministic. Avoids pulling crypto.
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Phase 6.3: redact an Error for the rendered error-boundary surface.
 *
 * In dev: pass-through — `error.tsx` sees the original Error unchanged.
 * In prod: produce a clone with
 *   - `.message` kept (users want a hint)
 *   - `.stack` trimmed to the error header + the top 3 frames (enough
 *     to tell "it's my code" vs "it's node_modules" without leaking the
 *     whole call tree to the browser)
 *   - the original `.name` preserved
 *
 * The returned value is always an Error (or subclass), so React rendering
 * can treat it uniformly. A matching digest is computed and returned so
 * the caller can pass it to the `digest` prop.
 *
 * Exported for unit testing. Not part of the public API.
 */
export function redactErrorForBoundary(error: Error, isDev: boolean): { error: Error; digest: string } {
  const digest = computeErrorDigest(error);
  if (isDev) {
    return { error, digest };
  }
  const redacted = new Error(error.message);
  redacted.name = error.name;
  if (typeof error.stack === "string") {
    const lines = error.stack.split("\n");
    // Keep the header line (`Error: msg`) + up to 3 frames.
    redacted.stack = lines.slice(0, 4).join("\n");
  } else {
    redacted.stack = undefined;
  }
  return { error: redacted, digest };
}

/**
 * Phase 18.ζ — per-request 로더 캐시 메타데이터. loader 반환값의 `_cache`
 * 프로퍼티 또는 `ctx.cache.*` 플루언트 호출에서 수집되어 렌더 후 캐시
 * 저장 단계에서 route-level defaults 와 merge 된다.
 */
export interface RuntimeCacheMeta {
  tags: string[];
  maxAge?: number;
  staleWhileRevalidate?: number;
}

interface PageLoadResult {
  loaderData: unknown;
  cookies?: CookieManager;
  /** Layout별 loader 데이터 (모듈 경로 → 데이터) */
  layoutData?: Map<string, unknown>;
  /** Phase 18.ζ — per-request 캐시 메타데이터 (_cache or ctx.cache.*) */
  cacheMeta?: RuntimeCacheMeta;
  /**
   * If the page's loader returned or threw a redirect Response, it surfaces
   * here. Callers short-circuit SSR and emit this Response to the browser
   * with any pending ctx.cookies merged in (session/CSRF must survive).
   *
   * NOTE: a bare `throw new Error(...)` does NOT set this — only Response
   * instances with a redirect-range status + Location header. See
   * `isRedirectResponse()` in runtime/redirect.ts.
   */
  redirect?: Response;
  /**
   * Phase 6.3: page loader returned/threw `notFound()`. When set, the
   * caller renders `app/not-found.tsx` (if registered) or falls through
   * to the built-in 404. The original Response carries the message body
   * as plain text so it can be surfaced on the 404 page.
   *
   * NOTE: a bare `new Response(null, { status: 404 })` does NOT set this
   * — only `notFound()` from `runtime/not-found.ts` (checked via brand).
   */
  notFound?: Response;
}

/**
 * Phase 18.ζ — loader 반환값에서 `_cache` 블록을 분리한다.
 *
 * 반환값이 `{ _cache: {...}, ...rest }` 모양이면 `_cache` 를 추출하고
 * 나머지를 실제 loader 데이터로 돌려준다. `_cache` 형태가 잘못되면
 * 조용히 무시하여 런타임이 깨지지 않도록 한다.
 */
function extractCacheMetaFromReturn(
  returned: unknown
): { data: unknown; meta: RuntimeCacheMeta | null } {
  if (
    returned &&
    typeof returned === "object" &&
    !Array.isArray(returned) &&
    "_cache" in (returned as Record<string, unknown>)
  ) {
    const obj = returned as Record<string, unknown>;
    const raw = obj._cache as Record<string, unknown> | null | undefined;
    const data = obj.data ?? (() => {
      // { _cache, ...rest } → strip _cache from the object
      const { _cache: _omit, ...rest } = obj as Record<string, unknown>;
      return rest;
    })();
    if (!raw || typeof raw !== "object") {
      return { data, meta: null };
    }
    const tagsRaw = Array.isArray(raw.tags) ? raw.tags : [];
    const tags = tagsRaw.filter((t): t is string => typeof t === "string" && t.length > 0);
    const maxAgeRaw = typeof raw.maxAge === "number"
      ? raw.maxAge
      : typeof raw.revalidate === "number"
        ? raw.revalidate
        : undefined;
    const swrRaw = typeof raw.staleWhileRevalidate === "number"
      ? raw.staleWhileRevalidate
      : typeof raw.swr === "number"
        ? raw.swr
        : undefined;
    return {
      data,
      meta: { tags, maxAge: maxAgeRaw, staleWhileRevalidate: swrRaw },
    };
  }
  return { data: returned, meta: null };
}

/**
 * Phase 18.ζ — ctx.cache 스냅샷과 `_cache` 리턴 메타데이터를 병합한다.
 * 둘 다 없으면 null. 태그는 합집합, 숫자는 return 값이 우선.
 */
function mergeRuntimeCacheMeta(
  fromReturn: RuntimeCacheMeta | null,
  fromCtx: { tags: string[]; maxAge?: number; staleWhileRevalidate?: number } | null
): RuntimeCacheMeta | null {
  if (!fromReturn && !fromCtx) return null;
  const tags = new Set<string>();
  fromReturn?.tags?.forEach((t) => tags.add(t));
  fromCtx?.tags?.forEach((t) => tags.add(t));
  return {
    tags: [...tags],
    maxAge: fromReturn?.maxAge ?? fromCtx?.maxAge,
    staleWhileRevalidate: fromReturn?.staleWhileRevalidate ?? fromCtx?.staleWhileRevalidate,
  };
}

/**
 * 페이지 컴포넌트 및 loader 데이터 로딩
 */
async function loadPageData(
  req: Request,
  route: { id: string; pattern: string; layoutChain?: string[] },
  params: Record<string, string>,
  registry: ServerRegistry
): Promise<Result<PageLoadResult>> {
  let loaderData: unknown;

  // 1. PageHandler 방식 (신규 - filling 포함)
  const pageHandler = registry.pageHandlers.get(route.id);
  if (pageHandler) {
    let cookies: CookieManager | undefined;
    try {
      const registration = await ensurePageRouteMetadata(route.id, registry, pageHandler);

      // Filling의 loader 실행
      if (registration.filling?.hasLoader()) {
        const ctx = new ManduContext(req, params);
        attachI18nToContext(ctx, req);
        // DX-3: loader may return OR throw a redirect Response. Both are
        // short-circuits — if we detect one, skip SSR and hand the Response
        // to the caller with pending cookies merged in.
        // Phase 6.3: same semantics for notFound() — checked BEFORE redirect
        // so a loader that does `throw notFound()` surfaces through the
        // dedicated path rather than hitting the isRedirectResponse false
        // positive (it won't — notFound has no Location — but being explicit
        // prevents future regressions).
        let returned: unknown;
        try {
          returned = await registration.filling.executeLoader(ctx);
        } catch (thrown) {
          if (isNotFoundResponse(thrown)) {
            // Carry the pending cookies on the result so the renderer can
            // merge them onto the rendered not-found page (which is a
            // fresh Response — the nfResponse body isn't reused).
            const nfCookies = ctx.cookies.hasPendingCookies() ? ctx.cookies : undefined;
            return ok({ loaderData: undefined, notFound: thrown, cookies: nfCookies });
          }
          if (isRedirectResponse(thrown)) {
            const redirectResponse = mergeCookiesIntoResponse(thrown, ctx.cookies);
            return ok({ loaderData: undefined, redirect: redirectResponse });
          }
          throw thrown;
        }
        if (isNotFoundResponse(returned)) {
          const nfCookies = ctx.cookies.hasPendingCookies() ? ctx.cookies : undefined;
          return ok({ loaderData: undefined, notFound: returned, cookies: nfCookies });
        }
        if (isRedirectResponse(returned)) {
          const redirectResponse = mergeCookiesIntoResponse(returned, ctx.cookies);
          return ok({ loaderData: undefined, redirect: redirectResponse });
        }
        // Phase 18.ζ — per-request cache meta collection
        const { data: strippedData, meta: returnMeta } = extractCacheMetaFromReturn(returned);
        const mergedMeta = mergeRuntimeCacheMeta(returnMeta, ctx.getCacheMetaSnapshot());
        loaderData = strippedData;
        if (ctx.cookies.hasPendingCookies()) {
          cookies = ctx.cookies;
        }
        if (mergedMeta) {
          return ok({ loaderData, cookies, cacheMeta: mergedMeta });
        }
      }
    } catch (error) {
      const pageError = createPageLoadErrorResponse(
        route.id,
        route.pattern,
        error instanceof Error ? error : new Error(String(error))
      );
      console.error(`[Mandu] ${pageError.errorType}:`, pageError.message);
      return err(pageError);
    }

    return ok({ loaderData, cookies });
  }

  // 2. PageLoader 방식 (레거시 호환)
  const loader = registry.pageLoaders.get(route.id);
  if (loader) {
    try {
      const module = await loader();
      const exported: unknown = module.default;
      const exportedObj = exported as Record<string, unknown> | null;
      const component = typeof exported === "function"
        ? (exported as RouteComponent)
        : (exportedObj?.component ?? undefined);
      // DX-1: pageLoader 경로에서 malformed default export를 silent 404 로
      //보내지 않고 명시적 에러로 즉시 실패시킨다. 이전에는
      //   `export default "hello"` / `export default undefined` / named-only
      // 같은 실수가 registerRouteComponent(undefined) → defaultCreateApp
      // 에서 404로 렌더되어 사용자가 원인을 추적하기 어려웠음. 여기서 throw
      // 하면 try/catch(아래) 의 createPageLoadErrorResponse 가 500 응답과
      // 함께 route.id + pattern 을 출력해주므로 개발자가 바로 인지한다.
      if (typeof component !== "function") {
        const defaultSummary =
          exported === undefined
            ? "undefined (missing `export default`)"
            : exported === null
              ? "null"
              : `type ${typeof exported}`;
        throw new Error(
          `[Mandu] Page module for '${route.id}' (pattern ${route.pattern}) has an invalid default export: ${defaultSummary}. ` +
            "Expected `export default function Page() {…}` or `export default { component, filling }`. " +
            "If the page file is empty or only has named exports, add a default-exported React component."
        );
      }
      registry.registerRouteComponent(route.id, component as RouteComponent);

      // #186: page 모듈에서 metadata / generateMetadata export 캐싱
      const modObj = module as Record<string, unknown>;
      if (modObj.metadata && typeof modObj.metadata === "object") {
        registry.pageMetadata.set(route.id, modObj.metadata as Metadata);
      }
      if (typeof modObj.generateMetadata === "function") {
        registry.pageGenerateMetadata.set(
          route.id,
          modObj.generateMetadata as GenerateMetadata,
        );
      }

      // filling이 있으면 캐시 옵션 등록 + loader 실행
      // Support both page-module shapes:
      //   (a) `export default { component, filling }` — object default
      //   (b) `export default function Page()` + `export const filling = …`
      //       — function default with named filling export
      // (b) is the more natural TS/React shape; without this fallback, filling
      // silently does nothing and pages render without loader data.
      let cookies: CookieManager | undefined;
      const fillingFromDefault =
        typeof exported === "object" && exported !== null
          ? ((exportedObj as Record<string, unknown>)?.filling as ManduFilling | null | undefined)
          : null;
      const fillingFromNamed = modObj.filling as ManduFilling | null | undefined;
      const filling: ManduFilling | null = fillingFromDefault ?? fillingFromNamed ?? null;
      if (filling?.getCacheOptions?.()) {
        registry.cacheOptions.set(route.id, filling.getCacheOptions()!);
      }
      if (filling?.hasLoader?.()) {
        const ctx = new ManduContext(req, params);
        attachI18nToContext(ctx, req);
        // DX-3 / Phase 6.3: same redirect + notFound handling as the
        // PageHandler path above. notFound is checked first so both
        // short-circuits remain symmetric.
        let returned: unknown;
        try {
          returned = await filling.executeLoader(ctx);
        } catch (thrown) {
          if (isNotFoundResponse(thrown)) {
            const nfCookies = ctx.cookies.hasPendingCookies() ? ctx.cookies : undefined;
            return ok({ loaderData: undefined, notFound: thrown, cookies: nfCookies });
          }
          if (isRedirectResponse(thrown)) {
            const redirectResponse = mergeCookiesIntoResponse(thrown, ctx.cookies);
            return ok({ loaderData: undefined, redirect: redirectResponse });
          }
          throw thrown;
        }
        if (isNotFoundResponse(returned)) {
          const nfCookies = ctx.cookies.hasPendingCookies() ? ctx.cookies : undefined;
          return ok({ loaderData: undefined, notFound: returned, cookies: nfCookies });
        }
        if (isRedirectResponse(returned)) {
          const redirectResponse = mergeCookiesIntoResponse(returned, ctx.cookies);
          return ok({ loaderData: undefined, redirect: redirectResponse });
        }
        // Phase 18.ζ — per-request cache meta collection (legacy pageLoader path)
        const { data: strippedData, meta: returnMeta } = extractCacheMetaFromReturn(returned);
        const mergedMeta = mergeRuntimeCacheMeta(returnMeta, ctx.getCacheMetaSnapshot());
        loaderData = strippedData;
        if (ctx.cookies.hasPendingCookies()) {
          cookies = ctx.cookies;
        }
        if (mergedMeta) {
          return ok({ loaderData, cookies, cacheMeta: mergedMeta });
        }
      }

      return ok({ loaderData, cookies });
    } catch (error) {
      const pageError = createPageLoadErrorResponse(
        route.id,
        route.pattern,
        error instanceof Error ? error : new Error(String(error))
      );
      console.error(`[Mandu] ${pageError.errorType}:`, pageError.message);
      return err(pageError);
    }
  }

  return ok({ loaderData });
}

interface LayoutLoadResult {
  /** Layout별 loader 데이터 (모듈 경로 → 데이터) */
  data: Map<string, unknown>;
  /**
   * Layout chain이 ctx.cookies.set(...) 으로 쌓은 pending 쿠키들.
   * loader 여러 개가 쿠키를 쓰면 chain 순서대로 병합되어 단일 CookieManager가 됨
   * (부모 layout → 자식 layout 방향으로 later-wins).
   * 쓴 쿠키가 없으면 undefined.
   *
   * DX-2: 예전엔 layout slot의 ctx.cookies가 drop 됐음 — 이제 여기서 response로 전파된다.
   */
  cookies: CookieManager | undefined;
}

/**
 * Layout + Page CookieManager 병합.
 *
 * 규칙 (DX-2):
 * - layout 이 쓴 Set-Cookie 는 먼저, page 가 쓴 Set-Cookie 는 나중에 오도록 순서 고정.
 * - HTTP 상 같은 이름의 Set-Cookie 가 여러 번 붙으면 브라우저는 뒤에 온 것(= page)을 최종 값으로 채택.
 * - 이렇게 하면 middleware → handler 와 동일한 "뒤에 온 것이 이긴다" 관례를 유지.
 *
 * 구현은 raw-append 만 사용해서 한쪽 CookieManager 를 mutate 하지 않는다.
 * (page 의 응답 API [ctx.json 등] 가 내부적으로 page 의 CookieManager 를 다시 쓸 수 있으므로
 *  page CookieManager 를 mutate 해버리면 double-emit 위험이 생긴다.)
 */
function mergeCookieManagers(
  req: Request,
  layout: CookieManager | undefined,
  page: CookieManager | undefined,
): CookieManager | undefined {
  if (!layout && !page) return undefined;
  if (!layout) return page;
  if (!page) return layout;

  // 둘 다 있으면 빈 CookieManager 에 raw 로 layout → page 순서로 쌓는다.
  const merged = new CookieManager(req);
  for (const header of layout.getSetCookieHeaders()) {
    merged.appendRawSetCookie(header);
  }
  for (const header of page.getSetCookieHeaders()) {
    merged.appendRawSetCookie(header);
  }
  return merged;
}

/**
 * Layout chain의 모든 loader를 병렬 실행
 * 각 layout.slot.ts가 있으면 해당 데이터를 layout props로 전달
 *
 * Cookie 처리 (DX-2):
 * - 각 layout slot은 개별 ManduContext 에서 실행되므로 각자의 CookieManager 를 가짐
 * - 함수 리턴 전에 chain 순서대로 하나의 CookieManager 로 병합해 반환
 * - 같은 이름의 쿠키를 여러 layout 이 set 하면 layout chain 후반부(= children 에 가까운 쪽)가 이김
 */
async function loadLayoutData(
  req: Request,
  layoutChain: string[] | undefined,
  params: Record<string, string>,
  registry: ServerRegistry
): Promise<LayoutLoadResult> {
  const layoutData = new Map<string, unknown>();
  if (!layoutChain || layoutChain.length === 0) {
    return { data: layoutData, cookies: undefined };
  }

  // layout.slot.ts 파일 검색: layout 모듈 경로에서 .slot.ts 파일 경로 유도
  // 예: app/layout.tsx → spec/slots/layout.slot.ts (auto-link 규칙)
  // 또는 직접 등록된 layout loader에서 filling 추출

  const loaderEntries: { modulePath: string; slotPath: string }[] = [];
  for (const modulePath of layoutChain) {
    // 캐시된 결과 확인
    if (registry.layoutSlotPaths.has(modulePath)) {
      const cached = registry.layoutSlotPaths.get(modulePath);
      if (cached) loaderEntries.push({ modulePath, slotPath: cached });
      continue;
    }

    // layout.tsx → layout 이름 추출 → 같은 디렉토리에서 .slot.ts 검색
    const layoutName = path.basename(modulePath, path.extname(modulePath));
    const slotCandidates = [
      path.join(path.dirname(modulePath), `${layoutName}.slot.ts`),
      path.join(path.dirname(modulePath), `${layoutName}.slot.tsx`),
    ];
    let found = false;
    for (const slotPath of slotCandidates) {
      try {
        const fullPath = path.join(registry.settings.rootDir, slotPath);
        const file = Bun.file(fullPath);
        if (await file.exists()) {
          registry.layoutSlotPaths.set(modulePath, fullPath);
          loaderEntries.push({ modulePath, slotPath: fullPath });
          found = true;
          break;
        }
      } catch {
        // 파일 없으면 스킵
      }
    }
    if (!found) {
      registry.layoutSlotPaths.set(modulePath, null); // 없음 캐시
    }
  }

  if (loaderEntries.length === 0) return { data: layoutData, cookies: undefined };

  const results = await Promise.all(
    loaderEntries.map(async ({ modulePath, slotPath }) => {
      try {
        const module = await import(slotPath);
        const exported = module.default;
        // layout.slot.ts가 ManduFilling이면 loader 실행
        if (exported && typeof exported === "object" && "executeLoader" in exported) {
          const filling = exported as ManduFilling;
          if (filling.hasLoader()) {
            const ctx = new ManduContext(req, params);
            attachI18nToContext(ctx, req);
            const data = await filling.executeLoader(ctx);
            // DX-3: layout loaders are NOT allowed to redirect. They share
            // the pipeline with a page loader and we can only honor one
            // redirect — the page's wins (authoritative). If a layout
            // returned a Response we log + discard it (keeping cookies
            // the layout may have set). Users who want layout-level auth
            // should put the redirect in the page's loader.
            if (isRedirectResponse(data)) {
              console.warn(
                `[Mandu] Layout loader for ${modulePath} returned a redirect Response; ignoring. ` +
                  `Put redirect() in a page loader instead — layout loaders cannot short-circuit rendering.`
              );
              const cookies = ctx.cookies.hasPendingCookies() ? ctx.cookies : undefined;
              return { modulePath, data: undefined, cookies };
            }
            const cookies = ctx.cookies.hasPendingCookies() ? ctx.cookies : undefined;
            return { modulePath, data, cookies };
          }
        }
      } catch (error) {
        // A thrown redirect Response from a layout would land here —
        // same rule: ignore, it's not the layout's decision to make.
        if (isRedirectResponse(error)) {
          console.warn(
            `[Mandu] Layout loader for ${modulePath} threw a redirect Response; ignoring. ` +
              `Put redirect() in a page loader instead.`
          );
        } else {
          console.warn(`[Mandu] Layout loader failed for ${modulePath}:`, error);
        }
      }
      return { modulePath, data: undefined, cookies: undefined };
    })
  );

  // chain 순서 유지: loaderEntries 순으로 결과를 순회
  // (Promise.all 은 입력 순서대로 배열을 보존하므로 results 의 index 가 chain 순서와 일치)
  //
  // Layout chain 단일 쿠키 병합 전략 (DX-2):
  // - 쿠키를 쓴 layout 이 하나라도 있으면 빈 CookieManager 를 만들고 chain 순서대로 raw-append
  // - 같은 이름의 쿠키를 여러 layout 이 set 하면 chain 후반부(= children 에 가까운 쪽)가 뒤에 나오므로
  //   브라우저 semantics 상 이김 (HTTP 상 마지막 Set-Cookie 가 최종 값)
  // - 개별 loader 의 CookieManager 를 mutate 하지 않음 (test assertion 안전성 확보)
  let mergedCookies: CookieManager | undefined;
  for (const { modulePath, data, cookies } of results) {
    if (data !== undefined) {
      layoutData.set(modulePath, data);
    }
    if (cookies) {
      if (!mergedCookies) {
        mergedCookies = new CookieManager(req);
      }
      for (const rawSetCookie of cookies.getSetCookieHeaders()) {
        mergedCookies.appendRawSetCookie(rawSetCookie);
      }
    }
  }

  return { data: layoutData, cookies: mergedCookies };
}

// ---------- SSR Renderer ----------

/**
 * #186: URL에서 searchParams를 Record<string, string>로 추출 (SEO 모듈 시그니처)
 */
function extractSearchParams(url: string): Record<string, string> {
  try {
    const u = new URL(url);
    const result: Record<string, string> = {};
    for (const [key, value] of u.searchParams.entries()) {
      if (!(key in result)) result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * #186: layout chain + page metadata를 순서대로 수집해 MetadataItem[] 구성
 * - 각 layout의 generateMetadata 우선, 없으면 static metadata
 * - page 모듈의 generateMetadata 우선, 없으면 static metadata
 * - 결과 배열을 SEO 모듈의 resolveMetadata에 전달
 */
async function collectMetadataItems(
  route: { id: string; layoutChain?: string[] },
  registry: ServerRegistry,
): Promise<MetadataItem[]> {
  const items: MetadataItem[] = [];

  if (route.layoutChain) {
    for (const layoutPath of route.layoutChain) {
      // Layout 모듈 로드 → metadata / generateMetadata 캐시 채움
      await registry.getLayoutComponent(layoutPath);
      const dyn = registry.layoutGenerateMetadata.get(layoutPath);
      if (dyn) {
        items.push(dyn);
        continue;
      }
      const staticMeta = registry.layoutMetadata.get(layoutPath);
      if (staticMeta) items.push(staticMeta);
    }
  }

  const pageDyn = registry.pageGenerateMetadata.get(route.id);
  if (pageDyn) {
    items.push(pageDyn);
  } else {
    const pageStatic = registry.pageMetadata.get(route.id);
    if (pageStatic) items.push(pageStatic);
  }

  return items;
}

/**
 * #186: 해석된 Metadata를 SSR 옵션(title + headTags)으로 변환
 */
async function buildSSRMetadata(
  route: { id: string; layoutChain?: string[] },
  params: Record<string, string>,
  url: string,
  registry: ServerRegistry,
): Promise<{ title: string; headTags: string }> {
  try {
    const items = await collectMetadataItems(route, registry);
    if (items.length === 0) {
      return { title: "Mandu App", headTags: "" };
    }
    const resolved = await resolveMetadata(items, params, extractSearchParams(url));
    const titleHtml = renderTitle(resolved);
    const headTags = renderMetadata(resolved);
    // resolveMetadata는 <title>을 headTags 안에 이미 포함시키므로,
    // 중복 방지를 위해 title은 문자열만 뽑고 headTags에서 <title>을 제거
    const title = extractTitleText(titleHtml) ?? "Mandu App";
    const headWithoutTitle = headTags.replace(/<title>[^<]*<\/title>\n?/i, "");
    return { title, headTags: headWithoutTitle };
  } catch (error) {
    console.warn("[Mandu] metadata resolution failed:", error);
    return { title: "Mandu App", headTags: "" };
  }
}

function extractTitleText(titleHtml: string): string | null {
  const match = /<title>([^<]*)<\/title>/i.exec(titleHtml);
  return match ? match[1] : null;
}

/**
 * SSR 렌더링 (Streaming/Non-streaming)
 */
async function renderPageSSR(
  route: { id: string; pattern: string; layoutChain?: string[]; streaming?: boolean; hydration?: HydrationConfig; errorModule?: string; loadingModule?: string; notFoundModule?: string },
  params: Record<string, string>,
  loaderData: unknown,
  url: string,
  registry: ServerRegistry,
  cookies?: CookieManager,
  layoutData?: Map<string, unknown>
): Promise<Result<Response>> {
  const settings = registry.settings;
  const defaultAppCreator = createDefaultAppFactory(registry);
  const appCreator = registry.createAppFn || defaultAppCreator;

  try {
    let app = appCreator({
      routeId: route.id,
      url,
      params,
      loaderData,
    });

    // Phase 18.β — per-route Suspense wrapper (Next.js `loading.tsx` parity).
    // If the route declared a `loading.tsx`, wrap the page element in a
    // `<Suspense fallback={<Loading/>}>` so async children (async server
    // components, React.lazy island hosts) can suspend without losing the
    // layout chain. Fallback import failure downgrades to render-without-
    // fallback rather than crashing the route.
    if (route.loadingModule) {
      try {
        const loadingMod = await import(path.join(settings.rootDir, route.loadingModule));
        const LoadingComponent = loadingMod.default as React.ComponentType<unknown>;
        if (typeof LoadingComponent === "function") {
          const fallback = React.createElement(LoadingComponent, {});
          app = React.createElement(React.Suspense, { fallback }, app);
        }
      } catch (loadingImportError) {
        if (settings.isDev) {
          console.warn(
            `[Mandu] loading.tsx import failed for ${route.id}; rendering without Suspense fallback:`,
            loadingImportError,
          );
        }
      }
    }

    // Island 래핑: 레이아웃 적용 전에 페이지 콘텐츠만 island div로 감쌈
    // 이렇게 하면 레이아웃은 island 바깥에 위치하여 하이드레이션 시 레이아웃이 유지됨
    const needsIslandWrap =
      route.hydration &&
      route.hydration.strategy !== "none" &&
      settings.bundleManifest;

    if (needsIslandWrap) {
      const bundle = settings.bundleManifest?.bundles[route.id];
      const bundleSrc = bundle?.js ? `${bundle.js}?t=${Date.now()}` : "";
      const priority = route.hydration!.priority || "visible";
      app = React.createElement("div", {
        "data-mandu-island": route.id,
        "data-mandu-src": bundleSrc,
        "data-mandu-priority": priority,
        style: { display: "contents" },
      }, app);
    }

    // 레이아웃 체인 적용 (island 래핑 후 → 레이아웃은 island 바깥)
    if (route.layoutChain && route.layoutChain.length > 0) {
      app = await wrapWithLayouts(app, route.layoutChain, registry, params, layoutData);
    }

    const serverData = loaderData
      ? { [route.id]: { serverData: loaderData } }
      : undefined;

    // #186: layout chain + page metadata 병합
    const builtMeta = await buildSSRMetadata(route, params, url, registry);

    // Streaming SSR 모드 결정
    const useStreaming = route.streaming !== undefined
      ? route.streaming
      : settings.streaming;

    // Issue #198 / Phase 18.ξ — Async server component resolution policy.
    //
    // Non-streaming path (`renderToString`) cannot handle async components,
    // so we MUST pre-resolve the tree up-front.
    //
    // Streaming path (`renderToReadableStream`, React 19) supports async
    // components natively and is designed around progressive flushing. If
    // we pre-resolve here, the caller blocks until every async component
    // settles before the shell can be emitted — defeating the entire point
    // of streaming (`TTFB` regresses from shell-ready to slowest-component).
    // So in streaming mode we hand React the raw async tree. Head tags
    // pushed from async components are captured by `renderToStream`'s
    // `buildHtmlTail` (late-head injection) via `use-head`. The streaming
    // shell-gen's `collectStreamingHeadTags` pre-pass uses `renderToString`
    // internally and will throw on async trees — its try/catch already
    // handles that case and returns an empty string, so the early shell
    // emission is still correct; the late-head script fills in any
    // metadata emitted during the async render.
    if (!useStreaming) {
      app = (await resolveAsyncElement(app)) as React.ReactElement;
    }

    if (useStreaming) {
      const streamingResponse = await renderStreamingResponse(app, {
        title: builtMeta.title,
        headTags: builtMeta.headTags,
        isDev: settings.isDev,
        hmrPort: settings.hmrPort,
        routeId: route.id,
        routePattern: route.pattern,
        hydration: route.hydration,
        bundleManifest: settings.bundleManifest,
        criticalData: loaderData as Record<string, unknown> | undefined,
        enableClientRouter: true,
        cssPath: settings.cssPath,
        transitions: settings.transitions,
        prefetch: settings.prefetch,
        spa: settings.spa,
        devtools: settings.devtools,
        onShellReady: () => {
          if (settings.isDev) {
            console.log(`[Mandu Streaming] Shell ready: ${route.id}`);
          }
        },
        onMetrics: (metrics) => {
          if (settings.isDev) {
            console.log(`[Mandu Streaming] Metrics for ${route.id}:`, {
              shellReadyTime: `${metrics.shellReadyTime}ms`,
              allReadyTime: `${metrics.allReadyTime}ms`,
              hasError: metrics.hasError,
            });
          }
        },
      });
      return ok(cookies ? cookies.applyToResponse(streamingResponse) : streamingResponse);
    }

    // 기존 renderToString 방식
    // Note: hydration 래핑은 위에서 React 엘리먼트 레벨로 이미 처리됨
    // renderToHTML에서 중복 래핑하지 않도록 hydration을 전달하되 strategy를 "none"으로 설정
    // 단, hydration 스크립트(importmap, runtime 등)는 여전히 필요하므로 bundleManifest는 유지
    const ssrResponse = renderSSR(app, {
      title: builtMeta.title,
      headTags: builtMeta.headTags,
      isDev: settings.isDev,
      hmrPort: settings.hmrPort,
      routeId: route.id,
      hydration: route.hydration,
      bundleManifest: settings.bundleManifest,
      serverData,
      enableClientRouter: true,
      routePattern: route.pattern,
      cssPath: settings.cssPath,
      islandPreWrapped: !!needsIslandWrap,
      transitions: settings.transitions,
      prefetch: settings.prefetch,
      spa: settings.spa,
      devtools: settings.devtools,
    });
    return ok(cookies ? cookies.applyToResponse(ssrResponse) : ssrResponse);
  } catch (error) {
    const renderError = error instanceof Error ? error : new Error(String(error));

    // Route-level ErrorBoundary: errorModule이 있으면 해당 컴포넌트로 에러 렌더링
    if (route.errorModule) {
      try {
        const errorMod = await import(path.join(settings.rootDir, route.errorModule));
        const ErrorComponent = errorMod.default as React.ComponentType<ErrorFallbackProps>;
        if (ErrorComponent) {
          // Phase 6.3: redact stack in prod, keep full fidelity in dev.
          // Full error is always logged below; only the client-visible
          // `error` prop is trimmed.
          const { error: boundaryError, digest } = redactErrorForBoundary(
            renderError,
            settings.isDev,
          );
          const errorElement = React.createElement(ErrorComponent, {
            error: boundaryError,
            errorInfo: undefined,
            resetError: () => {}, // SSR에서는 noop — 클라이언트 hydration 시 실제 동작
            digest,
          });

          // 레이아웃은 유지하면서 에러 컴포넌트만 교체
          let errorApp: React.ReactElement = errorElement;
          if (route.layoutChain && route.layoutChain.length > 0) {
            errorApp = await wrapWithLayouts(errorApp, route.layoutChain, registry, params, layoutData);
          }

          // Issue #198 — resolve async layouts wrapping the error component
          // so `async function Layout()` still renders on the 500 surface.
          errorApp = (await resolveAsyncElement(errorApp)) as React.ReactElement;

          const errorHtml = renderSSR(errorApp, {
            // 에러 상태에서는 resolveMetadata 결과를 신뢰할 수 없을 수 있으므로 리터럴 사용
            title: "Mandu App — Error",
            isDev: settings.isDev,
            cssPath: settings.cssPath,
            transitions: settings.transitions,
            prefetch: settings.prefetch,
            spa: settings.spa,
            devtools: settings.devtools,
          });
          return ok(cookies ? cookies.applyToResponse(errorHtml) : errorHtml);
        }
      } catch (errorBoundaryError) {
        console.error(`[Mandu] Error boundary failed for ${route.id}:`, errorBoundaryError);
      }
    }

    const ssrError = createSSRErrorResponse(
      route.id,
      route.pattern,
      renderError
    );
    console.error(`[Mandu] ${ssrError.errorType}:`, ssrError.message);

    // Phase 18.α — In dev mode, emit a 500 HTML response carrying the
    // full-screen error overlay so agents + developers see a structured
    // error UI in the browser instead of only the terminal stdout.
    // The overlay payload is embedded inside the HTML and the client
    // IIFE mounts it on DOMContentLoaded. Prod paths are untouched:
    // `shouldInjectOverlay` returns `false` for any non-dev setting.
    if (shouldInjectOverlay({ isDev: settings.isDev, enabled: settings.errorOverlay })) {
      const payload = buildPayloadFromError(renderError, {
        kind: "ssr",
        routeId: route.id,
        url,
      });
      const overlayHtml = buildOverlayErrorHtml(payload);
      const res = new Response(overlayHtml, {
        status: 500,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
      return ok(cookies ? cookies.applyToResponse(res) : res);
    }

    return err(ssrError);
  }
}

// ---------- Not Found Renderer (Phase 6.3) ----------

/**
 * Read the plain-text message body out of a notFound() Response without
 * consuming it. Returns a short default if the body is empty or reading
 * fails (e.g. body already read — shouldn't happen but defensive).
 */
async function readNotFoundMessage(response: Response): Promise<string> {
  try {
    const clone = response.clone();
    const body = await clone.text();
    return body.length > 0 ? body : "Not Found";
  } catch {
    return "Not Found";
  }
}

/**
 * Render `app/not-found.tsx` (if registered) as a status-404 page, or
 * fall back to the framework's JSON 404 error. Cookies set by the page
 * loader and any layout loaders are preserved on the final Response.
 *
 * Infinite-loop guard: if rendering the not-found component itself
 * throws (bad user code), we don't recurse back into this function —
 * we emit the built-in 404 instead. That way a broken not-found.tsx
 * never causes a stack overflow or tarpit loop.
 */
async function renderNotFoundPage(
  req: Request,
  route: { id: string; pattern: string; layoutChain?: string[]; hydration?: HydrationConfig; streaming?: boolean; notFoundModule?: string },
  params: Record<string, string>,
  registry: ServerRegistry,
  pageCookies: CookieManager | undefined,
  layoutCookies: CookieManager | undefined,
  layoutData: Map<string, unknown> | undefined,
  notFoundResponse: Response,
): Promise<Response> {
  const settings = registry.settings;
  const mergedCookies = mergeCookieManagers(req, layoutCookies, pageCookies);
  const message = await readNotFoundMessage(notFoundResponse);

  // Phase 18.β — per-route `not-found.tsx` takes precedence over the global
  // notFoundHandler. fs-scanner has already resolved the nearest ancestor
  // at scan time (`findClosestSpecialFile`), so `route.notFoundModule` is
  // the closest match up the segment tree. Falls back to the registered
  // global handler, then to the built-in JSON 404 so broken user code
  // never tarpits the request.
  let registration: { component: React.ComponentType<Record<string, unknown>>; filling?: { hasLoader(): boolean; executeLoader(ctx: ManduContext): Promise<unknown> } } | null = null;

  if (route.notFoundModule) {
    try {
      const mod = await import(path.join(settings.rootDir, route.notFoundModule));
      if (typeof mod.default === "function") {
        registration = { component: mod.default as React.ComponentType<Record<string, unknown>> };
      }
    } catch (importError) {
      if (settings.isDev) {
        console.warn(`[Mandu] not-found module "${route.notFoundModule}" import failed; falling back to global handler:`, importError);
      }
    }
  }

  if (!registration) {
    const handler = registry.notFoundHandler;
    if (!handler) {
      return errorToResponse(createNotFoundResponse(new URL(req.url).pathname), settings.isDev);
    }
    try {
      const globalReg = await handler();
      registration = { component: globalReg.component as React.ComponentType<Record<string, unknown>>, filling: globalReg.filling };
    } catch (handlerError) {
      console.error(`[Mandu] global notFoundHandler failed; falling back to built-in 404:`, handlerError);
      return errorToResponse(createNotFoundResponse(new URL(req.url).pathname), settings.isDev);
    }
  }

  try {
    const NotFoundComponent = registration.component;

    // Let the not-found page's own loader contribute data (e.g. nav links,
    // locale strings). The page loader has already run — this is the 2nd
    // loader invocation, scoped to the 404 surface only.
    let loaderData: unknown = { message };
    if (registration.filling?.hasLoader()) {
      const ctx = new ManduContext(req, params);
      attachI18nToContext(ctx, req);
      try {
        const returned = await registration.filling.executeLoader(ctx);
        loaderData = returned !== undefined ? returned : { message };
      } catch (loaderError) {
        console.warn(`[Mandu] not-found.tsx loader threw, falling back to { message }:`, loaderError);
        loaderData = { message };
      }
    }

    // Render the component. Reuse renderSSR directly (no cache, no
    // streaming, no island bundling — a 404 page is plain).
    let app: React.ReactElement = React.createElement(NotFoundComponent, {
      params,
      loaderData,
    });
    if (route.layoutChain && route.layoutChain.length > 0) {
      app = await wrapWithLayouts(app, route.layoutChain, registry, params, layoutData);
    }

    // Issue #198 — users may author `not-found.tsx` as an async server
    // component (e.g. to fetch copy from a CMS). Resolve the async tree
    // before the sync renderSSR path.
    app = (await resolveAsyncElement(app)) as React.ReactElement;

    const html = renderSSR(app, {
      title: "Not Found",
      isDev: settings.isDev,
      cssPath: settings.cssPath,
      transitions: settings.transitions,
      prefetch: settings.prefetch,
      spa: settings.spa,
      devtools: settings.devtools,
    });

    // renderSSR returns a 200; override to 404 without losing headers.
    const headers = new Headers(html.headers);
    const body = await html.text();
    let response = new Response(body, { status: 404, headers });
    if (mergedCookies) {
      response = mergedCookies.applyToResponse(response);
    }
    return response;
  } catch (renderError) {
    console.error(`[Mandu] app/not-found.tsx render failed; falling back to built-in 404:`, renderError);
    return errorToResponse(createNotFoundResponse(new URL(req.url).pathname), settings.isDev);
  }
}

// ---------- Page Route Handler ----------

/** SWR 백그라운드 재생성 중복 방지 */
const pendingRevalidations = new Set<string>();

/**
 * 페이지 라우트 처리
 */
async function handlePageRoute(
  req: Request,
  url: URL,
  route: { id: string; pattern: string; layoutChain?: string[]; streaming?: boolean; hydration?: HydrationConfig; errorModule?: string; loadingModule?: string; notFoundModule?: string },
  params: Record<string, string>,
  registry: ServerRegistry
): Promise<Result<Response>> {
  const settings = registry.settings;
  const cache = settings.cacheStore;
  // Only call ensurePageRouteMetadata when a pageHandler exists;
  // routes registered via registerPageLoader are handled by loadPageData instead.
  // DX-1: if the pageHandler returns a malformed registration (component is
  // not a function), ensurePageRouteMetadata now throws with a descriptive
  // message. Catch it here so the request becomes a loud 500 instead of
  // bubbling up as an opaque "Internal Server Error".
  if (registry.pageHandlers.has(route.id)) {
    try {
      await ensurePageRouteMetadata(route.id, registry);
    } catch (error) {
      const pageError = createPageLoadErrorResponse(
        route.id,
        route.pattern,
        error instanceof Error ? error : new Error(String(error))
      );
      console.error(`[Mandu] ${pageError.errorType}:`, pageError.message);
      return err(pageError);
    }
  }
  const renderMode = getRenderModeForRoute(route.id, registry);

  // _data 요청 (SPA 네비게이션)은 캐시하지 않음
  const isDataRequest = url.searchParams.has("_data");

  // PPR: cached shell + fresh dynamic data per request
  if (renderMode === "ppr" && cache && !isDataRequest) {
    const shellCacheKey = `ppr-shell:${route.id}`;
    const cachedShell = cache.get(shellCacheKey);

    if (cachedShell) {
      // Shell HIT: load only the dynamic data (cheap), skip full SSR render
      const loadResult = await loadPageData(req, route, params, registry);
      if (!loadResult.ok) return loadResult;
      // DX-3: loader-level redirect wins over the PPR shell — never emit
      // cached HTML to a user the loader wants to redirect away. Cookies
      // were already merged into the redirect Response inside loadPageData.
      if (loadResult.value.redirect) {
        return ok(loadResult.value.redirect);
      }
      const { loaderData, cookies } = loadResult.value;
      const pprResponse = createPPRResponse(cachedShell.html, route.id, loaderData);
      return ok(cookies ? cookies.applyToResponse(pprResponse) : pprResponse);
    }

    // Shell MISS: fall through to full render, then cache the shell below
  }

  // ─── Phase 18.ζ — ISR + cache-tags dispatch ────────────────────────────
  // Runs AFTER γ's prerendered pass-through (handled earlier in
  // `dispatchRequest`) and BEFORE full route dispatch.
  //   HIT   : serve fresh cache entry directly, no SSR work.
  //   STALE : serve stale HTML immediately + background revalidation
  //           under a per-key mutex (`pendingRevalidations`).
  //   MISS  : fall through to render. Save happens below (step 4b)
  //           after `_cache` / `ctx.cache` metadata has been collected
  //           from the loader return.
  //
  // Served responses carry `Cache-Control: public, max-age=…,
  // stale-while-revalidate=…` for CDN alignment plus the debug header
  // `X-Mandu-Cache: HIT|STALE`.
  if (cache && !isDataRequest && renderMode !== "dynamic" && renderMode !== "ppr") {
    const cacheKey = buildRouteCacheKey(route.id, url);
    const lookup = lookupCache(cache, cacheKey);

    if (lookup.status === "HIT" && lookup.entry) {
      return ok(createCachedResponse(lookup.entry, "HIT"));
    }

    if (lookup.status === "STALE" && lookup.entry) {
      // Stale-While-Revalidate: 이전 캐시 즉시 반환 + 백그라운드 재생성
      // 중복 재생성 방지: 이미 진행 중이면 스킵
      if (!pendingRevalidations.has(cacheKey)) {
        pendingRevalidations.add(cacheKey);
        queueMicrotask(async () => {
          try {
            await regenerateCache(req, url, route, params, registry, cache, cacheKey);
          } catch (error) {
            console.warn(`[Mandu Cache] Background revalidation failed for ${cacheKey}:`, error);
          } finally {
            pendingRevalidations.delete(cacheKey);
          }
        });
      }
      return ok(createCachedResponse(lookup.entry, "STALE"));
    }
  }
  // ─── End Phase 18.ζ ────────────────────────────────────────────────────

  // 1. 페이지 + 레이아웃 데이터 병렬 로딩
  const [loadResult, layoutLoad] = await Promise.all([
    loadPageData(req, route, params, registry),
    loadLayoutData(req, route.layoutChain, params, registry),
  ]);
  if (!loadResult.ok) {
    return loadResult;
  }

  const { loaderData, cookies: pageCookies } = loadResult.value;
  const { data: layoutData, cookies: layoutCookies } = layoutLoad;

  // DX-3: page loader redirect short-circuit. Applied BEFORE cookie merging
  // and BEFORE the SPA _data branch so the redirect is authoritative — a
  // client-side fetch('/page?_data=1') from the router must still see the
  // redirect so it follows the server's decision instead of rendering the
  // page shell. Layout loaders never redirect in this release (nested:
  // test #7) — only the page's decision wins.
  //
  // Cookies already merged in loadPageData include page-level cookies set
  // before the redirect call. Layout-level cookies also merge in so a
  // layout that started a session survives the page's redirect.
  if (loadResult.value.redirect) {
    let redirectResponse = loadResult.value.redirect;
    if (layoutCookies) {
      redirectResponse = layoutCookies.applyToResponse(redirectResponse);
    }
    return ok(redirectResponse);
  }

  // Phase 6.3: notFound short-circuit. Same ordering rationale as redirect —
  // never serve cached HTML to a user whose loader emitted notFound(), never
  // leak loader JSON via the ?_data=1 path. If `app/not-found.tsx` is
  // registered we render it here (status 404) with cookies preserved;
  // otherwise we fall back to the built-in 404.
  if (loadResult.value.notFound) {
    const nfResponse = await renderNotFoundPage(
      req,
      route,
      params,
      registry,
      pageCookies,
      layoutCookies,
      layoutData,
      loadResult.value.notFound,
    );
    return ok(nfResponse);
  }

  // DX-2: layout slot 의 쿠키를 response 로 전파.
  // 병합 순서: layout 먼저, page 가 뒤 — 같은 이름이면 page 가 이긴다 (middleware→handler 관례).
  const mergedCookies = mergeCookieManagers(req, layoutCookies, pageCookies);

  // 2. Client-side Routing: 데이터만 반환 (JSON)
  // 참고: layoutData는 SSR 시에만 사용 — SPA 네비게이션은 전체 페이지 SSR을 받지 않으므로 제외
  if (isDataRequest) {
    // Phase 7.2 — HDR (Hot Data Revalidation) signal. When the client
    // sends `X-Mandu-HDR: 1` it is a slot-refetch in dev mode. We echo
    // the header back so observability tooling can distinguish HDR
    // refetches from normal SPA navigations. The JSON body is
    // identical — HDR reuses the existing `_data=1` contract — so
    // this header is purely advisory.
    //
    // Phase 7.3 L-04: only echo the header in dev. HDR is a dev-time
    // feature (slot file watching + client HMR script) so no legitimate
    // production client should ever send `X-Mandu-HDR: 1`. Echoing it
    // in prod is zero-value attack surface (request-triggered response
    // header reflection). Silently ignore the request header instead.
    const isHDR = settings.isDev && req.headers.get("x-mandu-hdr") === "1";
    const jsonResponse = Response.json({
      routeId: route.id,
      pattern: route.pattern,
      params,
      loaderData: loaderData ?? null,
      timestamp: Date.now(),
    });
    if (isHDR) {
      // Set headers on the response. Response.json() returns an
      // immutable Response; we wrap with a new Headers object.
      const headers = new Headers(jsonResponse.headers);
      headers.set("X-Mandu-HDR", "1");
      const taggedResponse = new Response(jsonResponse.body, {
        status: jsonResponse.status,
        headers,
      });
      return ok(mergedCookies ? mergedCookies.applyToResponse(taggedResponse) : taggedResponse);
    }
    return ok(mergedCookies ? mergedCookies.applyToResponse(jsonResponse) : jsonResponse);
  }

  // 3. SSR 렌더링 (layoutData 전달)
  const ssrResult = await renderPageSSR(route, params, loaderData, req.url, registry, mergedCookies, layoutData);

  // 4a. PPR: cache only the shell (HTML structure minus loader data), not the full page
  if (cache && ssrResult.ok && renderMode === "ppr") {
    const cacheOptions = getCacheOptionsForRoute(route.id, registry);
    const revalidate = cacheOptions?.revalidate ?? 3600; // default 1 hour for PPR shells
    const shellCacheKey = `ppr-shell:${route.id}`;
    const cloned = ssrResult.value.clone();
    cloned.text().then((html) => {
      const shellHtml = extractShellHtml(html);
      cache.set(shellCacheKey, createCacheEntry(
        shellHtml, null, revalidate, cacheOptions?.tags ?? []
      ));
    }).catch(() => {});
  }

  // ─── Phase 18.ζ — ISR/SWR cache save (step 4b) ────────────────────────
  // Resolves the effective cache metadata from three tiers (per-request
  // `_cache` / `ctx.cache` → route-level `filling.loader(fn, {...})` →
  // global `ManduConfig.cache.defaultMaxAge/defaultSwr`). When a valid
  // `maxAge > 0` is resolved, we:
  //   1. Persist the rendered HTML under the same key used by the HIT
  //      path above (`buildRouteCacheKey`).
  //   2. Stamp the outgoing Response with `Cache-Control: public,
  //      max-age=…, stale-while-revalidate=…` + `X-Mandu-Cache: MISS` so
  //      CDNs and browsers can coordinate the same TTL we stored.
  // The persisted entry has `tags` union'd across tiers — invalidation
  // via `revalidateTag()` therefore hits both developer-declared tags
  // and per-request tags for this URL.
  if (cache && ssrResult.ok && renderMode !== "dynamic" && renderMode !== "ppr") {
    const perRequest = loadResult.value.cacheMeta;
    const resolved = resolveCacheMetaForSave(route.id, registry, perRequest);
    if (resolved) {
      const cloned = ssrResult.value.clone();
      const status = ssrResult.value.status;
      const headers = Object.fromEntries(ssrResult.value.headers.entries());
      const cacheKey = buildRouteCacheKey(route.id, url);
      // streaming 응답도 블로킹하지 않도록 백그라운드에서 캐시 저장
      cloned.text().then((html) => {
        cache.set(
          cacheKey,
          createCacheEntry(
            html,
            loaderData,
            {
              maxAge: resolved.maxAge,
              staleWhileRevalidate: resolved.staleWhileRevalidate,
              tags: resolved.tags,
            },
            status,
            headers
          )
        );
      }).catch(() => {});

      // Stamp Cache-Control + X-Mandu-Cache on the MISS response so
      // downstream CDNs honor the same TTL we just persisted.
      const freshEntryPreview = createCacheEntry(
        "",
        null,
        { maxAge: resolved.maxAge, staleWhileRevalidate: resolved.staleWhileRevalidate, tags: resolved.tags },
        status,
        {}
      );
      const cc = computeCacheControl(freshEntryPreview);
      const stamped = new Response(ssrResult.value.body, {
        status: ssrResult.value.status,
        statusText: ssrResult.value.statusText,
        headers: ssrResult.value.headers,
      });
      stamped.headers.set("Cache-Control", cc);
      stamped.headers.set("X-Mandu-Cache", "MISS");
      return ok(stamped);
    }
  }
  // ─── End Phase 18.ζ ────────────────────────────────────────────────────

  return ssrResult;
}

/**
 * 백그라운드 캐시 재생성 (SWR 패턴)
 */
async function regenerateCache(
  req: Request,
  url: URL,
  route: { id: string; pattern: string; layoutChain?: string[]; streaming?: boolean; hydration?: HydrationConfig; errorModule?: string; loadingModule?: string; notFoundModule?: string },
  params: Record<string, string>,
  registry: ServerRegistry,
  cache: CacheStore,
  cacheKey: string
): Promise<void> {
  const [loadResult, layoutLoad] = await Promise.all([
    loadPageData(req, route, params, registry),
    loadLayoutData(req, route.layoutChain, params, registry),
  ]);
  if (!loadResult.ok) return;
  // DX-3: never cache a redirect under a page-html cache key. A redirect
  // is per-request (auth state dependent) — caching it would poison every
  // subsequent visitor. Bail out and let the next request re-evaluate.
  if (loadResult.value.redirect) return;

  const { loaderData } = loadResult.value;
  const { data: layoutData } = layoutLoad;
  // 캐시 재생성 경로는 per-request 쿠키를 캐시해선 안 됨 → cookies undefined 로 유지.
  const ssrResult = await renderPageSSR(route, params, loaderData, req.url, registry, undefined, layoutData);
  if (!ssrResult.ok) return;

  // Phase 18.ζ — resolve meta with the same 3-tier priority as the MISS
  // path so background revalidation honors per-request `_cache` from the
  // freshly re-executed loader.
  const resolved = resolveCacheMetaForSave(
    route.id,
    registry,
    loadResult.value.cacheMeta
  );
  if (!resolved) return;

  const html = await ssrResult.value.text();
  const entry = createCacheEntry(
    html,
    loaderData,
    {
      maxAge: resolved.maxAge,
      staleWhileRevalidate: resolved.staleWhileRevalidate,
      tags: resolved.tags,
    },
    ssrResult.value.status,
    Object.fromEntries(ssrResult.value.headers.entries())
  );
  cache.set(cacheKey, entry);
}

/**
 * Phase 18.ζ — 최종 캐시 엔트리 stamp 용 메타데이터 해석.
 *
 * 우선순위 (높음 → 낮음):
 *   1. per-request: `loadResult.value.cacheMeta` (`_cache` 또는 `ctx.cache`)
 *   2. route-level: `filling.getCacheOptions()` (`.loader(fn, {revalidate, tags})`)
 *   3. global: `ManduConfig.cache.defaultMaxAge` / `defaultSwr`
 *
 * 반환값은 다음 의미를 가진다:
 *   - `null` → 저장하지 않음 (maxAge 가 0 이하이거나 캐싱 의사 없음).
 *   - `{ maxAge, staleWhileRevalidate, tags }` → 저장.
 *
 * 태그는 per-request + route-level 의 합집합이다.
 */
function resolveCacheMetaForSave(
  routeId: string,
  registry: ServerRegistry,
  perRequest: RuntimeCacheMeta | undefined
): { maxAge: number; staleWhileRevalidate: number; tags: string[] } | null {
  const routeLevel = registry.cacheOptions?.get(routeId) ?? null;
  // `getGlobalCacheDefaults` is imported from ./cache; defaults may be null.
  const defaults = (function () {
    try {
      // Dynamic require-free import: re-expose via the module we already
      // depend on at the top of this file (`./cache`).
      return getGlobalCacheDefaults();
    } catch {
      return null;
    }
  })();

  const maxAge =
    perRequest?.maxAge ??
    routeLevel?.revalidate ??
    defaults?.defaultMaxAge ??
    0;
  const swr =
    perRequest?.staleWhileRevalidate ??
    routeLevel?.staleWhileRevalidate ??
    defaults?.defaultSwr ??
    0;

  if (!Number.isFinite(maxAge) || maxAge <= 0) return null;

  const tagSet = new Set<string>();
  routeLevel?.tags?.forEach((t) => tagSet.add(t));
  perRequest?.tags?.forEach((t) => tagSet.add(t));

  return { maxAge, staleWhileRevalidate: Math.max(0, swr), tags: [...tagSet] };
}

/**
 * 라우트의 캐시 옵션 가져오기 (pageHandler의 filling에서 추출)
 */
function getCacheOptionsForRoute(
  routeId: string,
  registry: ServerRegistry
): { revalidate?: number; staleWhileRevalidate?: number; tags?: string[] } | null {
  const pageHandler = registry.pageHandlers.get(routeId);
  if (!pageHandler) return null;

  // pageHandler는 async () => { component, filling } 형태
  // filling의 getCacheOptions()를 호출하려면 filling 인스턴스에 접근해야 하지만
  // pageHandler 실행 없이는 접근 불가 → 등록 시점에 캐시 옵션을 별도 저장
  return registry.cacheOptions?.get(routeId) ?? null;
}

function getRenderModeForRoute(routeId: string, registry: ServerRegistry): RenderMode {
  return registry.renderModes.get(routeId) ?? "dynamic";
}

async function ensurePageRouteMetadata(
  routeId: string,
  registry: ServerRegistry,
  pageHandler?: PageHandler
): Promise<PageRegistration> {
  const handler = pageHandler ?? registry.pageHandlers.get(routeId);
  if (!handler) {
    throw new Error(`Page handler not found for route: '${routeId}'. Ensure this route is registered in the manifest. If you are running in development, restart 'mandu dev' to pick up new routes. In production, verify that the route module exists and was included in the build.`);
  }

  const existingComponent = registry.routeComponents.get(routeId);
  const existingFilling = registry.pageFillings.get(routeId);
  if (existingComponent && existingFilling) {
    return { component: existingComponent, filling: existingFilling };
  }

  const registration = await handler();
  // DX-1: pageHandler가 malformed registration을 반환해도 silent 404 대신
  // 명시적 에러로 실패. handlers.ts 의 auto-promote 블록이 function 기본값을
  // { component } 로 감싸주지만, 직접 registerPageHandler 를 쓰는 경우나
  // 사용자 코드가 이상한 값을 반환하는 경우를 방어한다.
  if (typeof registration?.component !== "function") {
    const t = registration === null || registration === undefined
      ? String(registration)
      : typeof registration.component;
    throw new Error(
      `[Mandu] Page handler for '${routeId}' returned an invalid registration: component is ${t}. ` +
        "Expected `{ component: ReactComponent, filling? }` from the page module's default export."
    );
  }
  const component = registration.component as RouteComponent;
  registry.registerRouteComponent(routeId, component);

  if (registration.filling) {
    registry.pageFillings.set(routeId, registration.filling);
    const cacheOptions = registration.filling.getCacheOptions?.();
    if (cacheOptions) {
      registry.cacheOptions.set(routeId, cacheOptions);
    }
    registry.renderModes.set(routeId, registration.filling.getRenderMode());
  }

  // #186: pageHandlers 경로에서도 metadata / generateMetadata 캐싱
  // (pageLoaders 경로는 loadPageData에서 이미 처리됨)
  if (registration.metadata && typeof registration.metadata === "object") {
    registry.pageMetadata.set(routeId, registration.metadata);
  }
  if (typeof registration.generateMetadata === "function") {
    registry.pageGenerateMetadata.set(routeId, registration.generateMetadata);
  }

  return registration;
}

function buildRouteCacheKey(routeId: string, url: URL): string {
  const entries = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey === bKey) {
      return aValue.localeCompare(bValue);
    }
    return aKey.localeCompare(bKey);
  });
  const search = entries.length > 0 ? `?${new URLSearchParams(entries).toString()}` : "";
  return `${routeId}:${url.pathname}${search}`;
}

// ---------- Main Request Dispatcher ----------

/**
 * 메인 요청 디스패처
 *
 * `skipMiddleware` is the Phase 18.ε re-entry flag: when a composed
 * request-level middleware chain invokes its `finalHandler`, we recurse
 * into this same dispatcher with `skipMiddleware=true` so we don't run
 * the chain twice. End users never pass this — it's only set by the
 * Phase 18.ε injection block below.
 */
/**
 * Phase 18 — try to serve a prerendered HTML file for `pathname`.
 *
 * Returns the HTTP response on hit, or `null` on miss (caller falls
 * through to static-file serving + SSR). Index load happens lazily
 * on the first request so `startServer` stays synchronous; failures
 * short-circuit to `null` (the feature is best-effort and must never
 * surface as a 500).
 *
 * Responses are stamped with `Cache-Control` from the registry
 * settings and an `X-Mandu-Cache: PRERENDERED` tag for observability /
 * log parity with the ISR cache path.
 *
 * Issue #221 — prerendered HTML lives at a **stable URL** (route →
 * file, no content hash in the path). Serving it with `immutable`
 * breaks new-deploy rollout exactly like #218: browsers pin the
 * stale HTML for up to a year. The fix mirrors #218's static-file
 * policy:
 *
 *   1. Default `Cache-Control` → `public, max-age=0, must-revalidate`
 *      (via `computeStaticCacheControl` — no hash in filename ⇒
 *      must-revalidate). User-supplied `PrerenderSettings.cacheControl`
 *      still wins so adapters can tune for their CDN.
 *   2. Emit a strong ETag (`Bun.hash` over the HTML bytes).
 *   3. On `If-None-Match` match → `304 Not Modified` with empty body,
 *      `Cache-Control` + `ETag` preserved for intermediaries.
 */
async function tryServePrerendered(
  pathname: string,
  settings: ServerRegistrySettings,
  method: string,
  request?: Request
): Promise<Response | null> {
  const p = settings.prerender;
  if (!p) return null;
  if (method !== "GET" && method !== "HEAD") return null;
  if (settings.edge) return null;

  if (p.index === undefined) {
    if (!p.pending) {
      p.pending = loadPrerenderIndex(settings.rootDir, p.dir).catch(() => null);
    }
    p.index = await p.pending;
    p.pending = undefined;
  }
  if (!p.index) return null;

  const filePath = resolvePrerenderedFile(p.index, settings.rootDir, p.dir, pathname);
  if (!filePath) return null;

  // Load via `Bun.file` so we can reuse the #218 ETag helper (which
  // keys the hash cache on absolute path + size + mtime). `exists()`
  // guards the rare race where the index points at a file that was
  // removed after load.
  const file = Bun.file(filePath);
  let exists = false;
  try {
    exists = await file.exists();
  } catch {
    return null;
  }
  if (!exists) return null;

  // Strong ETag derived from HTML bytes — same wyhash primitive the
  // static-asset dispatch uses, sharing the same LRU cache.
  let etag: string;
  try {
    etag = await computeStrongEtag(filePath, file);
  } catch {
    return null;
  }

  // Cache-Control resolution (Issue #221):
  //
  //   - When `p.cacheControl` is framework-chosen (either the current
  //     must-revalidate default or the pre-#221 `immutable` default,
  //     which we treat as "caller never opted out"), delegate to
  //     `computeStaticCacheControl` so dev-mode gets `no-cache,
  //     no-store, must-revalidate` and prod gets must-revalidate
  //     (prerendered filenames never carry a content hash, so the
  //     hash-aware policy always lands on the revalidating form).
  //   - Otherwise honour the override verbatim — adapters in front of
  //     a CDN with per-deploy invalidation may legitimately want
  //     aggressive caching.
  //
  // The pre-#221 `immutable` string is treated as a framework default
  // so projects upgrading from a persisted registry state get the fix
  // automatically rather than staying on the broken policy.
  const isFrameworkDefault =
    p.cacheControl === DEFAULT_PRERENDER_CACHE_CONTROL ||
    p.cacheControl === "public, max-age=31536000, immutable" ||
    p.cacheControl === "";
  const cacheControl = isFrameworkDefault
    ? computeStaticCacheControl(path.basename(filePath), settings.isDev)
    : p.cacheControl;

  // Conditional GET — RFC 7232 §3.2. Covers `"<etag>"`, `W/"<etag>"`,
  // comma-separated lists, and `*`. 304 keeps ETag + Cache-Control so
  // downstream caches update their freshness state.
  const ifNoneMatch = request?.headers.get("If-None-Match");
  if (ifNoneMatch && matchesEtag(ifNoneMatch, etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        "ETag": etag,
        "Cache-Control": cacheControl,
        "X-Mandu-Cache": "PRERENDERED",
      },
    });
  }

  let html: string;
  try {
    html = await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": cacheControl,
    "ETag": etag,
    "X-Mandu-Cache": "PRERENDERED",
  });
  const body = method === "HEAD" ? null : html;
  return new Response(body, { status: 200, headers });
}

// ─── Phase 18.μ — request-scoped i18n state ──────────────────────────────
/**
 * Per-request locale state keyed by the `Request` object. The runtime
 * dispatcher populates this right before `handleRequestInternal` returns
 * to route-specific paths; `handlePageRoute` / `handleApiRoute` read it
 * when creating `ManduContext` and attach via `ctx._setI18n(...)`.
 *
 * A WeakMap is used so completed requests release their entries
 * automatically — no explicit cleanup needed on the hot path.
 *
 * @internal
 */
const i18nRequestState = new WeakMap<
  Request,
  { locale: ResolvedLocale; translator?: Translator }
>();

/**
 * Phase 18.μ — expose the stashed locale state for `filling` /
 * `handlePageRoute` / `handleApiRoute`. Returns `undefined` when i18n
 * is disabled OR the request predates dispatch (internal callers).
 *
 * @internal
 */
export function getRequestI18n(
  req: Request
): { locale: ResolvedLocale; translator?: Translator } | undefined {
  return i18nRequestState.get(req);
}

/**
 * Phase 18.μ — attach i18n state to a freshly-constructed `ManduContext`.
 * No-op when i18n is disabled. Called by every callsite that instantiates
 * `new ManduContext(req, …)` so `ctx.locale` + `ctx.t` are populated
 * before loader / handler execution.
 *
 * @internal
 */
function attachI18nToContext(ctx: ManduContext, req: Request): void {
  const state = i18nRequestState.get(req);
  if (state) {
    ctx._setI18n(state.locale, state.translator);
  }
}

/**
 * Helper: returns the URL's first segment if it matches a known locale.
 * Extracted so the inline μ dispatch block stays readable.
 */
function stripLocaleForRedirectCheck(
  pathname: string,
  locales: readonly string[]
): string | undefined {
  if (pathname.length < 2) return undefined;
  const slashIdx = pathname.indexOf("/", 1);
  const first = slashIdx === -1 ? pathname.slice(1) : pathname.slice(1, slashIdx);
  return locales.includes(first) ? first : undefined;
}
// ─── End Phase 18.μ ──────────────────────────────────────────────────────

// ─── Issue #214 — dynamicParams guard helper ────────────────────────────────
/**
 * True when the incoming `params` from the router matches one of the
 * enumerated sets in `staticParams` (populated at build time from
 * `generateStaticParams`). Used by the runtime #214 guard to decide
 * whether a `dynamicParams: false` page must 404.
 *
 * Matching rules mirror `bundler/generate-static-params.ts`:
 *   - Scalar segments compare as exact strings.
 *   - Catch-all segments compare as slash-joined strings (the router
 *     always materializes wildcards as a single string, whereas
 *     `generateStaticParams` emits `string[]` — we normalize both
 *     sides to the joined form for equality).
 *
 * When `staticParams` is undefined or empty, no URL can match — the
 * route effectively becomes "no dynamic URLs at all", which is the
 * documented behavior of `dynamicParams: false` + `generateStaticParams: []`.
 */
function paramsInStaticSet(
  params: Record<string, string>,
  staticParams: StaticParamSetSchema[] | undefined
): boolean {
  if (!staticParams || staticParams.length === 0) return false;
  const paramKeys = Object.keys(params);
  for (const entry of staticParams) {
    if (!entry) continue;
    let allMatch = true;
    for (const key of paramKeys) {
      const requestValue = params[key];
      const declared = (entry as Record<string, string | string[] | undefined>)[key];
      if (declared === undefined) {
        // Optional catch-all that wasn't declared — router gives empty
        // string in that case; anything else is a miss.
        if (requestValue !== "") {
          allMatch = false;
          break;
        }
        continue;
      }
      const declaredJoined = Array.isArray(declared) ? declared.join("/") : declared;
      if (declaredJoined !== requestValue) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return true;
  }
  return false;
}
// ─── End Issue #214 ─────────────────────────────────────────────────────────

async function handleRequestInternal(
  req: Request,
  router: Router,
  registry: ServerRegistry,
  skipMiddleware: boolean = false
): Promise<Result<Response>> {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const settings = registry.settings;

  // 0. CORS Preflight 요청 처리
  if (settings.cors && isPreflightRequest(req)) {
    const corsOptions: CorsOptions = typeof settings.cors === 'object' ? settings.cors : {};
    return ok(handlePreflightRequest(req, corsOptions));
  }

  // 0.5. Phase 18 — prerendered HTML pass-through (SSG).
  // Must run BEFORE static-file serving and route dispatch so that
  // `mandu build`-emitted HTML short-circuits SSR. No-op if the
  // feature is disabled or the path wasn't prerendered.
  const prerendered = await tryServePrerendered(pathname, settings, req.method, req);
  if (prerendered) {
    if (settings.cors && isCorsRequest(req)) {
      const corsOptions: CorsOptions = typeof settings.cors === 'object' ? settings.cors : {};
      return ok(applyCorsToResponse(prerendered, req, corsOptions));
    }
    return ok(prerendered);
  }

  // ─── Phase 18.μ — i18n dispatch ─────────────────────────────────────────
  // Runs AFTER γ's prerendered check (static HTML per-locale is already
  // handled by path-prefix synthesis at build time) and BEFORE ζ's cache
  // lookup (cache keys include the resolved locale via `Vary:
  // Accept-Language`).
  //
  //   1. Resolve the active locale via `resolveLocale()` — the strategy
  //      switches determines URL / cookie / header precedence.
  //   2. For `strategy: 'path-prefix'`: when the incoming URL carries no
  //      locale prefix (root or locale-less path) AND the resolution
  //      came from `default` / `fallback`, we emit a 307 redirect to
  //      `/<locale><rest>` so the user lands on a locale-scoped URL.
  //      Cookie / header signals "win" over the default — no redirect
  //      when the user explicitly preferred a non-default locale.
  //   3. Stash the resolved locale on the `registry.__perRequest` map
  //      indexed by the request so downstream `handlePageRoute` /
  //      `handleApiRoute` can mount it onto `ctx` via `_setI18n()`.
  //
  // Zero overhead when `settings.i18n` is undefined — the `if` falls
  // through and the hot path runs exactly as Phase 18.λ's baseline.
  let resolvedLocaleForRequest: ResolvedLocale | undefined;
  let translatorForRequest: Translator | undefined;
  if (settings.i18n) {
    resolvedLocaleForRequest = resolveLocale(req, settings.i18n);

    // Path-prefix strategy: URL has no locale prefix AND resolver picked
    // a non-default locale from cookie/header → redirect to prefixed URL
    // so the user lands on a locale-scoped URL (Next.js parity).
    //
    // Excluded paths (never redirected, always locale-neutral):
    //   - `/api/*`  — API routes use `Accept-Language` header; JSON
    //     clients rarely want an HTML redirect.
    //   - `/_mandu/*`, `/.mandu/*` — framework internals.
    //   - `/sitemap.xml`, `/robots.txt`, etc. — metadata routes live
    //     at site root across all locales.
    if (
      settings.i18n.strategy === "path-prefix" &&
      (req.method === "GET" || req.method === "HEAD") &&
      !pathname.startsWith("/api/") &&
      !pathname.startsWith("/_mandu/") &&
      !pathname.startsWith("/.mandu/") &&
      !pathname.startsWith("/__kitchen") &&
      !pathname.startsWith("/__mandu/") &&
      pathname !== "/sitemap.xml" &&
      pathname !== "/robots.txt" &&
      pathname !== "/llms.txt" &&
      pathname !== "/manifest.webmanifest"
    ) {
      const urlLocale = stripLocaleForRedirectCheck(pathname, settings.i18n.locales);
      if (!urlLocale && resolvedLocaleForRequest.code !== settings.i18n.defaultLocale) {
        const targetPath = `/${resolvedLocaleForRequest.code}${pathname === "/" ? "" : pathname}`;
        const targetUrl = new URL(targetPath + url.search, req.url);
        const redirectRes = new Response(null, {
          status: 307,
          headers: {
            Location: targetUrl.toString(),
            Vary: "Accept-Language, Cookie",
            "Content-Language": resolvedLocaleForRequest.code,
          },
        });
        return ok(redirectRes);
      }
    }

    // Build translator if a registry is wired up.
    if (settings.messages) {
      translatorForRequest = createTranslator(settings.messages, {
        activeLocale: resolvedLocaleForRequest.code,
        defaultLocale: settings.i18n.defaultLocale,
        fallbackLocale: settings.i18n.fallback,
      });
    }

    // Stash on request-scoped map so downstream context creation (inside
    // `handlePageRoute` / `handleApiRoute`) can pick them up without
    // threading extra args through every call site. `i18nRequestState`
    // is a WeakMap — no memory retention after the request completes.
    if (resolvedLocaleForRequest) {
      i18nRequestState.set(req, {
        locale: resolvedLocaleForRequest,
        translator: translatorForRequest,
      });
    }
  }
  // ─── End Phase 18.μ ─────────────────────────────────────────────────────

  // 1. 정적 파일 서빙 시도 (최우선)
  // Edge runtimes (Cloudflare Workers, etc.) have no filesystem — skip and
  // let the platform's asset pipeline (Wrangler [assets], Vercel _static, …)
  // handle static routing instead.
  if (!settings.edge) {
    const staticFileResult = await serveStaticFile(pathname, settings, req);
    if (staticFileResult.handled) {
      const staticResponse = staticFileResult.response!;
      if (settings.cors && isCorsRequest(req)) {
        const corsOptions: CorsOptions = typeof settings.cors === 'object' ? settings.cors : {};
        return ok(applyCorsToResponse(staticResponse, req, corsOptions));
      }
      return ok(staticResponse);
    }
  }

  // 1.5. Image optimization handler (/_mandu/image)
  if (!settings.edge && pathname === "/_mandu/image") {
    const imageResponse = await handleImageRequest(req, settings.rootDir, settings.publicDir);
    if (imageResponse) return ok(imageResponse);
  }

  // 1.6. Internal runtime cache control endpoint
  if (pathname === INTERNAL_CACHE_ENDPOINT) {
    return ok(await handleInternalCacheControlRequest(req, settings));
  }

  // 1.7. Internal observability EventBus stream + recent snapshot
  if (pathname === INTERNAL_EVENTS_ENDPOINT) {
    return ok(handleEventsStreamRequest(req));
  }
  if (pathname === `${INTERNAL_EVENTS_ENDPOINT}/recent`) {
    return ok(handleEventsRecentRequest(req));
  }

  // Phase 17 — heap snapshot + Prometheus metrics endpoints.
  //
  // Gating: dev mode exposes by default so the DX is zero-friction. Prod
  // requires either `MANDU_DEBUG_HEAP=1` or explicit `observability.heapEndpoint:
  // true` in `ServerOptions`. Operators can opt-out of even the dev exposure by
  // passing `observability.heapEndpoint: false` (useful in tests that count
  // listeners / assert route shape).
  //
  // Missing endpoints return 404 via the normal route-not-found path —
  // scrapers can't distinguish "disabled" from "never existed". See
  // `docs/ops/metrics.md` for the operator-facing guide.
  if (pathname === HEAP_ENDPOINT) {
    if (isObservabilityExposed(settings.isDev, settings.heapEndpoint)) {
      // Phase 18.ψ — augment the Phase 17 payload with user-perf data.
      // We append (never restructure) the `perf` key so consumers that
      // rely on `.process`, `.caches`, `.bun` continue to parse. Keeping
      // the composition here (not in metrics.ts) avoids a metrics→perf
      // module dep — metrics stays a pure exposition layer.
      const base = collectHeapSnapshot();
      const perf = collectPerfSnapshot();
      const body = { ...base, perf };
      return ok(
        new Response(JSON.stringify(body, null, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        }),
      );
    }
  }
  if (pathname === METRICS_ENDPOINT) {
    if (isObservabilityExposed(settings.isDev, settings.metricsEndpoint)) {
      return ok(buildMetricsResponse());
    }
  }

  // Production OpenAPI endpoint — `/__mandu/openapi.json` + `.yaml`.
  // Gated behind `ManduConfig.openapi.enabled` (or MANDU_OPENAPI_ENABLED=1).
  // Every response carries an ETag so CDNs / browsers revalidate cheaply
  // after a deploy. Falls through to route dispatch if disabled OR the
  // pathname doesn't match the configured base path.
  if (settings.openapi) {
    const openapiManifest: RoutesManifest = {
      version: 1,
      routes: router.getRoutes(),
    };
    const openapiResponse = await handleOpenAPIRequest(
      req,
      pathname,
      openapiManifest,
      settings.rootDir,
      settings.openapi
    );
    if (openapiResponse) return ok(openapiResponse);
  }

  // 2. Kitchen dev dashboard (dev mode only)
  if (settings.isDev && pathname.startsWith(KITCHEN_PREFIX) && registry.kitchen) {
    const kitchenResponse = await registry.kitchen.handle(req, pathname);
    if (kitchenResponse) return ok(kitchenResponse);
  }

  // ─── Phase 18.ε — canonical request-level middleware chain ───────────────
  // Runs BEFORE route dispatch, AFTER infrastructure fast-paths (static
  // files, CORS preflight, internal endpoints, γ's prerendered pass-through,
  // Kitchen). Each composed layer can short-circuit with its own Response
  // or wrap the downstream Response after `next()` returns. Zero overhead
  // when no middleware is configured (settings.middlewareChain === undefined).
  //
  // Errors inside middleware propagate to the outer `handleRequest` catch,
  // which converts them to 5xx via `errorToResponse`. Middleware authors
  // don't need their own top-level try/catch.
  //
  // Re-entry: the chain's `finalHandler` recurses into this same function
  // with `skipMiddleware=true` so the chain is not executed twice. The
  // `next(rewrittenReq)` rewrite pattern flows through transparently —
  // `finalReq` is whatever the innermost middleware asked us to dispatch.
  //
  // NOTE: intentionally contained. Does NOT alter route dispatch semantics.
  // Coexists with α's 500-path, β's dispatch, γ's prerendered check,
  // δ's island section. See `docs/architect/middleware-composition.md`.
  if (!skipMiddleware && settings.middlewareChain) {
    const composed = settings.middlewareChain;
    const dispatchRoute = async (finalReq: Request): Promise<Response> => {
      const result = await handleRequestInternal(finalReq, router, registry, true);
      if (result.ok) return result.value;
      // Surface error-path responses to the chain so logging / metrics
      // layers see the final status. The outer `handleRequest` still owns
      // dev-mode Cache-Control stamping + eventBus emission.
      return errorToResponse(result.error, settings.isDev);
    };
    const composedResponse = await composed(req, dispatchRoute);
    return ok(composedResponse);
  }
  // ─── End Phase 18.ε ──────────────────────────────────────────────────────

  // ─── Phase 18.κ — typed RPC dispatch ──────────────────────────────────────
  // Runs AFTER γ's prerendered pass-through (handled earlier at step 0.5),
  // AFTER ζ's ISR/SWR cache check (per-route, inside handlePageRoute), and
  // BEFORE β's file-system route dispatch below. The canonical URL shape is
  //
  //   POST /api/rpc/<endpoint>/<method>
  //
  // with JSON body `{ input: <value> }`. The dispatcher:
  //   1. matches `/api/rpc/<name>/<method>` via `matchRpcPath()` (returns
  //      `null` for any other path — then we fall through to β),
  //   2. looks up the registered `RpcDefinition` in the module-level
  //      `rpcRegistry` (populated by `registerRpc` at boot from
  //      `ServerOptions.rpc.endpoints`),
  //   3. validates the request body against `procedure.input` (Zod),
  //      invokes `procedure.handler`, validates the return value against
  //      `procedure.output` (Zod), and ships a
  //      `{ ok: true, data } | { ok: false, error }` JSON envelope.
  //
  // All failure paths return structured envelopes — never throws — so the
  // outer request handler's 5xx catch is unreachable on the happy path.
  // See `packages/core/src/contract/rpc.ts` and
  // `docs/architect/typed-rpc.md`.
  {
    const rpcMatch = matchRpcPath(pathname);
    if (rpcMatch) {
      const rpcResponse = await dispatchRpc(
        req,
        rpcMatch.endpoint,
        rpcMatch.method,
        { isDev: settings.isDev }
      );
      if (settings.cors && isCorsRequest(req)) {
        const corsOptions: CorsOptions =
          typeof settings.cors === "object" ? settings.cors : {};
        return ok(applyCorsToResponse(rpcResponse, req, corsOptions));
      }
      return ok(rpcResponse);
    }
  }
  // ─── End Phase 18.κ ───────────────────────────────────────────────────────

  // 3. 라우트 매칭
  const match = router.match(pathname);
  if (!match) {
    // Phase 6.3: unmatched URL → try `app/not-found.tsx` first. We
    // can't reuse renderNotFoundPage directly (no route/params/layoutChain
    // context here), so inline a minimal render path. The component and
    // its loader are invoked with empty params + a pseudo route id so
    // layouts that rely on routeId don't crash. If rendering fails OR no
    // handler is registered, fall through to the built-in error path.
    if (registry.notFoundHandler) {
      try {
        const registration = await registry.notFoundHandler();
        let loaderData: unknown = { message: "Not Found" };
        if (registration.filling?.hasLoader()) {
          const ctx = new ManduContext(req, {});
          attachI18nToContext(ctx, req);
          try {
            const returned = await registration.filling.executeLoader(ctx);
            loaderData = returned !== undefined ? returned : { message: "Not Found" };
          } catch (loaderError) {
            console.warn(`[Mandu] not-found.tsx loader threw (unmatched URL):`, loaderError);
          }
        }
        const rawApp = React.createElement(registration.component, {
          params: {},
          loaderData,
        });
        // Issue #198 — pre-resolve in case the not-found component is async.
        const app = (await resolveAsyncElement(rawApp)) as React.ReactElement;
        const html = renderSSR(app, {
          title: "Not Found",
          isDev: settings.isDev,
          cssPath: settings.cssPath,
          transitions: settings.transitions,
          prefetch: settings.prefetch,
          spa: settings.spa,
          devtools: settings.devtools,
        });
        const headers = new Headers(html.headers);
        const body = await html.text();
        return ok(new Response(body, { status: 404, headers }));
      } catch (renderError) {
        console.error(`[Mandu] app/not-found.tsx render failed for unmatched URL; falling back to built-in 404:`, renderError);
      }
    }
    return err(createNotFoundResponse(pathname));
  }

  const { route, params } = match;

  // ─── Issue #214 — dynamicParams guard ─────────────────────────────────────
  // Runs AFTER γ's prerendered pass-through (step 0.5) and BEFORE ζ's
  // per-route ISR cache dispatch (which lives inside `handlePageRoute`).
  //
  // Contract (Next.js parity):
  //   - Page route opted into `dynamicParams: false` AND has `staticParams`
  //     populated from `generateStaticParams` at build time → the incoming
  //     params MUST match one of the known sets. Otherwise: 404.
  //   - `dynamicParams: true` (or undefined) → default behavior unchanged.
  //     Any dynamic URL falls through to SSR just like before.
  //   - API + metadata routes are never gated — `dynamicParams` is
  //     page-only.
  //
  // The guard short-circuits with `renderNotFoundPage` so per-route
  // `not-found.tsx` / global `notFoundHandler` / built-in JSON 404 all
  // render correctly without recursing through SSR. Cookies are not
  // applied because no page loader has run yet — this check precedes
  // loader dispatch by design.
  if (
    route.kind === "page" &&
    (route as { dynamicParams?: boolean }).dynamicParams === false
  ) {
    const staticParams = (route as { staticParams?: StaticParamSetSchema[] })
      .staticParams;
    if (!paramsInStaticSet(params, staticParams)) {
      const pageRouteForNF = route as {
        id: string;
        pattern: string;
        layoutChain?: string[];
        hydration?: HydrationConfig;
        streaming?: boolean;
        notFoundModule?: string;
      };
      const nfResponse = await renderNotFoundPage(
        req,
        pageRouteForNF,
        params,
        registry,
        /* pageCookies */ undefined,
        /* layoutCookies */ undefined,
        /* layoutData */ undefined,
        new Response(
          JSON.stringify({
            message: `No static param match for ${pathname}`,
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        )
      );
      if (settings.cors && isCorsRequest(req)) {
        const corsOptions: CorsOptions =
          typeof settings.cors === "object" ? settings.cors : {};
        return ok(applyCorsToResponse(nfResponse, req, corsOptions));
      }
      return ok(nfResponse);
    }
  }
  // ─── End Issue #214 ───────────────────────────────────────────────────────

  // 3. 라우트 종류별 처리
  if (route.kind === "api") {
    const rateLimitOptions = settings.rateLimit;
    if (rateLimitOptions && registry.rateLimiter) {
      const decision = registry.rateLimiter.consume(req, route.id, rateLimitOptions);
      if (!decision.allowed) {
        return ok(createRateLimitResponse(decision, rateLimitOptions));
      }

      const apiResult = await handleApiRoute(req, route, params, registry);
      if (!apiResult.ok) return apiResult;
      return ok(appendRateLimitHeaders(apiResult.value, decision, rateLimitOptions));
    }

    return handleApiRoute(req, route, params, registry);
  }

  if (route.kind === "page") {
    return handlePageRoute(req, url, route, params, registry);
  }

  if (route.kind === "metadata") {
    return handleMetadataRouteRequest(route, registry);
  }

  // 4. 알 수 없는 라우트 종류 — exhaustiveness check
  const _exhaustive: never = route;
  return err({
    errorType: "FRAMEWORK_BUG",
    code: "MANDU_F003",
    httpStatus: 500,
    message: `Unknown route kind: ${(_exhaustive as RouteSpec).kind}`,
    summary: "알 수 없는 라우트 종류 - 프레임워크 버그",
    fix: {
      file: ".mandu/routes.manifest.json",
      suggestion: "라우트의 kind는 'api' 또는 'page'여야 합니다",
    },
    route: { id: (_exhaustive as RouteSpec).id, pattern: (_exhaustive as RouteSpec).pattern },
    timestamp: new Date().toISOString(),
  });
}

// ========== Port Selection ==========

const MAX_PORT_ATTEMPTS = 10;

function isPortInUseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? "";
  return code === "EADDRINUSE" || message.includes("EADDRINUSE") || message.includes("address already in use");
}

function startBunServerWithFallback(options: {
  port: number;
  hostname?: string;
  fetch: (req: Request, server: Server<undefined>) => Promise<Response | undefined>;
  websocket?: Record<string, unknown>;
}): { server: Server<undefined>; port: number; attempts: number } {
  const { port: startPort, hostname, fetch, websocket } = options;
  let lastError: unknown = null;

  const serveOptions: Record<string, unknown> = { hostname, fetch, idleTimeout: 255 };
  if (websocket) serveOptions.websocket = websocket;

  // Port 0: let Bun/OS pick an available ephemeral port.
  if (startPort === 0) {
    const server = Bun.serve({ port: 0, ...serveOptions } as any);
    return { server, port: server.port ?? 0, attempts: 0 };
  }

  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const candidate = startPort + attempt;
    if (candidate < 1 || candidate > 65535) {
      continue;
    }
    try {
      const server = Bun.serve({ port: candidate, ...serveOptions } as any);
      return { server, port: server.port ?? candidate, attempts: attempt };
    } catch (error) {
      if (!isPortInUseError(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError ?? new Error(`No available port found starting at ${startPort}`);
}

// ========== Server Startup ==========

/**
 * Format a base URL for startup logging based on the bound hostname.
 *
 * When binding to wildcard addresses (`0.0.0.0`, `::`, or empty string),
 * the server listens on all interfaces — browsers must use `localhost`
 * or a specific loopback address to connect. We surface both IPv4 and IPv6
 * loopback URLs so the user can pick whichever their OS prefers.
 *
 * Returns `{ primary, additional }` where `primary` is the canonical URL
 * for UX (open-in-browser, runtime control) and `additional` are supplementary
 * URLs shown in the startup log.
 */
export function formatServerAddresses(
  hostname: string | undefined,
  port: number
): { primary: string; additional: string[] } {
  const isWildcardV4 = hostname === "0.0.0.0" || hostname === undefined || hostname === "";
  const isWildcardV6 = hostname === "::" || hostname === "[::]";
  if (isWildcardV4 || isWildcardV6) {
    return {
      primary: `http://localhost:${port}`,
      additional: [`http://127.0.0.1:${port}`, `http://[::1]:${port}`],
    };
  }
  // Bracket IPv6 literals for URL syntax.
  const host = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  return { primary: `http://${host}:${port}`, additional: [] };
}

export function startServer(manifest: RoutesManifest, options: ServerOptions = {}): ManduServer {
  const {
    port = 3000,
    // Default to 0.0.0.0 (dual-stack wildcard on IPv4) so `localhost` resolves
    // to 127.0.0.1 via OS-level IPv4-preferred lookups (e.g., Windows). Users
    // can still pin `hostname: "::1"` or `hostname: "127.0.0.1"` explicitly.
    // See issue #190.
    hostname = "0.0.0.0",
    rootDir = process.cwd(),
    isDev = false,
    hmrPort,
    bundleManifest,
    publicDir = "public",
    cors = false,
    streaming = false,
    rateLimit = false,
    cssPath: cssPathOption,
    registry = defaultRegistry,
    guardConfig = null,
    cache: cacheOption,
    managementToken,
    transitions,
    prefetch,
    spa,
    devtools,
    observability: observabilityOption,
    openapi: openapiOption,
    prerender: prerenderOption,
    middleware: middlewareOption,
    rpc: rpcOption,
    scheduler: schedulerOption,
    i18n: i18nOption,
    messages: messagesOption,
    plugins: pluginsOption,
    configHooks: configHooksOption,
    // #217 — internal flag: suppress the "listening" banner. Threaded
    // through by `mandu build`'s transient prerender server so that
    // ephemeral `port: 0` listeners don't confuse humans/LLMs with a
    // URL that's already torn down by the time they curl it.
    silent = false,
  } = options;

  // Phase 18.μ — validate i18n + messages shape. Both are branded via
  // `defineI18n()` / `defineMessages()`; reject any raw object so user
  // typos fail fast at boot instead of on first request.
  if (i18nOption !== undefined && !isI18nDefinition(i18nOption)) {
    throw new Error(
      "[mandu] ServerOptions.i18n must be the return value of defineI18n(). " +
        "Import { defineI18n } from '@mandujs/core/i18n'."
    );
  }
  if (messagesOption !== undefined && !isMessageRegistry(messagesOption)) {
    throw new Error(
      "[mandu] ServerOptions.messages must be the return value of defineMessages(). " +
        "Import { defineMessages } from '@mandujs/core/i18n'."
    );
  }

  // Phase 18.ε — build the request-level middleware chain once at boot.
  // `compose()` returns a passthrough when the list is empty; storing
  // `undefined` for "no middleware" keeps the hot path branch-free.
  //
  // Phase 18.τ — plugin-contributed middleware via `defineMiddlewareChain()`
  // is resolved asynchronously OUTSIDE `startServer()` (which is sync).
  // Drivers call `resolvePluginMiddleware({ plugins, configHooks, rootDir,
  // mode })` and pass the resulting `Middleware[]` as a PREFIX of
  // `options.middleware` before calling `startServer()`.
  //
  // `pluginsOption` / `configHooksOption` are still carried here so that
  // lifecycle observers fired by drivers can reuse the same bundle; they
  // are NOT consulted for the middleware chain itself.
  void pluginsOption;
  void configHooksOption;
  const middlewareChain: ComposedHandler | undefined =
    middlewareOption && middlewareOption.length > 0
      ? composeMiddleware(...middlewareOption)
      : undefined;

  // Phase 18 — normalize prerender pass-through settings. `undefined`
  // defaults to enabled (Next.js parity); explicit `false` opts out.
  let prerenderSettings: ServerRegistrySettings["prerender"] | undefined;
  if (prerenderOption !== false) {
    const dirOption =
      typeof prerenderOption === "object" && prerenderOption?.dir
        ? prerenderOption.dir
        : DEFAULT_PRERENDER_DIR;
    const cacheControl =
      typeof prerenderOption === "object" && prerenderOption?.cacheControl
        ? prerenderOption.cacheControl
        : DEFAULT_PRERENDER_CACHE_CONTROL;
    const absoluteDir = path.isAbsolute(dirOption)
      ? dirOption
      : path.join(options.rootDir ?? process.cwd(), dirOption);
    prerenderSettings = { dir: absoluteDir, cacheControl };
  }

  // cssPath 처리:
  // - string: 해당 경로로 <link> 주입
  // - false: CSS 링크 주입 비활성화
  // - undefined: false로 처리 (기본적으로 링크 미삽입 - 404 방지)
  //
  // dev/build에서 Tailwind 감지 시 명시적으로 cssPath 전달 필요:
  // - dev.ts: cssPath: hasTailwind ? cssWatcher?.serverPath : false
  // - 프로덕션: 빌드 후 .mandu/client/globals.css 존재 시 경로 전달
  const cssPath: string | false = cssPathOption ?? false;

  // CORS 옵션 파싱
  const corsOptions: CorsOptions | false = cors === true ? {} : cors;
  const rateLimitOptions = normalizeRateLimitOptions(rateLimit);

  if (!isDev && cors === true) {
    console.warn("⚠️  [Security Warning] CORS is set to allow all origins.");
    console.warn("   This is not recommended for production environments.");
    console.warn("   Consider specifying allowed origins explicitly:");
    console.warn("   cors: { origin: ['https://yourdomain.com'] }");
  }

  // Phase 18.θ — build a tracer once at boot. Honours
  // `observability.tracing` in options AND `MANDU_OTEL_ENDPOINT` env var.
  // When both are absent, `createTracerFromConfig({})` returns a disabled
  // tracer (no allocations, no per-request overhead).
  const tracerInstance: Tracer = createTracerFromConfig(
    observabilityOption?.tracing
  );
  // Install as process-global so `@mandujs/core/observability`
  // `getTracer()` returns the same instance user code sees through
  // `ctx.startSpan(...)`.
  setTracer(tracerInstance);

  // Registry settings 저장 (초기값)
  registry.settings = {
    isDev,
    hmrPort,
    bundleManifest,
    rootDir,
    publicDir,
    cors: corsOptions,
    streaming,
    rateLimit: rateLimitOptions,
    cssPath,
    managementToken,
    transitions,
    prefetch,
    spa,
    devtools,
    heapEndpoint: observabilityOption?.heapEndpoint,
    metricsEndpoint: observabilityOption?.metricsEndpoint,
    tracer: tracerInstance.enabled ? tracerInstance : undefined,
    // Production OpenAPI endpoint — default OFF so an internet-facing
    // deployment does not leak its API surface without explicit opt-in.
    // `MANDU_OPENAPI_ENABLED=1` in the environment forces-on without a
    // config edit; explicit `enabled: false` still wins (explicit > env).
    openapi: isOpenAPIEndpointEnabled(openapiOption?.enabled)
      ? resolveOpenAPIEndpointSettings(rootDir, openapiOption?.path)
      : undefined,
    prerender: prerenderSettings,
    middlewareChain,
    i18n: i18nOption,
    messages: messagesOption,
  };

  registry.rateLimiter = rateLimitOptions ? new MemoryRateLimiter() : null;

  // ─── Phase 18.κ — register RPC endpoints from options ──────────────────
  // The RPC registry is module-scoped (shared across all server
  // instances in this process). Clearing first keeps repeated
  // `startServer()` calls in tests deterministic — otherwise a stale
  // endpoint from a prior run could answer a later instance's requests.
  //
  // This runs once at boot; HMR-time re-registration goes through the
  // exported `registerRpc()` from `@mandujs/core/contract/rpc`.
  clearRpcRegistry();
  if (rpcOption?.endpoints) {
    for (const [name, definition] of Object.entries(rpcOption.endpoints)) {
      registerRpc(name, definition);
    }
  }
  // ─── End Phase 18.κ ────────────────────────────────────────────────────

  // ─── Phase 18.ζ — ISR/SWR 캐시 초기화 ──────────────────────────────────
  // `cacheOption` 는 `true` | `false` | `CacheStore` | `CacheConfig` 를 받는다:
  //   - `true`          → MemoryCacheStore(1000) 를 기본값으로 생성.
  //   - `CacheStore`    → 그대로 주입 (커스텀 어댑터, 예: redis).
  //   - `CacheConfig`   → { defaultMaxAge, defaultSwr, maxEntries, store }
  //                       에서 store="memory"(default) 로 MemoryCacheStore 생성
  //                       후 defaults 를 global 에 기록하여 per-request `_cache`
  //                       가 누락된 경우에도 자동 캐싱할 수 있게 한다.
  //   - `false`/미지정  → 캐시 disabled.
  if (cacheOption) {
    const store = createCacheStoreFromConfig(
      cacheOption as boolean | CacheStore | CacheConfig
    );
    if (store) {
      registry.settings.cacheStore = store;
      setGlobalCache(store); // revalidatePath/revalidateTag API에서 사용

      // CacheConfig 객체일 때만 defaults 를 전역에 등록. boolean/CacheStore
      // 형태로 들어오면 기존 동작 (per-route 설정 없으면 저장 안 함) 유지.
      if (
        typeof cacheOption === "object" &&
        cacheOption !== null &&
        !(typeof (cacheOption as CacheStore).get === "function")
      ) {
        const cfg = cacheOption as CacheConfig;
        setGlobalCacheDefaults({
          defaultMaxAge: cfg.defaultMaxAge,
          defaultSwr: cfg.defaultSwr,
        });
      } else {
        setGlobalCacheDefaults(null);
      }
    }
  } else {
    // 캐시 disabled — 이전 테스트 run 의 defaults 가 새 서버 instance 에
    // 새어 들어오지 않도록 초기화.
    setGlobalCacheDefaults(null);
  }
  // ─── End Phase 18.ζ ────────────────────────────────────────────────────

  // Kitchen dev dashboard (dev mode only)
  if (isDev) {
    const kitchen = new KitchenHandler({ rootDir, manifest, guardConfig });
    kitchen.start();
    registry.kitchen = kitchen;
  }

  const router = new Router(manifest.routes);

  // 글로벌 미들웨어 (middleware.ts) — 동기 로드로 첫 요청부터 보장
  let middlewareFn: MiddlewareFn | null = null;
  let middlewareConfig: MiddlewareConfig | null = null;

  const mwResult = loadMiddlewareSync(rootDir);
  if (mwResult) {
    middlewareFn = mwResult.fn;
    middlewareConfig = mwResult.config;
    console.log("🔗 Global middleware loaded");
  }

  // Fetch handler: 미들웨어 + CORS + 라우트 디스패치 (런타임 중립 팩토리 사용)
  const fetchHandler = createFetchHandler({
    router,
    registry,
    corsOptions,
    middlewareFn,
    middlewareConfig,
    handleRequest,
  });

  // WebSocket 핸들러 빌드 (등록된 WS 라우트가 있을 때만)
  const hasWsRoutes = registry.wsHandlers.size > 0;
  const wsConfig = hasWsRoutes ? {
    open(ws: any) {
      const data = ws.data as WSUpgradeData;
      const handlers = registry.wsHandlers.get(data.routeId);
      handlers?.open?.(wrapBunWebSocket(ws));
    },
    message(ws: any, message: string | ArrayBuffer) {
      const data = ws.data as WSUpgradeData;
      const handlers = registry.wsHandlers.get(data.routeId);
      handlers?.message?.(wrapBunWebSocket(ws), message);
    },
    close(ws: any, code: number, reason: string) {
      const data = ws.data as WSUpgradeData;
      const handlers = registry.wsHandlers.get(data.routeId);
      handlers?.close?.(wrapBunWebSocket(ws), code, reason);
    },
    drain(ws: any) {
      const data = ws.data as WSUpgradeData;
      const handlers = registry.wsHandlers.get(data.routeId);
      handlers?.drain?.(wrapBunWebSocket(ws));
    },
  } : undefined;

  // Phase 17 — bump the Prometheus request counter once per Response we
  // actually produce. WebSocket upgrades (return `undefined`) are
  // deliberately skipped so the counter only reflects plain HTTP traffic.
  // Errors from `recordHttpRequest` are impossible to surface here — the
  // Map update is synchronous and self-contained — but we still try/catch
  // as defence-in-depth.
  const bumpCounter = (req: Request, res: Response | undefined): void => {
    if (!res) return;
    try {
      recordHttpRequest(req.method, res.status);
    } catch {
      // Never let an observability hiccup break a request.
    }
  };

  // fetch handler: WS upgrade 감지 추가
  const wrappedFetch = hasWsRoutes
    ? async (req: Request, bunServer: Server<undefined>): Promise<Response | undefined> => {
        // WebSocket upgrade 요청 감지
        if (req.headers.get("upgrade") === "websocket") {
          const url = new URL(req.url);
          const match = router.match(url.pathname);
          if (match && registry.wsHandlers.has(match.route.id)) {
            const upgraded = (bunServer as any).upgrade(req, {
              data: { routeId: match.route.id, params: match.params, id: newId() },
            });
            return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
          }
        }
        const res = await fetchHandler(req);
        bumpCounter(req, res);
        return res;
      }
    : async (req: Request): Promise<Response> => {
        const res = await fetchHandler(req);
        bumpCounter(req, res);
        return res;
      };

  const { server, port: actualPort, attempts } = startBunServerWithFallback({
    port,
    hostname,
    fetch: wrappedFetch as any,
    websocket: wsConfig,
  });

  if (attempts > 0) {
    console.warn(`⚠️  Port ${port} is in use. Using ${actualPort} instead.`);
  }

  if (hmrPort !== undefined && hmrPort === port && actualPort !== port) {
    registry.settings = { ...registry.settings, hmrPort: actualPort };
  }

  const addresses = formatServerAddresses(hostname, actualPort);

  // ─── #217 — gate the boot banner on `!silent` ─────────────────────────
  // `silent: true` is passed by internal callers that spawn a transient
  // listener on an ephemeral port (e.g. the build-time prerender
  // orchestrator). The HTTP listener still binds; only the stdout banner
  // — "🥟 Mandu server listening" / "🥟 Mandu Dev Server listening" plus
  // its auxiliary lines (additional addresses, HMR, static-file hint,
  // CORS, streaming, Kitchen) — is suppressed. User-facing commands
  // (`mandu dev`, `mandu start`) leave `silent` undefined/false and
  // therefore see the banner unchanged.
  // ─── End #217 ─────────────────────────────────────────────────────────
  if (!silent) {
    if (isDev) {
      console.log(`🥟 Mandu Dev Server listening at ${addresses.primary}`);
      if (addresses.additional.length > 0) {
        console.log(`   (also reachable at ${addresses.additional.join(", ")})`);
      }
      if (registry.settings.hmrPort) {
        console.log(`🔥 HMR enabled on port ${registry.settings.hmrPort + PORTS.HMR_OFFSET}`);
      }
      console.log(`📂 Static files: /${publicDir}/, /.mandu/client/`);
      if (corsOptions) {
        console.log(`🌐 CORS enabled`);
      }
      if (streaming) {
        console.log(`🌊 Streaming SSR enabled`);
      }
      if (registry.kitchen) {
        console.log(`🍳 Kitchen dashboard at ${addresses.primary}/__kitchen`);
      }
    } else {
      console.log(`🥟 Mandu server listening at ${addresses.primary}`);
      if (addresses.additional.length > 0) {
        console.log(`   (also reachable at ${addresses.additional.join(", ")})`);
      }
      if (streaming) {
        console.log(`🌊 Streaming SSR enabled`);
      }
    }
  }

  // ─── Phase 18.λ — declarative cron scheduler ────────────────────────────
  // Boot the scheduler AFTER the HTTP listener is live so a malformed cron
  // expression (caught by validateCronExpression) surfaces alongside the
  // other boot errors rather than aborting the server. `startServer` is
  // synchronous by contract, so we use the already-imported scheduler
  // module rather than `await import`.
  let schedulerRegistration: import("../scheduler").CronRegistration | null = null;
  const jobDefs = schedulerOption?.jobs ?? [];
  const schedulerDisabled = schedulerOption?.disabled === true;
  if (jobDefs.length > 0 && !schedulerDisabled) {
    try {
      schedulerRegistration = schedulerDefineCron(jobDefs);
      schedulerRegistration.start();
      setActiveSchedulerRegistration(schedulerRegistration);
      const bunJobCount = Object.keys(schedulerRegistration.status()).filter(
        (name) => {
          const def = jobDefs.find((j) => j.name === name);
          const runOn = def?.runOn && def.runOn.length > 0 ? def.runOn : ["bun", "workers"];
          return runOn.includes("bun");
        },
      ).length;
      console.log(
        `⏰ Scheduler: ${bunJobCount} cron job(s) registered on Bun runtime` +
          (jobDefs.length !== bunJobCount
            ? ` (${jobDefs.length - bunJobCount} workers-only — see wrangler.toml)`
            : ""),
      );
    } catch (err) {
      // Scheduler failures MUST NOT crash the server — a bad cron string is
      // a developer error, but the HTTP surface should keep serving. Log
      // loudly and leave the registration null.
      console.error(
        "❌ [scheduler] failed to start — HTTP server continues without cron jobs:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    server,
    router,
    registry,
    stop: () => {
      registry.kitchen?.stop();
      // Fire-and-forget the async scheduler drain so `stop()` stays
      // synchronous for backwards compatibility with existing consumers.
      // Tests that need to await drain can reach for `registration.stop()`
      // directly; `server.stop()` triggers shutdown but doesn't block on
      // in-flight cron handler completion here.
      if (schedulerRegistration) {
        const reg = schedulerRegistration;
        schedulerRegistration = null;
        void reg.stop()
          .then(() => setActiveSchedulerRegistration(null))
          .catch((err) => {
            console.error("[scheduler] shutdown error:", err);
          });
      }
      server.stop();
    },
  };
}

// Clear registries (useful for testing) - deprecated, use clearDefaultRegistry()
export function clearRegistry(): void {
  clearDefaultRegistry();
}

// Export registry maps for backward compatibility (defaultRegistry 사용)
export const apiHandlers = defaultRegistry.apiHandlers;
export const pageLoaders = defaultRegistry.pageLoaders;
export const pageHandlers = defaultRegistry.pageHandlers;
export const routeComponents = defaultRegistry.routeComponents;

// ========== Runtime-Neutral Fetch Handler Factory ==========

/**
 * Options for {@link createAppFetchHandler}. Subset of {@link ServerOptions}
 * that makes sense in edge/serverless runtimes — no listen/port/hmr fields.
 */
export interface AppFetchHandlerOptions {
  /** Project root (used for module path validation). Required. */
  rootDir: string;
  /** Bundle manifest (Island hydration). Optional in pure-SSR apps. */
  bundleManifest?: BundleManifest;
  /** CORS config — `true` allows all origins, object for fine-grained rules. */
  cors?: boolean | CorsOptions;
  /** Streaming SSR toggle. Default: `false`. */
  streaming?: boolean;
  /** Rate limit policy. Memory-backed; edge runtimes should prefer durable stores. */
  rateLimit?: boolean | RateLimitOptions;
  /**
   * CSS link injection target for SSR. Typically `"/.mandu/client/globals.css"`
   * when Tailwind is in use. `false` disables injection.
   */
  cssPath?: string | false;
  /** Custom registry override (defaults to the global registry). */
  registry?: ServerRegistry;
  /**
   * Mark this handler as edge-hosted. Skips filesystem-dependent features
   * (static file serving, Kitchen dashboard, image optimization). Set to
   * `true` by `@mandujs/edge` adapters.
   */
  edge?: boolean;
  /**
   * Optional global middleware function. When omitted, the handler does not
   * attempt to auto-load `middleware.ts` from disk (important for edge
   * bundles where FS is unavailable). Adapters should pass pre-compiled
   * middleware at build time.
   */
  middleware?: {
    fn: MiddlewareFn;
    config?: MiddlewareConfig | null;
  };
}

/**
 * Build a runtime-neutral `fetch(req) → Promise<Response>` handler from a
 * routes manifest. Reuses the same request pipeline as `startServer()`
 * (CORS, middleware, router, SSR, API handlers) but without binding to
 * `Bun.serve`. Suitable for Cloudflare Workers, Deno Deploy, Vercel Edge,
 * Netlify Edge, and any other Web-Fetch host.
 *
 * Handler registration (`registerApiHandler`, `registerPageHandler`, …) must
 * happen *before* calling this factory — same contract as `startServer`.
 *
 * @example
 * ```ts
 * // Cloudflare Workers entry
 * import { createAppFetchHandler } from "@mandujs/core";
 * import manifest from "./.mandu/routes.manifest.json";
 * import "./.mandu/edge-workers/register.js"; // populates registries
 *
 * const fetch = createAppFetchHandler(manifest, {
 *   rootDir: "/",
 *   edge: true,
 *   cssPath: false,
 * });
 *
 * export default { fetch };
 * ```
 */
export function createAppFetchHandler(
  manifest: RoutesManifest,
  options: AppFetchHandlerOptions
): (req: Request) => Promise<Response> {
  const {
    rootDir,
    bundleManifest,
    cors = false,
    streaming = false,
    rateLimit = false,
    cssPath = false,
    registry = defaultRegistry,
    edge = false,
    middleware,
  } = options;

  const corsOptions: CorsOptions | false = cors === true ? {} : cors;
  const rateLimitOptions = normalizeRateLimitOptions(rateLimit);

  registry.settings = {
    isDev: false,
    bundleManifest,
    rootDir,
    publicDir: "public",
    cors: corsOptions,
    streaming,
    rateLimit: rateLimitOptions,
    cssPath,
    edge,
  };

  registry.rateLimiter = rateLimitOptions ? new MemoryRateLimiter() : null;

  const router = new Router(manifest.routes);

  return createFetchHandler({
    router,
    registry,
    corsOptions,
    middlewareFn: middleware?.fn ?? null,
    middlewareConfig: middleware?.config ?? null,
    handleRequest,
  });
}

// ========== Rate Limiting Public API ==========

/**
 * Rate limiter 인스턴스 생성
 * API 핸들러에서 직접 사용 가능
 *
 * @example
 * ```typescript
 * import { createRateLimiter } from '@mandujs/core/runtime/server';
 *
 * const limiter = createRateLimiter({ max: 5, windowMs: 60000 });
 *
 * export async function POST(req: Request) {
 *   const decision = limiter.check(req, 'my-api-route');
 *   if (!decision.allowed) {
 *     return limiter.createResponse(decision);
 *   }
 *   // ... 정상 로직
 * }
 * ```
 */
export function createRateLimiter(options?: RateLimitOptions) {
  const normalized = normalizeRateLimitOptions(options || true);
  if (!normalized) {
    throw new Error('Rate limiter options cannot be false');
  }

  const limiter = new MemoryRateLimiter();

  return {
    /**
     * Rate limit 체크
     * @param req Request 객체 (IP 추출용)
     * @param routeId 라우트 식별자 (동일 IP라도 라우트별로 독립적인 limit)
     */
    check(req: Request, routeId: string): RateLimitDecision {
      return limiter.consume(req, routeId, normalized);
    },

    /**
     * Rate limit 초과 시 429 응답 생성
     */
    createResponse(decision: RateLimitDecision): Response {
      return createRateLimitResponse(decision, normalized);
    },

    /**
     * 정상 응답에 Rate limit 헤더 추가
     */
    addHeaders(response: Response, decision: RateLimitDecision): Response {
      return appendRateLimitHeaders(response, decision, normalized);
    },
  };
}
