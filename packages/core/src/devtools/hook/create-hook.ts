/**
 * Mandu Kitchen DevTools - Hook Implementation
 * @version 1.0.3
 *
 * Framework ↔ DevTools 통신을 위한 Hook 시스템
 * - emit: 프레임워크 → DevTools 이벤트 발송
 * - connect: DevTools → 프레임워크 sink 등록
 * - queue: DevTools 연결 전 이벤트 버퍼링
 */

import type { KitchenEvent } from '../types';

// ============================================================================
// Types
// ============================================================================

export type EventSink = (event: KitchenEvent) => void;

export interface ManduDevtoolsHook {
  /** 이벤트 발송 (프레임워크 → DevTools) */
  emit: (event: KitchenEvent) => void;

  /** DevTools가 sink 등록 (DevTools → 프레임워크) */
  connect: (sink: EventSink) => void;

  /** DevTools 연결 해제 */
  disconnect: () => void;

  /** DevTools 연결 전 이벤트 큐 */
  queue: KitchenEvent[];

  /** 연결 상태 확인 */
  isConnected: () => boolean;

  /** 버전 정보 */
  version: string;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_QUEUE_SIZE = 100;
const HOOK_VERSION = '1.0.3';

// ============================================================================
// Hook Factory
// ============================================================================

/**
 * DevTools Hook 생성
 *
 * @example
 * ```typescript
 * // 프레임워크 코어에서
 * window.__MANDU_DEVTOOLS_HOOK__ = createDevtoolsHook();
 *
 * // 이벤트 발송
 * window.__MANDU_DEVTOOLS_HOOK__.emit({
 *   type: 'error',
 *   timestamp: Date.now(),
 *   data: normalizedError,
 * });
 *
 * // DevTools에서 연결
 * window.__MANDU_DEVTOOLS_HOOK__.connect((event) => {
 *   handleEvent(event);
 * });
 * ```
 */
export function createDevtoolsHook(): ManduDevtoolsHook {
  // Production 환경에서는 완전한 noop 반환
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
    return createNoopHook();
  }

  // Development: 실제 구현
  const queue: KitchenEvent[] = [];
  let sink: EventSink | null = null;

  return {
    version: HOOK_VERSION,

    emit(event: KitchenEvent): void {
      if (sink) {
        // DevTools 연결됨 - 직접 전송
        try {
          sink(event);
        } catch (e) {
          // DevTools 에러가 앱을 크래시시키면 안 됨
          console.warn('[Mandu Kitchen] Sink error:', e);
        }
      } else {
        // DevTools 미연결 - 큐에 쌓기 (크기 제한)
        if (queue.length >= MAX_QUEUE_SIZE) {
          // 오래된 이벤트 제거 (에러는 우선 보존)
          const nonErrorIndex = queue.findIndex((e) => e.type !== 'error');
          if (nonErrorIndex !== -1) {
            queue.splice(nonErrorIndex, 1);
          } else {
            // 모두 에러면 가장 오래된 것 제거
            queue.shift();
          }
        }
        queue.push(event);
      }
    },

    connect(nextSink: EventSink): void {
      sink = nextSink;

      // 큐 플러시
      while (queue.length > 0) {
        const event = queue.shift();
        if (event) {
          try {
            sink(event);
          } catch (e) {
            console.warn('[Mandu Kitchen] Flush error:', e);
          }
        }
      }
    },

    disconnect(): void {
      sink = null;
    },

    isConnected(): boolean {
      return sink !== null;
    },

    queue,
  };
}

// ============================================================================
// Noop Hook (Production)
// ============================================================================

function createNoopHook(): ManduDevtoolsHook {
  const emptyQueue: KitchenEvent[] = [];

  return {
    version: HOOK_VERSION,
    emit: () => {},
    connect: () => {},
    disconnect: () => {},
    isConnected: () => false,
    queue: emptyQueue,
  };
}

// ============================================================================
// Global Hook Accessor
// ============================================================================

declare global {
  interface Window {
    __MANDU_DEVTOOLS_HOOK__?: ManduDevtoolsHook;
  }
}

/**
 * 전역 Hook 가져오기 (없으면 생성)
 */
export function getOrCreateHook(): ManduDevtoolsHook {
  if (typeof window === 'undefined') {
    // SSR 환경
    return createNoopHook();
  }

  if (!window.__MANDU_DEVTOOLS_HOOK__) {
    window.__MANDU_DEVTOOLS_HOOK__ = createDevtoolsHook();
  }

  return window.__MANDU_DEVTOOLS_HOOK__;
}

/**
 * 전역 Hook 가져오기 (없으면 null)
 */
export function getHook(): ManduDevtoolsHook | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__MANDU_DEVTOOLS_HOOK__ ?? null;
}

/**
 * Hook 초기화 (프레임워크 시작 시 호출)
 */
export function initializeHook(): ManduDevtoolsHook {
  const hook = getOrCreateHook();

  // 초기화 이벤트 발송
  hook.emit({
    type: 'init',
    timestamp: Date.now(),
    data: {
      version: HOOK_VERSION,
      timestamp: Date.now(),
    },
  });

  return hook;
}
