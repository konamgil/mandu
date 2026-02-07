/**
 * Mandu Kitchen DevTools - Client Module
 * @version 1.0.3
 */

// State Management
export {
  KitchenStateManager,
  getStateManager,
  resetStateManager,
  type KitchenState,
  type StateListener,
} from './state-manager';

// Error Catching
export {
  ErrorCatcher,
  getErrorCatcher,
  initializeErrorCatcher,
  destroyErrorCatcher,
} from './catchers';

// Network Proxy
export {
  NetworkProxy,
  getNetworkProxy,
  initializeNetworkProxy,
  destroyNetworkProxy,
} from './catchers';

// Filters
export {
  removeComments,
  handleStrings,
  redactBuiltInSecrets,
  redactCustomPatterns,
  truncate,
  applyContextFilters,
  sanitizeStackTrace,
  sanitizeErrorMessage,
  type FilterOptions,
} from './filters';

// Persistence
export {
  PersistenceManager,
  getPersistenceManager,
  initializePersistence,
  destroyPersistence,
} from './persistence';

// Components
export {
  ManduCharacter,
  ManduBadge,
  ErrorOverlay,
  mountKitchen,
  unmountKitchen,
  isKitchenMounted,
  type ManduCharacterProps,
  type ManduBadgeProps,
  type ErrorOverlayProps,
} from './components';
