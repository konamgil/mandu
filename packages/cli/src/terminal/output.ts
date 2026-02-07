/**
 * DNA-014: Adaptive Output Format (JSON/Pretty/Plain)
 *
 * 환경에 따라 출력 형식을 자동 결정
 * - TTY: Pretty (색상 + 포맷팅)
 * - CI/pipe/agent: JSON (자동 처리/에이전트 친화)
 * - --json 플래그: JSON
 * - MANDU_OUTPUT 환경변수: 강제 지정
 */

import { theme, isRich, stripAnsi } from "./theme.js";

/**
 * 출력 모드
 */
export type OutputMode = "json" | "pretty" | "plain";

/**
 * 출력 옵션
 */
export interface OutputOptions {
  /** JSON 출력 강제 */
  json?: boolean;
  /** Plain 텍스트 강제 */
  plain?: boolean;
}

/**
 * 출력 모드 결정
 *
 * 우선순위:
 * 1. --json 플래그 → "json"
 * 2. --plain 플래그 → "plain"
 * 3. MANDU_OUTPUT 환경변수 → 지정된 값
 * 4. 에이전트 환경 → "json"
 * 5. !TTY (파이프), CI → "json"
 * 6. 기본값 → "pretty"
 */
export function getOutputMode(opts: OutputOptions = {}): OutputMode {
  // 플래그 우선
  if (opts.json) return "json";
  if (opts.plain) return "plain";

  // 환경변수 체크
  const envOutput = process.env.MANDU_OUTPUT?.toLowerCase();
  if (envOutput === "json") return "json";
  if (envOutput === "plain") return "plain";
  if (envOutput === "pretty") return "pretty";
  if (envOutput === "agent") return "json";

  // 에이전트 환경이면 JSON
  const agentSignals = [
    "MANDU_AGENT",
    "CODEX_AGENT",
    "CODEX",
    "CLAUDE_CODE",
    "ANTHROPIC_CLAUDE_CODE",
  ];
  for (const key of agentSignals) {
    const value = process.env[key];
    if (value === "1" || value === "true") {
      return "json";
    }
  }

  // CI 환경이면 JSON
  if (process.env.CI) return "json";

  // TTY가 아니면 JSON
  if (!process.stdout.isTTY) return "json";

  return "pretty";
}

/**
 * 출력 모드에 따른 포맷팅 컨텍스트
 */
export interface FormatContext {
  mode: OutputMode;
  rich: boolean;
}

/**
 * 포맷팅 컨텍스트 생성
 */
export function createFormatContext(opts: OutputOptions = {}): FormatContext {
  const mode = getOutputMode(opts);
  return {
    mode,
    rich: mode === "pretty" && isRich(),
  };
}

/**
 * 데이터를 모드에 맞게 포맷팅
 */
export function formatOutput<T>(
  data: T,
  ctx: FormatContext,
  formatters: {
    json?: (data: T) => unknown;
    pretty?: (data: T, rich: boolean) => string;
    plain?: (data: T) => string;
  }
): string {
  const { mode, rich } = ctx;

  if (mode === "json") {
    const jsonData = formatters.json ? formatters.json(data) : data;
    return JSON.stringify(jsonData, null, 2);
  }

  if (mode === "plain") {
    if (formatters.plain) {
      return formatters.plain(data);
    }
    // Pretty 포맷터에서 ANSI 코드 제거
    if (formatters.pretty) {
      return stripAnsi(formatters.pretty(data, false));
    }
    return String(data);
  }

  // Pretty 모드
  if (formatters.pretty) {
    return formatters.pretty(data, rich);
  }

  return String(data);
}

/**
 * 에러 출력 포맷팅
 */
export interface ErrorOutput {
  type: "error";
  message: string;
  error?: string;
  hint?: string;
  code?: string;
}

/**
 * 에러를 모드에 맞게 포맷팅
 */
export function formatError(
  error: Error | string,
  ctx: FormatContext,
  options: {
    hint?: string;
    code?: string;
  } = {}
): string {
  const { mode, rich } = ctx;
  const message = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack : undefined;

  if (mode === "json") {
    const output: ErrorOutput = {
      type: "error",
      message,
      code: options.code,
      hint: options.hint,
    };
    if (error instanceof Error && error.stack) {
      output.error = error.stack;
    }
    return JSON.stringify(output, null, 2);
  }

  const lines: string[] = [];

  // 에러 메시지
  if (options.code) {
    lines.push(
      rich
        ? `${theme.error("❌ Error")} [${theme.muted(options.code)}]`
        : `Error [${options.code}]`
    );
  } else {
    lines.push(rich ? theme.error("❌ Error") : "Error");
  }
  lines.push(rich ? `   ${message}` : `   ${message}`);

  // 힌트
  if (options.hint) {
    lines.push("");
    lines.push(rich ? theme.muted(`💡 ${options.hint}`) : `Hint: ${options.hint}`);
  }

  return lines.join("\n");
}

/**
 * 성공 메시지 포맷팅
 */
export function formatSuccess(
  message: string,
  ctx: FormatContext,
  details?: Record<string, unknown>
): string {
  const { mode, rich } = ctx;

  if (mode === "json") {
    return JSON.stringify({ type: "success", message, ...details }, null, 2);
  }

  if (rich) {
    return `${theme.success("✓")} ${message}`;
  }

  return `[OK] ${message}`;
}

/**
 * 경고 메시지 포맷팅
 */
export function formatWarning(
  message: string,
  ctx: FormatContext,
  details?: Record<string, unknown>
): string {
  const { mode, rich } = ctx;

  if (mode === "json") {
    return JSON.stringify({ type: "warning", message, ...details }, null, 2);
  }

  if (rich) {
    return `${theme.warn("⚠")} ${message}`;
  }

  return `[WARN] ${message}`;
}

/**
 * 정보 메시지 포맷팅
 */
export function formatInfo(
  message: string,
  ctx: FormatContext,
  details?: Record<string, unknown>
): string {
  const { mode, rich } = ctx;

  if (mode === "json") {
    return JSON.stringify({ type: "info", message, ...details }, null, 2);
  }

  if (rich) {
    return `${theme.info("ℹ")} ${message}`;
  }

  return `[INFO] ${message}`;
}

/**
 * 리스트 출력 포맷팅
 */
export function formatList<T>(
  items: T[],
  ctx: FormatContext,
  options: {
    title?: string;
    itemFormatter?: (item: T, rich: boolean) => string;
    emptyMessage?: string;
  } = {}
): string {
  const { mode, rich } = ctx;
  const { title, itemFormatter, emptyMessage = "No items" } = options;

  if (mode === "json") {
    return JSON.stringify({ title, items, count: items.length }, null, 2);
  }

  const lines: string[] = [];

  if (title) {
    lines.push(rich ? theme.heading(title) : title);
    lines.push("");
  }

  if (items.length === 0) {
    lines.push(rich ? theme.muted(emptyMessage) : emptyMessage);
  } else {
    for (const item of items) {
      const formatted = itemFormatter
        ? itemFormatter(item, rich)
        : String(item);
      lines.push(`  ${formatted}`);
    }
  }

  return lines.join("\n");
}
