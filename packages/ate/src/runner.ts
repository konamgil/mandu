import { spawn, execFileSync } from "node:child_process";
import { isAbsolute, join, relative } from "node:path";
import { getAtePaths, ensureDir, writeJson } from "./fs";
import { indexSpecs, specsForRouteId } from "./spec-indexer";
import type { RunInput } from "./types";

/**
 * Issue #237 — resolve `onlyFiles` + `onlyRoutes` into a deduped set
 * of Playwright positional args.
 *
 * `onlyFiles` are normalized to `repoRoot`-relative, forward-slash paths
 * so Playwright's matcher (which is relative-only) behaves identically
 * on Windows + POSIX.
 *
 * `onlyRoutes` are resolved through the existing Phase A.1 spec-indexer.
 * Route ids with no matching spec emit a warning to `stderr` but never
 * fail the run; the remaining ids continue.
 *
 * Returns `{ files, warnings }`. An empty `files` means "no filter" and
 * Playwright picks up every spec in its config.
 */
export function resolveRunFilter(
  repoRoot: string,
  input: Pick<RunInput, "onlyFiles" | "onlyRoutes">,
): { files: string[]; warnings: string[] } {
  const seen = new Set<string>();
  const files: string[] = [];
  const warnings: string[] = [];

  const addFile = (raw: string) => {
    const rel = isAbsolute(raw) ? relative(repoRoot, raw) : raw;
    const normalized = rel.replace(/\\/g, "/");
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    files.push(normalized);
  };

  for (const f of input.onlyFiles ?? []) {
    if (typeof f === "string" && f.trim().length > 0) {
      addFile(f.trim());
    }
  }

  if (input.onlyRoutes && input.onlyRoutes.length > 0) {
    // Index only once — spec-indexer is in-memory but we're paying a
    // glob + readFile per spec. One call suffices for a list of route ids.
    const index = indexSpecs(repoRoot);
    for (const routeId of input.onlyRoutes) {
      const matches = specsForRouteId(index, routeId);
      if (matches.length === 0) {
        warnings.push(
          `onlyRoutes: no spec found for routeId '${routeId}' (skipped)`,
        );
        continue;
      }
      for (const m of matches) addFile(m.path);
    }
  }

  return { files, warnings };
}

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

  // Issue #237 — spec / route filtering.
  //
  // Old behavior (pre-#237): `onlyRoutes` was shoved into `--grep`,
  // which failed as soon as a route id didn't appear verbatim in the
  // spec's `test(...)` title. The new flow resolves both surfaces
  // into concrete spec file paths via the spec-indexer (routeId →
  // spec), then hands the deduped union to Playwright as positional
  // `<file>` args. `grep` remains a pass-through for per-title
  // filtering on top of the file set.
  const filter = resolveRunFilter(repoRoot, {
    onlyFiles: input.onlyFiles,
    onlyRoutes: input.onlyRoutes,
  });
  for (const w of filter.warnings) {
    // Warnings are advisory — surface them on stderr so the caller
    // sees them in the captured tail without failing the run.
    console.warn(`[ATE] ${w}`);
  }
  for (const file of filter.files) {
    args.push(file);
  }
  if (typeof input.grep === "string" && input.grep.trim().length > 0) {
    args.push("--grep", input.grep.trim());
  }

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
