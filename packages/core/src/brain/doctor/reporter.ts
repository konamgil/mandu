/**
 * Brain v0.1 - Doctor Reporter
 *
 * Formats and outputs Doctor analysis results.
 * Works with or without LLM - always provides actionable output.
 */

import type { DoctorAnalysis, PatchSuggestion } from "../types";
import type { GuardViolation } from "../../guard/rules";
import { prioritizePatches } from "./patcher";

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
  // Check for NO_COLOR environment variable
  if (process.env.NO_COLOR) return false;

  // Check if stdout is a TTY
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
 * Format a violation for terminal output
 */
export function formatViolation(violation: GuardViolation): string {
  const lines: string[] = [];

  const severity = violation.severity || "error";
  const icon = severity === "error" ? "❌" : "⚠️";
  const colorCode = severity === "error" ? colors.red : colors.yellow;

  lines.push(
    `${icon} ${color(`[${violation.ruleId}]`, colorCode)} ${violation.file}`
  );
  lines.push(`   ${violation.message}`);

  if (violation.suggestion) {
    lines.push(`   ${color("💡", colors.cyan)} ${violation.suggestion}`);
  }

  if (violation.line) {
    lines.push(`   ${color("📍", colors.dim)} Line ${violation.line}`);
  }

  return lines.join("\n");
}

/**
 * Format a patch suggestion for terminal output
 */
export function formatPatch(patch: PatchSuggestion, index: number): string {
  const lines: string[] = [];

  const confidenceIcon =
    patch.confidence >= 0.8 ? "🟢" : patch.confidence >= 0.5 ? "🟡" : "🔴";

  lines.push(
    `${color(`${index}.`, colors.bright)} ${patch.description} ${confidenceIcon}`
  );

  switch (patch.type) {
    case "command":
      lines.push(
        `   ${color("$ ", colors.dim)}${color(patch.command || "", colors.cyan)}`
      );
      break;

    case "add":
      lines.push(`   ${color("+ 파일 생성:", colors.green)} ${patch.file}`);
      break;

    case "modify":
      lines.push(`   ${color("~ 파일 수정:", colors.yellow)} ${patch.file}`);
      if (patch.line) {
        lines.push(`   ${color("📍", colors.dim)} Line ${patch.line}`);
      }
      break;

    case "delete":
      lines.push(`   ${color("- 파일 삭제:", colors.red)} ${patch.file}`);
      break;
  }

  return lines.join("\n");
}

/**
 * Print Doctor analysis to console
 */
export function printDoctorReport(analysis: DoctorAnalysis): void {
  const { violations, summary, explanation, patches, llmAssisted, nextCommand } =
    analysis;

  console.log();
  console.log(color("🩺 Mandu Doctor Report", colors.bright + colors.blue));
  console.log(color("─".repeat(50), colors.dim));
  console.log();

  // Summary
  console.log(color("📋 요약", colors.bright));
  console.log(`   ${summary}`);
  console.log();

  // Violations
  if (violations.length > 0) {
    console.log(
      color(`🔍 발견된 위반 (${violations.length}개)`, colors.bright)
    );
    console.log();

    for (const violation of violations) {
      console.log(formatViolation(violation));
      console.log();
    }
  }

  // Detailed explanation
  if (explanation) {
    console.log(color("📖 상세 분석", colors.bright));
    console.log();

    // Format explanation with proper indentation
    const explLines = explanation.split("\n");
    for (const line of explLines) {
      if (line.startsWith("##")) {
        console.log(color(line.replace("## ", "▸ "), colors.cyan));
      } else if (line.trim()) {
        console.log(`   ${line}`);
      } else {
        console.log();
      }
    }
    console.log();
  }

  // Patch suggestions
  if (patches.length > 0) {
    console.log(color(`💊 제안된 수정 (${patches.length}개)`, colors.bright));
    console.log();

    const prioritized = prioritizePatches(patches);

    for (let i = 0; i < prioritized.length; i++) {
      console.log(formatPatch(prioritized[i], i + 1));
      console.log();
    }
  }

  // Next command
  if (nextCommand) {
    console.log(color("▶ 권장 다음 명령어", colors.bright));
    console.log();
    console.log(`   ${color("$ ", colors.dim)}${color(nextCommand, colors.green)}`);
    console.log();
  }

  // Footer
  console.log(color("─".repeat(50), colors.dim));
  console.log(
    `${color("ℹ️", colors.cyan)} LLM 지원: ${llmAssisted ? color("예", colors.green) : color("아니오", colors.yellow)}`
  );
  console.log();
}

/**
 * Generate a JSON report for MCP/API consumption
 */
export function generateJsonReport(analysis: DoctorAnalysis): string {
  return JSON.stringify(
    {
      summary: analysis.summary,
      violationCount: analysis.violations.length,
      violations: analysis.violations.map((v) => ({
        ruleId: v.ruleId,
        file: v.file,
        message: v.message,
        suggestion: v.suggestion,
        line: v.line,
        severity: v.severity || "error",
      })),
      patches: analysis.patches.map((p) => ({
        file: p.file,
        type: p.type,
        description: p.description,
        command: p.command,
        confidence: p.confidence,
      })),
      nextCommand: analysis.nextCommand,
      llmAssisted: analysis.llmAssisted,
    },
    null,
    2
  );
}

/**
 * Generate a Markdown report (Doctor Analysis)
 */
export function generateDoctorMarkdownReport(analysis: DoctorAnalysis): string {
  const lines: string[] = [];

  lines.push("# 🩺 Mandu Doctor Report");
  lines.push("");

  lines.push("## 📋 요약");
  lines.push("");
  lines.push(analysis.summary);
  lines.push("");

  if (analysis.violations.length > 0) {
    lines.push(`## 🔍 발견된 위반 (${analysis.violations.length}개)`);
    lines.push("");

    for (const v of analysis.violations) {
      const severity = v.severity || "error";
      const icon = severity === "error" ? "❌" : "⚠️";

      lines.push(`### ${icon} ${v.ruleId}`);
      lines.push("");
      lines.push(`- **파일**: \`${v.file}\``);
      lines.push(`- **메시지**: ${v.message}`);
      if (v.suggestion) {
        lines.push(`- **제안**: ${v.suggestion}`);
      }
      if (v.line) {
        lines.push(`- **라인**: ${v.line}`);
      }
      lines.push("");
    }
  }

  if (analysis.explanation) {
    lines.push("## 📖 상세 분석");
    lines.push("");
    lines.push(analysis.explanation);
    lines.push("");
  }

  if (analysis.patches.length > 0) {
    lines.push(`## 💊 제안된 수정 (${analysis.patches.length}개)`);
    lines.push("");

    const prioritized = prioritizePatches(analysis.patches);

    for (let i = 0; i < prioritized.length; i++) {
      const p = prioritized[i];
      const confidenceLabel =
        p.confidence >= 0.8 ? "🟢 높음" : p.confidence >= 0.5 ? "🟡 보통" : "🔴 낮음";

      lines.push(`### ${i + 1}. ${p.description}`);
      lines.push("");
      lines.push(`- **타입**: ${p.type}`);
      lines.push(`- **대상**: \`${p.file}\``);
      lines.push(`- **신뢰도**: ${confidenceLabel}`);

      if (p.command) {
        lines.push("");
        lines.push("```bash");
        lines.push(p.command);
        lines.push("```");
      }

      lines.push("");
    }
  }

  if (analysis.nextCommand) {
    lines.push("## ▶ 권장 다음 명령어");
    lines.push("");
    lines.push("```bash");
    lines.push(analysis.nextCommand);
    lines.push("```");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    `*LLM 지원: ${analysis.llmAssisted ? "예" : "아니오"}*`
  );

  return lines.join("\n");
}

/**
 * Format output based on requested format
 */
export type ReportFormat = "console" | "json" | "markdown";

export function formatDoctorReport(
  analysis: DoctorAnalysis,
  format: ReportFormat = "console"
): string | void {
  switch (format) {
    case "console":
      printDoctorReport(analysis);
      return;

    case "json":
      return generateJsonReport(analysis);

    case "markdown":
      return generateDoctorMarkdownReport(analysis);

    default:
      printDoctorReport(analysis);
  }
}
