/**
 * Mandu Diagnose — aggregator.
 *
 * Runs all registered checks in parallel (they are pure I/O, no shared
 * mutable state) and builds a unified `DiagnoseReport`.
 */

import type { DiagnoseCheckResult, DiagnoseReport } from "./types";
import {
  checkManifestFreshness,
  checkPrerenderPollution,
  checkCloneElementWarnings,
  checkDevArtifactsInProd,
  checkPackageExportGaps,
} from "./checks";

/**
 * Registered extended checks (Issue #215). These are the five checks that
 * supplement the legacy guard/contract/manifest/kitchen validation in MCP.
 *
 * Order matters for display purposes only — result aggregation is
 * order-independent.
 */
export const EXTENDED_CHECKS = [
  { name: "manifest_freshness", run: checkManifestFreshness },
  { name: "prerender_pollution", run: checkPrerenderPollution },
  { name: "cloneelement_warnings", run: checkCloneElementWarnings },
  { name: "dev_artifacts_in_prod", run: checkDevArtifactsInProd },
  { name: "package_export_gaps", run: checkPackageExportGaps },
] as const;

/**
 * Run every extended check in parallel and return the aggregate report.
 *
 * Legacy checks (kitchen_errors, guard_check, contract_validation,
 * manifest_validation) are NOT run here — they live in the MCP tool
 * surface and have different dependency requirements. Instead, the MCP
 * `mandu.diagnose` composite combines the extended checks with the
 * legacy ones and normalizes both into a single unified report.
 */
export async function runExtendedDiagnose(rootDir: string): Promise<DiagnoseReport> {
  const checks = await Promise.all(
    EXTENDED_CHECKS.map(async ({ run }) => {
      try {
        return await run(rootDir);
      } catch (err) {
        // Defensive fallback — individual checks shouldn't throw, but if
        // one does, we surface it as an error rather than crashing the
        // whole diagnose run.
        return {
          ok: false,
          rule: "diagnose_internal_error",
          severity: "error" as const,
          message: `Check threw an error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    })
  );

  return buildReport(checks);
}

/**
 * Aggregate a pre-computed list of check results into a `DiagnoseReport`.
 * Exported so the MCP composite can pass in both extended + legacy checks
 * at once.
 */
export function buildReport(checks: DiagnoseCheckResult[]): DiagnoseReport {
  let errorCount = 0;
  let warningCount = 0;
  for (const c of checks) {
    if (c.ok) continue;
    if (c.severity === "error") errorCount += 1;
    else if (c.severity === "warning") warningCount += 1;
  }
  return {
    healthy: errorCount === 0,
    errorCount,
    warningCount,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((c) => c.ok).length,
      failed: checks.filter((c) => !c.ok).length,
    },
  };
}
