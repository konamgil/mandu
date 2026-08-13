import fs from "fs/promises";
import path from "path";
import { rollbackAgentApply } from "./apply";
import type {
  AgentDiagnostic,
  AgentRepairAction,
  AgentRepairReport,
  AgentVerifyReport,
  BuildAgentRepairOptions,
} from "./types";

const DEFAULT_VERIFY_INPUT = ".mandu/agent-verify.json";

function resolveInside(rootDir: string, value: string): string {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("repair input must stay inside the project root");
  }
  return resolved;
}

async function readVerifyReport(filePath: string): Promise<AgentVerifyReport | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as AgentVerifyReport;
    if (parsed?.framework !== "mandu" || !Array.isArray(parsed.diagnostics)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function actionForDiagnostic(diagnostic: AgentDiagnostic): AgentRepairAction {
  const fix = diagnostic.suggestedFix;
  if (!fix) {
    return {
      diagnosticCode: diagnostic.code,
      kind: "manual",
      description: `Inspect ${diagnostic.code}: ${diagnostic.cause}`,
      safeToApply: false,
      applied: false,
    };
  }

  if (fix.type === "run_command" && fix.command) {
    return {
      diagnosticCode: diagnostic.code,
      kind: "run_command",
      description: fix.description,
      command: fix.command,
      safeToApply: false,
      applied: false,
    };
  }

  if ((fix.type === "create_file" || fix.type === "modify_file") && fix.path) {
    return {
      diagnosticCode: diagnostic.code,
      kind: "patch",
      description: fix.description,
      file: fix.path,
      // Current diagnostic shape does not carry patch content. Keep this
      // conservative until a typed patch payload exists.
      safeToApply: false,
      applied: false,
    };
  }

  return {
    diagnosticCode: diagnostic.code,
    kind: "manual",
    description: fix.description,
    safeToApply: false,
    applied: false,
  };
}

export function agentRepairReportPath(rootDir: string): string {
  return path.join(rootDir, ".mandu", "agent-repair.json");
}

export async function buildAgentRepairReport(
  rootDir: string = process.cwd(),
  options: BuildAgentRepairOptions = {},
): Promise<AgentRepairReport> {
  const root = path.resolve(rootDir);
  const sourceRel = options.from ?? DEFAULT_VERIFY_INPUT;
  if (options.rollbackId) {
    const action: AgentRepairAction = {
      diagnosticCode: "MANDU_APPLY_ROLLBACK",
      kind: "patch",
      description: `Restore the touched-file snapshot ${options.rollbackId}.`,
      safeToApply: true,
      applied: false,
    };
    if (!options.apply) {
      return {
        schemaVersion: 1,
        framework: "mandu",
        generatedAt: new Date().toISOString(),
        ok: true,
        status: "ready",
        sourceReport: `rollback:${options.rollbackId}`,
        diagnostics: [],
        actions: [action],
        appliedActions: [],
        warnings: ["Rollback preview only. Re-run with --apply to restore the snapshot."],
        nextVerifyCommand: "mandu agent verify --changed --json --write",
      };
    }

    try {
      const rollback = await rollbackAgentApply(root, options.rollbackId);
      action.applied = rollback.restoredFiles.length > 0;
      const diagnostics: AgentDiagnostic[] = rollback.conflicts.map((conflict) => ({
        code: "MANDU_APPLY_ROLLBACK_CONFLICT",
        severity: "error",
        title: "Rollback preserved a later edit",
        cause: conflict,
        repairable: false,
        source: "agent.repair",
      }));
      return {
        schemaVersion: 1,
        framework: "mandu",
        generatedAt: new Date().toISOString(),
        ok: rollback.ok,
        status: rollback.ok ? "rolled_back" : "rollback_conflict",
        sourceReport: `rollback:${options.rollbackId}`,
        diagnostics,
        actions: [action],
        appliedActions: action.applied ? [action] : [],
        rollback,
        warnings: rollback.ok
          ? []
          : ["Rollback stopped at files changed after apply; those user edits were preserved."],
        nextVerifyCommand: "mandu agent verify --changed --json --write",
      };
    } catch (error) {
      return {
        schemaVersion: 1,
        framework: "mandu",
        generatedAt: new Date().toISOString(),
        ok: false,
        status: "rollback_conflict",
        sourceReport: `rollback:${options.rollbackId}`,
        diagnostics: [
          {
            code: "MANDU_APPLY_ROLLBACK_FAILED",
            severity: "error",
            title: "Rollback failed",
            cause: error instanceof Error ? error.message : String(error),
            repairable: false,
            source: "agent.repair",
          },
        ],
        actions: [action],
        appliedActions: [],
        warnings: [],
        nextVerifyCommand: "mandu agent verify --changed --json --write",
      };
    }
  }
  const sourcePath = resolveInside(root, sourceRel);
  const warnings: string[] = [];
  const report = await readVerifyReport(sourcePath);

  if (!report) {
    return {
      schemaVersion: 1,
      framework: "mandu",
      generatedAt: new Date().toISOString(),
      ok: false,
      status: "input_missing",
      sourceReport: sourceRel,
      diagnostics: [
        {
          code: "MANDU_REPAIR_INPUT_MISSING",
          severity: "error",
          title: "Agent verify report missing",
          cause: `Could not read ${sourceRel}.`,
          suggestedFix: {
            type: "run_command",
            command: "mandu agent verify --changed --json --write",
            description: "Generate a fresh agent verify report first.",
          },
          docs: "docs/plans/20_agent_surface_consolidation_plan.md",
          repairable: true,
          source: "agent.repair",
        },
      ],
      actions: [
        {
          diagnosticCode: "MANDU_REPAIR_INPUT_MISSING",
          kind: "run_command",
          description: "Generate a fresh agent verify report first.",
          command: "mandu agent verify --changed --json --write",
          safeToApply: false,
          applied: false,
        },
      ],
      appliedActions: [],
      warnings: [],
      nextVerifyCommand: "mandu agent verify --changed --json --write",
    };
  }

  const diagnostics = report.diagnostics;
  const actions = diagnostics.map(actionForDiagnostic);
  const appliedActions: AgentRepairAction[] = [];

  if (options.apply) {
    const safePatchActions = actions.filter((action) => action.kind === "patch" && action.safeToApply);
    if (safePatchActions.length === 0) {
      warnings.push("No safe file patch candidates were available to apply.");
    }
    // Future extension: apply typed patch payloads here. Command execution is
    // intentionally never auto-applied by repair.
  }

  return {
    schemaVersion: 1,
    framework: "mandu",
    generatedAt: new Date().toISOString(),
    ok: true,
    status: diagnostics.length === 0 ? "nothing_to_repair" : "ready",
    sourceReport: sourceRel,
    diagnostics,
    actions,
    appliedActions,
    warnings,
    nextVerifyCommand: "mandu agent verify --changed --json --write",
  };
}

export async function writeAgentRepairReport(
  rootDir: string = process.cwd(),
  report?: AgentRepairReport,
): Promise<{ path: string; report: AgentRepairReport }> {
  const value = report ?? await buildAgentRepairReport(rootDir);
  const outPath = agentRepairReportPath(rootDir);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { path: outPath, report: value };
}
