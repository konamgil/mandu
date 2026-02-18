/**
 * DNA-014: Adaptive Output Format (JSON/Pretty/Plain)
 *
 * Automatically determines output format based on environment
 * - TTY: Pretty (colors + formatting)
 * - CI/pipe/agent: JSON (machine/agent-friendly)
 * - --json flag: JSON
 * - MANDU_OUTPUT env var: forced override
 */

import { theme, isRich, stripAnsi } from "./theme.js";

/**
 * Output mode
 */
export type OutputMode = "json" | "pretty" | "plain";

/**
 * Output options
 */
export interface OutputOptions {
  /** Force JSON output */
  json?: boolean;
  /** Force plain text */
  plain?: boolean;
}

/**
 * Determine output mode
 *
 * Priority:
 * 1. --json flag -> "json"
 * 2. --plain flag -> "plain"
 * 3. MANDU_OUTPUT env var -> specified value
 * 4. Agent environment -> "json"
 * 5. !TTY (pipe), CI -> "json"
 * 6. Default -> "pretty"
 */
export function getOutputMode(opts: OutputOptions = {}): OutputMode {
  // Flags take priority
  if (opts.json) return "json";
  if (opts.plain) return "plain";

  // Check environment variable
  const envOutput = process.env.MANDU_OUTPUT?.toLowerCase();
  if (envOutput === "json") return "json";
  if (envOutput === "plain") return "plain";
  if (envOutput === "pretty") return "pretty";
  if (envOutput === "agent") return "json";

  // Agent environment uses JSON
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

  // CI environment uses JSON
  if (process.env.CI) return "json";

  // Non-TTY uses JSON
  if (!process.stdout.isTTY) return "json";

  return "pretty";
}

/**
 * Formatting context based on output mode
 */
export interface FormatContext {
  mode: OutputMode;
  rich: boolean;
}

/**
 * Create formatting context
 */
export function createFormatContext(opts: OutputOptions = {}): FormatContext {
  const mode = getOutputMode(opts);
  return {
    mode,
    rich: mode === "pretty" && isRich(),
  };
}

/**
 * Format data according to output mode
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
    // Strip ANSI codes from pretty formatter
    if (formatters.pretty) {
      return stripAnsi(formatters.pretty(data, false));
    }
    return String(data);
  }

  // Pretty mode
  if (formatters.pretty) {
    return formatters.pretty(data, rich);
  }

  return String(data);
}

/**
 * Error output formatting
 */
export interface ErrorOutput {
  type: "error";
  message: string;
  error?: string;
  hint?: string;
  code?: string;
}

/**
 * Format error according to output mode
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

  // Error message
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

  // Hint
  if (options.hint) {
    lines.push("");
    lines.push(rich ? theme.muted(`💡 ${options.hint}`) : `Hint: ${options.hint}`);
  }

  return lines.join("\n");
}

/**
 * Format success message
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
 * Format warning message
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
 * Format info message
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
 * Format list output
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
