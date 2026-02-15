import { join } from "node:path";
import { getAtePaths, ensureDir, writeJson } from "./fs";
import { createDefaultOracle } from "./oracle";
import type { SummaryJson, OracleLevel } from "./types";
import { generateHtmlReport, type HtmlReportOptions } from "./reporter/html";

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
  } catch (err: any) {
    throw new Error(`Oracle 생성 실패: ${err.message}`);
  }

  return {
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
  } catch (err: any) {
    throw new Error(`Report 디렉토리 생성 실패: ${err.message}`);
  }

  const outPath = join(runDir, "summary.json");

  try {
    writeJson(outPath, summary);
  } catch (err: any) {
    throw new Error(`Summary 파일 저장 실패: ${err.message}`);
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
    } catch (err: any) {
      throw new Error(`HTML 리포트 생성 실패: ${err.message}`);
    }
  }

  return result;
}
