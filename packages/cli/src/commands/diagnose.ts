/**
 * Mandu CLI — `mandu diagnose`
 *
 * Runs the extended diagnose check set (Issue #215). Each check returns
 * a unified `{ ok, rule, severity, message, suggestion?, details? }`
 * shape. Any check with `severity: 'error'` causes a non-zero exit so
 * `mandu diagnose` can be wired into CI as a deploy gate.
 *
 * Flags:
 *   --json    Emit the raw `DiagnoseReport` as JSON to stdout (no console
 *             summary). Useful for machine consumption in CI pipelines.
 *   --quiet   Suppress the per-check narrative, only show the summary
 *             and exit code.
 */

import {
  runExtendedDiagnose,
  type DiagnoseCheckResult,
  type DiagnoseReport,
} from "@mandujs/core/diagnose";
import { getRootDir } from "../util/fs";

export interface DiagnoseOptions {
  json?: boolean;
  quiet?: boolean;
}

const SEVERITY_GLYPH: Record<string, string> = {
  error: "❌",
  warning: "⚠️ ",
  info: "ℹ️ ",
};

function formatCheck(check: DiagnoseCheckResult): string {
  if (check.ok) {
    return `✅ ${check.rule}: ${check.message}`;
  }
  const glyph = SEVERITY_GLYPH[check.severity ?? "error"] ?? "❌";
  const sev = (check.severity ?? "error").toUpperCase();
  const lines = [`${glyph} [${sev}] ${check.rule}: ${check.message}`];
  if (check.suggestion) lines.push(`   → ${check.suggestion}`);
  return lines.join("\n");
}

function renderConsole(report: DiagnoseReport, opts: DiagnoseOptions): void {
  if (!opts.quiet) {
    console.log("🥟 Mandu Diagnose\n");
    for (const check of report.checks) {
      console.log(formatCheck(check));
    }
    console.log("");
  }
  console.log("═══════════════════════════════════════");
  console.log(
    `Summary: ${report.summary.passed}/${report.summary.total} passed` +
      ` · ${report.errorCount} error(s) · ${report.warningCount} warning(s)`
  );
  console.log(report.healthy ? "✅ HEALTHY" : "❌ UNHEALTHY");
  console.log("═══════════════════════════════════════");
}

/**
 * Main entry. Returns `true` when healthy (exit 0), `false` when at
 * least one `severity: 'error'` check fired (CI gate).
 */
export async function diagnose(options: DiagnoseOptions = {}): Promise<boolean> {
  const rootDir = getRootDir();
  const report = await runExtendedDiagnose(rootDir);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    renderConsole(report, options);
  }

  return report.healthy;
}
