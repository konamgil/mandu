import { existsSync, readFileSync } from "node:fs";
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

  const jsonReportPath = join(paths.reportsDir, "latest", "playwright-report.json");
  const playwrightStats = summarizePlaywrightJson(jsonReportPath);

  const impact = params.impact ?? {
    mode: "full" as const,
    changedFiles: [],
    selectedRoutes: [],
  };

  return {
    schemaVersion: 1,
    runId: params.runId,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    ok: params.exitCode === 0,
    metrics: {
      specsExecuted: playwrightStats?.specsExecuted ?? 0,
      specsFailed: playwrightStats?.specsFailed ?? (params.exitCode === 0 ? 0 : 1),
      selectedRoutes: impact.selectedRoutes.length,
    },
    oracle,
    playwright: {
      exitCode: params.exitCode,
      reportDir: join(paths.reportsDir, params.runId),
      jsonReportPath,
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
    impact,
  };
}

function summarizePlaywrightJson(jsonReportPath: string): null | { specsExecuted: number; specsFailed: number } {
  if (!existsSync(jsonReportPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(jsonReportPath, "utf8")) as any;

    let executed = 0;
    let failed = 0;

    const visit = (node: any) => {
      if (!node || typeof node !== "object") return;

      // Common Playwright JSON shapes contain tests with a status.
      if (typeof node.status === "string") {
        if (["passed", "failed", "skipped", "timedOut", "interrupted"].includes(node.status)) {
          executed += 1;
          if (node.status === "failed" || node.status === "timedOut") failed += 1;
        }
      }

      for (const v of Object.values(node)) {
        if (Array.isArray(v)) v.forEach(visit);
        else visit(v);
      }
    };

    visit(parsed);

    // Some formats duplicate status fields; clamp to sane values.
    if (executed < failed) executed = failed;

    return { specsExecuted: executed, specsFailed: failed };
  } catch {
    return null;
  }
}

export function writeSummary(repoRoot: string, runId: string, summary: SummaryJson): string {
  const paths = getAtePaths(repoRoot);
  const runDir = join(paths.reportsDir, runId);
  ensureDir(runDir);
  const outPath = join(runDir, "summary.json");
  writeJson(outPath, summary);
  return outPath;
}
