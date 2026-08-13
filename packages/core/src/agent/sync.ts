import fs from "fs/promises";
import path from "path";
import type {
  AgentSuggestedCommand,
  AgentSyncFile,
  AgentSyncReport,
  AgentSyncTarget,
  BuildAgentSyncOptions,
} from "./types";

const SYNC_ROOT = path.join(".mandu", "agent-sync");
const TARGETS = ["codex", "claude", "gemini"] as const;
type ConcreteTarget = (typeof TARGETS)[number];

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function isTarget(value: string | undefined): value is AgentSyncTarget {
  return value === "codex" || value === "claude" || value === "gemini" || value === "all";
}

function concreteTargets(target: AgentSyncTarget): ConcreteTarget[] {
  return target === "all" ? [...TARGETS] : [target];
}

function targetFile(target: ConcreteTarget): string {
  if (target === "codex") return path.join(SYNC_ROOT, "codex", "AGENTS.md");
  if (target === "claude") return path.join(SYNC_ROOT, "claude", "CLAUDE.md");
  return path.join(SYNC_ROOT, "gemini", "GEMINI.md");
}

function renderInstructions(target: ConcreteTarget): string {
  const title =
    target === "codex"
      ? "Codex"
      : target === "claude"
        ? "Claude Code"
        : "Gemini CLI";
  return [
    `# Mandu Agent Workflow for ${title}`,
    "",
    "Mandu is an agent-native fullstack framework. Use the official agent surface before direct source edits.",
    "",
    "## Canonical Loop",
    "",
    "```text",
    "context -> plan -> apply -> verify -> repair",
    "```",
    "",
    "## Required First Choices",
    "",
    "1. Start with `mandu.agent.context` or `mandu agent context --json`.",
    "2. Create a plan with `mandu.agent.plan` or `mandu agent plan \"<task>\" --json --write`.",
    "3. Bind explicit typed operations with `mandu.agent.plan`; intent-only plans are read-only previews.",
    "4. Preview apply first. Execute only a bound plan with MCP `dryRun=false` or CLI `--execute`.",
    "5. Inspect the ApplyReceipt verification and rollback fields, then run `mandu.agent.verify` after broader edits.",
    "6. If needed, restore a receipt snapshot with `mandu agent repair --rollback <rollbackId> --apply`.",
    "",
    "## MCP Profile",
    "",
    "Use the reduced default profile:",
    "",
    "```bash",
    "MANDU_MCP_PROFILE=agent-core",
    "```",
    "",
    "`agent-full` is a compatibility alias of `agent-core`. Use `internal` only for framework maintenance.",
    "",
    "## Domain Skill Escalation",
    "",
    "- route/api: `mandu-fs-routes`",
    "- hydration/island/partial: `mandu-hydration`",
    "- contract/slot consistency: `mandu-contract`",
    "- guard/import boundary: `mandu-guard`",
    "- test/e2e: `mandu-testing`",
    "",
    "Domain skills are addenda. They do not replace the canonical loop.",
    "",
  ].join("\n");
}

function renderClaudeSkill(): string {
  return [
    "---",
    "name: mandu-agent-workflow",
    "description: Canonical context -> plan -> apply -> verify -> repair workflow for Mandu projects.",
    "---",
    "",
    "# Mandu Agent Workflow",
    "",
    "Use this skill first in Mandu projects. Follow `context -> plan -> apply -> verify -> repair`.",
    "",
    "Preferred tools: `mandu.agent.context`, `mandu.agent.plan`, `mandu.agent.apply`, `mandu.agent.verify`, `mandu.agent.repair`.",
    "",
    "CLI fallback:",
    "",
    "```bash",
    "mandu agent context --json",
    "mandu agent plan \"<task>\" --json --write",
    "mandu agent apply --from .mandu/agent-plan.json --json",
    "mandu agent apply --from .mandu/agent-plan.json --execute --write --json",
    "mandu agent verify --changed --json --write",
    "mandu agent repair --from .mandu/agent-verify.json --json",
    "```",
    "",
  ].join("\n");
}

function syncEntries(target: ConcreteTarget): Array<{ target: ConcreteTarget; relPath: string; content: string }> {
  const entries = [
    {
      target,
      relPath: targetFile(target),
      content: renderInstructions(target),
    },
  ];
  if (target === "claude") {
    entries.push({
      target,
      relPath: path.join(SYNC_ROOT, "claude", "skills", "mandu-agent-workflow", "SKILL.md"),
      content: renderClaudeSkill(),
    });
  }
  return entries;
}

async function writeEntry(
  rootDir: string,
  entry: { target: ConcreteTarget; relPath: string; content: string },
  dryRun: boolean,
): Promise<AgentSyncFile> {
  const absPath = path.join(rootDir, entry.relPath);
  let action: AgentSyncFile["action"] = "created";
  try {
    const existing = await fs.readFile(absPath, "utf8");
    action = existing === entry.content ? "unchanged" : "updated";
  } catch {
    action = "created";
  }

  if (dryRun) {
    action = "planned";
  } else if (action !== "unchanged") {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, entry.content, "utf8");
  }

  return {
    target: entry.target,
    path: toPosix(entry.relPath),
    action,
    bytes: Buffer.byteLength(entry.content, "utf8"),
  };
}

function nextCommands(): AgentSuggestedCommand[] {
  return [
    {
      command: "mandu agent context --json",
      reason: "Confirm the generated workflow matches the current project state.",
      required: true,
    },
    {
      command: "MANDU_MCP_PROFILE=agent-core",
      reason: "Use the reduced default MCP exposure for coding agents.",
      required: true,
    },
  ];
}

export async function buildAgentSyncReport(
  rootDir: string = process.cwd(),
  options: BuildAgentSyncOptions = {},
): Promise<AgentSyncReport> {
  const target = isTarget(options.target) ? options.target : "all";
  const dryRun = options.dryRun === true;
  const root = path.resolve(rootDir);
  const files: AgentSyncFile[] = [];

  for (const concrete of concreteTargets(target)) {
    for (const entry of syncEntries(concrete)) {
      files.push(await writeEntry(root, entry, dryRun));
    }
  }

  return {
    schemaVersion: 1,
    framework: "mandu",
    generatedAt: new Date().toISOString(),
    ok: true,
    target,
    profile: "agent-core",
    workflow: ["context", "plan", "apply", "verify", "repair"],
    files,
    warnings: dryRun ? ["Dry-run only. No files were written."] : [],
    nextCommands: nextCommands(),
  };
}
