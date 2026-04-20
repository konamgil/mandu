/**
 * @mandujs/core/diagnose — structured diagnostic checks.
 *
 * Public surface for Issue #215 diagnose-check expansion.
 */

export type { DiagnoseSeverity, DiagnoseCheckResult, DiagnoseReport } from "./types";
export {
  checkManifestFreshness,
  checkPrerenderPollution,
  checkCloneElementWarnings,
  checkDevArtifactsInProd,
  checkPackageExportGaps,
} from "./checks";
export { EXTENDED_CHECKS, runExtendedDiagnose, buildReport } from "./run";
