/**
 * Mandu Activity Monitor
 *
 * CLI-first real-time monitor for MCP server activity.
 * Supports pretty (human) and JSON (agent) outputs with dedupe + batching.
 */

import fs from "fs";
import path from "path";
import type { Subprocess } from "bun";

const TOOL_ICONS: Record<string, string> = {
  // Spec
  mandu_list_routes: "SPEC",
  mandu_get_route: "SPEC",
  mandu_add_route: "SPEC+",
  mandu_update_route: "SPEC~",
  mandu_delete_route: "SPEC-",
  mandu_validate_manifest: "SPEC?",
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

type MonitorSeverity = "info" | "warn" | "error";
type MonitorOutputFormat = "pretty" | "json";
type MonitorOutputPreference = MonitorOutputFormat | "auto" | "console" | "agent";
const SCHEMA_VERSION = "1.0";

interface MonitorStoreConfig {
  enabled?: boolean;
  retentionDays?: number;
  maxArchived?: number;
}

interface MonitorConfig {
  output?: MonitorOutputPreference;
  openTerminal?: boolean;
  dedupeWindowMs?: number;
  flushIntervalMs?: number;
  summaryIntervalMs?: number;
  store?: MonitorStoreConfig;
}

interface MonitorEvent {
  ts: string;
  type: string;
  severity: MonitorSeverity;
  source: string;
  message?: string;
  data?: Record<string, unknown>;
  actionRequired?: boolean;
  fingerprint?: string;
  count?: number;
  schemaVersion?: string;
}

interface DedupeEntry {
  event: MonitorEvent;
  count: number;
  windowStart: number;
  lastTs: number;
}

const DEFAULT_CONFIG: Required<MonitorConfig> = {
  output: "auto",
  openTerminal: true,
  dedupeWindowMs: 1500,
  flushIntervalMs: 500,
  summaryIntervalMs: 30000,
  store: {
    enabled: true,
    retentionDays: 7,
    maxArchived: 20,
  },
};

function normalizeOutput(
  value: MonitorOutputPreference | undefined
): MonitorOutputFormat | undefined {
  if (!value) return undefined;
  if (value === "json" || value === "agent") return "json";
  if (value === "pretty" || value === "console") return "pretty";
  return undefined;
}

function resolveOutputFormat(
  preference: MonitorOutputPreference | undefined
): MonitorOutputFormat {
  const env = process.env;
  const direct =
    normalizeOutput(preference) ??
    normalizeOutput(env.MANDU_MONITOR_FORMAT as MonitorOutputPreference) ??
    normalizeOutput(env.MANDU_OUTPUT as MonitorOutputPreference);

  if (direct) return direct;

  const agentSignals = [
    "MANDU_AGENT",
    "CODEX_AGENT",
    "CODEX",
    "CLAUDE_CODE",
    "ANTHROPIC_CLAUDE_CODE",
  ];

  for (const key of agentSignals) {
    const value = env[key];
    if (value === "1" || value === "true") {
      return "json";
    }
  }

  if (env.CI === "true") {
    return "json";
  }

  if (process.stdout && !process.stdout.isTTY) {
    return "json";
  }

  return "pretty";
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("ko-KR", { hour12: false });
}

function getTime(): string {
  return formatTime(new Date().toISOString());
}

function summarizeArgs(args: Record<string, unknown> | null | undefined): string {
  if (!args || Object.keys(args).length === 0) return "";
  const entries = Object.entries(args)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const val =
        typeof v === "string"
          ? v.length > 40
            ? v.slice(0, 40) + "..."
            : v
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
  if (obj.passed === false) {
    return ` >> FAILED (${(obj.violations as unknown[])?.length || 0} violations)`;
  }
  if (obj.valid === true) return obj.message ? ` >> ${obj.message}` : " >> VALID";
  if (obj.valid === false) {
    return ` >> INVALID (${(obj.violations as unknown[])?.length || 0} violations)`;
  }
  if (obj.generated) return " >> Generated";
  if (obj.status) return ` >> ${JSON.stringify(obj.status).slice(0, 60)}`;

  return "";
}

function mergeConfig(
  base: Required<MonitorConfig>,
  override: MonitorConfig
): Required<MonitorConfig> {
  return {
    ...base,
    ...override,
    store: {
      ...base.store,
      ...override.store,
    },
  };
}

function loadMonitorConfig(projectRoot: string): MonitorConfig {
  try {
    const configPath = path.join(projectRoot, ".mandu", "monitor.config.json");
    if (!fs.existsSync(configPath)) return {};
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function ensureManduDir(projectRoot: string): string {
  const manduDir = path.join(projectRoot, ".mandu");
  if (!fs.existsSync(manduDir)) {
    fs.mkdirSync(manduDir, { recursive: true });
  }
  return manduDir;
}

function writeDefaultConfig(projectRoot: string, config: Required<MonitorConfig>): void {
  try {
    const configPath = path.join(projectRoot, ".mandu", "monitor.config.json");
    if (fs.existsSync(configPath)) return;
    const template = {
      output: config.output,
      openTerminal: config.openTerminal,
      dedupeWindowMs: config.dedupeWindowMs,
      flushIntervalMs: config.flushIntervalMs,
      summaryIntervalMs: config.summaryIntervalMs,
      store: {
        enabled: config.store.enabled,
        retentionDays: config.store.retentionDays,
        maxArchived: config.store.maxArchived,
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(template, null, 2));
  } catch {
    // ignore config write errors
  }
}

export class ActivityMonitor {
  private logFile = "";
  private logStream: fs.WriteStream | null = null;
  private tailProcess: Subprocess | null = null;
  private projectRoot: string;
  private config: Required<MonitorConfig>;
  private outputFormat: MonitorOutputFormat;
  private pending: MonitorEvent[] = [];
  private dedupeMap = new Map<string, DedupeEntry>();
  private flushTimer: NodeJS.Timeout | null = null;
  private summaryTimer: NodeJS.Timeout | null = null;
  private summaryCounts = { total: 0, info: 0, warn: 0, error: 0 };
  private lastToolArgs = new Map<string, Record<string, unknown> | null>();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    const userConfig = loadMonitorConfig(projectRoot);
    this.config = mergeConfig(DEFAULT_CONFIG, userConfig);
    // When openTerminal is enabled, force pretty format for human-readable terminal output
    this.outputFormat = this.config.openTerminal
      ? "pretty"
      : resolveOutputFormat(this.config.output);
  }

  start(): void {
    const manduDir = ensureManduDir(this.projectRoot);
    writeDefaultConfig(this.projectRoot, this.config);
    const extension = this.outputFormat === "json" ? "jsonl" : "log";
    this.logFile = path.join(manduDir, `activity.${extension}`);

    if (this.config.store.enabled) {
      this.archiveExistingLog();
      this.pruneArchivedLogs();
    }

    this.logStream = fs.createWriteStream(this.logFile, { flags: "w" });

    if (this.outputFormat === "pretty") {
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
    }

    if (this.config.flushIntervalMs > 0) {
      this.flushTimer = setInterval(
        () => this.flush(false),
        this.config.flushIntervalMs
      );
    }

    if (
      this.outputFormat === "pretty" &&
      this.config.summaryIntervalMs > 0
    ) {
      this.summaryTimer = setInterval(
        () => this.emitSummary(),
        this.config.summaryIntervalMs
      );
    }

    if (this.config.openTerminal) {
      this.openTerminal();
    }
  }

  stop(): void {
    this.flush(true);
    if (this.tailProcess) {
      this.tailProcess.kill();
      this.tailProcess = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.summaryTimer) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = null;
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
    this.lastToolArgs.set(name, args ?? null);
    const argsStr = summarizeArgs(args);
    const tag = TOOL_ICONS[name] || name.replace("mandu_", "").toUpperCase();

    if (error) {
      this.enqueue({
        ts: new Date().toISOString(),
        type: "tool.error",
        severity: "error",
        source: "tool",
        message: `ERROR: ${error}`,
        actionRequired: true,
        fingerprint: `tool:error:${name}:${argsStr}`,
        data: { tool: name, tag, args, argsSummary: argsStr, error },
      });
      return;
    }

    this.enqueue({
      ts: new Date().toISOString(),
      type: "tool.call",
      severity: "info",
      source: "tool",
      data: { tool: name, tag, args, argsSummary: argsStr },
    });
  }

  /**
   * Log a tool result
   */
  logResult(name: string, result: unknown): void {
    const lastArgs = this.lastToolArgs.get(name) ?? null;
    if (this.lastToolArgs.has(name)) {
      this.lastToolArgs.delete(name);
    }
    const summary = summarizeResult(result);
    const tag = TOOL_ICONS[name] || name.replace("mandu_", "").toUpperCase();

    if (summary) {
      this.enqueue({
        ts: new Date().toISOString(),
        type: "tool.result",
        severity: "info",
        source: "tool",
        data: { tool: name, tag, summary },
      });
    }

    this.logStructuredResult(name, result, lastArgs);
  }

  /**
   * Log a watch event (called from watcher)
   */
  logWatch(level: string, ruleId: string, file: string, message: string): void {
    const severity: MonitorSeverity =
      level === "error" ? "error" : level === "info" ? "info" : "warn";

    this.enqueue({
      ts: new Date().toISOString(),
      type: "watch.warning",
      severity,
      source: "watch",
      message,
      actionRequired: severity !== "info",
      fingerprint: `watch:${ruleId}:${file}:${message}`,
      data: { ruleId, file, level, message },
    });
  }

  /**
   * Log a custom event
   */
  logEvent(category: string, message: string): void {
    this.enqueue({
      ts: new Date().toISOString(),
      type: "system.event",
      severity: "info",
      source: "system",
      message,
      data: { category },
    });
  }

  private logStructuredResult(
    name: string,
    result: unknown,
    lastArgs: Record<string, unknown> | null
  ): void {
    if (!result || typeof result !== "object") return;
    const obj = result as Record<string, unknown>;

    if (name === "mandu_guard_check") {
      const violations = Array.isArray(obj.violations) ? obj.violations : [];
      const passed = obj.passed === true;
      const count = violations.length;

      if (count > 0) {
        this.enqueue({
          ts: new Date().toISOString(),
          type: "guard.summary",
          severity: passed ? "info" : "error",
          source: "guard",
          actionRequired: !passed,
          fingerprint: `guard:summary:${count}`,
          data: { passed, count },
        });

        for (const violation of violations) {
          const v = violation as Record<string, unknown>;
          const ruleId = (v.ruleId as string | undefined) ?? "UNKNOWN_RULE";
          const file = v.file as string | undefined;
          const line = typeof v.line === "number" ? v.line : undefined;
          const column = typeof v.column === "number" ? v.column : undefined;
          const message =
            (v.message as string | undefined) ??
            (v.reason as string | undefined) ??
            "Guard violation";
          const suggestion =
            (v.suggestion as string | undefined) ??
            (v.tip as string | undefined);

          this.enqueue({
            ts: new Date().toISOString(),
            type: "guard.violation",
            severity: "error",
            source: "guard",
            message,
            actionRequired: true,
            fingerprint: `guard:${ruleId}:${file ?? ""}:${line ?? ""}:${column ?? ""}`,
            data: {
              ruleId,
              file,
              line,
              column,
              message,
              suggestion,
            },
          });
        }
      }

      return;
    }

    if (name === "mandu_check_location") {
      const allowed = obj.allowed === true;
      if (allowed) return;

      const violations = Array.isArray(obj.violations) ? obj.violations : [];
      const argPath = typeof lastArgs?.path === "string" ? lastArgs.path : undefined;
      for (const violation of violations) {
        const v = violation as Record<string, unknown>;
        const ruleId = (v.rule as string | undefined) ?? "LOCATION_RULE";
        const message = (v.message as string | undefined) ?? "Location violation";
        const severity = (v.severity as MonitorSeverity | undefined) ?? "warn";

        this.enqueue({
          ts: new Date().toISOString(),
          type: "guard.violation",
          severity,
          source: "architecture",
          message,
          actionRequired: severity !== "info",
          fingerprint: `guard:location:${ruleId}:${argPath ?? ""}`,
          data: {
            ruleId,
            file: argPath,
            message,
            suggestion: obj.suggestion,
            recommendedPath: obj.recommendedPath,
          },
        });
      }
      return;
    }

    if (name === "mandu_check_import") {
      const allowed = obj.allowed === true;
      if (allowed) return;

      const violations = Array.isArray(obj.violations) ? obj.violations : [];
      const sourceFile = typeof lastArgs?.sourceFile === "string" ? lastArgs.sourceFile : undefined;
      for (const violation of violations) {
        const v = violation as Record<string, unknown>;
        const message = (v.reason as string | undefined) ?? "Import violation";
        const suggestion = v.suggestion as string | undefined;
        const importTarget = typeof v.import === "string" ? v.import : undefined;

        this.enqueue({
          ts: new Date().toISOString(),
          type: "guard.violation",
          severity: "error",
          source: "architecture",
          message,
          actionRequired: true,
          fingerprint: `guard:import:${sourceFile ?? ""}:${importTarget ?? ""}`,
          data: {
            ruleId: "IMPORT_RULE",
            file: sourceFile,
            import: importTarget,
            message,
            suggestion,
          },
        });
      }
      return;
    }

    if (
      name === "mandu_add_route" ||
      name === "mandu_update_route" ||
      name === "mandu_delete_route"
    ) {
      if (obj.success !== true) return;
      const action =
        name === "mandu_add_route"
          ? "add"
          : name === "mandu_update_route"
            ? "update"
            : "delete";
      const route =
        (obj.route as Record<string, unknown> | undefined) ??
        (obj.deletedRoute as Record<string, unknown> | undefined);

      this.enqueue({
        ts: new Date().toISOString(),
        type: "routes.change",
        severity: "info",
        source: "routes",
        actionRequired: false,
        fingerprint: `routes:${action}:${route?.id ?? ""}`,
        data: {
          action,
          routeId: route?.id,
          pattern: route?.pattern,
          kind: route?.kind,
        },
      });
    }
  }

  private enqueue(event: MonitorEvent): void {
    if (!this.logStream) return;
    const now = Date.now();

    if (!event.fingerprint || this.config.dedupeWindowMs <= 0) {
      this.pending.push(event);
      return;
    }

    const existing = this.dedupeMap.get(event.fingerprint);
    if (!existing) {
      this.dedupeMap.set(event.fingerprint, {
        event,
        count: 1,
        windowStart: now,
        lastTs: now,
      });
      return;
    }

    if (now - existing.windowStart >= this.config.dedupeWindowMs) {
      this.pending.push(this.withCount(existing));
      this.dedupeMap.set(event.fingerprint, {
        event,
        count: 1,
        windowStart: now,
        lastTs: now,
      });
      return;
    }

    existing.count += 1;
    existing.lastTs = now;
    existing.event = event;
  }

  private flush(force: boolean): void {
    if (!this.logStream) return;
    const now = Date.now();
    const windowMs = this.config.dedupeWindowMs;

    for (const [key, entry] of this.dedupeMap) {
      const idleMs = now - entry.lastTs;
      if (force || idleMs >= windowMs) {
        this.pending.push(this.withCount(entry));
        this.dedupeMap.delete(key);
      }
    }

    if (this.pending.length === 0) return;

    for (const event of this.pending) {
      const line = this.formatEvent(event);
      if (!line) continue;
      this.write(line);
      this.updateSummary(event);
    }

    this.pending = [];
  }

  private withCount(entry: DedupeEntry): MonitorEvent {
    return {
      ...entry.event,
      count: entry.count,
    };
  }

  private formatEvent(event: MonitorEvent): string {
    if (this.outputFormat === "json") {
      const payload = event.schemaVersion
        ? event
        : { schemaVersion: SCHEMA_VERSION, ...event };
      return `${JSON.stringify(payload)}\n`;
    }
    return this.formatEventPretty(event);
  }

  private formatEventPretty(event: MonitorEvent): string {
    const time = formatTime(event.ts);
    const countSuffix = event.count && event.count > 1 ? ` x${event.count}` : "";

    switch (event.type) {
      case "tool.call": {
        const tag = event.data?.tag as string | undefined;
        const argsSummary = event.data?.argsSummary as string | undefined;
        return `${time} → [${tag ?? "TOOL"}]${argsSummary ?? ""}${countSuffix}\n`;
      }
      case "tool.error": {
        const tag = event.data?.tag as string | undefined;
        const argsSummary = event.data?.argsSummary as string | undefined;
        const message = event.message ?? "ERROR";
        return `${time} ✗ [${tag ?? "TOOL"}]${argsSummary ?? ""}${countSuffix}\n       ${message}\n`;
      }
      case "tool.result": {
        const tag = event.data?.tag as string | undefined;
        const summary = event.data?.summary as string | undefined;
        if (!summary) return "";
        return `${time} ✓ [${tag ?? "TOOL"}]${summary}${countSuffix}\n`;
      }
      case "watch.warning": {
        const ruleId = event.data?.ruleId as string | undefined;
        const file = event.data?.file as string | undefined;
        const message = event.message ?? "";
        const icon = event.severity === "info" ? "ℹ" : "⚠";
        return `${time} ${icon} [WATCH:${ruleId ?? "UNKNOWN"}] ${file ?? ""}${countSuffix}\n       ${message}\n`;
      }
      case "system.event": {
        const category = event.data?.category as string | undefined;
        const message = event.message ?? "";
        return `${time}   [${category ?? "SYSTEM"}] ${message}${countSuffix}\n`;
      }
      case "monitor.summary": {
        return `${time} · SUMMARY ${event.message ?? ""}\n`;
      }
      default:
        return `${time}   [${event.type}] ${event.message ?? ""}${countSuffix}\n`;
    }
  }

  private updateSummary(event: MonitorEvent): void {
    const count = event.count ?? 1;
    this.summaryCounts.total += count;
    this.summaryCounts[event.severity] += count;
  }

  private emitSummary(): void {
    if (this.summaryCounts.total === 0) return;
    const seconds = Math.round(this.config.summaryIntervalMs / 1000);
    const message = `last ${seconds}s · total=${this.summaryCounts.total} · error=${this.summaryCounts.error} · warn=${this.summaryCounts.warn} · info=${this.summaryCounts.info}`;
    this.summaryCounts = { total: 0, info: 0, warn: 0, error: 0 };
    const summaryEvent: MonitorEvent = {
      ts: new Date().toISOString(),
      type: "monitor.summary",
      severity: "info",
      source: "monitor",
      message,
    };
    const line = this.formatEvent(summaryEvent);
    if (line) {
      this.write(line);
    }
  }

  private write(text: string): void {
    if (this.logStream) {
      this.logStream.write(text);
    }
  }

  private archiveExistingLog(): void {
    try {
      if (!fs.existsSync(this.logFile)) return;
      const dir = path.dirname(this.logFile);
      const base = path.basename(this.logFile);
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "")
        .slice(0, 15);
      const archived = path.join(dir, `${base}.${stamp}.bak`);
      fs.renameSync(this.logFile, archived);
    } catch {
      // ignore archive errors
    }
  }

  private pruneArchivedLogs(): void {
    try {
      const dir = path.dirname(this.logFile);
      const base = path.basename(this.logFile);
      const files = fs
        .readdirSync(dir)
        .filter((file) => file.startsWith(`${base}.`) && file.endsWith(".bak"));

      const entries = files
        .map((file) => {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          return { file, fullPath, mtime: stat.mtime.getTime() };
        })
        .sort((a, b) => b.mtime - a.mtime);

      const retentionMs =
        (this.config.store.retentionDays || 7) * 24 * 60 * 60 * 1000;
      const now = Date.now();

      for (const entry of entries) {
        if (now - entry.mtime > retentionMs) {
          fs.unlinkSync(entry.fullPath);
        }
      }

      const maxArchived = this.config.store.maxArchived || 20;
      const remaining = entries.filter((entry) => fs.existsSync(entry.fullPath));
      if (remaining.length > maxArchived) {
        const toRemove = remaining.slice(maxArchived);
        for (const entry of toRemove) {
          fs.unlinkSync(entry.fullPath);
        }
      }
    } catch {
      // ignore prune errors
    }
  }

  private openTerminal(): void {
    try {
      if (process.platform === "win32") {
        this.tailProcess = Bun.spawn(
          [
            "cmd",
            "/c",
            "start",
            "Mandu Activity Monitor",
            "powershell",
            "-NoExit",
            "-Command",
            `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 | Out-Null; Get-Content '${this.logFile}' -Wait -Encoding UTF8`,
          ],
          { cwd: this.projectRoot, stdio: ["ignore", "ignore", "ignore"] }
        );
      } else if (process.platform === "darwin") {
        this.tailProcess = Bun.spawn(
          ["osascript", "-e", `tell application "Terminal" to do script "tail -f '${this.logFile}'"`],
          { stdio: ["ignore", "ignore", "ignore"] }
        );
      } else {
        this.tailProcess = Bun.spawn(
          ["x-terminal-emulator", "-e", `tail -f '${this.logFile}'`],
          { cwd: this.projectRoot, stdio: ["ignore", "ignore", "ignore"] }
        );
      }
    } catch {
      // Terminal auto-open failed silently
    }
  }
}
