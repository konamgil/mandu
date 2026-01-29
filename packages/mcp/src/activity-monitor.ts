/**
 * Mandu Activity Monitor
 *
 * Real-time terminal dashboard for MCP server activity.
 * Opens automatically when the MCP server starts.
 * Shows all tool calls, watch events, errors, and agent behavior.
 */

import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";

const TOOL_ICONS: Record<string, string> = {
  // Spec
  mandu_list_routes: "SPEC",
  mandu_get_route: "SPEC",
  mandu_add_route: "SPEC+",
  mandu_update_route: "SPEC~",
  mandu_delete_route: "SPEC-",
  mandu_validate_spec: "SPEC?",
  // Generate
  mandu_generate: "GEN",
  mandu_generate_status: "GEN?",
  // Guard
  mandu_guard_check: "GUARD",
  // Slot
  mandu_read_slot: "SLOT",
  mandu_write_slot: "SLOT~",
  mandu_validate_slot: "SLOT?",
  // Contract
  mandu_list_contracts: "CONTRACT",
  mandu_get_contract: "CONTRACT",
  mandu_create_contract: "CONTRACT+",
  mandu_validate_contracts: "CONTRACT?",
  mandu_sync_contract_slot: "SYNC",
  mandu_generate_openapi: "OPENAPI",
  mandu_update_route_contract: "CONTRACT~",
  // Transaction
  mandu_begin: "TX-BEGIN",
  mandu_commit: "TX-COMMIT",
  mandu_rollback: "TX-ROLLBACK",
  mandu_tx_status: "TX?",
  // History
  mandu_list_history: "HISTORY",
  mandu_get_snapshot: "SNAPSHOT",
  mandu_prune_history: "PRUNE",
  // Brain
  mandu_doctor: "DOCTOR",
  mandu_watch_start: "WATCH+",
  mandu_watch_status: "WATCH?",
  mandu_watch_stop: "WATCH-",
  mandu_check_location: "ARCH?",
  mandu_check_import: "IMPORT?",
  mandu_get_architecture: "ARCH",
  // Build
  mandu_build: "BUILD",
  mandu_build_status: "BUILD?",
  mandu_list_islands: "ISLAND",
  mandu_set_hydration: "HYDRA~",
  mandu_add_client_slot: "CLIENT+",
  // Error
  mandu_analyze_error: "ERROR",
};

function getTime(): string {
  return new Date().toLocaleTimeString("ko-KR", { hour12: false });
}

function summarizeArgs(args: Record<string, unknown> | null | undefined): string {
  if (!args || Object.keys(args).length === 0) return "";
  const entries = Object.entries(args)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const val = typeof v === "string"
        ? (v.length > 40 ? v.slice(0, 40) + "..." : v)
        : JSON.stringify(v);
      return `${k}=${val}`;
    });
  return entries.length > 0 ? ` (${entries.join(", ")})` : "";
}

function summarizeResult(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const obj = result as Record<string, unknown>;

  // Common patterns
  if (obj.error) return ` >> ERROR: ${obj.error}`;
  if (obj.success === true) return obj.message ? ` >> ${obj.message}` : " >> OK";
  if (obj.success === false) return ` >> FAILED: ${obj.message || "unknown"}`;
  if (Array.isArray(obj.routes)) return ` >> ${obj.routes.length} routes`;
  if (obj.passed === true) return obj.message ? ` >> ${obj.message}` : " >> PASSED";
  if (obj.passed === false) return ` >> FAILED (${(obj.violations as unknown[])?.length || 0} violations)`;
  if (obj.valid === true) return obj.message ? ` >> ${obj.message}` : " >> VALID";
  if (obj.valid === false) return ` >> INVALID (${(obj.violations as unknown[])?.length || 0} violations)`;
  if (obj.generated) return " >> Generated";
  if (obj.status) return ` >> ${JSON.stringify(obj.status).slice(0, 60)}`;

  return "";
}

export class ActivityMonitor {
  private logFile: string;
  private logStream: fs.WriteStream | null = null;
  private tailProcess: ChildProcess | null = null;
  private projectRoot: string;
  private callCount = 0;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    const manduDir = path.join(projectRoot, ".mandu");
    if (!fs.existsSync(manduDir)) {
      fs.mkdirSync(manduDir, { recursive: true });
    }
    this.logFile = path.join(manduDir, "activity.log");
  }

  start(): void {
    // Create/overwrite log file
    this.logStream = fs.createWriteStream(this.logFile, { flags: "w" });

    const time = getTime();
    const header =
      `\n` +
      `  ╔══════════════════════════════════════════════╗\n` +
      `  ║         MANDU MCP Activity Monitor           ║\n` +
      `  ║                                              ║\n` +
      `  ║  ${time}                                ║\n` +
      `  ║  ${this.projectRoot.slice(-40).padEnd(40)}    ║\n` +
      `  ╚══════════════════════════════════════════════╝\n\n`;

    this.logStream.write(header);

    // Auto-open terminal
    this.openTerminal();
  }

  stop(): void {
    if (this.tailProcess) {
      this.tailProcess.kill();
      this.tailProcess = null;
    }
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  /**
   * Log a tool call (invocation)
   */
  logTool(
    name: string,
    args?: Record<string, unknown> | null,
    _result?: unknown,
    error?: string,
  ): void {
    this.callCount++;
    const time = getTime();
    const tag = TOOL_ICONS[name] || name.replace("mandu_", "").toUpperCase();
    const argsStr = summarizeArgs(args);

    let line: string;
    if (error) {
      line = `${time} ✗ [${tag}]${argsStr}\n       ERROR: ${error}\n`;
    } else {
      line = `${time} → [${tag}]${argsStr}\n`;
    }

    this.write(line);
  }

  /**
   * Log a tool result
   */
  logResult(name: string, result: unknown): void {
    const time = getTime();
    const tag = TOOL_ICONS[name] || name.replace("mandu_", "").toUpperCase();
    const summary = summarizeResult(result);

    if (summary) {
      this.write(`${time} ✓ [${tag}]${summary}\n`);
    }
  }

  /**
   * Log a watch event (called from watcher)
   */
  logWatch(level: string, ruleId: string, file: string, message: string): void {
    const time = getTime();
    const icon = level === "info" ? "ℹ" : "⚠";
    this.write(`${time} ${icon} [WATCH:${ruleId}] ${file}\n       ${message}\n`);
  }

  /**
   * Log a custom event
   */
  logEvent(category: string, message: string): void {
    const time = getTime();
    this.write(`${time}   [${category}] ${message}\n`);
  }

  private write(text: string): void {
    if (this.logStream) {
      this.logStream.write(text);
    }
  }

  private openTerminal(): void {
    try {
      if (process.platform === "win32") {
        this.tailProcess = spawn("cmd", [
          "/c", "start",
          "Mandu Activity Monitor",
          "powershell", "-NoExit", "-Command",
          `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 | Out-Null; Get-Content '${this.logFile}' -Wait -Encoding UTF8`,
        ], { cwd: this.projectRoot, detached: true, stdio: "ignore" });
      } else if (process.platform === "darwin") {
        this.tailProcess = spawn("osascript", [
          "-e", `tell application "Terminal" to do script "tail -f '${this.logFile}'"`,
        ], { detached: true, stdio: "ignore" });
      } else {
        this.tailProcess = spawn("x-terminal-emulator", [
          "-e", `tail -f '${this.logFile}'`,
        ], { cwd: this.projectRoot, detached: true, stdio: "ignore" });
      }
      this.tailProcess?.unref();
    } catch {
      // Terminal auto-open failed silently
    }
  }
}
