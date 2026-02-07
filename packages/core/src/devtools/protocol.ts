/**
 * Mandu Kitchen DevTools - Event Protocol
 * @version 1.0.3
 */

import type {
  KitchenEvent,
  NormalizedError,
  IslandSnapshot,
  NetworkRequest,
  GuardViolation,
} from './types';

// ============================================================================
// Event Type Definitions
// ============================================================================

export type KitchenEvents =
  // Error events
  | KitchenEvent<'error', NormalizedError>
  | KitchenEvent<'error:clear', { id?: string }>

  // Island events
  | KitchenEvent<'island:register', IslandSnapshot>
  | KitchenEvent<'island:hydrate:start', { id: string }>
  | KitchenEvent<'island:hydrate:end', { id: string; time: number }>
  | KitchenEvent<'island:error', { id: string; error: NormalizedError }>

  // Network events
  | KitchenEvent<'network:request', NetworkRequest>
  | KitchenEvent<'network:response', { id: string; status: number; endTime: number }>
  | KitchenEvent<'network:chunk', { id: string; chunkIndex: number; size: number }>
  | KitchenEvent<'network:error', { id: string; error: string }>

  // Guard events
  | KitchenEvent<'guard:violation', GuardViolation>
  | KitchenEvent<'guard:clear', { ruleId?: string }>

  // HMR events
  | KitchenEvent<'hmr:update', { routeId: string; timestamp: number }>
  | KitchenEvent<'hmr:error', { message: string; stack?: string }>
  | KitchenEvent<'hmr:connected', { url: string }>
  | KitchenEvent<'hmr:disconnected', { reason?: string }>;

// ============================================================================
// Event Type Guards
// ============================================================================

export function isErrorEvent(
  event: KitchenEvent
): event is KitchenEvent<'error', NormalizedError> {
  return event.type === 'error';
}

export function isIslandEvent(
  event: KitchenEvent
): event is KitchenEvent<'island:register', IslandSnapshot> {
  return event.type.startsWith('island:');
}

export function isNetworkEvent(event: KitchenEvent): boolean {
  return event.type.startsWith('network:');
}

export function isGuardEvent(event: KitchenEvent): boolean {
  return event.type.startsWith('guard:');
}

export function isHmrEvent(event: KitchenEvent): boolean {
  return event.type.startsWith('hmr:');
}

// ============================================================================
// Event Factory Functions
// ============================================================================

let eventIdCounter = 0;

function generateEventId(): string {
  return `mk-${Date.now()}-${++eventIdCounter}`;
}

export function createErrorEvent(error: Omit<NormalizedError, 'id' | 'timestamp'>): KitchenEvents {
  return {
    type: 'error',
    timestamp: Date.now(),
    data: {
      ...error,
      id: generateEventId(),
      timestamp: Date.now(),
    },
  };
}

export function createIslandRegisterEvent(island: Omit<IslandSnapshot, 'id'>): KitchenEvents {
  return {
    type: 'island:register',
    timestamp: Date.now(),
    data: {
      ...island,
      id: generateEventId(),
    },
  };
}

export function createIslandHydrateStartEvent(id: string): KitchenEvents {
  return {
    type: 'island:hydrate:start',
    timestamp: Date.now(),
    data: { id },
  };
}

export function createIslandHydrateEndEvent(id: string, time: number): KitchenEvents {
  return {
    type: 'island:hydrate:end',
    timestamp: Date.now(),
    data: { id, time },
  };
}

export function createNetworkRequestEvent(
  request: Omit<NetworkRequest, 'id' | 'startTime'>
): KitchenEvents {
  return {
    type: 'network:request',
    timestamp: Date.now(),
    data: {
      ...request,
      id: generateEventId(),
      startTime: Date.now(),
    },
  };
}

export function createNetworkResponseEvent(
  id: string,
  status: number
): KitchenEvents {
  return {
    type: 'network:response',
    timestamp: Date.now(),
    data: { id, status, endTime: Date.now() },
  };
}

export function createGuardViolationEvent(
  violation: Omit<GuardViolation, 'id' | 'timestamp'>
): KitchenEvents {
  return {
    type: 'guard:violation',
    timestamp: Date.now(),
    data: {
      ...violation,
      id: generateEventId(),
      timestamp: Date.now(),
    },
  };
}

export function createHmrUpdateEvent(routeId: string): KitchenEvents {
  return {
    type: 'hmr:update',
    timestamp: Date.now(),
    data: { routeId, timestamp: Date.now() },
  };
}

export function createHmrErrorEvent(message: string, stack?: string): KitchenEvents {
  return {
    type: 'hmr:error',
    timestamp: Date.now(),
    data: { message, stack },
  };
}

// ============================================================================
// Constants
// ============================================================================

export const DEVTOOLS_VERSION = '1.0.3';

export const DEFAULT_CONFIG = {
  enabled: true,
  position: 'bottom-right' as const,
  defaultOpen: false,
  theme: 'auto' as const,
  features: {
    errorOverlay: true,
    islandsInspector: true,
    networkMonitor: true,
    guardViewer: true,
  },
  dataSafety: {
    stringMode: 'smart' as const,
    collectUserActions: false,
    collectCodeContext: false,
    customRedactPatterns: [],
  },
  network: {
    collectBody: false,
    bodyMaxBytes: 10_000,
  },
  persistence: {
    enabled: true,
    maxPersistEvents: 50,
    maxPersistBytes: 2_000_000,
    priority: 'errors-first' as const,
    incremental: {
      enabled: true,
      idleSyncMs: 300,
    },
  },
};

// ============================================================================
// Header Allowlist/Blocklist for Network Masking
// ============================================================================

export const ALLOWED_HEADERS = new Set([
  'content-type',
  'content-length',
  'accept',
  'cache-control',
  'accept-language',
  'accept-encoding',
  'user-agent',
]);

export const BLOCKED_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-csrf-token',
  'x-api-key',
  'x-auth-token',
]);
