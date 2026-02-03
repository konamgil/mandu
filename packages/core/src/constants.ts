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
