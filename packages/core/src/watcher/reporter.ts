/**
 * Brain v0.1 - Watch Reporter
 *
 * Formats and outputs watch warnings to the console.
 * Warnings only - never blocks operations.
 */

import type { WatchWarning, WatchStatus, ArchRule } from "../brain/types";
import { getRule } from "./rules";

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

/**
 * Check if colors should be used
 */
function useColors(): boolean {
  if (process.env.NO_COLOR) return false;
  if (typeof process?.stdout?.isTTY === "boolean") {
    return process.stdout.isTTY;
  }
  return true;
}

/**
 * Apply color if enabled
 */
function color(text: string, colorCode: string): string {
  if (!useColors()) return text;
  return `${colorCode}${text}${colors.reset}`;
}

/**
 * Format a warning for terminal output
 */
export function formatWarning(warning: WatchWarning): string {
  const rule = getRule(warning.ruleId);

  // Event icons
  const eventIcons: Record<string, string> = {
    create: "📝",
    modify: "✏️",
    delete: "🗑️",
  };

  const eventIcon = eventIcons[warning.event] || "📄";
  const ruleIcon = rule?.action === "error" ? "❌" : "⚠️";
  const ruleColor = rule?.action === "error" ? colors.red : colors.yellow;

  const lines: string[] = [];

  lines.push(
    `${eventIcon} ${ruleIcon} ${color(`[${warning.ruleId}]`, ruleColor)} ${warning.file}`
  );
  lines.push(`   ${warning.message}`);

  if (rule?.description) {
    lines.push(`   ${color("💡", colors.cyan)} ${rule.description}`);
  }

  return lines.join("\n");
}

/**
 * Print a warning to console
 */
export function printWarning(warning: WatchWarning): void {
  console.log(formatWarning(warning));
  console.log();
}

/**
 * Format watch status for terminal output
 */
export function formatStatus(status: WatchStatus): string {
  const lines: string[] = [];

  lines.push(color("👁️ Mandu Watch Status", colors.bright + colors.blue));
  lines.push(color("─".repeat(40), colors.dim));
  lines.push();

  const statusIcon = status.active ? "🟢" : "🔴";
  const statusText = status.active ? "Active" : "Inactive";

  lines.push(`${statusIcon} Status: ${color(statusText, status.active ? colors.green : colors.red)}`);

  if (status.rootDir) {
    lines.push(`📁 Root: ${color(status.rootDir, colors.cyan)}`);
  }

  lines.push(`📊 Files: ${status.fileCount}`);

  if (status.startedAt) {
    const duration = Math.floor(
      (Date.now() - status.startedAt.getTime()) / 1000
    );
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    lines.push(
      `⏱️ Uptime: ${minutes > 0 ? `${minutes}m ` : ""}${seconds}s`
    );
  }

  if (status.recentWarnings.length > 0) {
    lines.push();
    lines.push(
      color(
        `⚠️ Recent Warnings (${status.recentWarnings.length})`,
        colors.yellow
      )
    );

    // Show last 5 warnings
    const recent = status.recentWarnings.slice(-5);
    for (const warning of recent) {
      const time = warning.timestamp.toLocaleTimeString();
      lines.push(
        `   ${color(time, colors.dim)} [${warning.ruleId}] ${warning.file}`
      );
    }
  } else {
    lines.push();
    lines.push(color("✅ No recent warnings", colors.green));
  }

  return lines.join("\n");
}

/**
 * Print watch status to console
 */
export function printStatus(status: WatchStatus): void {
  console.log(formatStatus(status));
  console.log();
}

/**
 * Print watch startup message
 */
export function printWatchStart(rootDir: string): void {
  console.log();
  console.log(color("👁️ Mandu Watch", colors.bright + colors.blue));
  console.log(color("─".repeat(40), colors.dim));
  console.log(`📁 Watching: ${color(rootDir, colors.cyan)}`);
  console.log();
  console.log(color("Rules active:", colors.dim));
  console.log("  • GENERATED_DIRECT_EDIT - Generated 파일 직접 수정 감지");
  console.log("  • WRONG_SLOT_LOCATION - 잘못된 위치의 Slot 파일 감지");
  console.log("  • SLOT_NAMING - Slot 파일 네이밍 규칙");
  console.log("  • CONTRACT_NAMING - Contract 파일 네이밍 규칙");
  console.log("  • FORBIDDEN_IMPORT - Generated 파일의 금지된 import 감지");
  console.log();
  console.log(
    color("ℹ️  Watch는 경고만 출력합니다. 작업을 차단하지 않습니다.", colors.dim)
  );
  console.log(color("   Press Ctrl+C to stop", colors.dim));
  console.log();
}

/**
 * Print watch stop message
 */
export function printWatchStop(): void {
  console.log();
  console.log(color("👁️ Watch stopped", colors.dim));
  console.log();
}

/**
 * Generate JSON status for MCP/API consumption
 */
export function generateJsonStatus(status: WatchStatus): string {
  return JSON.stringify(
    {
      active: status.active,
      rootDir: status.rootDir,
      fileCount: status.fileCount,
      startedAt: status.startedAt?.toISOString() || null,
      recentWarnings: status.recentWarnings.map((w) => ({
        ruleId: w.ruleId,
        file: w.file,
        message: w.message,
        event: w.event,
        timestamp: w.timestamp.toISOString(),
      })),
    },
    null,
    2
  );
}

/**
 * Create a warning handler that prints to console
 */
export function createConsoleHandler(): (warning: WatchWarning) => void {
  return (warning) => {
    printWarning(warning);
  };
}

/**
 * Create a warning handler that collects warnings
 */
export function createCollectorHandler(): {
  handler: (warning: WatchWarning) => void;
  getWarnings: () => WatchWarning[];
  clear: () => void;
} {
  const warnings: WatchWarning[] = [];

  return {
    handler: (warning) => {
      warnings.push(warning);
    },
    getWarnings: () => [...warnings],
    clear: () => {
      warnings.length = 0;
    },
  };
}
