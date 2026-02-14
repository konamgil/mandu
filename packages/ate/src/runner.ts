import { spawn } from "node:child_process";
import { join } from "node:path";
import { getAtePaths, ensureDir, writeJson } from "./fs";
import type { RunInput } from "./types";

export interface RunResult {
  runId: string;
  reportDir: string;
  exitCode: number;
  jsonReportPath?: string;
  junitPath?: string;
}

function nowRunId(): string {
  return `run-${Date.now()}`;
}

export async function runPlaywright(input: RunInput): Promise<RunResult> {
  const repoRoot = input.repoRoot;
  const paths = getAtePaths(repoRoot);
  const runId = nowRunId();

  const runDir = join(paths.reportsDir, runId);
  const latestDir = join(paths.reportsDir, "latest");
  ensureDir(runDir);
  ensureDir(latestDir);

  const baseURL = input.baseURL ?? process.env.BASE_URL ?? "http://localhost:3333";

  const args = [
    "playwright",
    "test",
    "--config",
    "tests/e2e/playwright.config.ts",
  ];

  const env = {
    ...process.env,
    CI: input.ci ? "true" : process.env.CI,
    BASE_URL: baseURL,
  };

  const child = spawn("bunx", args, {
    cwd: repoRoot,
    stdio: "inherit",
    env,
  });

  const exitCode: number = await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
  });

  const result: RunResult = {
    runId,
    reportDir: runDir,
    exitCode,
    jsonReportPath: join(latestDir, "playwright-report.json"),
    junitPath: join(latestDir, "junit.xml"),
  };

  // record minimal run metadata
  writeJson(join(runDir, "run.json"), { ...result, baseURL, at: new Date().toISOString() });

  return result;
}
