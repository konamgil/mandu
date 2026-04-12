/**
 * Mandu Filling Module - 만두소 🥟
 *
 * DNA-002: 의존성 주입 패턴 지원
 */

export { ManduContext, ValidationError, CookieManager } from "./context";
export type { CookieOptions } from "./context";
export { ManduFilling, ManduFillingFactory, LoaderTimeoutError } from "./filling";
export type { Handler, Guard, ActionHandler, HttpMethod, Loader, LoaderOptions, LoaderCacheOptions, RenderMode, MiddlewarePlugin } from "./filling";
export { createCookieSessionStorage, Session } from "./session";
export type { SessionStorage, SessionData, CookieSessionOptions } from "./session";
export { wrapBunWebSocket } from "./ws";
export type { WSHandlers, ManduWebSocket, WSUpgradeData } from "./ws";
export { SSEConnection, createSSEConnection } from "./sse";
export type { SSEOptions, SSESendOptions, SSECleanup } from "./sse";
export { resolveResumeCursor, catchupFromCursor, mergeUniqueById } from "./sse-catchup";
export type { SSECursor, CatchupResult, CatchupOptions } from "./sse-catchup";

// Auth Guards
export {
  AuthenticationError,
  AuthorizationError,
  requireUser,
  requireRole,
  requireAnyRole,
  requireAllRoles,
  createAuthGuard,
  createRoleGuard,
} from "./auth";
export type { BaseUser, UserWithRole, UserWithRoles } from "./auth";

// DNA-002: Dependency Injection
export {
  createDefaultDeps,
  createMockDeps,
  mergeDeps,
  globalDeps,
} from "./deps";
export type {
  FillingDeps,
  DbDeps,
  CacheDeps,
  LoggerDeps,
  EventBusDeps,
  InjectDeps,
} from "./deps";
