/**
 * DNA-012: Multi-fallback Progress
 *
 * 다단계 폴백 프로그레스 시스템
 * - TTY: 스피너 (ora) → 라인 → 로그
 * - Non-TTY: 로그만
 * - withProgress() 패턴으로 자동 정리
 */

import { theme } from "./theme.js";

/**
 * 프로그레스 옵션
 */
export interface ProgressOptions {
  /** 레이블 */
  label: string;
  /** 전체 단계 수 (기본: 100) */
  total?: number;
  /** 출력 스트림 (기본: stderr) */
  stream?: NodeJS.WriteStream;
  /** 폴백 모드 */
  fallback?: "spinner" | "line" | "log" | "none";
  /** 성공 메시지 */
  successMessage?: string;
  /** 실패 메시지 */
  failMessage?: string;
}

/**
 * 프로그레스 리포터
 */
export interface ProgressReporter {
  /** 레이블 변경 */
  setLabel: (label: string) => void;
  /** 퍼센트 설정 (0-100) */
  setPercent: (percent: number) => void;
  /** 진행 (delta 만큼 증가) */
  tick: (delta?: number) => void;
  /** 성공 완료 */
  done: (message?: string) => void;
  /** 실패 완료 */
  fail: (message?: string) => void;
  /** 현재 퍼센트 */
  getPercent: () => number;
}

/**
 * 스피너 문자
 */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * 간단한 스피너 구현 (ora 대체)
 */
function createSpinner(stream: NodeJS.WriteStream) {
  let frameIndex = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let text = "";
  let isRunning = false;

  const render = () => {
    if (!isRunning) return;
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
    stream.write(`\r${theme.accent(frame)} ${text}`);
    frameIndex++;
  };

  return {
    start: (initialText: string) => {
      text = initialText;
      isRunning = true;
      render();
      intervalId = setInterval(render, 80);
    },
    setText: (newText: string) => {
      text = newText;
    },
    succeed: (successText: string) => {
      isRunning = false;
      if (intervalId) clearInterval(intervalId);
      stream.write(`\r${theme.success("✓")} ${successText}\n`);
    },
    fail: (failText: string) => {
      isRunning = false;
      if (intervalId) clearInterval(intervalId);
      stream.write(`\r${theme.error("✗")} ${failText}\n`);
    },
    stop: () => {
      isRunning = false;
      if (intervalId) clearInterval(intervalId);
      stream.write("\r" + " ".repeat(text.length + 5) + "\r");
    },
  };
}

/**
 * 프로그레스 바 렌더링
 */
function renderProgressBar(percent: number, width: number = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `[${bar}]`;
}

/**
 * CLI 프로그레스 생성
 *
 * @example
 * ```ts
 * const progress = createCliProgress({ label: "Building...", total: 4 });
 *
 * progress.setLabel("Scanning routes...");
 * await scanRoutes();
 * progress.tick();
 *
 * progress.setLabel("Bundling...");
 * await bundle();
 * progress.tick();
 *
 * progress.done("Build complete!");
 * ```
 */
export function createCliProgress(options: ProgressOptions): ProgressReporter {
  const {
    label: initialLabel,
    total = 100,
    stream = process.stderr,
    fallback = "spinner",
    successMessage,
    failMessage,
  } = options;

  const isTty = stream.isTTY;

  let label = initialLabel;
  let completed = 0;

  // TTY: 스피너 사용 (stdout이 pipe여도 stderr TTY면 동작)
  const spinner = isTty && fallback === "spinner" ? createSpinner(stream) : null;

  if (spinner) {
    spinner.start(label);
  }

  const getPercent = () => Math.round((completed / total) * 100);

  const render = () => {
    const percent = getPercent();
    const text =
      total > 1 ? `${label} ${renderProgressBar(percent)} ${percent}%` : label;

    if (spinner) {
      spinner.setText(text);
    } else if (isTty && fallback === "line") {
      stream.write(`\r${text}`);
    }
    // "log" 모드는 상태 변경 시마다 로그하지 않음
  };

  return {
    setLabel: (next: string) => {
      label = next;
      render();
    },

    setPercent: (percent: number) => {
      completed = (Math.max(0, Math.min(100, percent)) / 100) * total;
      render();
    },

    tick: (delta = 1) => {
      completed = Math.min(total, completed + delta);
      render();
    },

    getPercent,

    done: (message?: string) => {
      const finalMessage =
        message ?? successMessage ?? `${initialLabel} completed`;

      if (spinner) {
        spinner.succeed(finalMessage);
      } else if (isTty) {
        stream.write(`\r${theme.success("✓")} ${finalMessage}\n`);
      } else if (fallback !== "none") {
        stream.write(`[OK] ${finalMessage}\n`);
      }
    },

    fail: (message?: string) => {
      const finalMessage =
        message ?? failMessage ?? `${initialLabel} failed`;

      if (spinner) {
        spinner.fail(finalMessage);
      } else if (isTty) {
        stream.write(`\r${theme.error("✗")} ${finalMessage}\n`);
      } else if (fallback !== "none") {
        stream.write(`[FAIL] ${finalMessage}\n`);
      }
    },
  };
}

/**
 * 프로그레스 컨텍스트 패턴
 *
 * 작업 완료 후 자동으로 프로그레스 정리
 *
 * @example
 * ```ts
 * const result = await withProgress(
 *   { label: "Building...", total: 4 },
 *   async (progress) => {
 *     progress.setLabel("Step 1");
 *     await step1();
 *     progress.tick();
 *
 *     progress.setLabel("Step 2");
 *     await step2();
 *     progress.tick();
 *
 *     return { success: true };
 *   }
 * );
 * ```
 */
export async function withProgress<T>(
  options: ProgressOptions,
  work: (progress: ProgressReporter) => Promise<T>
): Promise<T> {
  const progress = createCliProgress(options);

  try {
    const result = await work(progress);
    progress.done();
    return result;
  } catch (error) {
    progress.fail(
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

/**
 * 단순 스피너 (진행률 없음)
 *
 * @example
 * ```ts
 * const stop = startSpinner("Loading...");
 * await loadData();
 * stop("Loaded!");
 * ```
 */
export function startSpinner(
  label: string,
  stream: NodeJS.WriteStream = process.stderr
): (successMessage?: string) => void {
  const isTty = stream.isTTY;

  if (!isTty) {
    stream.write(`${label}\n`);
    return (msg) => {
      if (msg) stream.write(`${msg}\n`);
    };
  }

  const spinner = createSpinner(stream);
  spinner.start(label);

  return (successMessage?: string) => {
    if (successMessage) {
      spinner.succeed(successMessage);
    } else {
      spinner.stop();
    }
  };
}

/**
 * 다중 단계 프로그레스
 *
 * @example
 * ```ts
 * await runSteps([
 *   { label: "Installing dependencies", fn: installDeps },
 *   { label: "Building", fn: build },
 *   { label: "Testing", fn: test },
 * ]);
 * ```
 */
export async function runSteps<T>(
  steps: Array<{
    label: string;
    fn: () => T | Promise<T>;
  }>,
  options: Omit<ProgressOptions, "label" | "total"> = {}
): Promise<T[]> {
  const results: T[] = [];
  const total = steps.length;
  let current = 0;

  const progress = createCliProgress({
    ...options,
    label: steps[0]?.label ?? "Processing...",
    total,
  });

  try {
    for (const step of steps) {
      progress.setLabel(step.label);
      const result = await step.fn();
      results.push(result);
      current++;
      progress.tick();
    }
    progress.done();
    return results;
  } catch (error) {
    progress.fail();
    throw error;
  }
}
