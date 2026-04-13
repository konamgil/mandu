/**
 * Mandu Monitor CLI
 *
 * Streams observability events from the running dev server's EventBus via
 * the `/__mandu/events` SSE endpoint. Falls back to tailing the legacy
 * `.mandu/activity.jsonl` / `activity.log` files when no dev server is
 * detected (or when `--no-server` is passed).
 *
 * Supported flags:
 *   --type <http|mcp|guard|build|error|cache|ws>
 *   --severity <info|warn|error>
 *   --trace <correlationId>
 *   --source <name>
 *   --stats              (aggregated stats from eventBus.getStats)
 *   --since <duration>   (e.g. "5m", "1h" — only used with --stats)
 *   --summary            (legacy summary mode for file-based logs)
 *   --no-server          (force file-tail fallback)
 *   --file <path>        (explicit log file)
 *   --follow=false       (don't stream — print snapshot and exit)
 */

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { resolveFromCwd, pathExists } from "../util/fs";
import { resolveOutputFormat } from "../util/output";
import { readRuntimeControl } from "../util/runtime-control";

type MonitorOutput = "console" | "json";

export type EventType = "http" | "mcp" | "guard" | "build" | "error" | "cache" | "ws";
export type SeverityLevel = "info" | "warn" | "error";

export type ExportFormat = "jsonl" | "otlp";

export interface MonitorOptions {
  follow?: boolean;
  summary?: boolean;
  since?: string;
  file?: string;
  type?: EventType;
  severity?: SeverityLevel;
  stats?: boolean;
  trace?: string;
  source?: string;
  noServer?: boolean;
  /** Phase 6-3: export historical events from SQLite store as jsonl or otlp */
  export?: ExportFormat;
  /** Output limit for export mode (default: 10000) */
  limit?: number;
}

/** Shape of an event coming from the EventBus SSE stream. */
interface BusEvent {
  id?: string;
  correlationId?: string;
  type?: string;
  severity?: SeverityLevel;
  source?: string;
  message?: string;
  timestamp?: number;
  duration?: number;
  data?: Record<string, unknown>;
}

/** Shape of a legacy activity.jsonl line. */
interface LegacyEvent {
  ts?: string;
  type?: string;
  severity?: SeverityLevel;
  source?: string;
  message?: string;
  data?: Record<string, unknown>;
  count?: number;
}

// ---------- Duration parsing ----------

function parseDuration(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2] ?? "m";
  switch (unit) {
    case "ms": return amount;
    case "s":  return amount * 1000;
    case "m":  return amount * 60 * 1000;
    case "h":  return amount * 60 * 60 * 1000;
    case "d":  return amount * 24 * 60 * 60 * 1000;
    default:   return undefined;
  }
}

// ---------- Filtering ----------

const SEVERITY_LEVELS: Record<string, number> = { info: 0, warn: 1, error: 2 };
const VALID_TYPES: ReadonlySet<string> = new Set([
  "http", "mcp", "guard", "build", "error", "cache", "ws",
]);

function matchesFilters(
  event: { type?: string; severity?: SeverityLevel; source?: string; correlationId?: string },
  opts: MonitorOptions,
): boolean {
  if (opts.type && !(event.type === opts.type || event.type?.startsWith(`${opts.type}.`))) {
    return false;
  }
  if (opts.severity) {
    const have = SEVERITY_LEVELS[event.severity ?? "info"] ?? 0;
    const want = SEVERITY_LEVELS[opts.severity] ?? 0;
    if (have < want) return false;
  }
  if (opts.source && event.source !== opts.source) return false;
  if (opts.trace && event.correlationId !== opts.trace) return false;
  return true;
}

// ---------- Formatting ----------

const SEVERITY_ICON: Record<SeverityLevel, string> = {
  info: "·",
  warn: "⚠",
  error: "✗",
};

const TYPE_TAG: Record<string, string> = {
  http:  "HTTP ",
  mcp:   "MCP  ",
  guard: "GUARD",
  build: "BUILD",
  cache: "CACHE",
  error: "ERROR",
  ws:    "WS   ",
};

function formatBusTime(ts?: number): string {
  const date = ts ? new Date(ts) : new Date();
  return date.toLocaleTimeString("en-US", { hour12: false });
}

function formatLegacyTime(ts?: string): string {
  const date = ts ? new Date(ts) : new Date();
  return date.toLocaleTimeString("en-US", { hour12: false });
}

function formatBusEventLine(event: BusEvent): string {
  const time = formatBusTime(event.timestamp);
  const severity: SeverityLevel = event.severity ?? "info";
  const icon = SEVERITY_ICON[severity];
  const tag = TYPE_TAG[event.type ?? ""] ?? (event.type ?? "EVENT").toUpperCase().padEnd(5);
  const dur = typeof event.duration === "number" ? ` ${Math.round(event.duration)}ms` : "";
  const trace = event.correlationId ? ` [${event.correlationId.slice(0, 8)}]` : "";
  const src = event.source ? ` <${event.source}>` : "";
  const msg = event.message ?? "";
  return `${time} ${icon} [${tag}]${src}${dur}${trace} ${msg}`;
}

function formatLegacyEventLine(event: LegacyEvent): string {
  const time = formatLegacyTime(event.ts);
  const countSuffix = event.count && event.count > 1 ? ` x${event.count}` : "";
  const type = event.type ?? "event";
  const severity: SeverityLevel = event.severity ?? "info";
  const icon = SEVERITY_ICON[severity];
  return `${time} ${icon} [${type}] ${event.message ?? ""}${countSuffix}`;
}

// ---------- SSE consumer ----------

async function fetchRecentSnapshot(baseUrl: string, opts: MonitorOptions): Promise<{
  events: BusEvent[];
  stats: Record<string, { count: number; errors: number; avgDuration: number }>;
} | null> {
  try {
    const url = new URL(`${baseUrl}/__mandu/events/recent`);
    if (opts.type) url.searchParams.set("type", opts.type);
    if (opts.severity) url.searchParams.set("severity", opts.severity);
    const windowMs = parseDuration(opts.since);
    if (windowMs) url.searchParams.set("windowMs", String(windowMs));
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return await res.json() as {
      events: BusEvent[];
      stats: Record<string, { count: number; errors: number; avgDuration: number }>;
    };
  } catch {
    return null;
  }
}

async function streamFromSSE(
  baseUrl: string,
  opts: MonitorOptions,
  output: MonitorOutput,
): Promise<void> {
  const url = new URL(`${baseUrl}/__mandu/events`);
  if (opts.type) url.searchParams.set("type", opts.type);
  if (opts.severity) url.searchParams.set("severity", opts.severity);
  if (opts.source) url.searchParams.set("source", opts.source);
  if (opts.trace) url.searchParams.set("trace", opts.trace);

  const res = await fetch(url, {
    headers: { Accept: "text/event-stream" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to connect to ${url}: HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Stop the process gracefully on Ctrl+C.
  const onSig = () => {
    try { reader.cancel().catch(() => {}); } catch { /* noop */ }
    process.exit(0);
  };
  process.once("SIGINT", onSig);
  process.once("SIGTERM", onSig);

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE messages are separated by blank lines.
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue;            // comment / heartbeat
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length === 0) continue;
      const payload = dataLines.join("\n");

      let event: BusEvent;
      try {
        event = JSON.parse(payload) as BusEvent;
      } catch {
        continue;
      }
      // Server-side filters cover type/severity/source/trace already, but
      // clients may apply additional severity escalation (>= filter).
      if (!matchesFilters(event, opts)) continue;

      if (output === "json") {
        process.stdout.write(`${JSON.stringify(event)}\n`);
      } else {
        process.stdout.write(`${formatBusEventLine(event)}\n`);
      }
    }
  }
}

// ---------- Stats rendering ----------

interface StatsBlock { count: number; errors: number; avgDuration: number }

function printStatsConsole(
  stats: Record<string, StatsBlock>,
  windowMs: number,
): void {
  const mins = Math.max(1, Math.round(windowMs / 60000));
  console.log(`\nLast ${mins} minute${mins !== 1 ? "s" : ""}:\n`);

  const fmt = (label: string, key: string, unit: string) => {
    const s = stats[key];
    if (!s || s.count === 0) return null;
    const avg = Math.round(s.avgDuration);
    return `  ${label.padEnd(7)} ${s.count} ${unit}${avg ? `, avg ${avg}ms` : ""}${s.errors ? `, ${s.errors} error${s.errors !== 1 ? "s" : ""}` : ""}`;
  };

  const rows = [
    fmt("HTTP:",  "http",  "req"),
    fmt("MCP:",   "mcp",   "calls"),
    fmt("Guard:", "guard", "violations"),
    fmt("Build:", "build", "rebuilds"),
    fmt("Cache:", "cache", "ops"),
    fmt("WS:",    "ws",    "msgs"),
    fmt("Error:", "error", "events"),
  ].filter((l): l is string => l !== null);

  if (rows.length === 0) {
    console.log("  (no events recorded in window)");
  } else {
    for (const row of rows) console.log(row);
  }
  console.log("");
}

// ---------- Legacy file-tail fallback ----------

async function resolveLogFile(
  rootDir: string,
  output: MonitorOutput,
  explicit?: string,
): Promise<string | null> {
  if (explicit) return explicit;
  const manduDir = path.join(rootDir, ".mandu");
  const jsonPath = path.join(manduDir, "activity.jsonl");
  const logPath  = path.join(manduDir, "activity.log");
  const hasJson = await pathExists(jsonPath);
  const hasLog  = await pathExists(logPath);
  if (output === "json") {
    if (hasJson) return jsonPath;
    if (hasLog) return logPath;
  } else {
    if (hasLog) return logPath;
    if (hasJson) return jsonPath;
  }
  return null;
}

function outputLegacyChunk(
  chunk: string,
  isJson: boolean,
  output: MonitorOutput,
  filters: MonitorOptions,
): void {
  if (!isJson || output === "json") {
    process.stdout.write(chunk);
    return;
  }
  for (const line of chunk.split("\n").filter(Boolean)) {
    try {
      const event = JSON.parse(line) as LegacyEvent;
      if (!matchesFilters(event, filters)) continue;
      process.stdout.write(`${formatLegacyEventLine(event)}\n`);
    } catch {
      process.stdout.write(`${line}\n`);
    }
  }
}

async function followLegacyFile(
  filePath: string,
  isJson: boolean,
  output: MonitorOutput,
  filters: MonitorOptions,
): Promise<void> {
  let position = 0;
  let buffer = "";
  try {
    const stat = await fs.stat(filePath);
    position = stat.size;
  } catch { position = 0; }

  const fd = await fs.open(filePath, "r");
  fsSync.watchFile(filePath, { interval: 500 }, async (curr) => {
    if (curr.size < position) { position = 0; buffer = ""; }
    if (curr.size === position) return;
    const length = curr.size - position;
    const chunk = Buffer.alloc(length);
    await fd.read(chunk, 0, length, position);
    position = curr.size;
    buffer += chunk.toString("utf-8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    if (lines.length > 0) {
      outputLegacyChunk(lines.join("\n"), isJson, output, filters);
    }
  });
}

async function runFileFallback(
  rootDir: string,
  options: MonitorOptions,
  output: MonitorOutput,
): Promise<boolean> {
  const filePath = await resolveLogFile(rootDir, output, options.file);
  if (!filePath) {
    console.error("Activity log file not found (.mandu/activity.log or activity.jsonl) and no dev server is running.");
    return false;
  }
  const isJson = filePath.endsWith(".jsonl");
  const follow = options.follow !== false;

  if (!follow) {
    const content = await fs.readFile(filePath, "utf-8");
    outputLegacyChunk(content, isJson, output, options);
    return true;
  }

  if (output !== "json") {
    console.log(`(no dev server detected — tailing ${path.relative(rootDir, filePath)})`);
  }
  await followLegacyFile(filePath, isJson, output, options);
  return new Promise(() => {});
}

// ---------- Entry ----------

function validateOptions(opts: MonitorOptions): string | null {
  if (opts.type && !VALID_TYPES.has(opts.type)) {
    return `Invalid --type "${opts.type}". Expected one of: ${[...VALID_TYPES].join(", ")}.`;
  }
  if (opts.severity && !(opts.severity in SEVERITY_LEVELS)) {
    return `Invalid --severity "${opts.severity}". Expected one of: info, warn, error.`;
  }
  if (opts.since && parseDuration(opts.since) === undefined) {
    return `Invalid --since "${opts.since}". Expected duration like "30s", "5m", "1h".`;
  }
  return null;
}

export async function monitor(options: MonitorOptions = {}): Promise<boolean> {
  const validation = validateOptions(options);
  if (validation) {
    console.error(validation);
    return false;
  }

  const rootDir = resolveFromCwd(".");
  const resolved = resolveOutputFormat();
  const output: MonitorOutput = resolved === "json" || resolved === "agent" ? "json" : "console";

  // Phase 6-3: Export mode — read historical events directly from SQLite store
  if (options.export) {
    if (options.export !== "jsonl" && options.export !== "otlp") {
      console.error(`Invalid --export format "${options.export}". Expected: jsonl, otlp.`);
      return false;
    }
    try {
      const obs = await import("@mandujs/core/observability");
      // Initialize store to read existing data (no-op if already started)
      await obs.startSqliteStore(rootDir);
      const queryOpts = {
        type: options.type,
        severity: options.severity,
        source: options.source,
        correlationId: options.trace,
        sinceMs: options.since ? Date.now() - (parseDuration(options.since) ?? 0) : undefined,
        limit: options.limit ?? 10_000,
      };
      const text = options.export === "jsonl"
        ? obs.exportJsonl(queryOpts)
        : obs.exportOtlp(queryOpts);
      process.stdout.write(text);
      if (options.export === "jsonl") process.stdout.write("\n");
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`Export failed: ${detail}`);
      return false;
    }
  }

  // 1. Try connecting to a running dev server (unless --no-server / --file).
  const useServer = !options.noServer && !options.file;
  const runtime = useServer ? await readRuntimeControl(rootDir) : null;
  const baseUrl = runtime?.baseUrl;

  // Stats mode — fetch a one-shot snapshot from the server.
  if (options.stats) {
    if (baseUrl) {
      const snapshot = await fetchRecentSnapshot(baseUrl, options);
      if (snapshot) {
        const windowMs = parseDuration(options.since) ?? 5 * 60 * 1000;
        if (output === "json") {
          console.log(JSON.stringify({ windowMs, stats: snapshot.stats }, null, 2));
        } else {
          printStatsConsole(snapshot.stats, windowMs);
        }
        return true;
      }
    }
    // Fallback: legacy file-based stats are no longer supported in stats mode.
    console.error("Stats mode requires a running dev server (start `mandu dev` first).");
    return false;
  }

  // Streaming/snapshot mode against the SSE endpoint.
  if (baseUrl) {
    try {
      // Snapshot-only mode (--follow=false): print recent events and exit.
      if (options.follow === false) {
        const snapshot = await fetchRecentSnapshot(baseUrl, options);
        if (snapshot) {
          for (const event of snapshot.events) {
            if (!matchesFilters(event, options)) continue;
            if (output === "json") {
              process.stdout.write(`${JSON.stringify(event)}\n`);
            } else {
              process.stdout.write(`${formatBusEventLine(event)}\n`);
            }
          }
          return true;
        }
      } else {
        if (output !== "json") {
          console.log(`(streaming from ${baseUrl}/__mandu/events — Ctrl+C to exit)`);
        }
        await streamFromSSE(baseUrl, options, output);
        return true;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`SSE connection failed (${detail}) — falling back to file tailing.`);
    }
  }

  // 2. Fallback to legacy file-based monitoring.
  return runFileFallback(rootDir, options, output);
}
