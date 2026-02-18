import { theme } from "../terminal";
import { ateExtract, ateGenerate, ateRun, ateReport, ateImpact } from "@mandujs/ate";

function jsonOut(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

export async function testAuto(opts: { ci?: boolean; impact?: boolean; baseURL?: string } = {}): Promise<boolean> {
  const repoRoot = process.cwd();
  const oracleLevel = "L0" as const;

  try {
    // 1) extract
    const extractRes = await ateExtract({ repoRoot });

    // 2) impact subset (optional)
    let onlyRoutes: string[] | undefined;
    let impactInfo: { mode: "full" | "subset"; changedFiles: string[]; selectedRoutes: string[] } = { mode: "full", changedFiles: [], selectedRoutes: [] };
    if (opts.impact) {
      const impactRes = await ateImpact({ repoRoot });
      onlyRoutes = impactRes.selectedRoutes.length ? impactRes.selectedRoutes : undefined;
      impactInfo = {
        mode: onlyRoutes ? "subset" : "full",
        changedFiles: impactRes.changedFiles,
        selectedRoutes: impactRes.selectedRoutes,
      };
    }

    // 3) generate
    const genRes = await ateGenerate({ repoRoot, oracleLevel, onlyRoutes });

    // 4) run
    const runRes = await ateRun({ repoRoot, ci: opts.ci, headless: opts.ci, baseURL: opts.baseURL });

    // 5) report
    const repRes = await ateReport({
      repoRoot,
      runId: runRes.runId,
      startedAt: runRes.startedAt,
      finishedAt: runRes.finishedAt,
      exitCode: runRes.exitCode,
      oracleLevel,
      impact: impactInfo,
    });

    jsonOut({
      ok: repRes.summary.ok,
      extract: extractRes,
      generate: genRes,
      run: { runId: runRes.runId, exitCode: runRes.exitCode },
      report: { summaryPath: repRes.summaryPath },
    });

    return repRes.summary.ok;
  } catch (err) {
    console.error(theme.error("ATE test:auto failed"), err);
    return false;
  }
}
