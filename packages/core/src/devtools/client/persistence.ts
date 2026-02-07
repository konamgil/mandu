/**
 * Mandu Kitchen DevTools - Persistence
 * @version 1.0.3
 *
 * sessionStorage를 사용한 이벤트 영속화
 */

import type { KitchenEvent, PreserveLogConfig, KitchenMetaLog } from '../types';

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'mandu-kitchen-events';
const META_LOG_KEY = 'mandu-kitchen-meta';
const MAX_META_LOGS = 20;

const DEFAULT_CONFIG: PreserveLogConfig = {
  enabled: true,
  maxPersistEvents: 50,
  maxPersistBytes: 2_000_000, // 2MB
  priority: 'errors-first',
  incremental: {
    enabled: true,
    idleSyncMs: 300,
  },
};

// ============================================================================
// Persistence Manager
// ============================================================================

export class PersistenceManager {
  private config: PreserveLogConfig;
  private pendingEvents: KitchenEvent[] = [];
  private syncTimeoutId: number | null = null;
  private isEnabled = true;

  constructor(config?: Partial<PreserveLogConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  updateConfig(config: Partial<PreserveLogConfig>): void {
    this.config = { ...this.config, ...config };
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  // --------------------------------------------------------------------------
  // Event Management
  // --------------------------------------------------------------------------

  /**
   * 이벤트 추가
   */
  addEvent(event: KitchenEvent): void {
    if (!this.config.enabled || !this.isEnabled) return;

    this.pendingEvents.push(event);

    // Incremental sync
    if (this.config.incremental?.enabled) {
      this.scheduleSync();
    }
  }

  /**
   * 여러 이벤트 추가
   */
  addEvents(events: KitchenEvent[]): void {
    if (!this.config.enabled || !this.isEnabled) return;

    this.pendingEvents.push(...events);

    if (this.config.incremental?.enabled) {
      this.scheduleSync();
    }
  }

  /**
   * 즉시 저장
   */
  flush(): void {
    if (this.syncTimeoutId) {
      clearTimeout(this.syncTimeoutId);
      this.syncTimeoutId = null;
    }

    this.persistEvents();
  }

  // --------------------------------------------------------------------------
  // Sync Scheduling
  // --------------------------------------------------------------------------

  private scheduleSync(): void {
    if (this.syncTimeoutId) return;

    const idleSyncMs = this.config.incremental?.idleSyncMs ?? 300;

    this.syncTimeoutId = window.setTimeout(() => {
      this.syncTimeoutId = null;
      this.persistEvents();
    }, idleSyncMs);
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  private persistEvents(): void {
    if (this.pendingEvents.length === 0) return;

    try {
      // 기존 이벤트 로드
      const existingEvents = this.loadEvents();

      // 새 이벤트 병합
      const allEvents = [...existingEvents, ...this.pendingEvents];

      // 우선순위에 따라 정렬
      const sorted = this.sortByPriority(allEvents);

      // 저장 시도
      this.saveEvents(sorted);

      // 성공 시 pending 클리어
      this.pendingEvents = [];
    } catch (e) {
      this.logMeta({
        timestamp: Date.now(),
        type: 'persist_fail',
        error: e instanceof Error ? e.message : String(e),
        context: {
          eventCount: this.pendingEvents.length,
          activeTab: 'unknown',
        },
      });
    }
  }

  private sortByPriority(events: KitchenEvent[]): KitchenEvent[] {
    const sorted = [...events];

    if (this.config.priority === 'errors-first') {
      sorted.sort((a, b) => {
        const aIsError = a.type === 'error' ? 1 : 0;
        const bIsError = b.type === 'error' ? 1 : 0;

        if (aIsError !== bIsError) {
          return bIsError - aIsError; // 에러 우선
        }

        return b.timestamp - a.timestamp; // 최신 우선
      });
    } else {
      // recent-first
      sorted.sort((a, b) => b.timestamp - a.timestamp);
    }

    return sorted;
  }

  private saveEvents(events: KitchenEvent[]): void {
    const { maxPersistEvents, maxPersistBytes } = this.config;

    // 최대 개수 제한
    let subset = events.slice(0, maxPersistEvents);

    // 바이트 제한에 맞게 조정
    for (let i = subset.length; i > 0; i--) {
      try {
        const toSave = subset.slice(0, i);
        const json = JSON.stringify(toSave);

        if (json.length > maxPersistBytes) {
          continue;
        }

        sessionStorage.setItem(STORAGE_KEY, json);
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
          continue;
        }
        throw e;
      }
    }

    // 모두 실패 시 스토리지 클리어
    sessionStorage.removeItem(STORAGE_KEY);
    this.logMeta({
      timestamp: Date.now(),
      type: 'persist_fail',
      error: 'All save attempts failed, storage cleared',
      context: {
        eventCount: events.length,
        activeTab: 'unknown',
      },
    });
  }

  // --------------------------------------------------------------------------
  // Load
  // --------------------------------------------------------------------------

  /**
   * 저장된 이벤트 로드
   */
  loadEvents(): KitchenEvent[] {
    try {
      const json = sessionStorage.getItem(STORAGE_KEY);
      if (!json) return [];

      const events = JSON.parse(json) as KitchenEvent[];
      return Array.isArray(events) ? events : [];
    } catch {
      return [];
    }
  }

  /**
   * 저장된 이벤트 클리어
   */
  clearEvents(): void {
    sessionStorage.removeItem(STORAGE_KEY);
    this.pendingEvents = [];
  }

  // --------------------------------------------------------------------------
  // Meta Logging
  // --------------------------------------------------------------------------

  private logMeta(log: KitchenMetaLog): void {
    try {
      const existingJson = sessionStorage.getItem(META_LOG_KEY);
      const existing: KitchenMetaLog[] = existingJson
        ? JSON.parse(existingJson)
        : [];

      existing.push(log);

      // 최대 개수 제한
      const trimmed = existing.slice(-MAX_META_LOGS);

      sessionStorage.setItem(META_LOG_KEY, JSON.stringify(trimmed));
    } catch {
      // 메타 로깅 실패는 무시
    }
  }

  /**
   * 메타 로그 조회
   */
  getMetaLogs(): KitchenMetaLog[] {
    try {
      const json = sessionStorage.getItem(META_LOG_KEY);
      if (!json) return [];

      const logs = JSON.parse(json) as KitchenMetaLog[];
      return Array.isArray(logs) ? logs : [];
    } catch {
      return [];
    }
  }

  /**
   * 메타 로그 클리어
   */
  clearMetaLogs(): void {
    sessionStorage.removeItem(META_LOG_KEY);
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * beforeunload 이벤트에 연결
   */
  attachBeforeUnload(): () => void {
    const handler = () => {
      this.flush();
    };

    window.addEventListener('beforeunload', handler);

    return () => {
      window.removeEventListener('beforeunload', handler);
    };
  }

  /**
   * 정리
   */
  destroy(): void {
    if (this.syncTimeoutId) {
      clearTimeout(this.syncTimeoutId);
      this.syncTimeoutId = null;
    }
    this.pendingEvents = [];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalPersistence: PersistenceManager | null = null;

export function getPersistenceManager(config?: Partial<PreserveLogConfig>): PersistenceManager {
  if (!globalPersistence) {
    globalPersistence = new PersistenceManager(config);
  }
  return globalPersistence;
}

export function initializePersistence(config?: Partial<PreserveLogConfig>): PersistenceManager {
  const manager = getPersistenceManager(config);
  manager.attachBeforeUnload();
  return manager;
}

export function destroyPersistence(): void {
  if (globalPersistence) {
    globalPersistence.destroy();
    globalPersistence = null;
  }
}
