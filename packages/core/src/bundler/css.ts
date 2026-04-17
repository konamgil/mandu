/**
 * Mandu CSS Builder
 * Tailwind CSS v4 CLI 기반 CSS 빌드 및 감시
 *
 * 특징:
 * - Tailwind v4 Oxide Engine (Rust) 사용
 * - Zero Config: @import "tailwindcss" 자동 감지
 * - 출력: .mandu/client/globals.css
 *
 * #152: Tailwind CLI --watch 모드가 Bun.spawn에서 hang되는 문제 수정
 * - 원인: @tailwindcss/cli v4 --watch 모드가 Bun subprocess에서 파일 미생성
 * - 해결: 자체 파일 감시 + 단발 빌드 반복 방식으로 전환
 */

import { spawn } from "bun";
import path from "path";
import fs from "fs/promises";
import { watch as fsWatch, type FSWatcher } from "fs";
import { withPerf } from "../perf";

/**
 * Tailwind CLI 실행 명령어를 결정한다.
 * Windows에서 Bun.spawn은 PATH 기반 명령어 해석이 불안정하므로 (#152)
 * process.execPath (절대 경로)를 사용해 안정적으로 실행한다.
 */
function getTailwindCommand(args: string[]): string[] {
  return [process.execPath, "x", ...args];
}

// ========== Types ==========

export interface CSSBuildOptions {
  /** 프로젝트 루트 디렉토리 */
  rootDir: string;
  /** CSS 입력 파일 (기본: "app/globals.css") */
  input?: string;
  /** CSS 출력 파일 (기본: ".mandu/client/globals.css") */
  output?: string;
  /** Watch 모드 활성화 */
  watch?: boolean;
  /** Minify 활성화 (production) */
  minify?: boolean;
  /** 빌드 완료 콜백 */
  onBuild?: (result: CSSBuildResult) => void;
  /** 에러 콜백 */
  onError?: (error: Error) => void;
}

export interface CSSBuildResult {
  success: boolean;
  outputPath: string;
  buildTime?: number;
  error?: string;
}

export interface CSSWatcher {
  /** 출력 파일 경로 (절대 경로) */
  outputPath: string;
  /** 서버 경로 (/.mandu/client/globals.css) */
  serverPath: string;
  /** 감시 중지 */
  close: () => void;
}

// ========== Constants ==========

const DEFAULT_INPUT = "app/globals.css";
const DEFAULT_OUTPUT = ".mandu/client/globals.css";
const SERVER_CSS_PATH = "/.mandu/client/globals.css";
const CSS_REBUILD_DEBOUNCE = 150; // ms

// ========== Detection ==========

/**
 * Tailwind v4 프로젝트인지 감지
 * app/globals.css에 @import "tailwindcss" 포함 여부 확인
 */
export async function isTailwindProject(rootDir: string): Promise<boolean> {
  const cssPath = path.join(rootDir, DEFAULT_INPUT);

  try {
    const content = await fs.readFile(cssPath, "utf-8");
    return (
      content.includes('@import "tailwindcss"') ||
      content.includes("@import 'tailwindcss'") ||
      content.includes("@tailwind base")
    );
  } catch {
    return false;
  }
}

/**
 * CSS 입력 파일 존재 여부 확인
 */
export async function hasCSSEntry(rootDir: string, input?: string): Promise<boolean> {
  const cssPath = path.join(rootDir, input || DEFAULT_INPUT);
  try {
    await fs.access(cssPath);
    return true;
  } catch {
    return false;
  }
}

// ========== Build ==========

/**
 * CSS 단발 빌드 (--watch 없이)
 * Tailwind CLI --watch가 Bun.spawn에서 hang되므로 (#152) 단발 빌드만 사용
 */
async function runCSSBuild(
  rootDir: string,
  inputPath: string,
  outputPath: string,
  minify: boolean,
): Promise<CSSBuildResult> {
  const startTime = performance.now();
  const args = ["@tailwindcss/cli", "-i", inputPath, "-o", outputPath];
  if (minify) args.push("--minify");

  try {
    const proc = spawn(getTailwindCommand(args), {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const rawStderr = await new Response(proc.stderr).text();
      // ANSI escape + 환경 경고 필터링
      const stderr = rawStderr
        .replace(/\u001b\[[0-9;]*m/g, "")
        .split("\n")
        .filter((l) => l.trim() && !l.includes(".bash_profile") && !l.includes("$'\\377"))
        .join("\n")
        .trim();
      return {
        success: false,
        outputPath,
        error: stderr || `Tailwind CLI exited with code ${exitCode}`,
      };
    }

    return {
      success: true,
      outputPath,
      buildTime: performance.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      outputPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * CSS 일회성 빌드 (production용)
 */
export async function buildCSS(options: CSSBuildOptions): Promise<CSSBuildResult> {
  return withPerf("bundler:css", async () => {
    const {
      rootDir,
      input = DEFAULT_INPUT,
      output = DEFAULT_OUTPUT,
      minify = true,
    } = options;

    const inputPath = path.join(rootDir, input);
    const outputPath = path.join(rootDir, output);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    return runCSSBuild(rootDir, inputPath, outputPath, minify);
  });
}

// ========== Watch ==========

/**
 * CSS 감시 모드 시작 (development용)
 *
 * #152: Tailwind CLI --watch 모드가 Bun.spawn에서 파일을 생성하지 않는 문제로 인해
 * 자체 파일 감시 + 단발 빌드 반복 방식을 사용한다.
 *
 * 동작:
 * 1. 초기 단발 빌드 실행 (await — 서버 시작 전 CSS 준비 보장)
 * 2. app/, src/ 디렉토리 및 입력 CSS 파일 감시
 * 3. 관련 파일 변경 시 debounce 후 단발 빌드 재실행
 */
export async function startCSSWatch(options: CSSBuildOptions): Promise<CSSWatcher> {
  const {
    rootDir,
    input = DEFAULT_INPUT,
    output = DEFAULT_OUTPUT,
    minify = false,
    onBuild,
    onError,
  } = options;

  const inputPath = path.join(rootDir, input);
  const outputPath = path.join(rootDir, output);

  // 출력 디렉토리 생성
  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
  } catch (error) {
    const err = new Error(`CSS 출력 디렉토리 생성 실패: ${error instanceof Error ? error.message : error}`);
    console.error(`❌ ${err.message}`);
    onError?.(err);
    throw err;
  }

  console.log(`🎨 Tailwind CSS v4 빌드 시작...`);
  console.log(`   입력: ${input}`);
  console.log(`   출력: ${output}`);

  // 1. 초기 빌드 (await — 서버 시작 전 CSS 준비 보장)
  const initialResult = await runCSSBuild(rootDir, inputPath, outputPath, minify);

  if (initialResult.success) {
    console.log(`   ✅ CSS built (${Math.round(initialResult.buildTime ?? 0)}ms)`);
  } else {
    console.error(`   ❌ CSS build failed: ${initialResult.error}`);
    onError?.(new Error(initialResult.error));
  }

  // 2. 파일 감시 설정 (CSS 소스, app/, src/ 디렉토리)
  const watchers: FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isBuilding = false;
  let pendingRebuild = false;

  const triggerRebuild = () => {
    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(async () => {
      if (isBuilding) {
        pendingRebuild = true;
        return;
      }

      isBuilding = true;
      try {
        const result = await runCSSBuild(rootDir, inputPath, outputPath, minify);
        if (result.success) {
          console.log(`   ✅ CSS rebuilt (${Math.round(result.buildTime ?? 0)}ms)`);
          onBuild?.(result);
        } else {
          console.error(`   ❌ CSS rebuild failed: ${result.error}`);
          onError?.(new Error(result.error));
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`   ❌ CSS rebuild error: ${error.message}`);
        onError?.(error);
      } finally {
        isBuilding = false;
        if (pendingRebuild) {
          pendingRebuild = false;
          triggerRebuild();
        }
      }
    }, CSS_REBUILD_DEBOUNCE);
  };

  // CSS/TSX/HTML 파일 변경 시 리빌드 트리거
  const isRelevantChange = (filename: string | null): boolean => {
    if (!filename) return false;
    const ext = path.extname(filename).toLowerCase();
    return [".css", ".tsx", ".ts", ".jsx", ".js", ".html"].includes(ext);
  };

  // 감시 대상 디렉토리
  const watchTargets = ["app", "src"];

  for (const dir of watchTargets) {
    const absDir = path.join(rootDir, dir);
    try {
      await fs.access(absDir);
      const watcher = fsWatch(absDir, { recursive: true }, (_event, filename) => {
        if (isRelevantChange(filename)) {
          triggerRebuild();
        }
      });
      watchers.push(watcher);
    } catch {
      // 디렉토리 없으면 무시
    }
  }

  // 입력 CSS 파일 직접 감시 (app/ 외부에 있을 수도 있으므로)
  try {
    const cssWatcher = fsWatch(inputPath, () => triggerRebuild());
    watchers.push(cssWatcher);
  } catch {
    // 무시
  }

  return {
    outputPath,
    serverPath: SERVER_CSS_PATH,
    close: () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) w.close();
    },
  };
}

/**
 * CSS 서버 경로 반환
 */
export function getCSSServerPath(): string {
  return SERVER_CSS_PATH;
}

/**
 * CSS 링크 태그 생성
 */
export function generateCSSLinkTag(isDev: boolean = false): string {
  const cacheBust = isDev ? `?t=${Date.now()}` : "";
  return `<link rel="stylesheet" href="${SERVER_CSS_PATH}${cacheBust}">`;
}
