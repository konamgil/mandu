/**
 * Mandu Diagnose — unified check result shape.
 *
 * Every diagnose check returns a `DiagnoseCheckResult`. Severity semantics:
 *
 *   - `error`   : blocks deploy. CI should fail. Example: stale dev-mode
 *                 manifest shipped to prod, package export gap, empty bundles
 *                 with islands declared.
 *   - `warning` : degraded UX or future risk. Does NOT block deploy, but
 *                 surfaces for operator attention. Example: suspicious
 *                 prerendered routes, many cloneElement warnings.
 *   - `info`    : neutral observation, no action required.
 *
 * The `rule` field is a stable machine-readable identifier. The `message`
 * field is human-readable and MAY include route paths or counts. The
 * optional `suggestion` field is a single actionable next step.
 */
export type DiagnoseSeverity = "error" | "warning" | "info";

export interface DiagnoseCheckResult {
  /** Overall pass/fail for this check. `true` = healthy. */
  ok: boolean;
  /** Stable machine-readable rule id, e.g. `manifest_freshness`. */
  rule: string;
  /** Severity when `ok === false`. Omitted when `ok === true`. */
  severity?: DiagnoseSeverity;
  /** Human-readable summary. */
  message: string;
  /** Single-line actionable next step, e.g. `"Run mandu build"`. */
  suggestion?: string;
  /** Structured details (route list, counts, file paths). */
  details?: Record<string, unknown>;
}

/**
 * Aggregated report across all checks for a single diagnose run.
 */
export interface DiagnoseReport {
  /** `true` when no check has `ok: false` with `severity: 'error'`. */
  healthy: boolean;
  /** Count of checks returning `ok: false` with `severity: 'error'`. */
  errorCount: number;
  /** Count of checks returning `ok: false` with `severity: 'warning'`. */
  warningCount: number;
  /** Individual check results in registration order. */
  checks: DiagnoseCheckResult[];
  /** Summary statistics. */
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}
