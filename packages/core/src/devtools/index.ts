/**
 * Mandu Kitchen DevTools
 * AI-Native Developer Tools for Mandu Framework
 *
 * @version 1.1.0
 * @description "만두를 찌듯 편안하게 디버깅한다"
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Core
  KitchenEvent,

  // Error
  ErrorType,
  DevToolsSeverity,
  NormalizedError,

  // Island
  DevToolsHydrationStrategy,
  IslandStatus,
  IslandSnapshot,

  // Network
  NetworkRequest,
  NetworkBodyPolicy,

  // Guard
  DevToolsGuardViolation,

  // AI Context
  CodeContextInfo,
  AIContextPayload,

  // Redaction
  RedactPattern,

  // Persistence
  PreserveLogConfig,

  // Worker
  WorkerPolicy,
  WorkerTask,

  // Config
  Position,
  Theme,
  DevToolsConfig,

  // Plugin
  KitchenAPI,
  KitchenPanelPlugin,

  // Meta
  MetaLogType,
  KitchenMetaLog,

  // Character
  ManduState,
  ManduCharacterData,
} from './types';

export { MANDU_CHARACTERS } from './types';

// ============================================================================
// Design Tokens
// ============================================================================

export {
  colors,
  typography,
  spacing,
  borderRadius,
  borderWidth,
  shadows,
  animation,
  zIndex,
  breakpoints,
  ManduDesignTokens,
  generateCSSVariables,
  testIds,
  type TestId,
} from './design-tokens';

// ============================================================================
// Client
// ============================================================================

export {
  // State
  KitchenStateManager,
  getStateManager,
  resetStateManager,
  type KitchenState,
  type StateListener,

  // Error Catching
  ErrorCatcher,
  getErrorCatcher,
  initializeErrorCatcher,
  destroyErrorCatcher,

  // Network Proxy
  NetworkProxy,
  getNetworkProxy,
  initializeNetworkProxy,
  destroyNetworkProxy,

  // Filters
  removeComments,
  handleStrings,
  redactBuiltInSecrets,
  redactCustomPatterns,
  truncate,
  applyContextFilters,
  sanitizeStackTrace,
  sanitizeErrorMessage,
  type FilterOptions,

  // Persistence
  PersistenceManager,
  getPersistenceManager,
  initializePersistence,
  destroyPersistence,

  // Components
  ManduCharacter,
  ManduBadge,
  ErrorOverlay,
  mountKitchen,
  unmountKitchen,
  isKitchenMounted,
  type ManduCharacterProps,
  type ManduBadgeProps,
  type ErrorOverlayProps,
} from './client';

// ============================================================================
// Initialization
// ============================================================================

export {
  initManduKitchen,
  destroyManduKitchen,
  autoInit,
  type KitchenInstance,
} from './init';

// ============================================================================
// Protocol
// ============================================================================

export type { KitchenEvents } from './protocol';

export {
  // Type guards
  isErrorEvent,
  isIslandEvent,
  isNetworkEvent,
  isGuardEvent,
  isHmrEvent,

  // Event factories
  createErrorEvent,
  createIslandRegisterEvent,
  createIslandHydrateStartEvent,
  createIslandHydrateEndEvent,
  createNetworkRequestEvent,
  createNetworkResponseEvent,
  createDevToolsGuardViolationEvent,
  createHmrUpdateEvent,
  createHmrErrorEvent,

  // Constants
  DEVTOOLS_VERSION,
  DEFAULT_CONFIG,
  ALLOWED_HEADERS,
  BLOCKED_HEADERS,
} from './protocol';

// ============================================================================
// Hook
// ============================================================================

export {
  createDevtoolsHook,
  getOrCreateHook,
  getHook,
  initializeHook,
  type ManduDevtoolsHook,
  type EventSink,
} from './hook';

// ============================================================================
// Convenience Functions
// ============================================================================

import { getOrCreateHook } from './hook';
import type { NormalizedError, DevToolsGuardViolation } from './types';
import {
  createErrorEvent,
  createHmrUpdateEvent,
  createHmrErrorEvent,
  createDevToolsGuardViolationEvent,
} from './protocol';

/**
 * 에러 리포트 (간편 API)
 *
 * @example
 * ```typescript
 * import { reportError } from '@mandu/core/devtools';
 *
 * try {
 *   // ...
 * } catch (e) {
 *   reportError(e);
 * }
 * ```
 */
export function reportError(
  error: Error | string,
  options?: Partial<Omit<NormalizedError, 'id' | 'timestamp' | 'message'>>
): void {
  const hook = getOrCreateHook();
  const message = typeof error === 'string' ? error : error.message;
  const stack = typeof error === 'string' ? undefined : error.stack;

  hook.emit(
    createErrorEvent({
      type: options?.type ?? 'runtime',
      severity: options?.severity ?? 'error',
      message,
      stack,
      url: typeof window !== 'undefined' ? window.location.href : '',
      ...options,
    })
  );
}

/**
 * HMR 업데이트 알림 (간편 API)
 */
export function notifyHmrUpdate(routeId: string): void {
  const hook = getOrCreateHook();
  hook.emit(createHmrUpdateEvent(routeId));
}

/**
 * HMR 에러 알림 (간편 API)
 */
export function notifyHmrError(message: string, stack?: string): void {
  const hook = getOrCreateHook();
  hook.emit(createHmrErrorEvent(message, stack));
}

/**
 * Guard 위반 리포트 (간편 API)
 */
export function reportGuardViolation(
  violation: Omit<DevToolsGuardViolation, 'id' | 'timestamp'>
): void {
  const hook = getOrCreateHook();
  hook.emit(createDevToolsGuardViolationEvent(violation));
}

// ============================================================================
// DevTools API (for external use)
// ============================================================================

/**
 * DevTools 공개 API
 * window.ManduDevTools로 접근 가능
 */
export const ManduDevTools = {
  /**
   * 로그 출력
   */
  log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    const hook = getOrCreateHook();
    hook.emit({
      type: 'log',
      timestamp: Date.now(),
      data: { level, message, data },
    });
  },

  /**
   * 에러 리포트
   */
  reportError,

  /**
   * 타이머 시작
   */
  time(label: string): void {
    if (typeof performance !== 'undefined') {
      performance.mark(`mandu-time-${label}`);
    }
  },

  /**
   * 타이머 종료 및 시간 반환
   */
  timeEnd(label: string): number {
    if (typeof performance !== 'undefined') {
      const markName = `mandu-time-${label}`;
      try {
        performance.measure(`mandu-measure-${label}`, markName);
        const entries = performance.getEntriesByName(`mandu-measure-${label}`);
        const duration = entries[entries.length - 1]?.duration ?? 0;
        performance.clearMarks(markName);
        performance.clearMeasures(`mandu-measure-${label}`);
        return duration;
      } catch {
        return 0;
      }
    }
    return 0;
  },

  /**
   * DevTools 토글
   */
  toggle(): void {
    const hook = getOrCreateHook();
    hook.emit({
      type: 'devtools:toggle',
      timestamp: Date.now(),
      data: {},
    });
  },

  /**
   * DevTools 열기
   */
  open(): void {
    const hook = getOrCreateHook();
    hook.emit({
      type: 'devtools:open',
      timestamp: Date.now(),
      data: {},
    });
  },

  /**
   * DevTools 닫기
   */
  close(): void {
    const hook = getOrCreateHook();
    hook.emit({
      type: 'devtools:close',
      timestamp: Date.now(),
      data: {},
    });
  },

  /**
   * 에러 목록 클리어
   */
  clearErrors(): void {
    const hook = getOrCreateHook();
    hook.emit({
      type: 'error:clear',
      timestamp: Date.now(),
      data: {},
    });
  },
};

// 브라우저 환경에서 전역 객체에 등록
if (typeof window !== 'undefined') {
  (window as Window & { ManduDevTools?: typeof ManduDevTools }).ManduDevTools =
    ManduDevTools;
}

// ============================================================================
// v1.1: Server Module (Source Context Provider)
// ============================================================================

export {
  SourceContextProvider,
  SourcemapParser,
  createViteMiddleware,
  manduSourceContextPlugin,
  type SourceContextRequest,
  type SourceContextResponse,
  type SourceContextProviderOptions,
  type SourcemapPosition,
  type SourcemapParseResult,
} from './server';

// ============================================================================
// v1.1: Worker Module (Redaction Worker)
// ============================================================================

export {
  // Redaction Worker
  redactText,
  truncateText,
  BUILT_IN_SECRET_PATTERNS,
  PII_PATTERNS,
  type WorkerRequest,
  type WorkerResponse,

  // Worker Manager
  WorkerManager,
  getWorkerManager,
  initializeWorkerManager,
  destroyWorkerManager,
  type WorkerStatus,
  type WorkerManagerOptions,
} from './worker';

// ============================================================================
// v1.1: AI Module (Context Builder, MCP Connector)
// ============================================================================

export {
  // Context Builder
  AIContextBuilder,
  getContextBuilder,
  resetContextBuilder,
  type ContextBuilderOptions,
  type UserAction,

  // MCP Connector
  MCPConnector,
  getMCPConnector,
  destroyMCPConnector,
  type MCPConnectorOptions,
  type MCPMessage,
  type AnalysisRequest,
  type AnalysisResponse,
  type MCPConnectionStatus,
} from './ai';
