import type { Tool } from "@modelcontextprotocol/sdk/types.js";
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
  writeAgentManifest,
  writeAgentPlan,
  writeAgentRepairReport,
  writeAgentVerifyReport,
  type AgentOperationInput,
} from "@mandujs/core/compat/agent/index";

interface AgentContextInput {
  cwd?: unknown;
  includeDiagnose?: unknown;
  includeGit?: unknown;
  writeManifest?: unknown;
}

interface AgentVerifyInput {
  cwd?: unknown;
  changedOnly?: unknown;
  includeDiagnose?: unknown;
  includeGit?: unknown;
  includeGuard?: unknown;
  includeContract?: unknown;
  staged?: unknown;
  base?: unknown;
  writeReport?: unknown;
}

interface AgentPlanInput {
  cwd?: unknown;
  intent?: unknown;
  operations?: unknown;
  idempotencyKey?: unknown;
  rollbackPolicy?: unknown;
  writePlan?: unknown;
}

interface AgentApplyInput {
  cwd?: unknown;
  from?: unknown;
  dryRun?: unknown;
  writeReport?: unknown;
}

interface AgentSyncInput {
  cwd?: unknown;
  target?: unknown;
  dryRun?: unknown;
}

interface AgentRepairInput {
  cwd?: unknown;
  from?: unknown;
  apply?: unknown;
  rollbackId?: unknown;
  writeReport?: unknown;
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return fallback;
}

function resolveCwd(projectRoot: string, value: unknown): string {
  const root = path.resolve(projectRoot);
  const resolved =
    typeof value === "string" && value.length > 0
      ? path.resolve(root, value)
      : root;
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("cwd must stay inside the MCP project root");
  }
  return resolved;
}

async function runAgentContext(
  projectRoot: string,
  input: AgentContextInput,
) {
  const cwd = resolveCwd(projectRoot, input.cwd);
  const context = await buildAgentContext(cwd, {
    includeDiagnose: boolOrDefault(input.includeDiagnose, true),
    includeGit: boolOrDefault(input.includeGit, true),
  });

  if (boolOrDefault(input.writeManifest, false)) {
    const { path, manifest } = await writeAgentManifest(cwd, context);
    return {
      ...context,
      manifest: {
        path,
        written: true,
        schemaVersion: manifest.schemaVersion,
      },
    };
  }

  return context;
}

async function runAgentPlan(
  projectRoot: string,
  input: AgentPlanInput,
) {
  const cwd = resolveCwd(projectRoot, input.cwd);
  const intent = typeof input.intent === "string" ? input.intent.trim() : "";
  if (!intent) {
    throw new Error("intent is required for mandu.agent.plan");
  }

  const plan = Array.isArray(input.operations) && input.operations.length > 0
    ? await buildExecutableAgentPlan(cwd, {
        intent,
        operations: input.operations as AgentOperationInput[],
        idempotencyKey:
          typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined,
        rollbackPolicy:
          input.rollbackPolicy === "automatic" || input.rollbackPolicy === "manual"
            ? input.rollbackPolicy
            : undefined,
      })
    : buildAgentPlan({ intent });

  if (boolOrDefault(input.writePlan, false)) {
    const { path, plan: written } = await writeAgentPlan(cwd, plan);
    return {
      ...written,
      plan: {
        path,
        written: true,
        schemaVersion: written.schemaVersion,
      },
    };
  }

  return plan;
}

async function runAgentApply(
  projectRoot: string,
  input: AgentApplyInput,
) {
  const cwd = resolveCwd(projectRoot, input.cwd);
  const report = await buildAgentApplyReport(cwd, {
    from: typeof input.from === "string" && input.from.length > 0 ? input.from : undefined,
    dryRun: boolOrDefault(input.dryRun, true),
  });

  if (boolOrDefault(input.writeReport, false)) {
    const { path, report: written } = await writeAgentApplyReport(cwd, report);
    return {
      ...written,
      report: {
        path,
        written: true,
        schemaVersion: written.schemaVersion,
      },
    };
  }

  return report;
}

async function runAgentVerify(
  projectRoot: string,
  input: AgentVerifyInput,
) {
  const cwd = resolveCwd(projectRoot, input.cwd);
  const report = await buildAgentVerifyReport(cwd, {
    changedOnly: boolOrDefault(input.changedOnly, true),
    includeDiagnose: boolOrDefault(input.includeDiagnose, true),
    includeGit: boolOrDefault(input.includeGit, true),
    includeGuard: boolOrDefault(input.includeGuard, true),
    includeContract: boolOrDefault(input.includeContract, true),
    staged: boolOrDefault(input.staged, false),
    base: typeof input.base === "string" && input.base.length > 0 ? input.base : undefined,
  });

  if (boolOrDefault(input.writeReport, false)) {
    const { path, report: written } = await writeAgentVerifyReport(cwd, report);
    return {
      ...written,
      report: {
        path,
        written: true,
        schemaVersion: written.schemaVersion,
      },
    };
  }

  return report;
}

async function runAgentRepair(
  projectRoot: string,
  input: AgentRepairInput,
) {
  const cwd = resolveCwd(projectRoot, input.cwd);
  const report = await buildAgentRepairReport(cwd, {
    from: typeof input.from === "string" && input.from.length > 0 ? input.from : undefined,
    apply: boolOrDefault(input.apply, false),
    rollbackId:
      typeof input.rollbackId === "string" && input.rollbackId.length > 0
        ? input.rollbackId
        : undefined,
  });

  if (boolOrDefault(input.writeReport, false)) {
    const { path, report: written } = await writeAgentRepairReport(cwd, report);
    return {
      ...written,
      report: {
        path,
        written: true,
        schemaVersion: written.schemaVersion,
      },
    };
  }

  return report;
}

async function runAgentSync(
  projectRoot: string,
  input: AgentSyncInput,
) {
  const cwd = resolveCwd(projectRoot, input.cwd);
  const target =
    input.target === "codex" ||
    input.target === "claude" ||
    input.target === "gemini" ||
    input.target === "all"
      ? input.target
      : "all";
  return buildAgentSyncReport(cwd, {
    target,
    dryRun: boolOrDefault(input.dryRun, false),
  });
}

export const agentToolDefinitions: Tool[] = [
  {
    name: "mandu.agent.context",
    description:
      "Official agent-core entry point. Returns one structured project context for Codex/Claude/Gemini: project metadata, routes/APIs, partials/islands, slots/contracts, guard summary, diagnostics, git state, and the canonical context -> plan -> apply -> verify -> repair workflow.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Project directory to inspect. Defaults to the MCP project root.",
        },
        includeDiagnose: {
          type: "boolean",
          description: "Include diagnose summary and normalized diagnostics. Defaults to true.",
        },
        includeGit: {
          type: "boolean",
          description: "Include git branch and changed-file summary. Defaults to true.",
        },
        writeManifest: {
          type: "boolean",
          description:
            "Write .mandu/agent-manifest.json while building context. Defaults to false.",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.agent.plan",
    description:
      "Official agent-core planning entry point. Without operations it returns a conservative intent preview. With typed operations it binds current content hashes, exact write scope, rollback policy, and an idempotency key into an executable plan.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Project directory to plan against. Defaults to the MCP project root.",
        },
        intent: {
          type: "string",
          description: "Natural-language task request, for example: add authenticated dashboard.",
        },
        operations: {
          type: "array",
          description:
            "Optional typed write operations. When present, the server binds current preconditions and returns an executable plan.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              kind: {
                type: "string",
                enum: [
                  "file.create",
                  "file.patch-with-hash",
                  "route.create",
                  "api.create",
                  "contract.update",
                  "guard.safe-fix",
                  "generated.refresh",
                ],
              },
              target: { type: "string" },
              effect: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["write"] },
                  content: { type: "string" },
                  encoding: { type: "string", enum: ["utf8"] },
                },
                required: ["type", "content", "encoding"],
              },
            },
            required: ["kind", "target", "effect"],
          },
        },
        idempotencyKey: {
          type: "string",
          description: "Optional stable retry key. A UUID is generated when omitted.",
        },
        rollbackPolicy: {
          type: "string",
          enum: ["automatic", "manual"],
          description: "Failure policy. Defaults to automatic rollback.",
        },
        writePlan: {
          type: "boolean",
          description: "Write .mandu/agent-plan.json while planning. Defaults to false.",
        },
      },
      required: ["intent"],
    },
  },
  {
    name: "mandu.agent.apply",
    description:
      "Official agent-core typed apply entry point. It previews by default. With dryRun=false it enforces exact scope, base revision and content hashes, snapshots touched files, applies UTF-8 write operations, verifies the result, rolls back failures by policy, and returns the shared ApplyReceipt schema.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Project directory. Defaults to the MCP project root.",
        },
        from: {
          type: "string",
          description: "Plan path relative to cwd. Defaults to .mandu/agent-plan.json.",
        },
        dryRun: {
          type: "boolean",
          description: "Validate and preview without writing. Defaults to true; set false to execute.",
        },
        writeReport: {
          type: "boolean",
          description: "Write .mandu/agent-apply.json. Defaults to false.",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.agent.verify",
    description:
      "Official agent-core verification entry point. Returns one structured report that combines changed files, diagnose, route manifest, guard, contract consistency, normalized diagnostics, and suggested follow-up commands.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Project directory to verify. Defaults to the MCP project root.",
        },
        changedOnly: {
          type: "boolean",
          description: "Filter guard/contract findings to changed files when git data exists. Defaults to true.",
        },
        includeDiagnose: {
          type: "boolean",
          description: "Run diagnose and include normalized diagnose diagnostics. Defaults to true.",
        },
        includeGit: {
          type: "boolean",
          description: "Collect git changed files. Defaults to true.",
        },
        includeGuard: {
          type: "boolean",
          description: "Run architecture guard if the routes manifest is available. Defaults to true.",
        },
        includeContract: {
          type: "boolean",
          description: "Run contract/slot consistency checks if the routes manifest is available. Defaults to true.",
        },
        staged: {
          type: "boolean",
          description: "Use staged changes only. Defaults to false.",
        },
        base: {
          type: "string",
          description: "Optional git base ref for changed-file detection.",
        },
        writeReport: {
          type: "boolean",
          description: "Write .mandu/agent-verify.json while verifying. Defaults to false.",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.agent.repair",
    description:
      "Official agent-core repair entry point. Reads an agent verify report and returns structured next actions, or restores an ApplyReceipt snapshot by rollbackId when apply=true. It never executes shell commands and preserves files changed after apply.",
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Project directory. Defaults to the MCP project root.",
        },
        from: {
          type: "string",
          description: "Verify report path relative to cwd. Defaults to .mandu/agent-verify.json.",
        },
        apply: {
          type: "boolean",
          description: "Apply safe typed patch candidates only. Defaults to false.",
        },
        rollbackId: {
          type: "string",
          description:
            "Optional rollback ID from an ApplyReceipt. With apply=true, restores the touched-file snapshot after conflict checks.",
        },
        writeReport: {
          type: "boolean",
          description: "Write .mandu/agent-repair.json. Defaults to false.",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.agent.sync",
    description:
      "Official agent sync helper. Writes or previews Codex, Claude Code, and Gemini CLI workflow artifacts under .mandu/agent-sync so each agent follows the same Mandu agent loop and MCP profile guidance.",
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Project directory. Defaults to the MCP project root.",
        },
        target: {
          type: "string",
          enum: ["codex", "claude", "gemini", "all"],
          description: "Agent target to sync. Defaults to all.",
        },
        dryRun: {
          type: "boolean",
          description: "Preview files without writing. Defaults to false.",
        },
      },
      required: [],
    },
  },
];

export function agentTools(projectRoot: string) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "mandu.agent.context": async (args) =>
      runAgentContext(projectRoot, args as AgentContextInput),
    "mandu.agent.plan": async (args) =>
      runAgentPlan(projectRoot, args as AgentPlanInput),
    "mandu.agent.apply": async (args) =>
      runAgentApply(projectRoot, args as AgentApplyInput),
    "mandu.agent.verify": async (args) =>
      runAgentVerify(projectRoot, args as AgentVerifyInput),
    "mandu.agent.repair": async (args) =>
      runAgentRepair(projectRoot, args as AgentRepairInput),
    "mandu.agent.sync": async (args) =>
      runAgentSync(projectRoot, args as AgentSyncInput),
  };
  return handlers;
}
