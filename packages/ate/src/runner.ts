import { spawn, execFileSync } from "node:child_process";
import { join } from "node:path";
import { getAtePaths, ensureDir, writeJson } from "./fs";
import type { RunInput } from "./types";

/**
 * bunx 또는 bun x 중 사용 가능한 실행 명령을 반환한다.
 */
function resolveBunx(): { cmd: string; args: string[] } {
  try {
    execFileSync("bunx", ["--version"], { stdio: "ignore" });
    return { cmd: "bunx", args: [] };
  } catch {
    return { cmd: "bun", args: ["x"] };
  }
}

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

  const { cmd, args: prefixArgs } = resolveBunx();

  let child;
  try {
    child = spawn(cmd, [...prefixArgs, ...args], {
      cwd: repoRoot,
      stdio: "inherit",
      env,
    });
  } catch (err: unknown) {
    throw new Error(`Playwright 프로세스 시작 실패 (${cmd}): ${err instanceof Error ? err.message : String(err)}`);
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
      // spawn 자체 실패는 환경 문제 — 테스트 실패와 구분하기 위해 명시적 에러
      reject(new Error(`Playwright 실행기 오류 (환경 문제): ${err.message}`));
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
