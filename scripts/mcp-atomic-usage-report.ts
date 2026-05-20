#!/usr/bin/env bun
/**
 * MCP Atomic Usage Report
 *
 * Parses `.mandu/activity.jsonl` to surface:
 *   - Top called atomic tools (most-used)
 *   - Zero-call atomics (deprecation candidates)
 *   - Per-profile call distribution (validates profile sizing)
 *
 * Usage:
 *   bun scripts/mcp-atomic-usage-report.ts
 *   bun scripts/mcp-atomic-usage-report.ts --days 30
 *   bun scripts/mcp-atomic-usage-report.ts --json
 *   bun scripts/mcp-atomic-usage-report.ts --log path/to/activity.jsonl
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TOOL_MODULES } from "../packages/mcp/src/tools/index";
import {
  EXPERT_ONLY_CATEGORIES,
  PROFILE_CATEGORIES,
} from "../packages/mcp/src/profiles";

interface CliArgs {
  logPath: string;
  days?: number;
  json: boolean;
  top: number;
}

interface ToolCallEvent {
  ts: string;
  tool: string;
}

interface TopEntry {
  tool: string;
  calls: number;
  category: string;
  profile: ProfileLabel;
}

interface ZeroEntry {
  tool: string;
  category: string;
  profile: ProfileLabel;
}

interface ProfileRollup {
  profile: ProfileLabel;
  tools: number;
  calls: number;
}

interface Report {
  scanned: {
    logPath: string;
    events: number;
    period: string;
  };
  totals: {
    totalCalls: number;
    distinctTools: number;
    totalTools: number;
  };
  topCalled: TopEntry[];
  zeroCall: ZeroEntry[];
  byProfile: ProfileRollup[];
}

type ProfileLabel = "agent-core" | "agent-full" | "expert" | "unknown";

const DAY_MS = 86_400_000;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    logPath: ".mandu/activity.jsonl",
    json: false,
    top: 20,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--days") args.days = Number(argv[++i]);
    else if (flag === "--log") args.logPath = argv[++i];
    else if (flag === "--top") args.top = Number(argv[++i]);
    else if (flag === "--json") args.json = true;
    else if (flag === "--help" || flag === "-h") {
      console.log(
        [
          "Usage: bun scripts/mcp-atomic-usage-report.ts [options]",
          "  --log <path>   Path to activity.jsonl (default: .mandu/activity.jsonl)",
          "  --days <n>     Only count events within the last N days",
          "  --top <n>      Number of top tools to show (default: 20)",
          "  --json         Emit JSON instead of text",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  return args;
}

function loadEvents(logPath: string, days?: number): ToolCallEvent[] {
  const cutoff = days ? Date.now() - days * DAY_MS : 0;
  const events: ToolCallEvent[] = [];
  const raw = readFileSync(logPath, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let evt: { ts?: string; type?: string; data?: { tool?: string } };
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.type !== "tool.call") continue;
    const tool = evt.data?.tool;
    if (!tool || !evt.ts) continue;
    if (days && new Date(evt.ts).getTime() < cutoff) continue;
    events.push({ ts: evt.ts, tool });
  }
  return events;
}

function buildCatalog(): Map<string, string> {
  const byTool = new Map<string, string>();
  for (const module of TOOL_MODULES) {
    for (const def of module.definitions) byTool.set(def.name, module.category);
  }
  return byTool;
}

function classifyCategory(category: string): ProfileLabel {
  if (PROFILE_CATEGORIES["agent-core"]!.includes(category)) return "agent-core";
  if (PROFILE_CATEGORIES["agent-full"]!.includes(category)) return "agent-full";
  if (EXPERT_ONLY_CATEGORIES.has(category)) return "expert";
  return "unknown";
}

export function buildReport(args: CliArgs): Report {
  const events = loadEvents(args.logPath, args.days);
  const catalog = buildCatalog();

  const counts = new Map<string, number>();
  for (const evt of events) counts.set(evt.tool, (counts.get(evt.tool) ?? 0) + 1);

  const topCalled: TopEntry[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, args.top)
    .map(([tool, calls]) => {
      const category = catalog.get(tool) ?? "(unregistered)";
      return { tool, calls, category, profile: classifyCategory(category) };
    });

  const zeroCall: ZeroEntry[] = [];
  for (const [tool, category] of catalog) {
    if (!counts.has(tool)) {
      zeroCall.push({ tool, category, profile: classifyCategory(category) });
    }
  }
  zeroCall.sort((a, b) => a.tool.localeCompare(b.tool));

  const rollup: Record<ProfileLabel, ProfileRollup> = {
    "agent-core": { profile: "agent-core", tools: 0, calls: 0 },
    "agent-full": { profile: "agent-full", tools: 0, calls: 0 },
    expert: { profile: "expert", tools: 0, calls: 0 },
    unknown: { profile: "unknown", tools: 0, calls: 0 },
  };
  for (const [tool, category] of catalog) {
    const profile = classifyCategory(category);
    rollup[profile].tools++;
    rollup[profile].calls += counts.get(tool) ?? 0;
  }

  return {
    scanned: {
      logPath: args.logPath,
      events: events.length,
      period: args.days ? `last ${args.days} days` : "all-time",
    },
    totals: {
      totalCalls: events.length,
      distinctTools: counts.size,
      totalTools: catalog.size,
    },
    topCalled,
    zeroCall,
    byProfile: (["agent-core", "agent-full", "expert", "unknown"] as ProfileLabel[])
      .map((p) => rollup[p])
      .filter((r) => r.tools > 0 || r.calls > 0),
  };
}

function renderText(report: Report): string {
  const lines: string[] = [];
  const divider = "=".repeat(64);
  const sub = "-".repeat(64);

  lines.push("MCP Atomic Usage Report");
  lines.push(divider);
  lines.push(`Log:    ${report.scanned.logPath}`);
  lines.push(`Period: ${report.scanned.period}`);
  lines.push(`Events: ${report.scanned.events} tool.call records`);
  lines.push("");
  lines.push(
    `Distinct tools called: ${report.totals.distinctTools} of ${report.totals.totalTools}`,
  );
  lines.push("");

  lines.push(`Top ${report.topCalled.length} called tools`);
  lines.push(sub);
  if (report.topCalled.length === 0) {
    lines.push("  (no tool.call events in scanned log)");
  } else {
    for (const t of report.topCalled) {
      const name = t.tool.padEnd(44);
      const calls = String(t.calls).padStart(6);
      lines.push(`  ${name} ${calls}  [${t.profile}]`);
    }
  }
  lines.push("");

  lines.push("Profile rollup");
  lines.push(sub);
  for (const p of report.byProfile) {
    const profile = p.profile.padEnd(12);
    const tools = String(p.tools).padStart(4);
    const calls = String(p.calls).padStart(6);
    lines.push(`  ${profile} tools: ${tools}   calls: ${calls}`);
  }
  lines.push("");

  lines.push(`Zero-call tools (deprecation candidates): ${report.zeroCall.length}`);
  lines.push(sub);
  if (report.zeroCall.length === 0) {
    lines.push("  (all registered tools were called at least once)");
  } else {
    const byProfile: Record<ProfileLabel, string[]> = {
      "agent-core": [],
      "agent-full": [],
      expert: [],
      unknown: [],
    };
    for (const z of report.zeroCall) byProfile[z.profile].push(z.tool);
    for (const profile of [
      "agent-core",
      "agent-full",
      "expert",
      "unknown",
    ] as ProfileLabel[]) {
      const tools = byProfile[profile];
      if (tools.length === 0) continue;
      lines.push(`  [${profile}] ${tools.length} tools`);
      for (const t of tools.slice(0, 10)) lines.push(`    - ${t}`);
      if (tools.length > 10) lines.push(`    ... and ${tools.length - 10} more`);
    }
  }

  return lines.join("\n");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const absLog = resolve(args.logPath);
  if (!existsSync(absLog)) {
    console.error(`Activity log not found: ${absLog}`);
    console.error(`Run the MCP server to produce one, or pass --log <path>.`);
    process.exit(1);
  }
  args.logPath = absLog;

  const report = buildReport(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderText(report));
  }
}

if (import.meta.main) {
  main();
}

export { parseArgs };
