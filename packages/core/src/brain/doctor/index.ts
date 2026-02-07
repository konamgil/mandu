/**
 * Brain v0.1 - Doctor Module
 *
 * Doctor handles error recovery:
 * - Guard failure analysis
 * - Root cause summary
 * - Minimal patch suggestions
 * - Works with or without LLM
 */

export {
  categorizeViolation,
  analyzeRootCauseTemplate,
  generateTemplatePatches,
  buildAnalysisPrompt,
  parseLLMAnalysis,
  analyzeViolations,
  type ViolationCategory,
} from "./analyzer";

export {
  prioritizePatches,
  deduplicatePatches,
  generatePatchDescription,
  applyPatch,
  applyPatches,
  generatePatchReport,
  type PatchResult,
  type BatchPatchResult,
} from "./patcher";

export {
  formatViolation,
  formatPatch,
  printDoctorReport,
  generateJsonReport,
  generateDoctorMarkdownReport,
  formatDoctorReport,
  type ReportFormat,
} from "./reporter";

export {
  analyzeConfigMismatch,
  analyzeConfigMismatchWithLLM,
  formatConfigAnalysisReport,
  type ConfigMismatchAnalysis,
  type ConfigAnalysisReport,
  type ConfigIssueCategory,
  type ConfigIssueSeverity,
} from "./config-analyzer";
