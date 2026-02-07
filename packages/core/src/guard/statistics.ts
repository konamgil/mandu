/**
 * Mandu Guard Statistics
 *
 * 위반 통계 및 트렌드 분석
 */

import { writeFile, readFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import type {
  Violation,
  ViolationReport,
  ViolationType,
  Severity,
  GuardPreset,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 단일 스캔 기록
 */
export interface ScanRecord {
  /** 스캔 ID */
  id: string;
  /** 스캔 시간 */
  timestamp: number;
  /** 프리셋 */
  preset?: GuardPreset;
  /** 분석된 파일 수 */
  filesAnalyzed: number;
  /** 총 위반 수 */
  totalViolations: number;
  /** 심각도별 카운트 */
  bySeverity: Record<Severity, number>;
  /** 타입별 카운트 */
  byType: Record<ViolationType, number>;
  /** 레이어별 카운트 */
  byLayer: Record<string, number>;
  /** 가장 많은 위반 파일 */
  hotspots: Array<{ file: string; count: number }>;
}

/**
 * 통계 저장소
 */
export interface StatisticsStore {
  /** 버전 */
  version: number;
  /** 프로젝트 이름 */
  projectName?: string;
  /** 스캔 기록 */
  records: ScanRecord[];
  /** 마지막 업데이트 */
  lastUpdated: number;
}

/**
 * 트렌드 분석
 */
export interface TrendAnalysis {
  /** 분석 기간 */
  period: {
    start: number;
    end: number;
    days: number;
  };
  /** 위반 변화량 */
  violationDelta: number;
  /** 위반 변화율 (%) */
  violationChangePercent: number;
  /** 개선/악화 */
  trend: "improving" | "stable" | "degrading";
  /** 레이어별 트렌드 */
  byLayer: Record<string, { delta: number; trend: "improving" | "stable" | "degrading" }>;
  /** 권장 사항 */
  recommendations: string[];
}

/**
 * 레이어별 통계
 */
export interface LayerStatistics {
  /** 레이어 이름 */
  name: string;
  /** 총 위반 수 */
  totalViolations: number;
  /** 위반 원인 레이어 수 */
  asSource: number;
  /** 위반 대상 레이어 수 */
  asTarget: number;
  /** 가장 많이 위반한 타겟 */
  topTargets: Array<{ layer: string; count: number }>;
  /** 건강도 점수 (0-100) */
  healthScore: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Statistics Generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 리포트에서 스캔 기록 생성
 */
export function createScanRecord(
  report: ViolationReport,
  preset?: GuardPreset
): ScanRecord {
  // 레이어별 카운트
  const byLayer: Record<string, number> = {};
  for (const v of report.violations) {
    byLayer[v.fromLayer] = (byLayer[v.fromLayer] || 0) + 1;
  }

  // 핫스팟 (가장 많은 위반 파일)
  const fileCounts: Record<string, number> = {};
  for (const v of report.violations) {
    fileCounts[v.filePath] = (fileCounts[v.filePath] || 0) + 1;
  }

  const hotspots = Object.entries(fileCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([file, count]) => ({ file, count }));

  return {
    id: generateId(),
    timestamp: Date.now(),
    preset,
    filesAnalyzed: report.filesAnalyzed,
    totalViolations: report.totalViolations,
    bySeverity: report.bySeverity,
    byType: report.byType,
    byLayer,
    hotspots,
  };
}

/**
 * 레이어별 통계 계산
 */
export function calculateLayerStatistics(
  violations: Violation[],
  layers: string[]
): LayerStatistics[] {
  const stats: Map<string, LayerStatistics> = new Map();

  // 초기화
  for (const layer of layers) {
    stats.set(layer, {
      name: layer,
      totalViolations: 0,
      asSource: 0,
      asTarget: 0,
      topTargets: [],
      healthScore: 100,
    });
  }

  // 위반 집계
  const targetCounts: Map<string, Map<string, number>> = new Map();

  for (const v of violations) {
    // Source 카운트
    const sourceStat = stats.get(v.fromLayer);
    if (sourceStat) {
      sourceStat.asSource++;
      sourceStat.totalViolations++;

      // 타겟 카운트
      if (!targetCounts.has(v.fromLayer)) {
        targetCounts.set(v.fromLayer, new Map());
      }
      const targets = targetCounts.get(v.fromLayer)!;
      targets.set(v.toLayer, (targets.get(v.toLayer) || 0) + 1);
    }

    // Target 카운트
    const targetStat = stats.get(v.toLayer);
    if (targetStat) {
      targetStat.asTarget++;
    }
  }

  // 건강도 점수 및 Top targets 계산
  for (const [layer, stat] of stats) {
    // 건강도: 위반이 많을수록 낮음
    const maxViolations = 20; // 20개 이상이면 0점
    stat.healthScore = Math.max(0, Math.round(100 - (stat.asSource / maxViolations) * 100));

    // Top targets
    const targets = targetCounts.get(layer);
    if (targets) {
      stat.topTargets = Array.from(targets.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([layer, count]) => ({ layer, count }));
    }
  }

  return Array.from(stats.values());
}

/**
 * 트렌드 분석
 */
export function analyzeTrend(
  records: ScanRecord[],
  days: number = 7
): TrendAnalysis | null {
  if (records.length < 2) {
    return null;
  }

  const now = Date.now();
  const periodStart = now - days * 24 * 60 * 60 * 1000;

  // 기간 내 기록 필터링
  const periodRecords = records.filter((r) => r.timestamp >= periodStart);

  if (periodRecords.length < 2) {
    return null;
  }

  // 가장 오래된 것과 가장 최근 것 비교
  const oldest = periodRecords[0];
  const newest = periodRecords[periodRecords.length - 1];

  const violationDelta = newest.totalViolations - oldest.totalViolations;
  const violationChangePercent =
    oldest.totalViolations === 0
      ? 0
      : Math.round((violationDelta / oldest.totalViolations) * 100);

  const trend: TrendAnalysis["trend"] =
    violationDelta < -2
      ? "improving"
      : violationDelta > 2
      ? "degrading"
      : "stable";

  // 레이어별 트렌드
  const allLayers = new Set([
    ...Object.keys(oldest.byLayer || {}),
    ...Object.keys(newest.byLayer || {}),
  ]);

  const byLayer: TrendAnalysis["byLayer"] = {};
  for (const layer of allLayers) {
    const oldCount = oldest.byLayer?.[layer] || 0;
    const newCount = newest.byLayer?.[layer] || 0;
    const delta = newCount - oldCount;

    byLayer[layer] = {
      delta,
      trend: delta < -1 ? "improving" : delta > 1 ? "degrading" : "stable",
    };
  }

  // 권장 사항 생성
  const recommendations: string[] = [];

  if (trend === "degrading") {
    recommendations.push("위반이 증가하고 있습니다. 새 코드 리뷰를 강화하세요.");
  }

  const degradingLayers = Object.entries(byLayer)
    .filter(([_, v]) => v.trend === "degrading")
    .map(([k, _]) => k);

  if (degradingLayers.length > 0) {
    recommendations.push(`주의 필요 레이어: ${degradingLayers.join(", ")}`);
  }

  const hotspot = newest.hotspots?.[0];
  if (hotspot && hotspot.count > 5) {
    recommendations.push(`핫스팟: ${hotspot.file} (${hotspot.count}개 위반) - 리팩토링 고려`);
  }

  if (recommendations.length === 0 && trend === "improving") {
    recommendations.push("잘하고 있습니다! 아키텍처 품질이 개선되고 있습니다.");
  }

  return {
    period: {
      start: oldest.timestamp,
      end: newest.timestamp,
      days,
    },
    violationDelta,
    violationChangePercent,
    trend,
    byLayer,
    recommendations,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Statistics Storage
// ═══════════════════════════════════════════════════════════════════════════

const STATS_FILE = ".mandu/guard-stats.json";
const MAX_RECORDS = 100;

/**
 * 통계 저장소 로드
 */
export async function loadStatistics(rootDir: string): Promise<StatisticsStore> {
  const filePath = join(rootDir, STATS_FILE);

  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {
      version: 1,
      records: [],
      lastUpdated: Date.now(),
    };
  }
}

/**
 * 통계 저장소 저장
 */
export async function saveStatistics(
  rootDir: string,
  store: StatisticsStore
): Promise<void> {
  const filePath = join(rootDir, STATS_FILE);

  // 디렉토리 생성
  await mkdir(dirname(filePath), { recursive: true });

  // 레코드 수 제한
  if (store.records.length > MAX_RECORDS) {
    store.records = store.records.slice(-MAX_RECORDS);
  }

  store.lastUpdated = Date.now();

  await writeFile(filePath, JSON.stringify(store, null, 2));
}

/**
 * 스캔 기록 추가
 */
export async function addScanRecord(
  rootDir: string,
  record: ScanRecord
): Promise<void> {
  const store = await loadStatistics(rootDir);
  store.records.push(record);
  await saveStatistics(rootDir, store);
}

// ═══════════════════════════════════════════════════════════════════════════
// Report Generation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 마크다운 리포트 생성 (Guard Report)
 */
export function generateGuardMarkdownReport(
  report: ViolationReport,
  trend?: TrendAnalysis | null,
  layerStats?: LayerStatistics[]
): string {
  const lines: string[] = [];

  lines.push("# 🛡️ Mandu Guard Report");
  lines.push("");
  lines.push(`*Generated: ${new Date().toISOString()}*`);
  lines.push("");

  // 요약
  lines.push("## 📊 Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Files Analyzed | ${report.filesAnalyzed} |`);
  lines.push(`| Total Violations | ${report.totalViolations} |`);
  lines.push(`| Errors | ${report.bySeverity.error} |`);
  lines.push(`| Warnings | ${report.bySeverity.warn} |`);
  lines.push(`| Info | ${report.bySeverity.info} |`);
  lines.push(`| Analysis Time | ${report.analysisTime}ms |`);
  lines.push("");

  // 트렌드
  if (trend) {
    lines.push("## 📈 Trend Analysis");
    lines.push("");

    const trendEmoji =
      trend.trend === "improving"
        ? "📉"
        : trend.trend === "degrading"
        ? "📈"
        : "➡️";

    lines.push(`**Status:** ${trendEmoji} ${trend.trend.toUpperCase()}`);
    lines.push("");
    lines.push(`- Violation change: ${trend.violationDelta >= 0 ? "+" : ""}${trend.violationDelta}`);
    lines.push(`- Change rate: ${trend.violationChangePercent >= 0 ? "+" : ""}${trend.violationChangePercent}%`);
    lines.push(`- Period: ${trend.period.days} days`);
    lines.push("");

    if (trend.recommendations.length > 0) {
      lines.push("### 💡 Recommendations");
      lines.push("");
      for (const rec of trend.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push("");
    }
  }

  // 레이어 통계
  if (layerStats && layerStats.length > 0) {
    lines.push("## 🏗️ Layer Health");
    lines.push("");
    lines.push(`| Layer | Health | Violations | Top Target |`);
    lines.push(`|-------|--------|------------|------------|`);

    for (const stat of layerStats) {
      const healthEmoji =
        stat.healthScore >= 80
          ? "🟢"
          : stat.healthScore >= 50
          ? "🟡"
          : "🔴";

      const topTarget = stat.topTargets[0];
      const topTargetStr = topTarget ? `${topTarget.layer} (${topTarget.count})` : "-";

      lines.push(
        `| ${stat.name} | ${healthEmoji} ${stat.healthScore}% | ${stat.asSource} | ${topTargetStr} |`
      );
    }
    lines.push("");
  }

  // 위반 상세
  if (report.violations.length > 0) {
    lines.push("## ❌ Violations");
    lines.push("");

    // 타입별 그룹화
    const byType = new Map<ViolationType, Violation[]>();
    for (const v of report.violations) {
      if (!byType.has(v.type)) {
        byType.set(v.type, []);
      }
      byType.get(v.type)!.push(v);
    }

    for (const [type, violations] of byType) {
      lines.push(`### ${getTypeTitle(type)} (${violations.length})`);
      lines.push("");

      for (const v of violations.slice(0, 10)) {
        lines.push(`- **${v.filePath}:${v.line}**`);
        lines.push(`  - \`${v.fromLayer}\` → \`${v.toLayer}\``);
        lines.push(`  - ${v.importStatement}`);
        if (v.suggestions.length > 0) {
          lines.push(`  - 💡 ${v.suggestions[0]}`);
        }
        lines.push("");
      }

      if (violations.length > 10) {
        lines.push(`*... and ${violations.length - 10} more*`);
        lines.push("");
      }
    }
  }

  // 결론
  lines.push("---");
  lines.push("");

  if (report.totalViolations === 0) {
    lines.push("✅ **All clear!** No architecture violations detected.");
  } else if (report.bySeverity.error > 0) {
    lines.push(`❌ **Action required:** ${report.bySeverity.error} error(s) must be fixed.`);
  } else {
    lines.push(`⚠️ **Review needed:** ${report.totalViolations} issue(s) found.`);
  }

  return lines.join("\n");
}

/**
 * HTML 리포트 생성
 */
export function generateHTMLReport(
  report: ViolationReport,
  trend?: TrendAnalysis | null,
  layerStats?: LayerStatistics[]
): string {
  const markdown = generateGuardMarkdownReport(report, trend, layerStats);

  // 간단한 마크다운 → HTML 변환
  let html = markdown
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match
        .split("|")
        .filter((c) => c.trim())
        .map((c) => `<td>${c.trim()}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Mandu Guard Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem;
      background: #f5f5f5;
    }
    h1 { color: #333; border-bottom: 2px solid #0066cc; }
    h2 { color: #0066cc; margin-top: 2rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #ddd; }
    code { background: #f0f0f0; padding: 0.2rem 0.4rem; border-radius: 3px; }
    li { margin: 0.5rem 0; }
    .summary { background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
  </style>
</head>
<body>
  <div class="summary">
    ${html}
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function generateId(): string {
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getTypeTitle(type: ViolationType): string {
  switch (type) {
    case "layer-violation":
      return "Layer Violations";
    case "circular-dependency":
      return "Circular Dependencies";
    case "cross-slice":
      return "Cross-Slice Dependencies";
    case "deep-nesting":
      return "Deep Nesting";
    case "file-type":
      return "File Type Violations";
    case "invalid-shared-segment":
      return "Shared Segment Violations";
    default:
      return "Violations";
  }
}
