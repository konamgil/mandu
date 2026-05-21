import { join } from "node:path";
import { getAtePaths, ensureDir, writeJson } from "./fs";
import { createDefaultOracle } from "./oracle";
import type { SummaryJson, OracleLevel } from "./types";
import { generateHtmlReport } from "./reporter/html";

export interface QualityScore {
  score: number;
  grade: "pass" | "warn" | "fail";
  signals: string[];
}

export interface QualityScoreComparison {
  beforeScore: number;
  afterScore: number;
  delta: number;
  verdict: "improved" | "regressed" | "unchanged";
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function gradeScore(score: number): QualityScore["grade"] {
  if (score >= 85) return "pass";
  if (score >= 60) return "warn";
  return "fail";
}

export function computeQualityScore(summary: Pick<SummaryJson, "ok" | "oracle" | "heal" | "impact">): QualityScore {
  const signals: string[] = [];
  let score = summary.ok ? 50 : 10;
  signals.push(summary.ok ? "test runner passed" : "test runner failed");

  const oracleSignals = [
    ["L0 smoke oracle", summary.oracle.l0.ok],
    ["L1 structure oracle", summary.oracle.l1.ok],
    ["L2 contract oracle", summary.oracle.l2.ok],
    ["L3 behavior oracle", summary.oracle.l3.ok],
  ] as const;

  for (const [label, ok] of oracleSignals) {
    if (ok) {
      score += 10;
      signals.push(`${label} passed`);
    } else {
      signals.push(`${label} did not pass`);
    }
  }

  if (summary.impact.mode === "subset" && summary.impact.selectedRoutes.length > 0) {
    score += 5;
    signals.push("impact-scoped route subset selected");
  }

  if (summary.heal.attempted && summary.heal.suggestions.length === 0) {
    score += 5;
    signals.push("no heal suggestions required");
  } else if (summary.heal.suggestions.length > 0) {
    signals.push(`${summary.heal.suggestions.length} heal suggestion(s) pending`);
  }

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    grade: gradeScore(finalScore),
    signals,
  };
}

export function compareQualityScores(
  before: Pick<SummaryJson, "quality"> | number,
  after: Pick<SummaryJson, "quality"> | number,
): QualityScoreComparison {
  const beforeScore = typeof before === "number" ? before : before.quality?.score ?? 0;
  const afterScore = typeof after === "number" ? after : after.quality?.score ?? 0;
  const delta = afterScore - beforeScore;
  return {
    beforeScore,
    afterScore,
    delta,
    verdict: delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged",
  };
}

export function composeSummary(params: {
  repoRoot: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  oracleLevel: OracleLevel;
  impact?: { changedFiles: string[]; selectedRoutes: string[]; mode: "full" | "subset" };
  heal?: { suggestions: Array<{ kind: string; title: string; diff: string }> };
}): SummaryJson {
  // Validate required params
  if (!params.repoRoot) {
    throw new Error("repoRoot는 필수입니다");
  }
  if (!params.runId) {
    throw new Error("runId는 필수입니다");
  }

  const paths = getAtePaths(params.repoRoot);

  let oracle;
  try {
    oracle = createDefaultOracle(params.oracleLevel);
  } catch (err: unknown) {
    throw new Error(`Oracle 생성 실패: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  const summary: SummaryJson = {
    schemaVersion: 1,
    runId: params.runId,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    ok: params.exitCode === 0,
    oracle,
    playwright: {
      exitCode: params.exitCode,
      reportDir: join(paths.reportsDir, params.runId),
      jsonReportPath: join(paths.reportsDir, "latest", "playwright-report.json"),
      junitPath: join(paths.reportsDir, "latest", "junit.xml"),
    },
    mandu: {
      interactionGraphPath: paths.interactionGraphPath,
      selectorMapPath: paths.selectorMapPath,
      scenariosPath: paths.scenariosPath,
    },
    heal: {
      attempted: true,
      suggestions: params.heal?.suggestions ?? [],
    },
    impact: params.impact ?? {
      mode: "full",
      changedFiles: [],
      selectedRoutes: [],
    },
  };

  summary.quality = computeQualityScore(summary);
  return summary;
}

export function writeSummary(repoRoot: string, runId: string, summary: SummaryJson): string {
  if (!repoRoot) {
    throw new Error("repoRoot는 필수입니다");
  }
  if (!runId) {
    throw new Error("runId는 필수입니다");
  }

  const paths = getAtePaths(repoRoot);
  const runDir = join(paths.reportsDir, runId);

  try {
    ensureDir(runDir);
  } catch (err: unknown) {
    throw new Error(`Report 디렉토리 생성 실패: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  const outPath = join(runDir, "summary.json");

  try {
    writeJson(outPath, summary);
  } catch (err: unknown) {
    throw new Error(`Summary 파일 저장 실패: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  return outPath;
}

export type ReportFormat = "json" | "html" | "both";

export interface GenerateReportOptions {
  repoRoot: string;
  runId: string;
  format?: ReportFormat;
  includeScreenshots?: boolean;
  includeTraces?: boolean;
}

export async function generateReport(options: GenerateReportOptions): Promise<{ json?: string; html?: string }> {
  const { repoRoot, runId, format = "both", includeScreenshots = true, includeTraces = true } = options;

  const result: { json?: string; html?: string } = {};

  // JSON은 이미 writeSummary로 생성되었다고 가정
  if (format === "json" || format === "both") {
    const paths = getAtePaths(repoRoot);
    result.json = join(paths.reportsDir, runId, "summary.json");
  }

  // HTML 생성
  if (format === "html" || format === "both") {
    try {
      const htmlResult = await generateHtmlReport({
        repoRoot,
        runId,
        includeScreenshots,
        includeTraces,
      });
      result.html = htmlResult.path;
    } catch (err: unknown) {
      throw new Error(`HTML 리포트 생성 실패: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  }

  return result;
}
