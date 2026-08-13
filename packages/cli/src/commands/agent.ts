import fs from "fs/promises";
import path from "path";
import {
  buildAgentApplyReport,
  buildAgentContext,
  buildExecutableAgentPlan,
  buildAgentPlan,
  buildAgentRepairReport,
  buildAgentSyncReport,
  buildAgentVerifyReport,
  writeAgentApplyReport,
  toAgentManifest,
  writeAgentPlan,
  writeAgentManifest,
  writeAgentRepairReport,
  writeAgentVerifyReport,
  type AgentApplyReport,
  type AgentContext,
  type AgentManifest,
  type AgentPlan,
  type AgentOperationInput,
  type AgentRepairReport,
  type AgentSyncReport,
  type AgentSyncTarget,
  type AgentVerifyReport,
} from "@mandujs/core/compat/agent/index";
import { getRootDir } from "../util/fs";
import { theme } from "../terminal";

export type AgentSubcommand =
  | "context"
  | "manifest"
  | "plan"
  | "apply"
  | "verify"
  | "repair"
  | "sync";

export interface AgentCommandOptions {
  action?: AgentSubcommand;
  json?: boolean;
  write?: boolean;
  changed?: boolean;
  staged?: boolean;
  base?: string;
  from?: string;
  intent?: string;
  operations?: string;
  rollbackId?: string;
  dryRun?: boolean;
  target?: AgentSyncTarget;
  apply?: boolean;
  cwd?: string;
  includeDiagnose?: boolean;
  includeGit?: boolean;
  includeGuard?: boolean;
  includeContract?: boolean;
}

export const AGENT_HELP = [
  "",
  "  mandu agent — canonical agent workflow",
  "",
  "  Official loop:",
  "    context -> plan -> apply -> verify -> repair",
  "",
  "  Available now:",
  "    context [--json] [--no-diagnose]    Print project context for agents.",
  "    manifest [--write] [--json]         Build the agent manifest, optionally writing .mandu/agent-manifest.json.",
  "    plan <intent> [--json] [--write]     Convert a natural-language task into a conservative work plan.",
  "    plan <intent> --operations <file>    Bind typed operations and preconditions into an executable plan.",
  "    apply [--from <file>] [--json]       Validate and preview a typed plan (no writes by default).",
  "    apply --from <file> --execute        Apply typed operations with snapshot rollback and a receipt.",
  "    verify [--changed] [--json]         Run one agent-facing verification report.",
  "",
  "    repair [--from <file>] [--json]      Convert a verify report into next actions.",
  "    repair --rollback <id> --apply       Restore a receipt snapshot unless later edits conflict.",
  "    sync [--target all] [--json]         Emit Codex/Claude/Gemini workflow artifacts.",
  "",
  "  Examples:",
  "    mandu agent context --json",
  "    mandu agent manifest --write",
  "    mandu agent plan \"add authenticated dashboard\" --json --write",
  "    mandu agent apply --from .mandu/agent-plan.json --json",
  "    mandu agent verify --changed --json",
  "    mandu agent repair --from .mandu/agent-verify.json --json",
  "    mandu agent sync --target all",
  "",
].join("\n");

function normalizeRoot(cwd: string | undefined): string {
  return cwd && cwd !== "true" ? path.resolve(cwd) : getRootDir();
}

function resolveInsideRoot(rootDir: string, value: string): string {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, value);
  const rootKey = process.platform === "win32" ? root.toLowerCase() : root;
  const resolvedKey = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  if (resolvedKey !== rootKey && !resolvedKey.startsWith(`${rootKey}${path.sep}`)) {
    throw new Error("typed operation input must stay inside the project root");
  }
  return resolved;
}

function printContextSummary(context: AgentContext): void {
  console.log(theme.heading("Mandu Agent Context"));
  console.log("");
  console.log(`project:  ${context.project.name ?? "(unnamed)"}`);
  console.log(`root:     ${context.project.root}`);
  console.log(`routes:   ${context.routes.length} (${context.routeSource})`);
  console.log(`pages:    ${context.pages.length}`);
  console.log(`apis:     ${context.apis.length}`);
  console.log(`partials: ${context.partials.length}`);
  console.log(`islands:  ${context.islands.length}`);
  console.log(`slots:    ${context.slots.length}`);
  console.log(`contracts:${context.contracts.length}`);
  console.log(`guard:    ${context.guards.preset ?? "default"}`);
  if (context.diagnose) {
    console.log(
      `diagnose: ${context.diagnose.healthy ? "healthy" : "unhealthy"} ` +
        `(${context.diagnose.errorCount} error, ${context.diagnose.warningCount} warning)`,
    );
  }
  if (context.warnings.length > 0) {
    console.log("");
    console.log(theme.warn("warnings:"));
    for (const warning of context.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log("");
  console.log(theme.muted("next: mandu agent plan \"<task>\" --json"));
}

function printManifestSummary(result: { path?: string; manifest: AgentManifest }): void {
  console.log(theme.heading("Mandu Agent Manifest"));
  if (result.path) {
    console.log(`written: ${result.path}`);
  }
  console.log(`routes: ${result.manifest.routes.length}`);
  console.log(`apis:   ${result.manifest.apis.length}`);
  console.log(`steps:  ${result.manifest.agentWorkflow.canonical.join(" -> ")}`);
}

function printPlanSummary(result: { path?: string; plan: AgentPlan }): void {
  const { plan } = result;
  console.log(theme.heading("Mandu Agent Plan"));
  if (result.path) {
    console.log(`written: ${result.path}`);
  }
  console.log(`intent:  ${plan.intent}`);
  console.log(`domains: ${plan.domains.join(", ")}`);
  console.log(`reads:   ${plan.filesToRead.length}`);
  console.log(`creates: ${plan.filesToCreate.length}`);
  console.log(`tools:   ${plan.mcpTools.length}`);
  if (plan.risks.length > 0) {
    console.log("");
    console.log("risks:");
    for (const risk of plan.risks) {
      console.log(`  - ${risk.level}: ${risk.reason}`);
    }
  }
  console.log("");
  console.log(theme.muted("next: mandu agent apply --from .mandu/agent-plan.json --json"));
}

function printApplySummary(result: { path?: string; report: AgentApplyReport }): void {
  const { report } = result;
  console.log(theme.heading("Mandu Agent Apply"));
  if (result.path) {
    console.log(`written: ${result.path}`);
  }
  console.log(`status: ${report.ok ? "ready" : "blocked"}`);
  console.log(`dry run: ${report.dryRun ? "yes" : "no"}`);
  console.log(`plan:   ${report.sourcePlan}`);
  console.log(`actions:${report.actions.length}`);
  for (const action of report.actions.slice(0, 10)) {
    const suffix = action.tool ? ` -> ${action.tool}` : action.file ? ` -> ${action.file}` : action.command ? ` -> ${action.command}` : "";
    console.log(`  - ${action.kind}${suffix}`);
  }
  if (report.actions.length > 10) {
    console.log(`  - ... ${report.actions.length - 10} more`);
  }
  if (report.warnings.length > 0) {
    console.log("");
    console.log(theme.warn("warnings:"));
    for (const warning of report.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log("");
  console.log(theme.muted(`next: ${report.nextVerifyCommand}`));
}

function printVerifySummary(result: { path?: string; report: AgentVerifyReport }): void {
  const { report } = result;
  console.log(theme.heading("Mandu Agent Verify"));
  if (result.path) {
    console.log(`written: ${result.path}`);
  }
  console.log(`status: ${report.ok ? "ok" : "failed"}`);
  console.log(`changed files: ${report.changedFiles.length}`);
  console.log(`checks: ${report.checks.length}`);
  for (const check of report.checks) {
    console.log(`  - ${check.id}: ${check.ok ? "ok" : check.severity} (${check.diagnostics})`);
  }
  if (report.diagnostics.length > 0) {
    console.log("");
    console.log(theme.warn("diagnostics:"));
    for (const diagnostic of report.diagnostics.slice(0, 8)) {
      const location = diagnostic.file ? ` ${diagnostic.file}` : "";
      console.log(`  - [${diagnostic.severity}] ${diagnostic.code}${location}: ${diagnostic.cause}`);
    }
    if (report.diagnostics.length > 8) {
      console.log(`  - ... ${report.diagnostics.length - 8} more`);
    }
  }
  if (report.suggestedCommands.length > 0) {
    console.log("");
    console.log("suggested commands:");
    for (const suggestion of report.suggestedCommands) {
      console.log(`  - ${suggestion.command}`);
    }
  }
}

function printRepairSummary(result: { path?: string; report: AgentRepairReport }): void {
  const { report } = result;
  console.log(theme.heading("Mandu Agent Repair"));
  if (result.path) {
    console.log(`written: ${result.path}`);
  }
  console.log(`status: ${report.status}`);
  console.log(`actions: ${report.actions.length}`);
  for (const action of report.actions.slice(0, 10)) {
    const suffix = action.command ? ` -> ${action.command}` : action.file ? ` -> ${action.file}` : "";
    console.log(`  - ${action.kind} ${action.diagnosticCode}${suffix}`);
  }
  if (report.warnings.length > 0) {
    console.log("");
    console.log(theme.warn("warnings:"));
    for (const warning of report.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log("");
  console.log(theme.muted(`next: ${report.nextVerifyCommand}`));
}

function printSyncSummary(report: AgentSyncReport): void {
  console.log(theme.heading("Mandu Agent Sync"));
  console.log(`target:  ${report.target}`);
  console.log(`profile: ${report.profile}`);
  console.log(`files:   ${report.files.length}`);
  for (const file of report.files) {
    console.log(`  - ${file.action}: ${file.path}`);
  }
  if (report.warnings.length > 0) {
    console.log("");
    console.log(theme.warn("warnings:"));
    for (const warning of report.warnings) {
      console.log(`  - ${warning}`);
    }
  }
  console.log("");
  console.log(theme.muted("next: mandu agent context --json"));
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function planned(action: string): boolean {
  console.error(
    [
      `mandu agent ${action} is planned but not implemented yet.`,
      "Current implementation checkpoint: context + plan + apply + verify + repair.",
      "See docs/plans/20_agent_surface_consolidation_plan.md.",
    ].join("\n"),
  );
  return false;
}

export async function agent(options: AgentCommandOptions = {}): Promise<boolean> {
  const action = options.action;
  if (!action) {
    process.stdout.write(AGENT_HELP);
    return false;
  }

  const rootDir = normalizeRoot(options.cwd);
  const includeDiagnose = options.includeDiagnose !== false;
  const includeGit = options.includeGit !== false;
  const includeGuard = options.includeGuard !== false;
  const includeContract = options.includeContract !== false;

  switch (action) {
    case "context": {
      const context = await buildAgentContext(rootDir, { includeDiagnose, includeGit });
      if (options.json) {
        printJson(context);
      } else {
        printContextSummary(context);
      }
      return true;
    }

    case "manifest": {
      const context = await buildAgentContext(rootDir, { includeDiagnose, includeGit });
      if (options.write) {
        const result = await writeAgentManifest(rootDir, context);
        if (options.json) {
          printJson({ path: result.path, manifest: result.manifest });
        } else {
          printManifestSummary(result);
        }
        return true;
      }
      const manifest = toAgentManifest(context);
      if (options.json) {
        printJson(manifest);
      } else {
        printManifestSummary({ manifest });
      }
      return true;
    }

    case "plan": {
      let intent = options.intent?.trim();
      let plan: AgentPlan;
      if (options.operations) {
        const operationPath = resolveInsideRoot(rootDir, options.operations);
        const draft = JSON.parse(await fs.readFile(operationPath, "utf8")) as {
          intent?: unknown;
          operations?: unknown;
          idempotencyKey?: unknown;
          rollbackPolicy?: unknown;
        };
        if (!intent && typeof draft.intent === "string") intent = draft.intent.trim();
        if (!Array.isArray(draft.operations)) {
          console.error("Typed operation input must contain an operations array.");
          return false;
        }
        if (!intent) {
          console.error("Typed operation input requires an intent in the file or command arguments.");
          return false;
        }
        plan = await buildExecutableAgentPlan(rootDir, {
          intent,
          operations: draft.operations as AgentOperationInput[],
          idempotencyKey:
            typeof draft.idempotencyKey === "string" ? draft.idempotencyKey : undefined,
          rollbackPolicy:
            draft.rollbackPolicy === "manual" || draft.rollbackPolicy === "automatic"
              ? draft.rollbackPolicy
              : undefined,
        });
      } else {
        if (!intent) {
          console.error("Usage: mandu agent plan \"<task>\" --json");
          return false;
        }
        plan = buildAgentPlan({ intent });
      }
      if (options.write) {
        const result = await writeAgentPlan(rootDir, plan);
        if (options.json) {
          printJson({ path: result.path, plan: result.plan });
        } else {
          printPlanSummary(result);
        }
        return true;
      }
      if (options.json) {
        printJson(plan);
      } else {
        printPlanSummary({ plan });
      }
      return true;
    }

    case "apply": {
      const report = await buildAgentApplyReport(rootDir, {
        from: options.from,
        dryRun: options.dryRun,
      });
      if (options.write) {
        const result = await writeAgentApplyReport(rootDir, report);
        if (options.json) {
          printJson({ path: result.path, report: result.report });
        } else {
          printApplySummary(result);
        }
        return report.ok;
      }
      if (options.json) {
        printJson(report);
      } else {
        printApplySummary({ report });
      }
      return report.ok;
    }

    case "verify": {
      const report = await buildAgentVerifyReport(rootDir, {
        changedOnly: options.changed !== false,
        staged: options.staged,
        base: options.base,
        includeDiagnose,
        includeGit,
        includeGuard,
        includeContract,
      });
      if (options.write) {
        const result = await writeAgentVerifyReport(rootDir, report);
        if (options.json) {
          printJson({ path: result.path, report: result.report });
        } else {
          printVerifySummary(result);
        }
        return report.ok;
      }
      if (options.json) {
        printJson(report);
      } else {
        printVerifySummary({ report });
      }
      return report.ok;
    }

    case "repair": {
      const report = await buildAgentRepairReport(rootDir, {
        from: options.from,
        apply: options.apply === true,
        rollbackId: options.rollbackId,
      });
      if (options.write) {
        const result = await writeAgentRepairReport(rootDir, report);
        if (options.json) {
          printJson({ path: result.path, report: result.report });
        } else {
          printRepairSummary(result);
        }
        return report.ok;
      }
      if (options.json) {
        printJson(report);
      } else {
        printRepairSummary({ report });
      }
      return report.ok;
    }

    case "sync": {
      const report = await buildAgentSyncReport(rootDir, {
        target: options.target,
        dryRun: options.dryRun,
      });
      if (options.json) {
        printJson(report);
      } else {
        printSyncSummary(report);
      }
      return report.ok;
    }

    default:
      return planned(action);
  }
}
