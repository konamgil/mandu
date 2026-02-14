import { join } from "node:path";
import { getAtePaths, ensureDir, writeJson } from "./fs";
import { createDefaultOracle } from "./oracle";
import type { SummaryJson, OracleLevel } from "./types";

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
