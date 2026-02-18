/**
 * DNA-012: Multi-fallback Progress
 *
 * Multi-level fallback progress system
 * - TTY: Spinner (ora) -> Line -> Log
 * - Non-TTY: Log only
 * - Auto-cleanup via withProgress() pattern
 */

import { theme } from "./theme.js";

/**
 * Progress options
 */
export interface ProgressOptions {
  /** Label */
  label: string;
  /** Total steps (default: 100) */
  total?: number;
  /** Output stream (default: stderr) */
  stream?: NodeJS.WriteStream;
  /** Fallback mode */
  fallback?: "spinner" | "line" | "log" | "none";
  /** Success message */
  successMessage?: string;
  /** Failure message */
  failMessage?: string;
}

/**
 * Progress reporter
 */
export interface ProgressReporter {
  /** Change label */
  setLabel: (label: string) => void;
  /** Set percent (0-100) */
  setPercent: (percent: number) => void;
  /** Advance (increment by delta) */
  tick: (delta?: number) => void;
  /** Complete with success */
  done: (message?: string) => void;
  /** Complete with failure */
  fail: (message?: string) => void;
  /** Current percent */
  getPercent: () => number;
}

/**
 * Spinner frames
 */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Simple spinner implementation (ora replacement)
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
 * Render progress bar
 */
function renderProgressBar(percent: number, width: number = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `[${bar}]`;
}

/**
 * Create CLI progress
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

  // TTY: use spinner (works if stderr is TTY even when stdout is piped)
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
    // "log" mode does not log on every state change
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
 * Progress context pattern
 *
 * Automatically cleans up progress after work completes
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
 * Simple spinner (no progress percentage)
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
 * Multi-step progress
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
