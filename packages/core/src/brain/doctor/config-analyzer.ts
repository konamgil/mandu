/**
 * Brain Config Analyzer - Lockfile 불일치 원인 분석
 *
 * 설정 변경 사항을 분석하고 원인과 해결책을 제안
 *
 * @see docs/plans/09_lockfile_integration_plan.md
 */

import type { ConfigDiff } from "../../utils/differ";
import type { LLMAdapter } from "../adapters/base";

/**
 * 변경 항목 (내부용)
 */
interface ChangeItem {
  path: string;
  value?: unknown;
  oldValue?: unknown;
  newValue?: unknown;
}

// ============================================
// 타입
// ============================================

export type ConfigIssueCategory =
  | "security"   // 민감정보 변경
  | "mcp"        // MCP 서버 설정 변경
  | "server"     // 서버 설정 변경
  | "guard"      // Guard 설정 변경
  | "general";   // 일반 변경

export type ConfigIssueSeverity = "low" | "medium" | "high" | "critical";

export interface ConfigMismatchAnalysis {
  /** 변경 카테고리 */
  category: ConfigIssueCategory;
  /** 심각도 */
  severity: ConfigIssueSeverity;
  /** 변경된 필드 경로 */
  path: string;
  /** 근본 원인 설명 */
  rootCause: string;
  /** 제안 사항 */
  suggestions: string[];
  /** 자동 수정 가능 여부 */
  autoFixable: boolean;
}

export interface ConfigAnalysisReport {
  /** 전체 분석 결과 */
  analyses: ConfigMismatchAnalysis[];
  /** 요약 */
  summary: string;
  /** 권장 조치 */
  recommendedAction: "update-lockfile" | "revert-config" | "review-required";
  /** 분석 시각 */
  timestamp: string;
}

// ============================================
// 카테고리 판별
// ============================================

const SENSITIVE_PATTERNS = [
  /apikey/i,
  /secret/i,
  /token/i,
  /password/i,
  /credential/i,
  /auth/i,
  /private/i,
];

const MCP_PATTERNS = [
  /^mcpServers/,
  /^mcp\./,
];

const SERVER_PATTERNS = [
  /^server\./,
  /^port$/,
  /^host$/,
];

const GUARD_PATTERNS = [
  /^guard\./,
  /^preset$/,
];

/**
 * 변경 경로에서 카테고리 판별
 */
function categorizeChange(path: string): ConfigIssueCategory {
  if (SENSITIVE_PATTERNS.some(p => p.test(path))) {
    return "security";
  }
  if (MCP_PATTERNS.some(p => p.test(path))) {
    return "mcp";
  }
  if (SERVER_PATTERNS.some(p => p.test(path))) {
    return "server";
  }
  if (GUARD_PATTERNS.some(p => p.test(path))) {
    return "guard";
  }
  return "general";
}

/**
 * 카테고리별 기본 심각도
 */
function getDefaultSeverity(category: ConfigIssueCategory): ConfigIssueSeverity {
  switch (category) {
    case "security":
      return "critical";
    case "mcp":
      return "medium";
    case "server":
      return "medium";
    case "guard":
      return "low";
    case "general":
      return "low";
  }
}

// ============================================
// 분석 함수
// ============================================

/**
 * 단일 변경 분석
 */
function analyzeChange(
  change: ChangeItem,
  changeType: "added" | "modified" | "removed"
): ConfigMismatchAnalysis {
  const category = categorizeChange(change.path);
  const severity = getDefaultSeverity(category);

  const suggestions = generateSuggestionsForPath(category, change.path, changeType);
  const rootCause = generateRootCauseForPath(category, change.path, changeType);

  return {
    category,
    severity,
    path: change.path,
    rootCause,
    suggestions,
    autoFixable: category === "general",
  };
}

/**
 * 근본 원인 생성
 */
function generateRootCauseForPath(
  category: ConfigIssueCategory,
  path: string,
  changeType: "added" | "modified" | "removed"
): string {
  const action = changeType === "added"
    ? "추가되었습니다"
    : changeType === "removed"
    ? "삭제되었습니다"
    : "변경되었습니다";

  switch (category) {
    case "security":
      return `민감 정보 필드 '${path}'가 ${action}. 보안 검토가 필요합니다.`;

    case "mcp":
      return `MCP 서버 설정 '${path}'가 ${action}. AI 에이전트 통합에 영향을 줄 수 있습니다.`;

    case "server":
      return `서버 설정 '${path}'가 ${action}. 배포 환경에 영향을 줄 수 있습니다.`;

    case "guard":
      return `Guard 설정 '${path}'가 ${action}. 아키텍처 검증 규칙이 변경됩니다.`;

    case "general":
    default:
      return `설정 '${path}'가 ${action}.`;
  }
}

/**
 * 제안 사항 생성
 */
function generateSuggestionsForPath(
  category: ConfigIssueCategory,
  path: string,
  changeType: "added" | "modified" | "removed"
): string[] {
  const suggestions: string[] = [];

  switch (category) {
    case "security":
      suggestions.push("민감 정보는 환경 변수를 통해 주입하는 것을 권장합니다.");
      suggestions.push(".env 파일에 보관하고 .gitignore에 추가하세요.");
      suggestions.push("의도한 변경이라면 보안 검토 후 'mandu lock'을 실행하세요.");
      break;

    case "mcp":
      suggestions.push("MCP 서버 설정 변경 시 에이전트 연결을 확인하세요.");
      if (changeType === "added") {
        suggestions.push("새 MCP 서버가 정상적으로 연결되는지 확인하세요.");
      } else if (changeType === "removed") {
        suggestions.push("삭제된 MCP 서버를 사용하는 기능이 없는지 확인하세요.");
      }
      suggestions.push("의도한 변경이라면 'mandu lock'을 실행하세요.");
      break;

    case "server":
      suggestions.push("서버 설정 변경 시 배포 환경과의 호환성을 확인하세요.");
      if (path.includes("port")) {
        suggestions.push("포트 변경 시 방화벽 규칙도 업데이트하세요.");
      }
      suggestions.push("의도한 변경이라면 'mandu lock'을 실행하세요.");
      break;

    case "guard":
      suggestions.push("Guard 설정 변경 시 기존 코드가 새 규칙을 위반하지 않는지 확인하세요.");
      suggestions.push("'mandu guard'를 실행하여 위반 사항을 확인하세요.");
      suggestions.push("의도한 변경이라면 'mandu lock'을 실행하세요.");
      break;

    case "general":
    default:
      suggestions.push("의도한 변경이라면 'mandu lock'을 실행하세요.");
      suggestions.push("의도하지 않은 변경이라면 설정을 원복하세요.");
      break;
  }

  return suggestions;
}

// ============================================
// 메인 분석 함수
// ============================================

/**
 * 설정 불일치 분석 (템플릿 기반)
 *
 * @param diff 설정 차이
 * @returns 분석 보고서
 *
 * @example
 * ```typescript
 * const diff = diffConfig(oldConfig, newConfig);
 * const report = analyzeConfigMismatch(diff);
 * console.log(report.summary);
 * ```
 */
export function analyzeConfigMismatch(diff: ConfigDiff): ConfigAnalysisReport {
  const analyses: ConfigMismatchAnalysis[] = [];

  // MCP 서버 변경 분석
  for (const name of diff.mcpServers.added) {
    analyses.push(analyzeChange({ path: `mcpServers.${name}` }, "added"));
  }
  for (const name of diff.mcpServers.removed) {
    analyses.push(analyzeChange({ path: `mcpServers.${name}` }, "removed"));
  }
  for (const item of diff.mcpServers.modified) {
    analyses.push(analyzeChange({ path: `mcpServers.${item.name}` }, "modified"));
  }

  // 프로젝트 설정 변경 분석
  for (const path of diff.projectConfig.added) {
    analyses.push(analyzeChange({ path }, "added"));
  }
  for (const path of diff.projectConfig.removed) {
    analyses.push(analyzeChange({ path }, "removed"));
  }
  for (const item of diff.projectConfig.modified) {
    analyses.push(analyzeChange({ path: item.key }, "modified"));
  }

  // 심각도별 정렬 (critical > high > medium > low)
  const severityOrder: Record<ConfigIssueSeverity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  analyses.sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity]);

  // 요약 생성
  const summary = generateSummary(analyses);

  // 권장 조치 결정
  const recommendedAction = determineRecommendedAction(analyses);

  return {
    analyses,
    summary,
    recommendedAction,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 요약 생성
 */
function generateSummary(analyses: ConfigMismatchAnalysis[]): string {
  if (analyses.length === 0) {
    return "변경 사항이 없습니다.";
  }

  const bySeverity = {
    critical: analyses.filter(a => a.severity === "critical").length,
    high: analyses.filter(a => a.severity === "high").length,
    medium: analyses.filter(a => a.severity === "medium").length,
    low: analyses.filter(a => a.severity === "low").length,
  };

  const parts: string[] = [];
  if (bySeverity.critical > 0) parts.push(`심각 ${bySeverity.critical}개`);
  if (bySeverity.high > 0) parts.push(`높음 ${bySeverity.high}개`);
  if (bySeverity.medium > 0) parts.push(`중간 ${bySeverity.medium}개`);
  if (bySeverity.low > 0) parts.push(`낮음 ${bySeverity.low}개`);

  return `총 ${analyses.length}개 변경 감지 (${parts.join(", ")})`;
}

/**
 * 권장 조치 결정
 */
function determineRecommendedAction(
  analyses: ConfigMismatchAnalysis[]
): "update-lockfile" | "revert-config" | "review-required" {
  const hasCritical = analyses.some(a => a.severity === "critical");
  const hasHigh = analyses.some(a => a.severity === "high");
  const hasSecurity = analyses.some(a => a.category === "security");

  if (hasCritical || hasSecurity) {
    return "review-required";
  }

  if (hasHigh) {
    return "review-required";
  }

  // 모두 자동 수정 가능하면 lockfile 업데이트
  if (analyses.every(a => a.autoFixable)) {
    return "update-lockfile";
  }

  return "review-required";
}

// ============================================
// 포맷팅
// ============================================

/**
 * 분석 보고서를 콘솔 출력용 문자열로 변환
 */
export function formatConfigAnalysisReport(report: ConfigAnalysisReport): string {
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════");
  lines.push("🩺 Config Mismatch Analysis");
  lines.push("═══════════════════════════════════════");
  lines.push("");
  lines.push(`📊 ${report.summary}`);
  lines.push("");

  if (report.analyses.length > 0) {
    lines.push("변경 사항:");
    lines.push("───────────────────────────────────────");

    for (const analysis of report.analyses) {
      const icon = getSeverityIcon(analysis.severity);
      lines.push(`${icon} [${analysis.category.toUpperCase()}] ${analysis.path}`);
      lines.push(`   ${analysis.rootCause}`);

      if (analysis.suggestions.length > 0) {
        lines.push(`   제안:`);
        for (const suggestion of analysis.suggestions.slice(0, 2)) {
          lines.push(`     • ${suggestion}`);
        }
      }
      lines.push("");
    }
  }

  lines.push("───────────────────────────────────────");
  lines.push(`권장 조치: ${formatRecommendedAction(report.recommendedAction)}`);

  return lines.join("\n");
}

function getSeverityIcon(severity: ConfigIssueSeverity): string {
  switch (severity) {
    case "critical": return "🚨";
    case "high": return "🔴";
    case "medium": return "🟡";
    case "low": return "🟢";
  }
}

function formatRecommendedAction(
  action: "update-lockfile" | "revert-config" | "review-required"
): string {
  switch (action) {
    case "update-lockfile":
      return "'mandu lock'을 실행하여 lockfile을 업데이트하세요.";
    case "revert-config":
      return "설정을 이전 상태로 원복하세요.";
    case "review-required":
      return "변경 사항을 검토한 후 적절한 조치를 취하세요.";
  }
}

// ============================================
// LLM 기반 분석 (선택적)
// ============================================

/**
 * LLM을 사용한 심층 분석
 *
 * @param diff 설정 차이
 * @param adapter LLM 어댑터
 * @returns 분석 보고서
 */
export async function analyzeConfigMismatchWithLLM(
  diff: ConfigDiff,
  adapter: LLMAdapter
): Promise<ConfigAnalysisReport> {
  // 기본 템플릿 분석 수행
  const baseReport = analyzeConfigMismatch(diff);

  // LLM 사용 불가 시 기본 보고서 반환
  const status = await adapter.checkStatus();
  if (!status.available) {
    return baseReport;
  }

  // LLM 프롬프트 생성
  const prompt = buildConfigAnalysisPrompt(diff, baseReport);

  try {
    const messages = [{ role: "user" as const, content: prompt }];
    const response = await adapter.complete(messages);

    // LLM 응답 파싱 및 병합
    const content = response.content ?? "";
    return mergeWithLLMAnalysis(baseReport, content);
  } catch {
    // LLM 분석 실패 시 기본 보고서 반환
    return baseReport;
  }
}

function buildConfigAnalysisPrompt(diff: ConfigDiff, baseReport: ConfigAnalysisReport): string {
  const mcpAdded = diff.mcpServers.added.map(n => `- mcpServers.${n}`).join("\n") || "없음";
  const mcpRemoved = diff.mcpServers.removed.map(n => `- mcpServers.${n}`).join("\n") || "없음";
  const mcpModified = diff.mcpServers.modified.map(m => `- mcpServers.${m.name}`).join("\n") || "없음";

  const configAdded = diff.projectConfig.added.map(p => `- ${p}`).join("\n") || "없음";
  const configRemoved = diff.projectConfig.removed.map(p => `- ${p}`).join("\n") || "없음";
  const configModified = diff.projectConfig.modified.map(m => `- ${m.key}`).join("\n") || "없음";

  return `다음 설정 변경 사항을 분석하고 추가 인사이트를 제공해주세요.

변경 요약: ${baseReport.summary}

MCP 서버 변경:
- 추가: ${mcpAdded}
- 삭제: ${mcpRemoved}
- 수정: ${mcpModified}

프로젝트 설정 변경:
- 추가: ${configAdded}
- 삭제: ${configRemoved}
- 수정: ${configModified}

다음을 분석해주세요:
1. 이 변경이 시스템에 미칠 수 있는 영향
2. 잠재적인 문제점
3. 추가 제안 사항

응답은 간결하게 해주세요.`;
}

function mergeWithLLMAnalysis(
  baseReport: ConfigAnalysisReport,
  llmResponse: string
): ConfigAnalysisReport {
  // LLM 응답을 요약에 추가
  return {
    ...baseReport,
    summary: `${baseReport.summary}\n\n🤖 AI 분석: ${llmResponse.slice(0, 200)}...`,
  };
}
