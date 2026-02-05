/**
 * Mandu core constants
 * Centralized defaults for timeouts, limits, and client behavior.
 */

export const TIMEOUTS = {
  LOADER_DEFAULT: 5000,
  CLIENT_DEFAULT: 30000,
  WATCHER_DEBOUNCE: 100,
  HMR_RECONNECT_DELAY: 1000,
  HMR_MAX_RECONNECT: 10,
} as const;

export const PORTS = {
  HMR_OFFSET: 1,
} as const;

export const HYDRATION = {
  DEFAULT_PRIORITY: "visible" as const,
} as const;

export const LIMITS = {
  ROUTER_PATTERN_CACHE: 200,
  ROUTER_PREFETCH_CACHE: 500,
} as const;

export const CONTENT = {
  /** 로더 기본 타임아웃 (ms) */
  LOADER_TIMEOUT: 10000,
  /** 데이터 스토어 파일 경로 */
  STORE_FILE: ".mandu/content-store.json",
  /** 메타 스토어 파일 경로 */
  META_FILE: ".mandu/content-meta.json",
  /** 저장 디바운스 (ms) */
  DEBOUNCE_SAVE: 500,
  /** 기본 콘텐츠 디렉토리 */
  DEFAULT_DIR: "content",
  /** API 로더 기본 캐시 TTL (초) */
  API_CACHE_TTL: 3600,
} as const;
