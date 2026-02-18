/**
 * Mandu Kitchen DevTools - Initialization
 * @version 1.1.0
 *
 * 통합 초기화 함수
 */

import type { DevToolsConfig } from './types';
import { initializeHook } from './hook';
import {
  mountKitchen,
  unmountKitchen,
  initializeErrorCatcher,
  destroyErrorCatcher,
  initializeNetworkProxy,
  destroyNetworkProxy,
  initializePersistence,
  destroyPersistence,
  getStateManager,
  getPersistenceManager,
} from './client';
import { initializeWorkerManager, destroyWorkerManager } from './worker';
import { getContextBuilder, resetContextBuilder, getMCPConnector, destroyMCPConnector } from './ai';

// ============================================================================
// Types
// ============================================================================

export interface KitchenInstance {
  /** DevTools 언마운트 및 정리 */
  destroy: () => void;
  /** 상태 관리자 접근 */
  getState: () => Record<string, unknown>;
  /** 에러 리포트 */
  reportError: (error: Error | string) => void;
  /** DevTools 열기 */
  open: () => void;
  /** DevTools 닫기 */
  close: () => void;
  /** DevTools 토글 */
  toggle: () => void;
}

// ============================================================================
// Initialization
// ============================================================================

let isInitialized = false;

/**
 * Mandu Kitchen DevTools 초기화
 *
 * @example
 * ```typescript
 * import { initManduKitchen } from '@mandu/core/devtools';
 *
 * // 앱 시작 시 초기화
 * const kitchen = initManduKitchen({
 *   position: 'bottom-right',
 *   features: {
 *     errorOverlay: true,
 *     networkMonitor: true,
 *   },
 * });
 *
 * // 나중에 정리
 * kitchen.destroy();
 * ```
 */
export function initManduKitchen(config: DevToolsConfig = {}): KitchenInstance {
  // Production 환경에서는 noop 반환
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
    return createNoopInstance();
  }

  // 브라우저 환경이 아니면 noop 반환
  if (typeof window === 'undefined') {
    return createNoopInstance();
  }

  // 이미 초기화되었으면 기존 인스턴스 반환
  if (isInitialized) {
    console.warn('[Mandu Kitchen] Already initialized. Call destroy() first to reinitialize.');
    return createInstance();
  }

  // 비활성화 설정이면 noop 반환
  if (config.enabled === false) {
    return createNoopInstance();
  }

  // 초기화 시작
  try {
    // 1. Hook 초기화
    initializeHook();

    // 2. Error Catcher 초기화
    if (config.features?.errorOverlay !== false) {
      initializeErrorCatcher();
    }

    // 3. Network Proxy 초기화
    if (config.features?.networkMonitor !== false) {
      initializeNetworkProxy({
        bodyPolicy: {
          collectBody: config.network?.collectBody ?? false,
          optInPolicy: {
            maxBytes: config.network?.bodyMaxBytes ?? 10_000,
            applyPIIFilter: true,
            applySecretFilter: true,
            allowedContentTypes: ['application/json', 'text/plain', 'text/event-stream'],
          },
        },
      });
    }

    // 4. Persistence 초기화
    if (config.persistence?.enabled !== false) {
      const persistence = initializePersistence(config.persistence);

      // 저장된 이벤트 복원
      const savedEvents = persistence.loadEvents();
      if (savedEvents.length > 0) {
        const stateManager = getStateManager(config);
        for (const event of savedEvents) {
          stateManager.handleEvent(event);
        }
      }
    }

    // 5. v1.1: Worker Manager 초기화 (백그라운드, 실패해도 계속)
    initializeWorkerManager().catch((err) => {
      console.warn('[Mandu Kitchen] Worker initialization failed, using main thread fallback:', err);
    });

    // 6. v1.1: AI Context Builder 초기화
    const contextBuilder = getContextBuilder({ config });

    // 7. UI 마운트
    mountKitchen(config);

    isInitialized = true;

    console.log('[Mandu Kitchen] DevTools v1.1 initialized 🥟');

    return createInstance();
  } catch (error) {
    console.error('[Mandu Kitchen] Initialization failed:', error);
    return createNoopInstance();
  }
}

/**
 * DevTools 정리
 */
export function destroyManduKitchen(): void {
  if (!isInitialized) return;

  try {
    // UI 언마운트
    unmountKitchen();

    // v1.0 모듈 정리
    destroyErrorCatcher();
    destroyNetworkProxy();
    destroyPersistence();

    // v1.1 모듈 정리
    destroyWorkerManager();
    resetContextBuilder();
    destroyMCPConnector();

    isInitialized = false;

    console.log('[Mandu Kitchen] DevTools destroyed');
  } catch (error) {
    console.error('[Mandu Kitchen] Cleanup failed:', error);
  }
}

// ============================================================================
// Instance Factories
// ============================================================================

function createInstance(): KitchenInstance {
  return {
    destroy: destroyManduKitchen,

    getState: () => getStateManager().getState(),

    reportError: (error: Error | string) => {
      const stateManager = getStateManager();
      const message = typeof error === 'string' ? error : error.message;
      const stack = typeof error === 'string' ? undefined : error.stack;

      stateManager.addError({
        id: `manual-${Date.now()}`,
        type: 'runtime',
        severity: 'error',
        message,
        stack,
        timestamp: Date.now(),
        url: window.location.href,
      });
    },

    open: () => getStateManager().open(),
    close: () => getStateManager().close(),
    toggle: () => getStateManager().toggle(),
  };
}

function createNoopInstance(): KitchenInstance {
  return {
    destroy: () => {},
    getState: () => ({}),
    reportError: () => {},
    open: () => {},
    close: () => {},
    toggle: () => {},
  };
}

// ============================================================================
// Auto-initialization (optional)
// ============================================================================

/**
 * 자동 초기화 (script 태그로 로드 시)
 *
 * HTML에서 사용:
 * <script src="mandu-kitchen.js" data-auto-init data-position="bottom-left"></script>
 */
export function autoInit(): void {
  if (typeof document === 'undefined') return;

  // DOMContentLoaded 이후에 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      checkAndInit();
    });
  } else {
    checkAndInit();
  }
}

function checkAndInit(): void {
  // data-auto-init 속성이 있는 script 태그 찾기
  const script = document.querySelector('script[data-mandu-kitchen-auto-init]');
  if (!script) return;

  const config: DevToolsConfig = {};

  // data 속성에서 설정 읽기
  const position = script.getAttribute('data-position');
  if (position) {
    config.position = position as DevToolsConfig['position'];
  }

  const theme = script.getAttribute('data-theme');
  if (theme) {
    config.theme = theme as DevToolsConfig['theme'];
  }

  initManduKitchen(config);
}
