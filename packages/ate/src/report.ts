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
  const paths = getAtePaths(params.repoRoot);
  const oracle = createDefaultOracle(params.oracleLevel);

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
  const paths = getAtePaths(repoRoot);
  const runDir = join(paths.reportsDir, runId);
  ensureDir(runDir);
  const outPath = join(runDir, "summary.json");
  writeJson(outPath, summary);
  return outPath;
}
