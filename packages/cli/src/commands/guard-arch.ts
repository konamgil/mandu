/**
 * mandu guard arch - Architecture Guard Command
 *
 * Real-time architecture monitoring and one-off checks
 */

import {
  createGuardWatcher,
  checkDirectory,
  printReport,
  formatReportForAgent,
  formatReportAsAgentJSON,
  getPreset,
  listPresets,
  createScanRecord,
  addScanRecord,
  loadStatistics,
  analyzeTrend,
  calculateLayerStatistics,
  generateGuardMarkdownReport,
  generateHTMLReport,
  validateAndReport,
  analyzeDependencyGraph,
  renderGraphHtml,
  type GuardConfig,
  type GuardPreset,
} from "@mandujs/core";
import { writeFile, mkdir } from "fs/promises";
import { isDirectory, resolveFromCwd } from "../util/fs";
import { getFsRoutesGuardPolicy } from "../util/guard-policy";
import { resolveOutputFormat, type OutputFormat } from "../util/output";
import path from "path";

export interface GuardArchOptions {
  /** Preset name */
  preset?: GuardPreset;
  /** Real-time watch mode */
  watch?: boolean;
  /** CI mode (exit 1 on error) */
  ci?: boolean;
  /** Output format: console, agent, json */
  format?: OutputFormat;
  /** Quiet mode (summary only) */
  quiet?: boolean;
  /** Source directory */
  srcDir?: string;
  /** List available presets */
  listPresets?: boolean;
  /** Report output file */
  output?: string;
  /** Report format: json, markdown, html */
  reportFormat?: "json" | "markdown" | "html";
  /** Save statistics (for trend analysis) */
  saveStats?: boolean;
  /** Show trend analysis */
  showTrend?: boolean;
  /**
   * Emit an interactive dependency graph to .mandu/guard/.
   *
   * - `true` / `"html"` → emits both graph.html + graph.json
   * - `"json"` → JSON only (for CI consumption; skips HTML render)
   */
  graph?: boolean | "html" | "json";
}

function inferReportFormat(output?: string): "json" | "markdown" | "html" | undefined {
  if (!output) return undefined;
  const ext = path.extname(output).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return undefined;
}

export async function guardArch(options: GuardArchOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  const {
    watch = false,
    ci = process.env.CI === "true",
    format,
    quiet = false,
    listPresets: showPresets = false,
    output,
    reportFormat = inferReportFormat(options.output) ?? "markdown",
    saveStats = false,
    showTrend = false,
  } = options;
  const resolvedFormat = resolveOutputFormat(format);
  const enableFsRoutes = await isDirectory(path.resolve(rootDir, "app"));

  // List presets
  if (showPresets) {
    console.log("");
    console.log("🛡️  Mandu Guard - Available Presets");
    console.log("");

    const presets = listPresets();
    for (const p of presets) {
      const presetDef = getPreset(p.name);
      console.log(`  ${p.name === "fsd" ? "✨ " : "  "}${p.name}`);
      console.log(`     ${p.description}`);
      console.log(`     Layers: ${presetDef.hierarchy.join(" → ")}`);
      console.log("");
    }

    console.log("Usage: set guard.preset in mandu.config to choose a preset");
    return true;
  }

  const fileConfig = await validateAndReport(rootDir);
  if (!fileConfig) return false;
  const guardConfigFromFile = fileConfig.guard ?? {};

  const preset = options.preset ?? guardConfigFromFile.preset ?? "mandu";
  const srcDir = options.srcDir ?? guardConfigFromFile.srcDir ?? "src";

  if (resolvedFormat === "console") {
    console.log("");
    console.log("🛡️  Mandu Guard - Architecture Checker");
    console.log("");
    console.log(`📋 Preset: ${preset}`);
    console.log(`📂 Source: ${srcDir}/`);
    console.log(`🔧 Mode: ${watch ? "Watch" : "Check"}`);
    console.log("");
  }

  // Guard config
  const guardConfig: GuardConfig = {
    preset,
    srcDir,
    realtime: watch,
    realtimeOutput: resolvedFormat,
    exclude: guardConfigFromFile.exclude,
    fsRoutes: getFsRoutesGuardPolicy(enableFsRoutes),
  };

  // Real-time watch mode
  if (watch) {
    if (resolvedFormat === "console") {
      console.log("👁️  Watching for architecture violations...");
      console.log("   Press Ctrl+C to stop\n");
    }

    const watcher = createGuardWatcher({
      config: guardConfig,
      rootDir,
      onViolation: (violation) => {
        // Real-time violation output is handled inside watcher
      },
      onFileAnalyzed: (analysis, violations) => {
        if (resolvedFormat === "console" && violations.length > 0 && !quiet) {
          const timestamp = new Date().toLocaleTimeString();
          console.log(`[${timestamp}] ${analysis.filePath}: ${violations.length} violation(s)`);
        }
      },
    });

    watcher.start();

    // Handle Ctrl+C
    process.on("SIGINT", () => {
      if (resolvedFormat === "console") {
        console.log("\n🛑 Guard stopped");
      }
      watcher.close();
      process.exit(0);
    });

    // Keep running
    return new Promise(() => {});
  }

  // One-off check mode
  if (resolvedFormat === "console" && !quiet) {
    console.log("🔍 Scanning for architecture violations...\n");
  }

  const report = await checkDirectory(guardConfig, rootDir);
  const presetDef = getPreset(preset);

  // Print report based on output format
  switch (resolvedFormat) {
    case "json":
      console.log(formatReportAsAgentJSON(report, preset));
      break;

    case "agent":
      console.log(formatReportForAgent(report, preset));
      break;

    case "console":
    default:
      if (quiet) {
        // Summary only
        console.log(`Files analyzed: ${report.filesAnalyzed}`);
        console.log(`Violations: ${report.totalViolations}`);
        console.log(`  Errors: ${report.bySeverity.error}`);
        console.log(`  Warnings: ${report.bySeverity.warn}`);
        console.log(`  Info: ${report.bySeverity.info}`);
      } else {
        printReport(report, presetDef.hierarchy);
      }
      break;
  }

  // Save statistics
  if (saveStats) {
    const scanRecord = createScanRecord(report, preset);
    await addScanRecord(rootDir, scanRecord);
    console.log("📊 Statistics saved to .mandu/guard-stats.json");
  }

  // Trend analysis
  let trend = null;
  let layerStats = null;

  if (showTrend) {
    const store = await loadStatistics(rootDir);
    trend = analyzeTrend(store.records, 7);
    layerStats = calculateLayerStatistics(report.violations, presetDef.hierarchy);

    if (trend) {
      console.log("");
      console.log("📈 Trend Analysis (7 days):");
      const trendEmoji = trend.trend === "improving" ? "📉" : trend.trend === "degrading" ? "📈" : "➡️";
      console.log(`   Status: ${trendEmoji} ${trend.trend.toUpperCase()}`);
      console.log(`   Change: ${trend.violationDelta >= 0 ? "+" : ""}${trend.violationDelta} (${trend.violationChangePercent >= 0 ? "+" : ""}${trend.violationChangePercent}%)`);

      if (trend.recommendations.length > 0) {
        console.log("   💡 Recommendations:");
        for (const rec of trend.recommendations) {
          console.log(`      - ${rec}`);
        }
      }
    }
  }

  // Phase 18.π — Dependency graph emission (--graph)
  if (options.graph) {
    const mode = options.graph === "json" ? "json" : "html";
    const outDir = path.resolve(rootDir, ".mandu/guard");
    await mkdir(outDir, { recursive: true });
    const graph = await analyzeDependencyGraph(guardConfig, rootDir);
    const jsonPath = path.join(outDir, "graph.json");
    await writeFile(jsonPath, JSON.stringify(graph, null, 2));
    if (mode === "html") {
      const htmlPath = path.join(outDir, "graph.html");
      await writeFile(htmlPath, renderGraphHtml(graph));
      if (resolvedFormat === "console") {
        console.log(
          `\n📊 Graph written to .mandu/guard/graph.html (${graph.summary.nodes} modules, ${graph.summary.edges} edges, ${graph.summary.violationEdges} violations)`
        );
      }
    } else {
      if (resolvedFormat === "console") {
        console.log(
          `\n📊 Graph written to .mandu/guard/graph.json (${graph.summary.nodes} modules, ${graph.summary.edges} edges, ${graph.summary.violationEdges} violations)`
        );
      }
    }
  }

  // Write report file
  if (output) {
    let reportContent: string;

    switch (reportFormat) {
      case "json":
        reportContent = formatReportAsAgentJSON(report, preset);
        break;
      case "html":
        reportContent = generateHTMLReport(report, trend, layerStats ?? undefined);
        break;
      case "markdown":
      default:
        reportContent = generateGuardMarkdownReport(report, trend, layerStats ?? undefined);
        break;
    }

    await writeFile(output, reportContent);
    console.log(`\n📄 Report saved to ${output}`);
  }

  // Fail in CI mode when errors exist
  const hasErrors = report.bySeverity.error > 0;
  const hasWarnings = report.bySeverity.warn > 0;

  if (report.totalViolations === 0) {
    console.log("\n✅ Architecture check passed");
    return true;
  }

  if (hasErrors || (ci && hasWarnings)) {
    const reason = hasErrors
      ? `${report.bySeverity.error} error(s)`
      : `${report.bySeverity.warn} warning(s)`;
    console.log(`\n❌ Architecture check failed: ${reason}`);
    return false;
  }

  console.log(`\n⚠️  ${report.totalViolations} issue(s) found`);
  return true;
}
