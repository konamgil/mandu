/**
 * Brain v0.1 - Watcher Module
 *
 * Watch handles error prevention:
 * - File change detection
 * - Architecture rule warnings
 * - No blocking - warnings only
 */

// Rules
export {
  MVP_RULES,
  getRulesMap,
  matchGlob,
  matchRules,
  checkNamingConvention,
  checkForbiddenImports,
  validateFile,
  getRule,
  getAllRules,
} from "./rules";

// Watcher
export {
  FileWatcher,
  createWatcher,
  getWatcher,
  startWatcher,
  stopWatcher,
  type WatcherConfig,
} from "./watcher";

// Reporter
export {
  formatWarning,
  printWarning,
  formatStatus,
  printStatus,
  printWatchStart,
  printWatchStop,
  generateJsonStatus,
  createConsoleHandler,
  createCollectorHandler,
} from "./reporter";
