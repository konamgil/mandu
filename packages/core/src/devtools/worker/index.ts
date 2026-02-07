/**
 * Mandu Kitchen DevTools - Worker Module
 * @version 1.1.0
 */

// Redaction Worker
export {
  redactText,
  truncateText,
  handleMessage,
  BUILT_IN_SECRET_PATTERNS,
  PII_PATTERNS,
  type WorkerRequest,
  type WorkerResponse,
} from './redaction-worker';

// Worker Manager
export {
  WorkerManager,
  getWorkerManager,
  initializeWorkerManager,
  destroyWorkerManager,
  type WorkerStatus,
  type WorkerManagerOptions,
} from './worker-manager';
