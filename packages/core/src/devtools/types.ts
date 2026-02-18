/**
 * Mandu Kitchen DevTools - Type Definitions
 * @version 1.0.3
 */

// ============================================================================
// Core Event Types
// ============================================================================

export interface KitchenEvent<T extends string = string, D = unknown> {
  type: T;
  timestamp: number;
  data: D;
}

// ============================================================================
// Error Types
// ============================================================================

export type ErrorType = 'runtime' | 'unhandled' | 'react' | 'network' | 'hmr' | 'guard';
export type DevToolsSeverity = 'critical' | 'error' | 'warning' | 'info';

export interface NormalizedError {
  id: string;
  type: ErrorType;
  severity: DevToolsSeverity;
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  componentStack?: string;
  islandId?: string;
  timestamp: number;
  url: string;
}

// ============================================================================
// Island Types
// ============================================================================

export type DevToolsHydrationStrategy = 'load' | 'idle' | 'visible' | 'media' | 'never';
export type IslandStatus = 'ssr' | 'pending' | 'hydrating' | 'hydrated' | 'error';

export interface IslandSnapshot {
  id: string;
  name: string;
  strategy: DevToolsHydrationStrategy;
  status: IslandStatus;
  ssrRenderTime?: number;
  hydrateStartTime?: number;
  hydrateEndTime?: number;
  bundleSize?: number;
}

// ============================================================================
// Network Types
// ============================================================================

export interface NetworkRequest {
  id: string;
  method: string;
  url: string;
  safeHeaders: Record<string, string>;
  redactedHeaders: string[];
  body?: {
    available: boolean;
    size: number;
    content?: unknown;
  };
  status?: number;
  startTime: number;
  endTime?: number;
  isStreaming: boolean;
  chunkCount?: number;
}

export interface NetworkBodyPolicy {
  collectBody: boolean;
  optInPolicy?: {
    maxBytes: number;
    applyPIIFilter: boolean;
    applySecretFilter: boolean;
    allowedContentTypes: string[];
  };
}

// ============================================================================
// Guard Types
// ============================================================================

export interface DevToolsGuardViolation {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: 'error' | 'warning';
  message: string;
  source: {
    file: string;
    line?: number;
    column?: number;
  };
  target?: {
    file: string;
    line?: number;
  };
  suggestion?: string;
  timestamp: number;
}

// ============================================================================
// AI Context Types
// ============================================================================

export interface CodeContextInfo {
  filePath: string;
  line: number;
  column?: number;
  sourcemapUrl?: string;
  snippet?: {
    content: string;
    lineRange: [number, number];
    source: 'dev-server' | 'sourcemap-inline' | 'unavailable';
  };
}

export interface AIContextPayload {
  error: NormalizedError;
  island?: IslandSnapshot;
  framework: { name: 'mandu'; version: string };
  devtools: { version: string };
  recentErrors?: Array<{
    id: string;
    message: string;
    timestamp: number;
    isCausedBy?: string;
  }>;
  userActions?: Array<{
    type: 'navigation' | 'interaction' | 'reload';
    targetHint?: string;
    timestamp: number;
  }>;
  codeContext?: CodeContextInfo;
}

// ============================================================================
// Redaction Types
// ============================================================================

export interface RedactPattern {
  source: string;
  flags?: string;
  replacement?: string;
  label?: string;
}

// ============================================================================
// Persistence Types
// ============================================================================

export interface PreserveLogConfig {
  enabled: boolean;
  maxPersistEvents: number;
  maxPersistBytes: number;
  priority: 'errors-first' | 'recent-first';
  incremental?: {
    enabled: boolean;
    idleSyncMs: number;
  };
}

// ============================================================================
// Worker Types
// ============================================================================

export interface WorkerPolicy {
  timeout: number;
  onTimeout: 'fallback-main' | 'skip';
  onError: 'disable-worker' | 'retry-once';
  maxConsecutiveFailures: number;
}

export interface WorkerTask {
  id: string;
  type: 'redact' | 'truncate';
  data: {
    text: string;
    patterns?: RedactPattern[];
    maxBytes?: number;
  };
}

// ============================================================================
// Config Types
// ============================================================================

export type Position = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type Theme = 'light' | 'dark' | 'auto';

export interface DevToolsConfig {
  enabled?: boolean;
  position?: Position;
  defaultOpen?: boolean;
  theme?: Theme;

  features?: {
    errorOverlay?: boolean;
    islandsInspector?: boolean;
    networkMonitor?: boolean;
    guardViewer?: boolean;
  };

  dataSafety?: {
    stringMode?: 'smart' | 'strip';
    collectUserActions?: boolean;
    collectCodeContext?: boolean;
    customRedactPatterns?: RedactPattern[];
  };

  network?: {
    collectBody?: boolean;
    bodyMaxBytes?: number;
  };

  persistence?: PreserveLogConfig;
  plugins?: KitchenPanelPlugin[];
}

// ============================================================================
// Plugin Types
// ============================================================================

export interface KitchenAPI {
  subscribe(type: string, callback: (event: KitchenEvent) => void): () => void;
  getErrors(): NormalizedError[];
  getIslands(): IslandSnapshot[];
  getNetworkRequests(): NetworkRequest[];
  clearErrors(): void;
  getConfig(): DevToolsConfig;
  copyToClipboard(text: string): Promise<void>;
  openInEditor(file: string, line?: number): void;
}

export interface KitchenPanelPlugin {
  id: string;
  name: string;
  icon: string;
  order: number;

  init(api: KitchenAPI): void;
  destroy?(): void;
  render(container: HTMLElement): void;
  onEvent?(event: KitchenEvent): void;
}

// ============================================================================
// Meta Log Types
// ============================================================================

export type MetaLogType =
  | 'init'
  | 'hook_fail'
  | 'render_fail'
  | 'persist_fail'
  | 'worker_timeout'
  | 'worker_error'
  | 'worker_disabled'
  | 'recovered';

export interface KitchenMetaLog {
  timestamp: number;
  type: MetaLogType;
  error?: string;
  context: {
    eventCount: number;
    activeTab: string;
    memoryInfo?: { usedJSHeapSize?: number };
  };
}

// ============================================================================
// Mandu Character Types
// ============================================================================

export type ManduState = 'normal' | 'warning' | 'error' | 'loading' | 'hmr';

export interface ManduCharacterData {
  state: ManduState;
  emoji: string;
  message: string;
}

export const MANDU_CHARACTERS: Record<ManduState, ManduCharacterData> = {
  normal: {
    state: 'normal',
    emoji: '(◕‿◕)',
    message: '모든 만두가 잘 익고 있어요~',
  },
  warning: {
    state: 'warning',
    emoji: '(◕_◕)',
    message: '뭔가 이상해요...',
  },
  error: {
    state: 'error',
    emoji: '(ノಠ益ಠ)ノ彡┻━┻',
    message: '만두가 타버렸어요!',
  },
  loading: {
    state: 'loading',
    emoji: '(◕‿◕)💨',
    message: '만두 찌는 중...',
  },
  hmr: {
    state: 'hmr',
    emoji: '(◕‿◕)✨',
    message: '레시피 업데이트됨!',
  },
};
