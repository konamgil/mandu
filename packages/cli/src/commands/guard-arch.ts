/**
 * mandu guard arch - Architecture Guard Command
 *
 * 실시간 아키텍처 감시 및 일회성 검사
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
  type GuardConfig,
  type GuardPreset,
} from "@mandujs/core";
import { writeFile } from "fs/promises";
import { isDirectory, resolveFromCwd } from "../util/fs";
import { resolveOutputFormat, type OutputFormat } from "../util/output";
import path from "path";

export interface GuardArchOptions {
  /** 프리셋 이름 */
  preset?: GuardPreset;
  /** 실시간 감시 모드 */
  watch?: boolean;
  /** CI 모드 (에러 시 exit 1) */
  ci?: boolean;
  /** 출력 형식: console, agent, json */
  format?: OutputFormat;
  /** 조용히 (요약만 출력) */
  quiet?: boolean;
  /** 소스 디렉토리 */
  srcDir?: string;
  /** 프리셋 목록 출력 */
  listPresets?: boolean;
  /** 리포트 파일 출력 */
  output?: string;
  /** 리포트 형식: json, markdown, html */
  reportFormat?: "json" | "markdown" | "html";
  /** 통계 저장 (트렌드 분석용) */
  saveStats?: boolean;
  /** 트렌드 분석 표시 */
  showTrend?: boolean;
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

  // 프리셋 목록 출력
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

  // Guard 설정
  const guardConfig: GuardConfig = {
    preset,
    srcDir,
    realtime: watch,
    realtimeOutput: resolvedFormat,
    exclude: guardConfigFromFile.exclude,
    fsRoutes: enableFsRoutes
      ? {
          noPageToPage: true,
          pageCanImport: [
            "client/pages",
            "client/widgets",
            "client/features",
            "client/entities",
            "client/shared",
            "shared/contracts",
            "shared/types",
            "shared/utils/client",
          ],
          layoutCanImport: [
            "client/app",
            "client/widgets",
            "client/shared",
            "shared/contracts",
            "shared/types",
            "shared/utils/client",
          ],
          routeCanImport: [
            "server/api",
            "server/application",
            "server/domain",
            "server/infra",
            "server/core",
            "shared/contracts",
            "shared/schema",
            "shared/types",
            "shared/utils/client",
            "shared/utils/server",
            "shared/env",
          ],
        }
      : undefined,
  };

  // 실시간 감시 모드
  if (watch) {
    if (resolvedFormat === "console") {
      console.log("👁️  Watching for architecture violations...");
      console.log("   Press Ctrl+C to stop\n");
    }

    const watcher = createGuardWatcher({
      config: guardConfig,
      rootDir,
      onViolation: (violation) => {
        // 실시간 위반 출력은 watcher 내부에서 처리됨
      },
      onFileAnalyzed: (analysis, violations) => {
        if (resolvedFormat === "console" && violations.length > 0 && !quiet) {
          const timestamp = new Date().toLocaleTimeString();
          console.log(`[${timestamp}] ${analysis.filePath}: ${violations.length} violation(s)`);
        }
      },
    });

    watcher.start();

    // Ctrl+C 핸들링
    process.on("SIGINT", () => {
      if (resolvedFormat === "console") {
        console.log("\n🛑 Guard stopped");
      }
      watcher.close();
      process.exit(0);
    });

    // 계속 실행
    return new Promise(() => {});
  }

  // 일회성 검사 모드
  if (resolvedFormat === "console" && !quiet) {
    console.log("🔍 Scanning for architecture violations...\n");
  }

  const report = await checkDirectory(guardConfig, rootDir);
  const presetDef = getPreset(preset);

  // 출력 형식에 따른 리포트 출력
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
        // 요약만 출력
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

  // 통계 저장
  if (saveStats) {
    const scanRecord = createScanRecord(report, preset);
    await addScanRecord(rootDir, scanRecord);
    console.log("📊 Statistics saved to .mandu/guard-stats.json");
  }

  // 트렌드 분석
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

  // 리포트 파일 출력
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

  // CI 모드에서 에러가 있으면 실패
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
