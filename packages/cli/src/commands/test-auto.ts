import { theme } from "../terminal";
import { ateExtract, ateGenerate, ateRun, ateReport, ateImpact, ATEFS } from "@mandujs/ate";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { startManagedServer } from "../ate/managed-server";

function jsonOut(obj: unknown) {
  // Stable JSON output: downstream tooling can rely on this shape.
  console.log(JSON.stringify(obj, null, 2));
}

async function runShell(command: string, cwd: string): Promise<{ exitCode: number }> {
  const child = spawn(command, { cwd, shell: true, stdio: "inherit" });
  const exitCode: number = await new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
  return { exitCode };
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  // Bun supports AbortSignal.timeout; Node 18+ does too. Fallback: no timeout.
  const anySig = AbortSignal as any;
  if (typeof anySig?.timeout === "function") return anySig.timeout(ms);
  return undefined;
}

type TestAutoJsonV1 = {
  schemaVersion: 1;
  command: "test:auto";
  ok: boolean;
  repoRoot: string;
  oracleLevel: "L0" | "L1" | "L2" | "L3";
  options: { ci: boolean; impact: boolean; baseURL?: string };
  impact: { mode: "full" | "subset"; changedFiles: string[]; selectedRoutes: string[] };
  extract: { ok: boolean };
  generate: { ok: boolean; scenariosPath?: string; generatedSpecs?: string[] };
  run: { ok: boolean; runId: string; exitCode: number; startedAt: string; finishedAt: string };
  report: { ok: boolean; summaryPath: string };
};

export async function testAuto(
  opts: {
    ci?: boolean;
    impact?: boolean;
    baseURL?: string;

    /** Start a server process and manage its lifecycle around the playwright run. */
    dev?: string;
    start?: string;
    stop?: string;

    /** Health endpoint path for readiness check (default: /api/health). */
    healthPath?: string;
    /** Total readiness wait timeout (ms). */
    readyTimeoutMs?: number;

    /** If the baseURL is already healthy, skip starting a server. */
    reuseExisting?: boolean;
  } = {},
): Promise<boolean> {
  const repoRoot = process.cwd();
  const oracleLevel = "L0" as const;

  // Pre-generate a runId so server logs and playwright artifacts can be correlated.
  const runId = `run-${Date.now()}`;

  try {
    // 1) extract
    await ateExtract({ repoRoot });

    // 2) impact subset (optional)
    let onlyRoutes: string[] | undefined;
    let impactInfo: { mode: "full" | "subset"; changedFiles: string[]; selectedRoutes: string[] } = {
      mode: "full",
      changedFiles: [],
      selectedRoutes: [],
    };
    if (opts.impact) {
      const impactRes = ateImpact({ repoRoot });
      onlyRoutes = impactRes.selectedRoutes.length ? impactRes.selectedRoutes : undefined;
      impactInfo = {
        mode: onlyRoutes ? "subset" : "full",
        changedFiles: impactRes.changedFiles,
        selectedRoutes: impactRes.selectedRoutes,
      };
    }

    // 3) generate
    const genRes = ateGenerate({ repoRoot, oracleLevel, onlyRoutes });

    // 4) run (optionally with managed server lifecycle)
    const baseURL = opts.baseURL ?? process.env.BASE_URL ?? "http://localhost:3333";

    const paths = ATEFS.getAtePaths(repoRoot);
    const runDir = join(paths.reportsDir, runId);
    ATEFS.ensureDir(runDir);

    const shouldManageServer = !!opts.dev || !!opts.start;
    const startCmd = opts.dev ?? opts.start;

    let managed:
      | undefined
      | {
          baseURL: string;
          pid?: number;
          stop: () => Promise<void>;
        };

    if (shouldManageServer && startCmd) {
      // If reuseExisting is enabled and healthcheck passes, skip starting.
      if (opts.reuseExisting) {
        try {
          const healthURL = new URL(opts.healthPath ?? "/api/health", baseURL).toString();
          const res = await fetch(healthURL, { signal: timeoutSignal(1500) });
          if (!res.ok) throw new Error(String(res.status));
        } catch {
          managed = await startManagedServer({
            command: startCmd,
            cwd: repoRoot,
            baseURL,
            healthPath: opts.healthPath,
            readyTimeoutMs: opts.readyTimeoutMs,
            logPath: join(runDir, "server.log"),
          });
        }
      } else {
        managed = await startManagedServer({
          command: startCmd,
          cwd: repoRoot,
          baseURL,
          healthPath: opts.healthPath,
          readyTimeoutMs: opts.readyTimeoutMs,
          logPath: join(runDir, "server.log"),
        });
      }
    }

    let runRes: Awaited<ReturnType<typeof ateRun>>;
    try {
      runRes = await ateRun({
        repoRoot,
        runId,
        ci: opts.ci,
        headless: opts.ci,
        baseURL: managed?.baseURL ?? baseURL,
      });
    } finally {
      // Stop server if we started one.
      if (managed) {
        if (opts.stop) {
          // If explicit stop command is provided, run it (best-effort).
          try {
            await runShell(opts.stop, repoRoot);
          } catch {
            // ignore
          }
        }
        await managed.stop();
      }
    }

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

    const out: TestAutoJsonV1 = {
      schemaVersion: 1,
      command: "test:auto",
      ok: repRes.summary.ok,
      repoRoot,
      oracleLevel,
      options: { ci: !!opts.ci, impact: !!opts.impact, baseURL: opts.baseURL },
      impact: impactInfo,
      extract: { ok: true },
      generate: { ok: !!genRes?.ok, scenariosPath: genRes?.scenariosPath, generatedSpecs: genRes?.generatedSpecs },
      run: {
        ok: !!runRes?.ok,
        runId: runRes.runId,
        exitCode: runRes.exitCode,
        startedAt: runRes.startedAt,
        finishedAt: runRes.finishedAt,
      },
      report: { ok: !!repRes?.ok, summaryPath: repRes.summaryPath },
    };

    jsonOut(out);

    return out.ok;
  } catch (err) {
    console.error(theme.error("ATE test:auto failed"), err);
    return false;
  }
}
