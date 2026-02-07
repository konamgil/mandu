import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { resolveFromCwd, pathExists } from "../util/fs";
import { resolveOutputFormat } from "../util/output";

type MonitorOutput = "console" | "json";

export interface MonitorOptions {
  follow?: boolean;
  summary?: boolean;
  since?: string;
  file?: string;
}

interface MonitorEvent {
  ts?: string;
  type?: string;
  severity?: "info" | "warn" | "error";
  source?: string;
  message?: string;
  data?: Record<string, unknown>;
  count?: number;
}

function parseDuration(value?: string): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+)(ms|s|m|h|d)?$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2] ?? "m";
  switch (unit) {
    case "ms":
      return amount;
    case "s":
      return amount * 1000;
    case "m":
      return amount * 60 * 1000;
    case "h":
      return amount * 60 * 60 * 1000;
    case "d":
      return amount * 24 * 60 * 60 * 1000;
    default:
      return undefined;
  }
}

function formatTime(ts?: string): string {
  const date = ts ? new Date(ts) : new Date();
  return date.toLocaleTimeString("ko-KR", { hour12: false });
}

function formatEventForConsole(event: MonitorEvent): string {
  const time = formatTime(event.ts);
  const countSuffix = event.count && event.count > 1 ? ` x${event.count}` : "";
  const type = event.type ?? "event";

  if (type === "tool.call") {
    const tag = (event.data?.tag as string | undefined) ?? "TOOL";
    const argsSummary = event.data?.argsSummary as string | undefined;
    return `${time} → [${tag}]${argsSummary ?? ""}${countSuffix}`;
  }
  if (type === "tool.error") {
    const tag = (event.data?.tag as string | undefined) ?? "TOOL";
    const argsSummary = event.data?.argsSummary as string | undefined;
    const message = event.message ?? "ERROR";
    return `${time} ✗ [${tag}]${argsSummary ?? ""}${countSuffix}\n       ${message}`;
  }
  if (type === "tool.result") {
    const tag = (event.data?.tag as string | undefined) ?? "TOOL";
    const summary = event.data?.summary as string | undefined;
    return `${time} ✓ [${tag}]${summary ?? ""}${countSuffix}`;
  }
  if (type === "watch.warning") {
    const ruleId = event.data?.ruleId as string | undefined;
    const file = event.data?.file as string | undefined;
    const message = event.message ?? "";
    const icon = event.severity === "info" ? "ℹ" : "⚠";
    return `${time} ${icon} [WATCH:${ruleId ?? "UNKNOWN"}] ${file ?? ""}${countSuffix}\n       ${message}`;
  }
  if (type === "guard.violation") {
    const ruleId = event.data?.ruleId as string | undefined;
    const file = event.data?.file as string | undefined;
    const line = event.data?.line as number | undefined;
    const message = event.message ?? (event.data?.message as string | undefined) ?? "";
    const location = line ? `${file}:${line}` : file ?? "";
    return `${time} 🚨 [GUARD:${ruleId ?? "UNKNOWN"}] ${location}${countSuffix}\n       ${message}`;
  }
  if (type === "guard.summary") {
    const count = event.data?.count as number | undefined;
    const passed = event.data?.passed as boolean | undefined;
    return `${time} 🧱 [GUARD] ${passed ? "PASSED" : "FAILED"} (${count ?? 0} violations)`;
  }
  if (type === "routes.change") {
    const action = event.data?.action as string | undefined;
    const routeId = event.data?.routeId as string | undefined;
    const pattern = event.data?.pattern as string | undefined;
    const kind = event.data?.kind as string | undefined;
    const detail = [routeId, pattern, kind].filter(Boolean).join(" ");
    return `${time} 🛣️  [ROUTES:${action ?? "change"}] ${detail}${countSuffix}`;
  }
  if (type === "monitor.summary") {
    return `${time} · SUMMARY ${event.message ?? ""}`;
  }
  if (type === "system.event") {
    const category = event.data?.category as string | undefined;
    return `${time}   [${category ?? "SYSTEM"}] ${event.message ?? ""}${countSuffix}`;
  }

  return `${time}   [${type}] ${event.message ?? ""}${countSuffix}`;
}

async function resolveLogFile(
  rootDir: string,
  output: MonitorOutput,
  explicit?: string
): Promise<string | null> {
  if (explicit) return explicit;

  const manduDir = path.join(rootDir, ".mandu");
  const jsonPath = path.join(manduDir, "activity.jsonl");
  const logPath = path.join(manduDir, "activity.log");

  const hasJson = await pathExists(jsonPath);
  const hasLog = await pathExists(logPath);

  if (output === "json") {
    if (hasJson) return jsonPath;
    if (hasLog) return logPath;
  } else {
    if (hasLog) return logPath;
    if (hasJson) return jsonPath;
  }

  return null;
}

async function readSummary(
  filePath: string,
  sinceMs: number
): Promise<{
  windowMs: number;
  total: number;
  bySeverity: { info: number; warn: number; error: number };
  byType: Record<string, number>;
}> {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  const cutoff = Date.now() - sinceMs;
  const counts = { total: 0, info: 0, warn: 0, error: 0 };
  const byType: Record<string, number> = {};

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as MonitorEvent;
      if (!event.ts) continue;
      const ts = new Date(event.ts).getTime();
      if (Number.isNaN(ts) || ts < cutoff) continue;
      const count = event.count ?? 1;
      counts.total += count;
      if (event.severity) {
        counts[event.severity] += count;
      }
      const type = event.type ?? "event";
      byType[type] = (byType[type] ?? 0) + count;
    } catch {
      // ignore parse errors
    }
  }

  return { windowMs: sinceMs, total: counts.total, bySeverity: counts, byType };
}

function printSummaryConsole(summary: {
  windowMs: number;
  total: number;
  bySeverity: { info: number; warn: number; error: number };
  byType: Record<string, number>;
}): void {
  const seconds = Math.round(summary.windowMs / 1000);
  const topTypes = Object.entries(summary.byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => `${type}=${count}`)
    .join(", ");

  console.log(`Summary (last ${seconds}s)`);
  console.log(`  total=${summary.total}`);
  console.log(`  error=${summary.bySeverity.error} warn=${summary.bySeverity.warn} info=${summary.bySeverity.info}`);
  if (topTypes) {
    console.log(`  top=${topTypes}`);
  }
}

function outputChunk(
  chunk: string,
  isJson: boolean,
  output: MonitorOutput
): void {
  if (!isJson || output === "json") {
    process.stdout.write(chunk);
    return;
  }

  const lines = chunk.split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const event = JSON.parse(line) as MonitorEvent;
      const formatted = formatEventForConsole(event);
      process.stdout.write(`${formatted}\n`);
    } catch {
      process.stdout.write(`${line}\n`);
    }
  }
}

async function followFile(
  filePath: string,
  isJson: boolean,
  output: MonitorOutput,
  startAtEnd: boolean
): Promise<void> {
  let position = 0;
  let buffer = "";

  try {
    const stat = await fs.stat(filePath);
    position = startAtEnd ? stat.size : 0;
  } catch {
    position = 0;
  }

  const fd = await fs.open(filePath, "r");

  fsSync.watchFile(
    filePath,
    { interval: 500 },
    async (curr) => {
      if (curr.size < position) {
        position = 0;
        buffer = "";
      }
      if (curr.size === position) {
        return;
      }

      const length = curr.size - position;
      const chunk = Buffer.alloc(length);
      await fd.read(chunk, 0, length, position);
      position = curr.size;
      buffer += chunk.toString("utf-8");

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (lines.length > 0) {
        outputChunk(lines.join("\n"), isJson, output);
      }
    }
  );
}

export async function monitor(options: MonitorOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  const resolved = resolveOutputFormat();
  const output: MonitorOutput = resolved === "json" || resolved === "agent" ? "json" : "console";
  const filePath = await resolveLogFile(rootDir, output, options.file);

  if (!filePath) {
    console.error("❌ activity log 파일을 찾을 수 없습니다. (.mandu/activity.log 또는 activity.jsonl)");
    return false;
  }

  const isJson = filePath.endsWith(".jsonl");
  const follow = options.follow !== false;

  if (options.summary) {
    if (!isJson) {
      console.error("⚠️  summary는 JSON 로그(activity.jsonl)에서만 가능합니다.");
    } else {
      const windowMs = parseDuration(options.since) ?? 5 * 60 * 1000;
      const summary = await readSummary(filePath, windowMs);
      if (output === "json") {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        printSummaryConsole(summary);
      }
    }
    if (!follow) return true;
  }

  if (!follow) {
    const content = await fs.readFile(filePath, "utf-8");
    outputChunk(content, isJson, output);
    return true;
  }

  await followFile(filePath, isJson, output, true);
  return new Promise(() => {});
}
