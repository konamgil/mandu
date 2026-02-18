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

  // Validate input
  if (!repoRoot) {
    throw new Error("repoRoot는 필수입니다");
  }

  const runDir = join(paths.reportsDir, runId);
  const latestDir = join(paths.reportsDir, "latest");

  try {
    ensureDir(runDir);
    ensureDir(latestDir);
  } catch (err: unknown) {
    throw new Error(`Report 디렉토리 생성 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

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

  let child;
  try {
    child = spawn("bunx", args, {
      cwd: repoRoot,
      stdio: "inherit",
      env,
    });
  } catch (err: unknown) {
    throw new Error(`Playwright 프로세스 시작 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  const exitCode: number = await new Promise((resolve, reject) => {
    // Timeout protection (10 minutes)
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Playwright 실행 타임아웃 (10분 초과)"));
    }, 10 * 60 * 1000);

    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve(code ?? 1);
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      console.error(`[ATE] Playwright 실행 에러: ${err.message}`);
      resolve(1); // Fail gracefully
    });
  });

  const result: RunResult = {
    runId,
    reportDir: runDir,
    exitCode,
    jsonReportPath: join(latestDir, "playwright-report.json"),
    junitPath: join(latestDir, "junit.xml"),
  };

  // record minimal run metadata
  try {
    writeJson(join(runDir, "run.json"), { ...result, baseURL, at: new Date().toISOString() });
  } catch (err: unknown) {
    console.warn(`[ATE] Run metadata 저장 실패: ${err instanceof Error ? err.message : String(err)}`);
    // Non-fatal: continue
  }

  return result;
}
