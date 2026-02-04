/**
 * Mandu Guard
 *
 * 실시간 아키텍처 감시 시스템
 *
 * @module guard
 *
 * @example
 * ```typescript
 * import { createGuardWatcher, checkDirectory } from "@mandujs/core/guard";
 *
 * // 실시간 감시
 * const watcher = createGuardWatcher({
 *   config: { preset: "fsd" },
 *   rootDir: process.cwd(),
 * });
 * watcher.start();
 *
 * // 일회성 검사
 * const report = await checkDirectory({ preset: "fsd" }, process.cwd());
 * console.log(report.totalViolations);
 * ```
 */

// ═══════════════════════════════════════════════════════════════════════════
// Legacy Guard (Contract Guard)
// ═══════════════════════════════════════════════════════════════════════════

export * from "./rules";
export * from "./check";
export * from "./auto-correct";
export * from "./contract-guard";

// ═══════════════════════════════════════════════════════════════════════════
// Architecture Guard - Types
// ═══════════════════════════════════════════════════════════════════════════

export type {
  GuardPreset,
  GuardConfig,
  Severity,
  SeverityConfig,
  LayerDefinition,
  LayerRule,
  ImportInfo,
  FileAnalysis,
  ViolationType,
  Violation,
  ViolationReport,
  WatcherEvent,
  WatcherCallback,
  GuardWatcher,
  PresetDefinition,
  FSRoutesGuardConfig,
} from "./types";

export {
  DEFAULT_GUARD_CONFIG,
  WATCH_EXTENSIONS,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Architecture Guard - Analyzer
// ═══════════════════════════════════════════════════════════════════════════

export {
  extractImports,
  resolveFileLayer,
  resolveImportLayer,
  extractSlice,
  analyzeFile,
  shouldAnalyzeFile,
  shouldIgnoreImport,
} from "./analyzer";

// ═══════════════════════════════════════════════════════════════════════════
// Architecture Guard - Validator
// ═══════════════════════════════════════════════════════════════════════════

export {
  validateLayerDependency,
  validateFileAnalysis,
  validateAnalyses,
  detectCircularDependencies,
  createViolation,
} from "./validator";

// ═══════════════════════════════════════════════════════════════════════════
// Architecture Guard - Reporter
// ═══════════════════════════════════════════════════════════════════════════

export {
  formatViolation,
  formatReport,
  formatViolationSummary,
  printViolation,
  printReport,
  printRealtimeViolation,
  formatReportAsJSON,
  formatForGitHubActions,
  // Agent-optimized exports
  formatViolationForAgent,
  formatViolationAsAgentJSON,
  formatReportForAgent,
  formatReportAsAgentJSON,
} from "./reporter";

// ═══════════════════════════════════════════════════════════════════════════
// Architecture Guard - Suggestions
// ═══════════════════════════════════════════════════════════════════════════

export {
  getDocumentationLink,
  generateSmartSuggestions,
  toAgentFormat,
  type AgentViolationFormat,
} from "./suggestions";

// ═══════════════════════════════════════════════════════════════════════════
// Architecture Guard - Watcher
// ═══════════════════════════════════════════════════════════════════════════

export {
  createGuardWatcher,
  checkFile,
  checkDirectory,
  clearAnalysisCache,
} from "./watcher";

// ═══════════════════════════════════════════════════════════════════════════
// Architecture Guard - Presets
// ═══════════════════════════════════════════════════════════════════════════

export {
  presets,
  getPreset,
  listPresets,
  fsdPreset,
  cleanPreset,
  hexagonalPreset,
  atomicPreset,
  manduPreset,
  FSD_HIERARCHY,
  CLEAN_HIERARCHY,
  HEXAGONAL_HIERARCHY,
  ATOMIC_HIERARCHY,
} from "./presets";

// ═══════════════════════════════════════════════════════════════════════════
// Architecture Guard - AST Analyzer (Advanced)
// ═══════════════════════════════════════════════════════════════════════════

export {
  extractImportsAST,
  extractExportsAST,
  analyzeModuleAST,
  type ExportInfo,
  type ModuleAnalysis,
} from "./ast-analyzer";

// ═══════════════════════════════════════════════════════════════════════════
// Architecture Guard - Statistics
// ═══════════════════════════════════════════════════════════════════════════

export {
  createScanRecord,
  calculateLayerStatistics,
  analyzeTrend,
  loadStatistics,
  saveStatistics,
  addScanRecord,
  generateGuardMarkdownReport,
  generateHTMLReport,
  type ScanRecord,
  type StatisticsStore,
  type TrendAnalysis,
  type LayerStatistics,
} from "./statistics";

// ═══════════════════════════════════════════════════════════════════════════
// Config Guard - 설정 무결성 검증
// ═══════════════════════════════════════════════════════════════════════════

export {
  guardConfig,
  quickConfigGuard,
  formatConfigGuardResult,
  formatConfigGuardAsJSON,
  calculateHealthScore,
  type ConfigGuardResult,
  type ConfigGuardError,
  type ConfigGuardWarning,
  type ConfigGuardOptions,
  type UnifiedHealthResult,
} from "./config-guard";

// ═══════════════════════════════════════════════════════════════════════════
// Self-Healing Guard
// ═══════════════════════════════════════════════════════════════════════════

export {
  // Main API
  checkWithHealing,
  generateHealing,
  applyHealing,
  healAll,
  explainRule,
  // Types
  type HealingOption,
  type HealingFixResult,
  type HealingSuggestion,
  type HealingContext,
  type HealingItem,
  type HealingResult,
  type RuleExplanation,
} from "./healing";
