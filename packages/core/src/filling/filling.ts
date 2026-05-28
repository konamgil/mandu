/**
 * Mandu Filling - 만두소 🥟
 * 체이닝 API로 비즈니스 로직 정의
 *
 * DNA-002: 의존성 주입 패턴 지원
 */

import { ManduContext, ValidationError, BadRequestError } from "./context";
import { AuthenticationError, AuthorizationError } from "./auth";
import { type FillingDeps, globalDeps } from "./deps";
import { ErrorClassifier, formatErrorResponse, ErrorCode } from "../error";
import { TIMEOUTS } from "../constants";
import { createContract, type ContractDefinition, type ContractInstance } from "../contract";
import type { WSHandlers } from "./ws";
import {
  type Middleware as RuntimeMiddleware,
  type MiddlewareEntry,
  compose,
} from "../runtime/compose";
import {
  type LifecycleStore,
  type OnRequestHandler,
  type OnParseHandler,
  type BeforeHandleHandler,
  type AfterHandleHandler,
  type MapResponseHandler,
  type OnErrorHandler,
  type AfterResponseHandler,
  createLifecycleStore,
  executeLifecycle,
  type ExecuteOptions,
} from "../runtime/lifecycle";
import type { SlotMetadata, SlotConstraints } from "../guard/semantic-slots";
import {
  DeployIntentInput,
  type DeployIntentInput as DeployIntentInputType,
} from "../deploy/intent";

/** Handler function type */
export type Handler = (ctx: ManduContext) => Response | Promise<Response>;

/** Guard function type (alias of BeforeHandle) */
export type Guard = BeforeHandleHandler;

/** HTTP methods */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** 미들웨어 플러그인 (여러 lifecycle 단계를 조합) */
export interface MiddlewarePlugin {
  beforeHandle?: BeforeHandleHandler;
  afterHandle?: AfterHandleHandler;
  mapResponse?: MapResponseHandler;
}

/**
 * Loader function type — SSR data loader.
 *
 * Returns the route's data object `T`, or a `Response` to short-circuit
 * the SSR pipeline (DX-3). A returned `Response` with a redirect-range
 * status code becomes the final response — SSR is skipped and any pending
 * `ctx.cookies` are merged into the outgoing headers. Use the
 * `redirect(url)` helper for the common case; throwing a `Response` is
 * also accepted (Remix idiom).
 */
export type LoaderResult<T = unknown> = T | Response;

export type Loader<T = unknown> = (
  ctx: ManduContext
) => LoaderResult<T> | Promise<LoaderResult<T>>;

/**
 * Page-level SSR data reader. Prefer this name in public docs when the
 * distinction from mutation actions or schema contracts matters.
 */
export type RouteDataLoader<T = unknown> = Loader<T>;

/** Loader 실행 옵션 */
export interface LoaderOptions<T = unknown> {
  /** 타임아웃 (ms), 기본값 5000 */
  timeout?: number;
  /** 타임아웃 또는 에러 시 반환할 fallback 데이터 */
  fallback?: T;
}

/** Loader 캐시/ISR 옵션 */
export interface LoaderCacheOptions {
  /**
   * Fresh 캐시 유지 시간 (초). `maxAge` 의 별칭 — Next.js `revalidate`
   * API 와 호환성을 유지한다. 0 이면 캐시 안 함.
   */
  revalidate?: number;
  /**
   * Phase 18.ζ — fresh 창을 지난 뒤 캐시를 계속 서빙할 stale-while-revalidate
   * 창 길이 (초). 지정 시 `revalidate` 구간 후 이 기간만큼 STALE 응답을
   * 즉시 반환하고 백그라운드에서 재생성한다.
   */
  staleWhileRevalidate?: number;
  /** 온디맨드 무효화 태그 */
  tags?: string[];
}

/** 렌더링 모드 */
export type RenderMode = "dynamic" | "isr" | "swr" | "ppr";

/** Loader 타임아웃 에러 */
export class LoaderTimeoutError extends Error {
  constructor(timeout: number) {
    super(`Loader timed out after ${timeout}ms`);
    this.name = "LoaderTimeoutError";
  }
}

/** Action handler type — named mutation handler */
export type ActionHandler = (ctx: ManduContext) => Response | Promise<Response>;

/**
 * Named mutation/interaction handler. Alias of `ActionHandler`, exported so
 * docs and generated examples can name the action responsibility directly.
 */
export type MutationAction = ActionHandler;

/**
 * Executable route pipeline: handlers, loader, actions, middleware, cache,
 * render mode, and deploy intent. This is intentionally separate from the
 * API schema contract.
 */
export type RouteFilling<TLoaderData = unknown> = ManduFilling<TLoaderData>;

interface FillingConfig<TLoaderData = unknown> {
  handlers: Map<HttpMethod, Handler>;
  actions: Map<string, ActionHandler>;
  loader?: Loader<TLoaderData>;
  loaderCache?: LoaderCacheOptions;
  renderMode?: RenderMode;
  wsHandlers?: WSHandlers;
  lifecycle: LifecycleStore;
  middleware: MiddlewareEntry[];
  /** Semantic slot metadata */
  semantic: SlotMetadata;
  /**
   * Issue #250 M5 — explicit deploy intent override. When present,
   * `mandu deploy:plan` records this entry as `source: "explicit"`,
   * which the planner never overwrites via inference. The shape is
   * the partial-input form so users can declare just the fields they
   * care about (typically `runtime` + maybe `regions`).
   *
   * Use this to escape-hatch the heuristic / brain when you know
   * better than they do — e.g. an API route that imports a DB driver
   * but is actually called from a build-only script and you want it
   * to ship as `static`.
   */
  deploy?: DeployIntentInputType;
}

export class ManduFilling<TLoaderData = unknown> {
  private config: FillingConfig<TLoaderData> = {
    handlers: new Map(),
    actions: new Map(),
    lifecycle: createLifecycleStore(),
    middleware: [],
    semantic: {},
  };

  /**
   * Semantic Slot: 슬롯의 목적 정의
   * AI가 이 슬롯의 역할을 이해하고 적절한 구현을 하도록 안내
   *
   * @example
   * ```typescript
   * Mandu.filling()
   *   .purpose("사용자 목록 조회 API")
   *   .get(async (ctx) => { ... });
   * ```
   */
  purpose(purposeText: string): this {
    this.config.semantic.purpose = purposeText;
    return this;
  }

  /**
   * Semantic Slot: 상세 설명 추가
   *
   * @example
   * ```typescript
   * Mandu.filling()
   *   .purpose("사용자 목록 조회 API")
   *   .description("페이지네이션된 사용자 목록 반환. 관리자 전용.")
   *   .get(async (ctx) => { ... });
   * ```
   */
  description(descText: string): this {
    this.config.semantic.description = descText;
    return this;
  }

  /**
   * Semantic Slot: 제약 조건 정의
   * AI가 이 범위 내에서만 구현하도록 제한
   *
   * @example
   * ```typescript
   * Mandu.filling()
   *   .purpose("사용자 목록 조회 API")
   *   .constraints({
   *     maxLines: 50,
   *     maxCyclomaticComplexity: 10,
   *     requiredPatterns: ["input-validation", "error-handling"],
   *     forbiddenPatterns: ["direct-db-write"],
   *     allowedImports: ["server/domain/user/*", "shared/utils/*"],
   *   })
   *   .get(async (ctx) => { ... });
   * ```
   */
  constraints(constraintsConfig: SlotConstraints): this {
    this.config.semantic.constraints = constraintsConfig;
    return this;
  }

  /**
   * Semantic Slot: 태그 추가 (검색 및 분류용)
   */
  tags(...tagList: string[]): this {
    this.config.semantic.tags = tagList;
    return this;
  }

  /**
   * Semantic Slot: 소유자/담당자 지정
   */
  owner(ownerName: string): this {
    this.config.semantic.owner = ownerName;
    return this;
  }

  /**
   * 슬롯 메타데이터 가져오기
   */
  getSemanticMetadata(): SlotMetadata {
    return { ...this.config.semantic };
  }

  /**
   * Deploy intent override — pin the runtime / cache / regions for this
   * route so `mandu deploy:plan` never overrides it via inference.
   *
   * Issue #250 M5. The shape mirrors the cache schema's partial-input
   * form: declare only the fields you care about; the rest fall to
   * the heuristic / brain. The `deploy:plan` command records the
   * entry as `source: "explicit"` and protects it from re-inference.
   *
   * @example Pin an API route to bun + Seoul region:
   * ```typescript
   * Mandu.filling()
   *   .deploy({ runtime: "bun", regions: ["icn1"] })
   *   .post(async (ctx) => { ... });
   * ```
   *
   * @example Force a dynamic page to render statically (only valid when
   * `generateStaticParams` covers every parameter set):
   * ```typescript
   * Mandu.filling()
   *   .deploy({ runtime: "static" })
   *   .loader(async () => ({ ... }));
   * ```
   *
   * The intent is validated immediately so a typo (`runtime: "lambdda"`)
   * fails at module load instead of silently shipping the wrong shape.
   */
  deploy(intent: DeployIntentInputType): this {
    this.config.deploy = DeployIntentInput.parse(intent);
    return this;
  }

  /**
   * Read the explicit deploy intent for this route, if any.
   *
   * Returns `undefined` when the user did not call `.deploy()`. The
   * build-time extractor consults this to decide whether to mark the
   * cache entry as `source: "explicit"` or pass through to inference.
   */
  getDeployIntent(): DeployIntentInputType | undefined {
    return this.config.deploy;
  }

  /**
   * SSR 데이터 로더 등록
   *
   * @example
   * ```typescript
   * // 기본 (캐시 없음)
   * .loader(async (ctx) => ({ posts: await db.getPosts() }))
   *
   * // ISR: 60초 캐시 후 백그라운드 재생성
   * .loader(async (ctx) => ({ posts: await db.getPosts() }), { revalidate: 60 })
   *
   * // 태그 기반 무효화
   * .loader(async (ctx) => ({ posts: await db.getPosts() }), { revalidate: 3600, tags: ["posts"] })
   * ```
   */
  loader(loaderFn: Loader<TLoaderData>, cacheOptions?: LoaderCacheOptions): this {
    this.config.loader = loaderFn;
    if (cacheOptions) {
      this.config.loaderCache = cacheOptions;
    }
    return this;
  }

  /**
   * 렌더링 모드 설정
   *
   * @example
   * ```typescript
   * .render("isr", { revalidate: 120 })
   * .render("swr", { revalidate: 300, tags: ["blog"] })
   * ```
   */
  render(mode: RenderMode, cacheOptions?: LoaderCacheOptions): this {
    this.config.renderMode = mode;
    if (cacheOptions) {
      this.config.loaderCache = { ...this.config.loaderCache, ...cacheOptions };
    }
    return this;
  }

  /** 현재 캐시/ISR 설정 반환 */
  getCacheOptions(): LoaderCacheOptions | undefined {
    return this.config.loaderCache;
  }

  /** 현재 렌더링 모드 반환 */
  getRenderMode(): RenderMode {
    return this.config.renderMode ?? "dynamic";
  }

  /**
   * Execute the registered loader.
   *
   * Return shape:
   *   - `TLoaderData` — normal loader data
   *   - `Response` — the loader returned a Response (e.g. `redirect("/login")`).
   *     Callers must check `instanceof Response` and short-circuit their
   *     pipeline instead of treating the value as page data.
   *   - `undefined` — no loader registered
   *
   * DX-3: the Response overload is explicit in the signature so downstream
   * TypeScript consumers are forced to narrow before consuming data —
   * prevents accidentally passing a Response into renderPageSSR.
   */
  async executeLoader(
    ctx: ManduContext,
    options: LoaderOptions<TLoaderData> = {}
  ): Promise<TLoaderData | Response | undefined> {
    if (!this.config.loader) {
      return undefined;
    }
    const { timeout = TIMEOUTS.LOADER_DEFAULT, fallback } = options;
    try {
      const loaderPromise = Promise.resolve(this.config.loader(ctx));
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new LoaderTimeoutError(timeout)), timeout);
      });
      return await Promise.race([loaderPromise, timeoutPromise]);
    } catch (error) {
      if (fallback !== undefined) {
        console.warn(`[Mandu] Loader failed, using fallback:`, error instanceof Error ? error.message : String(error));
        return fallback;
      }
      throw error;
    }
  }

  hasLoader(): boolean {
    return !!this.config.loader;
  }

  get(handler: Handler): this {
    this.config.handlers.set("GET", handler);
    return this;
  }

  post(handler: Handler): this {
    this.config.handlers.set("POST", handler);
    return this;
  }

  put(handler: Handler): this {
    this.config.handlers.set("PUT", handler);
    return this;
  }

  patch(handler: Handler): this {
    this.config.handlers.set("PATCH", handler);
    return this;
  }

  delete(handler: Handler): this {
    this.config.handlers.set("DELETE", handler);
    return this;
  }

  head(handler: Handler): this {
    this.config.handlers.set("HEAD", handler);
    return this;
  }

  options(handler: Handler): this {
    this.config.handlers.set("OPTIONS", handler);
    return this;
  }

  all(handler: Handler): this {
    const methods: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    methods.forEach((method) => this.config.handlers.set(method, handler));
    return this;
  }

  /**
   * Named action — mutation 핸들러 등록
   * POST 요청에서 _action 파라미터로 디스패치됨
   *
   * action 완료 후 loader가 있으면 자동 revalidation:
   * 응답에 { _action, _revalidated, loaderData } 포함
   *
   * @example
   * ```typescript
   * Mandu.filling()
   *   .loader(async (ctx) => ({ todos: await db.getTodos() }))
   *   .action("create", async (ctx) => {
   *     const { title } = await ctx.body<{ title: string }>();
   *     await db.createTodo(title);
   *     return ctx.ok({ created: true });
   *   })
   *   .action("delete", async (ctx) => {
   *     const { id } = await ctx.body<{ id: string }>();
   *     await db.deleteTodo(id);
   *     return ctx.ok({ deleted: true });
   *   });
   * ```
   */
  action(name: string, handler: ActionHandler): this {
    if (!name || name.trim().length === 0) {
      throw new Error("[Mandu] Action name must be a non-empty string");
    }
    this.config.actions.set(name, handler);
    return this;
  }

  hasAction(name: string): boolean {
    return this.config.actions.has(name);
  }

  getActionNames(): string[] {
    return Array.from(this.config.actions.keys());
  }

  /**
   * WebSocket 핸들러 등록
   *
   * @example
   * ```typescript
   * Mandu.filling()
   *   .ws({
   *     open(ws) { ws.subscribe("chat"); },
   *     message(ws, msg) { ws.publish("chat", msg); },
   *     close(ws) { console.log("Disconnected:", ws.id); },
   *   });
   * ```
   */
  ws(handlers: WSHandlers): this {
    this.config.wsHandlers = handlers;
    return this;
  }

  getWSHandlers(): WSHandlers | undefined {
    return this.config.wsHandlers;
  }

  hasWS(): boolean {
    return !!this.config.wsHandlers;
  }

  /**
   * 요청 시작 훅
   */
  onRequest(fn: OnRequestHandler): this {
    this.config.lifecycle.onRequest.push({ fn, scope: "local" });
    return this;
  }

  /**
   * Compose-style middleware (Hono/Koa 스타일)
   * lifecycle의 handler 단계에서 실행됨
   */
  middleware(fn: RuntimeMiddleware, name?: string): this {
    this.config.middleware.push({
      fn,
      name: name || fn.name || `middleware_${this.config.middleware.length}`,
      isAsync: fn.constructor.name === "AsyncFunction",
    });
    return this;
  }

  /**
   * 바디 파싱 훅
   * body를 읽을 때는 req.clone() 사용 권장
   */
  onParse(fn: OnParseHandler): this {
    this.config.lifecycle.onParse.push({ fn, scope: "local" });
    return this;
  }

  beforeHandle(fn: BeforeHandleHandler): this {
    this.config.lifecycle.beforeHandle.push({ fn, scope: "local" });
    return this;
  }

  /**
   * Guard alias (beforeHandle와 동일)
   * 인증/인가, 요청 차단 등에 사용
   */
  guard(fn: Guard): this {
    return this.beforeHandle(fn);
  }

  /**
   * 미들웨어 등록 (Guard 함수 또는 lifecycle 객체)
   *
   * @example
   * ```typescript
   * // 단순 guard
   * .use(authGuard)
   *
   * // lifecycle 객체 (beforeHandle + afterHandle)
   * .use(compress())
   * .use(cors({ origin: "https://example.com" }))
   * ```
   */
  use(fn: Guard | MiddlewarePlugin): this {
    if (typeof fn === "function") {
      return this.guard(fn);
    }
    // 미들웨어 플러그인 객체: 각 lifecycle 단계를 개별 등록
    if (fn.beforeHandle) this.beforeHandle(fn.beforeHandle);
    if (fn.afterHandle) this.afterHandle(fn.afterHandle);
    if (fn.mapResponse) this.mapResponse(fn.mapResponse);
    return this;
  }

  /**
   * 핸들러 후 훅
   */
  afterHandle(fn: AfterHandleHandler): this {
    this.config.lifecycle.afterHandle.push({ fn, scope: "local" });
    return this;
  }

  /**
   * 최종 응답 매핑 훅
   */
  mapResponse(fn: MapResponseHandler): this {
    this.config.lifecycle.mapResponse.push({ fn, scope: "local" });
    return this;
  }

  /**
   * 에러 핸들링 훅
   */
  onError(fn: OnErrorHandler): this {
    this.config.lifecycle.onError.push({ fn, scope: "local" });
    return this;
  }

  /**
   * 응답 후 훅 (비동기)
   */
  afterResponse(fn: AfterResponseHandler): this {
    this.config.lifecycle.afterResponse.push({ fn, scope: "local" });
    return this;
  }

  async handle(
    request: Request,
    params: Record<string, string> = {},
    routeContext?: { routeId: string; pattern: string },
    options?: ExecuteOptions & { deps?: FillingDeps }
  ): Promise<Response> {
    const deps = options?.deps ?? globalDeps.get();
    const normalizedRequest = await applyMethodOverride(request);
    const ctx = new ManduContext(normalizedRequest, params, deps);
    const method = normalizedRequest.method.toUpperCase() as HttpMethod;

    // Action 디스패치: POST/PUT/PATCH/DELETE + 등록된 action이 있을 때
    if (this.config.actions.size > 0 && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const actionResult = await this.tryDispatchAction(ctx, routeContext, options);
      if (actionResult) return actionResult;
    }

    // RFC 7231 §4.3.2: HEAD is GET without a body. A route that only
    // registers a GET handler must still serve HEAD — run GET, then strip
    // the body while preserving status + headers. An explicit HEAD handler
    // takes precedence when present.
    const stripBody = method === "HEAD" && !this.config.handlers.has("HEAD");
    const handler = this.config.handlers.get(method) ?? (stripBody ? this.config.handlers.get("GET") : undefined);
    if (!handler) {
      const allowed = Array.from(this.config.handlers.keys());
      if (this.config.handlers.has("GET") && !allowed.includes("HEAD")) {
        allowed.push("HEAD");
      }
      // RFC 7231 §6.5.5: a 405 response MUST include an `Allow` header listing
      // every supported method (not just the body field). ctx.json() cannot
      // attach headers, so build the response directly here.
      return Response.json(
        { status: "error", message: `Method ${method} not allowed`, allowed },
        { status: 405, headers: { Allow: allowed.join(", ") } },
      );
    }
    const lifecycleWithDefaults = this.createLifecycleWithDefaults(routeContext);
    const runHandler = async () => {
      if (this.config.middleware.length === 0) {
        return handler(ctx);
      }
      const chain: MiddlewareEntry[] = [
        ...this.config.middleware,
        {
          fn: async (innerCtx) => handler(innerCtx),
          name: "handler",
          isAsync: true,
        },
      ];
      const composed = compose(chain);
      return composed(ctx);
    };
    const response = await executeLifecycle(lifecycleWithDefaults, ctx, runHandler, options);
    if (stripBody) {
      // Preserve status + headers (incl. Content-Type / Content-Length the
      // GET handler set), drop the body. A null-body Response keeps headers.
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return response;
  }

  /**
   * Action 디스패치 시도
   * _action 파라미터가 있고 매칭되는 action이 있으면 실행 + revalidation
   * 매칭 안 되면 null 반환 → 기존 핸들러로 fallback
   */
  private async tryDispatchAction(
    ctx: ManduContext,
    routeContext?: { routeId: string; pattern: string },
    options?: ExecuteOptions & { deps?: FillingDeps }
  ): Promise<Response | null> {
    const actionName = await this.resolveActionName(ctx);
    if (!actionName) return null;

    const actionHandler = this.config.actions.get(actionName);
    if (!actionHandler) return null;

    // action 이름을 ctx에 저장 (다른 lifecycle 훅에서 접근 가능)
    ctx.set("_actionName", actionName);

    const lifecycleWithDefaults = this.createLifecycleWithDefaults(routeContext);

    const runAction = async () => {
      if (this.config.middleware.length === 0) {
        return actionHandler(ctx);
      }
      const chain: MiddlewareEntry[] = [
        ...this.config.middleware,
        { fn: async (innerCtx) => actionHandler(innerCtx), name: `action:${actionName}`, isAsync: true },
      ];
      return compose(chain)(ctx);
    };

    const actionResponse = await executeLifecycle(lifecycleWithDefaults, ctx, runAction, options);

    // Action 성공 + loader 있으면 자동 revalidation
    if (actionResponse.ok && this.config.loader) {
      // fetch 요청(JS 환경)만 revalidation JSON 반환
      // HTML form 제출(Accept: text/html)은 action 응답 그대로 반환
      const accept = ctx.headers.get("accept") ?? "";
      const isFetchRequest = accept.includes("application/json")
        || ctx.headers.get("x-requested-with") === "ManduAction";

      if (isFetchRequest) {
        try {
          const freshData = await this.executeLoader(ctx);

          // action 응답 본문 보존 (actionData로 포함)
          let actionData: unknown = null;
          const actionContentType = actionResponse.headers.get("content-type") ?? "";
          if (actionContentType.includes("application/json")) {
            actionData = await actionResponse.clone().json().catch(() => null);
          }

          const revalidatedResponse = ctx.json({
            _action: actionName,
            _revalidated: true,
            actionData,
            loaderData: freshData,
          });

          // action 응답의 Set-Cookie 헤더 보존
          const setCookies = actionResponse.headers.getSetCookie?.() ?? [];
          for (const cookie of setCookies) {
            revalidatedResponse.headers.append("Set-Cookie", cookie);
          }

          return revalidatedResponse;
        } catch {
          // Loader 실패 시 action 결과만 반환
          return actionResponse;
        }
      }
    }

    return actionResponse;
  }

  /**
   * 요청에서 action 이름 추출
   * 우선순위: body._action > URL ?_action=
   * (body를 우선하여 URL query 조작에 의한 action hijacking 방지)
   */
  private async resolveActionName(ctx: ManduContext): Promise<string | null> {
    // 1. Request body에서 먼저 확인 (form 제어 하에 있으므로 더 안전)
    const contentType = ctx.headers.get("content-type") ?? "";
    try {
      if (contentType.includes("application/json")) {
        const cloned = ctx.request.clone();
        const body = await cloned.json() as Record<string, unknown>;
        if (typeof body._action === "string") return body._action;
      } else if (contentType.includes("form")) {
        const cloned = ctx.request.clone();
        const formData = await cloned.formData();
        const action = formData.get("_action");
        if (typeof action === "string") return action;
      }
    } catch {
      // 파싱 실패 시 query fallback
    }

    // 2. URL query parameter (body에 없을 때만)
    const fromQuery = ctx.query._action;
    if (fromQuery) return fromQuery;

    return null;
  }

  private createLifecycleWithDefaults(routeContext?: { routeId: string; pattern: string }): LifecycleStore {
    const lifecycle: LifecycleStore = {
      onRequest: [...this.config.lifecycle.onRequest],
      onParse: [...this.config.lifecycle.onParse],
      beforeHandle: [...this.config.lifecycle.beforeHandle],
      afterHandle: [...this.config.lifecycle.afterHandle],
      mapResponse: [...this.config.lifecycle.mapResponse],
      afterResponse: [...this.config.lifecycle.afterResponse],
      onError: [...this.config.lifecycle.onError],
    };
    const defaultErrorHandler: OnErrorHandler = (ctx, error) => {
      if (error instanceof AuthenticationError) {
        return ctx.json({ errorType: "AUTH_ERROR", code: "AUTHENTICATION_REQUIRED", message: error.message, summary: "인증 필요 - 로그인 후 다시 시도하세요", timestamp: new Date().toISOString() }, 401);
      }
      if (error instanceof AuthorizationError) {
        return ctx.json({ errorType: "AUTH_ERROR", code: "ACCESS_DENIED", message: error.message, summary: "권한 없음 - 접근 권한이 부족합니다", requiredRoles: error.requiredRoles, timestamp: new Date().toISOString() }, 403);
      }
      if (error instanceof ValidationError) {
        return ctx.json({ errorType: "LOGIC_ERROR", code: ErrorCode.SLOT_VALIDATION_ERROR, message: "Validation failed", summary: "입력 검증 실패 - 요청 데이터 확인 필요", fix: { file: routeContext ? `spec/slots/${routeContext.routeId}.slot.ts` : "spec/slots/", suggestion: "요청 데이터가 스키마와 일치하는지 확인하세요" }, route: routeContext, errors: error.errors, timestamp: new Date().toISOString() }, 400);
      }
      if (error instanceof BadRequestError) {
        return ctx.json({ errorType: "CLIENT_ERROR", code: "MANDU_C400", message: error.message, summary: "잘못된 요청 본문 - 클라이언트 입력 확인 필요", route: routeContext, timestamp: new Date().toISOString() }, 400);
      }
      const classifier = new ErrorClassifier(null, routeContext ? { id: routeContext.routeId, pattern: routeContext.pattern } : undefined);
      const manduError = classifier.classify(error);
      console.error(`[Mandu] ${manduError.errorType}:`, manduError.message);
      const response = formatErrorResponse(manduError, { isDev: process.env.NODE_ENV !== "production" });
      return ctx.json(response, 500);
    };
    lifecycle.onError.push({ fn: defaultErrorHandler, scope: "local" });
    return lifecycle;
  }

  getMethods(): HttpMethod[] {
    return Array.from(this.config.handlers.keys());
  }

  /**
   * Convert to named handler exports compatible with Mandu route.ts files.
   * Usage: export const { GET, POST } = filling.toHandlers();
   */
  toHandlers(): Partial<Record<HttpMethod, (req: Request) => Promise<Response>>> {
    const result: Partial<Record<HttpMethod, (req: Request) => Promise<Response>>> = {};
    for (const method of this.config.handlers.keys()) {
      result[method] = (req: Request) => this.handle(req, {}, undefined);
    }
    return result;
  }

  hasMethod(method: HttpMethod): boolean {
    return this.config.handlers.has(method);
  }
}

const OVERRIDABLE_METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

async function applyMethodOverride(request: Request): Promise<Request> {
  if (request.method.toUpperCase() !== "POST") {
    return request;
  }

  const override = await detectMethodOverride(request);
  if (!override || override === "POST") {
    return request;
  }

  return new Request(request, { method: override });
}

async function detectMethodOverride(request: Request): Promise<HttpMethod | null> {
  const headerOverride = normalizeOverrideMethod(request.headers.get("X-HTTP-Method-Override"));
  if (headerOverride) return headerOverride;

  const url = new URL(request.url);
  const queryOverride = normalizeOverrideMethod(url.searchParams.get("_method"));
  if (queryOverride) return queryOverride;

  const contentType = request.headers.get("content-type") ?? "";
  const cloned = request.clone();

  try {
    if (contentType.includes("application/json")) {
      const body = await cloned.json() as { _method?: unknown };
      return normalizeOverrideMethod(typeof body?._method === "string" ? body._method : null);
    }

    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await cloned.formData();
      const override = form.get("_method");
      return normalizeOverrideMethod(typeof override === "string" ? override : null);
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeOverrideMethod(value: string | null): HttpMethod | null {
  if (!value) return null;
  const method = value.toUpperCase() as HttpMethod;
  return OVERRIDABLE_METHODS.has(method) ? method : null;
}

/**
 * Mandu Filling factory functions
 * Note: These are also available via the main `Mandu` namespace
 */
export const ManduFillingFactory = {
  filling<TLoaderData = unknown>(): ManduFilling<TLoaderData> {
    return new ManduFilling<TLoaderData>();
  },
  contract<T extends ContractDefinition>(definition: T): T & ContractInstance {
    return createContract(definition);
  },
  context(request: Request, params?: Record<string, string>): ManduContext {
    return new ManduContext(request, params);
  },
};
