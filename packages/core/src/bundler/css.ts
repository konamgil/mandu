/**
 * Mandu CSS Builder
 * Tailwind CSS v4 CLI 기반 CSS 빌드 및 감시
 *
 * 특징:
 * - Tailwind v4 Oxide Engine (Rust) 사용
 * - Zero Config: @import "tailwindcss" 자동 감지
 * - 출력: .mandu/client/globals.css
 */

import { spawn, which, type Subprocess } from "bun";
import path from "path";
import fs from "fs/promises";
import { watch as fsWatch, type FSWatcher } from "fs";

/**
 * Tailwind CLI 실행 명령어를 결정한다.
 * bunx가 PATH에 없는 환경(일부 Windows/CI)에서도 동작하도록
 * `bun x`로 fallback한다.
 */
function getTailwindCommand(args: string[]): string[] {
  if (which("bunx")) {
    return ["bunx", ...args];
  }
  // bunx shim이 없어도 `bun x`는 동작함
  return ["bun", "x", ...args];
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
  /** Tailwind CLI 프로세스 */
  process: Subprocess;
  /** 출력 파일 경로 (절대 경로) */
  outputPath: string;
  /** 서버 경로 (/.mandu/client/globals.css) */
  serverPath: string;
  /** 프로세스 종료 */
  close: () => void;
}

// ========== Constants ==========

const DEFAULT_INPUT = "app/globals.css";
const DEFAULT_OUTPUT = ".mandu/client/globals.css";
const SERVER_CSS_PATH = "/.mandu/client/globals.css";

// ========== Detection ==========

/**
 * Tailwind v4 프로젝트인지 감지
 * app/globals.css에 @import "tailwindcss" 포함 여부 확인
 */
export async function isTailwindProject(rootDir: string): Promise<boolean> {
  const cssPath = path.join(rootDir, DEFAULT_INPUT);

  try {
    const content = await fs.readFile(cssPath, "utf-8");
    // Tailwind v4: @import "tailwindcss"
    // Tailwind v3: @tailwind base; @tailwind components; @tailwind utilities;
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
 * CSS 일회성 빌드 (production용)
 */
export async function buildCSS(options: CSSBuildOptions): Promise<CSSBuildResult> {
  const {
    rootDir,
    input = DEFAULT_INPUT,
    output = DEFAULT_OUTPUT,
    minify = true,
  } = options;

  const inputPath = path.join(rootDir, input);
  const outputPath = path.join(rootDir, output);
  const startTime = performance.now();

  // 출력 디렉토리 생성
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Tailwind CLI 실행
  const args = [
    "@tailwindcss/cli",
    "-i", inputPath,
    "-o", outputPath,
  ];

  if (minify) {
    args.push("--minify");
  }

  try {
    const proc = spawn(getTailwindCommand(args), {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    // 프로세스 완료 대기
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return {
        success: false,
        outputPath,
        error: stderr || `Tailwind CLI exited with code ${exitCode}`,
      };
    }

    const buildTime = performance.now() - startTime;

    return {
      success: true,
      outputPath,
      buildTime,
    };
  } catch (error) {
    return {
      success: false,
      outputPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ========== Watch ==========

/**
 * CSS 감시 모드 시작 (development용)
 * Tailwind CLI --watch 모드로 실행
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

  try {
    // 출력 디렉토리 생성
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
  } catch (error) {
    const err = new Error(`CSS 출력 디렉토리 생성 실패: ${error instanceof Error ? error.message : error}`);
    console.error(`❌ ${err.message}`);
    onError?.(err);
    throw err;
  }

  // Tailwind CLI 인자 구성
  const args = [
    "@tailwindcss/cli",
    "-i", inputPath,
    "-o", outputPath,
    "--watch",
  ];

  if (minify) {
    args.push("--minify");
  }

  console.log(`🎨 Tailwind CSS v4 빌드 시작...`);
  console.log(`   입력: ${input}`);
  console.log(`   출력: ${output}`);

  // Bun subprocess로 Tailwind CLI 실행
  let proc;
  try {
    proc = spawn(getTailwindCommand(args), {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    const err = new Error(
      `Tailwind CLI 실행 실패. @tailwindcss/cli가 설치되어 있는지 확인하세요.\n` +
      `설치: bun add -d @tailwindcss/cli tailwindcss\n` +
      `원인: ${error instanceof Error ? error.message : error}`
    );
    console.error(`❌ ${err.message}`);
    onError?.(err);
    throw err;
  }

  // 출력 파일 워처로 빌드 완료 감지 (stdout 패턴보다 신뢰성 높음, #111)
  // Tailwind CLI stdout 출력 형식은 버전마다 달라질 수 있으므로 파일 변경으로 감지
  let fsWatcher: FSWatcher | null = null;
  let lastMtime = 0;

  const startFileWatcher = () => {
    try {
      fsWatcher = fsWatch(outputPath, () => {
        // 연속 이벤트 중복 방지 (50ms 이내 재발생 무시)
        const now = Date.now();
        if (now - lastMtime < 50) return;
        lastMtime = now;
        console.log(`   ✅ CSS rebuilt`);
        onBuild?.({ success: true, outputPath });
      });
    } catch {
      // 파일이 아직 없으면 500ms 후 재시도
      setTimeout(startFileWatcher, 500);
    }
  };

  // stdout 로그용 (빌드 시작/완료 메시지 표시)
  (async () => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        if (line.includes("warn") || line.includes("Warning")) {
          console.log(`   ⚠️  CSS ${line.trim()}`);
        }
      }
    }
  })();

  // 초기 빌드 완료 후 파일 워처 시작
  startFileWatcher();

  // stderr 모니터링 (에러 감지)
  (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const rawText = decoder.decode(value).trim();
      // ANSI 이스케이프 코드 제거 후 비교 (Tailwind CLI가 컬러 출력)
      const text = rawText.replace(/\u001b\[[0-9;]*m/g, "").trim();
      if (text) {
        // 환경 경고 무시
        if (text.includes(".bash_profile") || text.includes("$'\\377")) {
          continue;
        }
        // Tailwind CLI 정상 진행 메시지는 info 레벨로 처리
        // (패키지 해석, 다운로드, 잠금 파일 등은 정상 동작)
        if (
          text.includes("Resolving dependencies") ||
          text.includes("Resolved, downloaded") ||
          text.includes("Saved lockfile") ||
          text.includes("tailwindcss") ||
          text.match(/^v?\d+\.\d+\.\d+/) // 버전 출력
        ) {
          if (text) console.log(`   ℹ️  CSS: ${text}`);
          continue;
        }
        console.error(`   ❌ CSS Error: ${text}`);
        onError?.(new Error(text));
      }
    }
  })();

  // 프로세스 종료 감지
  proc.exited.then((code) => {
    if (code !== 0 && code !== null) {
      console.error(`   ❌ Tailwind CLI exited with code ${code}`);
    }
  });

  return {
    process: proc,
    outputPath,
    serverPath: SERVER_CSS_PATH,
    close: () => {
      fsWatcher?.close();
      // Windows에서는 SIGTERM이 무시될 수 있으므로 SIGKILL 사용 (#117)
      if (process.platform === "win32") {
        proc.kill("SIGKILL");
      } else {
        proc.kill();
      }
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
