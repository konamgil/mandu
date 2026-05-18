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
  runTsgolint,
  type GuardConfig,
  type GuardPreset,
  type TsgolintBridgeResult,
} from "@mandujs/core";
import { writeFile, mkdir } from "fs/promises";
import { isDirectory, resolveFromCwd } from "../util/fs";
import { getFsRoutesGuardPolicy } from "../util/guard-policy";
import { refreshStaleRuntimeLockfile, LOCKFILE_COMMANDS } from "../util/lockfile";
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
  /**
   * Follow-up E — invoke the `oxlint --type-aware` bridge after the
   * architecture check.
   *
   * - `true`  → run the bridge; merge its violations into the exit code.
   * - `false` → hard-skip even when `guard.typeAware` is configured.
   * - `undefined` (default) → inherit from config: run iff
   *   `guard.typeAware` is set. Users can still force the flag from
   *   the command line with `--type-aware` / `--no-type-aware`.
   */
  typeAware?: boolean;
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
  const lockRefresh = await refreshStaleRuntimeLockfile(fileConfig, rootDir, {
    mode: ci ? "ci" : "development",
  });

  const preset = options.preset ?? guardConfigFromFile.preset ?? "mandu";
  const srcDir = options.srcDir ?? guardConfigFromFile.srcDir ?? "src";

  if (resolvedFormat === "console") {
    console.log("");
    console.log("🛡️  Mandu Guard - Architecture Checker");
    console.log("");
    console.log(`📋 Preset: ${preset}`);
    console.log(`📂 Source: ${srcDir}/`);
    console.log(`🔧 Mode: ${watch ? "Watch" : "Check"}`);
    if (lockRefresh.refreshed) {
      console.log(`🔒 Refreshed .mandu/guard.lock (${lockRefresh.hash?.slice(0, 8)})`);
    } else if (lockRefresh.reason === "policy-blocked" && !quiet) {
      console.log(`🔒 Guard lock is stale. Run \`${LOCKFILE_COMMANDS.update}\` to refresh it.`);
    }
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
      onViolation: (_violation) => {
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

  // ──────────────────────────────────────────────────────────────────────
  // Follow-up E — type-aware lint pass (`oxlint --type-aware`).
  //
  // Precedence: explicit CLI flag > config. When the CLI flag is omitted
  // entirely we infer "on" from the presence of `guard.typeAware` in
  // the config. A `--no-type-aware` CLI flag always wins.
  // ──────────────────────────────────────────────────────────────────────
  const typeAwareCfg = guardConfigFromFile.typeAware;
  const typeAwareEnabled =
    options.typeAware !== undefined
      ? options.typeAware
      : typeAwareCfg !== undefined;

  let typeAwareResult: TsgolintBridgeResult | undefined;
  if (typeAwareEnabled) {
    if (resolvedFormat === "console" && !quiet) {
      console.log("\n🔬 Running type-aware lint (oxlint --type-aware)...");
    }
    typeAwareResult = await runTsgolint({
      projectRoot: rootDir,
      rules: typeAwareCfg?.rules,
      severity: typeAwareCfg?.severity,
      configPath: typeAwareCfg?.configPath,
    });

    if (resolvedFormat === "console" && !quiet) {
      if (typeAwareResult.skipped === "oxlint-not-installed") {
        console.log(
          "   ⚠️  oxlint not installed at node_modules/.bin/oxlint — type-aware pass skipped.\n" +
            "   Install with: bun add -D oxlint oxlint-tsgolint"
        );
      } else if (typeAwareResult.skipped === "severity-off") {
        console.log("   ⏭️  severity=off in config — skipped.");
      } else {
        const { violations, summary } = typeAwareResult;
        const errorCount = violations.filter((v) => v.severity === "error").length;
        const warnCount = violations.filter((v) => v.severity === "warn").length;
        const infoCount = violations.filter((v) => v.severity === "info").length;
        console.log(
          `   ${violations.length === 0 ? "✅" : "⚠️"} ${violations.length} type-aware violation(s) ` +
            `(${errorCount} error, ${warnCount} warn, ${infoCount} info) ` +
            `across ${summary.filesAnalyzed} file(s) in ${summary.elapsedMs}ms`
        );
        if (violations.length > 0) {
          // Show the first 5 hits; the JSON / file output carries the rest.
          for (const v of violations.slice(0, 5)) {
            const rel = path.relative(rootDir, v.filePath) || v.filePath;
            console.log(
              `     ${v.severity === "error" ? "🚨" : v.severity === "warn" ? "⚠️ " : "ℹ️ "} ` +
                `${rel}:${v.line}:${v.column}  [${v.ruleName}] ${v.ruleDescription}`
            );
          }
          if (violations.length > 5) {
            console.log(`     … and ${violations.length - 5} more (see report file).`);
          }
        }
      }
    } else if (resolvedFormat === "json") {
      // Surface type-aware results in JSON output too — as a secondary
      // JSON document so downstream consumers can pipe `head -1` for the
      // architecture block or `tail -1` for the type-aware block.
      console.log(
        JSON.stringify(
          {
            typeAware: {
              skipped: typeAwareResult.skipped,
              summary: typeAwareResult.summary,
              violations: typeAwareResult.violations,
            },
          },
          null,
          2
        )
      );
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

  // Follow-up E — type-aware errors flip the exit code just like
  // architecture errors. Warnings alone keep the build green (same
  // policy as the architecture pass — `ci` flag escalates warnings).
  const typeAwareErrors = typeAwareResult
    ? typeAwareResult.violations.filter((v) => v.severity === "error").length
    : 0;
  const typeAwareWarnings = typeAwareResult
    ? typeAwareResult.violations.filter((v) => v.severity === "warn").length
    : 0;

  if (
    report.totalViolations === 0 &&
    typeAwareErrors === 0 &&
    typeAwareWarnings === 0
  ) {
    console.log("\n✅ Architecture check passed");
    return true;
  }

  if (
    hasErrors ||
    typeAwareErrors > 0 ||
    (ci && (hasWarnings || typeAwareWarnings > 0))
  ) {
    const parts: string[] = [];
    if (hasErrors) parts.push(`${report.bySeverity.error} architecture error(s)`);
    if (typeAwareErrors > 0) parts.push(`${typeAwareErrors} type-aware error(s)`);
    if (parts.length === 0) {
      parts.push(
        `${report.bySeverity.warn + typeAwareWarnings} warning(s) (CI mode)`
      );
    }
    console.log(`\n❌ Guard failed: ${parts.join(", ")}`);
    return false;
  }

  console.log(
    `\n⚠️  ${report.totalViolations + (typeAwareResult?.violations.length ?? 0)} issue(s) found`
  );
  return true;
}
