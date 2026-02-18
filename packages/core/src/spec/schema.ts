import { z } from "zod";

// ========== Hydration 설정 ==========

export const SpecHydrationStrategy = z.enum(["none", "island", "full", "progressive"]);
export type SpecHydrationStrategy = z.infer<typeof SpecHydrationStrategy>;

export const HydrationPriority = z.enum(["immediate", "visible", "idle", "interaction"]);
export type HydrationPriority = z.infer<typeof HydrationPriority>;

export const HydrationConfig = z.object({
  /**
   * Hydration 전략
   * - none: 순수 Static HTML (JS 없음)
   * - island: Slot 영역만 hydrate (기본값)
   * - full: 전체 페이지 hydrate
   * - progressive: 점진적 hydrate
   */
  strategy: SpecHydrationStrategy,

  /**
   * Hydration 우선순위
   * - immediate: 페이지 로드 즉시
   * - visible: 뷰포트에 보일 때 (기본값)
   * - idle: 브라우저 idle 시
   * - interaction: 사용자 상호작용 시
   */
  priority: HydrationPriority.default("visible"),

  /**
   * 번들 preload 여부
   */
  preload: z.boolean().default(false),
});

export type HydrationConfig = z.infer<typeof HydrationConfig>;

// ========== Loader 설정 ==========

export const LoaderConfig = z.object({
  /**
   * SSR 시 데이터 로딩 타임아웃 (ms)
   */
  timeout: z.number().positive().default(5000),

  /**
   * 로딩 실패 시 fallback 데이터
   */
  fallback: z.record(z.unknown()).optional(),
});

export type LoaderConfig = z.infer<typeof LoaderConfig>;

// ========== Route 설정 ==========

export const RouteKind = z.enum(["page", "api"]);
export type RouteKind = z.infer<typeof RouteKind>;

export const SpecHttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
export type SpecHttpMethod = z.infer<typeof SpecHttpMethod>;

// ---- 공통 필드 ----
const RouteSpecBase = {
  id: z.string().min(1, "id는 필수입니다"),
  pattern: z.string().startsWith("/", "pattern은 /로 시작해야 합니다"),
  module: z.string().min(1, "module 경로는 필수입니다"),
  slotModule: z.string().optional(),
  clientModule: z.string().optional(),
  contractModule: z.string().optional(),
  hydration: HydrationConfig.optional(),
  loader: LoaderConfig.optional(),
  streaming: z.boolean().optional(),
};

// ---- Page 라우트 ----
export const PageRouteSpec = z
  .object({
    ...RouteSpecBase,
    kind: z.literal("page"),
    // page 필수
    componentModule: z.string().min(1, "kind가 'page'인 경우 componentModule은 필수입니다"),
    // page 전용 optional
    methods: z.array(SpecHttpMethod).optional(),
    layoutChain: z.array(z.string()).optional(),
    loadingModule: z.string().optional(),
    errorModule: z.string().optional(),
  })
  .refine(
    (route) => {
      if (route.clientModule && route.hydration?.strategy === "none") {
        return false;
      }
      return true;
    },
    {
      message: "clientModule이 있으면 hydration.strategy는 'none'이 아니어야 합니다",
      path: ["hydration"],
    }
  );

export type PageRouteSpec = z.infer<typeof PageRouteSpec>;

// ---- API 라우트 ----
export const ApiRouteSpec = z.object({
  ...RouteSpecBase,
  kind: z.literal("api"),
  // api 전용
  methods: z.array(SpecHttpMethod).optional(),
  // page 전용 필드도 optional로 허용 (호환성)
  componentModule: z.string().optional(),
  layoutChain: z.array(z.string()).optional(),
  loadingModule: z.string().optional(),
  errorModule: z.string().optional(),
});

export type ApiRouteSpec = z.infer<typeof ApiRouteSpec>;

// ---- discriminatedUnion ----
export const RouteSpec = z.discriminatedUnion("kind", [
  // PageRouteSpec에 .refine()이 적용되어 있으므로 내부 shape를 직접 사용
  z.object({
    ...RouteSpecBase,
    kind: z.literal("page"),
    componentModule: z.string().min(1, "kind가 'page'인 경우 componentModule은 필수입니다"),
    methods: z.array(SpecHttpMethod).optional(),
    layoutChain: z.array(z.string()).optional(),
    loadingModule: z.string().optional(),
    errorModule: z.string().optional(),
  }),
  z.object({
    ...RouteSpecBase,
    kind: z.literal("api"),
    methods: z.array(SpecHttpMethod).optional(),
    componentModule: z.string().optional(),
    layoutChain: z.array(z.string()).optional(),
    loadingModule: z.string().optional(),
    errorModule: z.string().optional(),
  }),
]);

export type RouteSpec = z.infer<typeof RouteSpec>;

// ========== Manifest ==========

export const RoutesManifest = z
  .object({
    version: z.number().int().positive(),
    routes: z.array(RouteSpec),
  })
  .refine(
    (manifest) => {
      const ids = manifest.routes.map((r) => r.id);
      const uniqueIds = new Set(ids);
      return ids.length === uniqueIds.size;
    },
    {
      message: "route id는 중복될 수 없습니다",
      path: ["routes"],
    }
  )
  .refine(
    (manifest) => {
      const patterns = manifest.routes.map((r) => r.pattern);
      const uniquePatterns = new Set(patterns);
      return patterns.length === uniquePatterns.size;
    },
    {
      message: "route pattern은 중복될 수 없습니다",
      path: ["routes"],
    }
  );

export type RoutesManifest = z.infer<typeof RoutesManifest>;

// ========== Assertion Functions ==========

/**
 * Asserts that the given route is a page route.
 * After this call, TypeScript narrows the type to PageRouteSpec.
 */
export function assertPageRoute(route: RouteSpec): asserts route is PageRouteSpec {
  if (route.kind !== "page") {
    throw new Error(`Expected page route, got "${route.kind}" (id: ${route.id})`);
  }
}

/**
 * Asserts that the given route is an API route.
 * After this call, TypeScript narrows the type to ApiRouteSpec.
 */
export function assertApiRoute(route: RouteSpec): asserts route is ApiRouteSpec {
  if (route.kind !== "api") {
    throw new Error(`Expected API route, got "${route.kind}" (id: ${route.id})`);
  }
}

// ========== 유틸리티 함수 ==========

/**
 * 기본 hydration 설정 반환
 */
export function getDefaultHydration(route: RouteSpec): HydrationConfig {
  // clientModule이 있으면 island, 없으면 none
  if (route.clientModule) {
    return {
      strategy: "island",
      priority: "visible",
      preload: false,
    };
  }
  return {
    strategy: "none",
    priority: "visible",
    preload: false,
  };
}

/**
 * 라우트의 실제 hydration 설정 반환 (기본값 적용)
 */
export function getRouteHydration(route: RouteSpec): HydrationConfig {
  if (route.hydration) {
    return {
      strategy: route.hydration.strategy,
      priority: route.hydration.priority ?? "visible",
      preload: route.hydration.preload ?? false,
    };
  }
  return getDefaultHydration(route);
}

/**
 * Hydration이 필요한 라우트인지 확인
 */
export function needsHydration(route: RouteSpec): boolean {
  const hydration = getRouteHydration(route);
  return route.kind === "page" && hydration.strategy !== "none";
}
