import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  agentManifestPath,
  buildAgentContext,
  readAgentManifest,
  writeAgentManifest,
} from "../context";
import {
  agentPlanPath,
  buildAgentApplyReport,
  buildAgentPlan,
  writeAgentApplyReport,
  writeAgentPlan,
} from "../plan";
import {
  agentRepairReportPath,
  buildAgentRepairReport,
  writeAgentRepairReport,
} from "../repair";
import { buildAgentSyncReport } from "../sync";
import {
  agentVerifyReportPath,
  buildAgentVerifyReport,
  writeAgentVerifyReport,
} from "../verify";

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

async function runGit(root: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: exitCode === 0, stdout, stderr };
  } catch (error) {
    return { ok: false, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

describe("agent context", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-agent-context-"));
    await writeFile(root, "package.json", JSON.stringify({
      name: "agent-app",
      version: "1.2.3",
      packageManager: "bun@1.3.14",
    }));
    await writeFile(root, ".mandu/routes.manifest.json", JSON.stringify({
      version: 1,
      routes: [
        {
          id: "home",
          pattern: "/",
          kind: "page",
          module: "app/page.tsx",
          componentModule: "app/page.tsx",
          layoutChain: [],
        },
        {
          id: "api-ping",
          pattern: "/api/ping",
          kind: "api",
          module: "app/api/ping/route.ts",
          methods: ["GET"],
          contractModule: "spec/contracts/ping.contract.ts",
        },
      ],
    }));
    await writeFile(root, "app/dashboard/counter.partial.tsx", "export default function Counter() { return null; }");
    await writeFile(root, "app/dashboard/chart.island.tsx", "export default function Chart() { return null; }");
    await writeFile(root, "spec/slots/dashboard.slot.ts", "export default {};");
    await writeFile(root, "spec/contracts/ping.contract.ts", "export default {};");
    await writeFile(root, ".env.example", "DATABASE_URL=\n");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("builds a single agent-facing project map", async () => {
    const context = await buildAgentContext(root, {
      includeDiagnose: false,
      includeGit: false,
    });

    expect(context.framework).toBe("mandu");
    expect(context.project.name).toBe("agent-app");
    expect(context.project.packageManager).toBe("bun@1.3.14");
    expect(context.routeSource).toBe("manifest");
    expect(context.routes).toHaveLength(2);
    expect(context.pages.map((r) => r.id)).toEqual(["home"]);
    expect(context.apis.map((r) => r.id)).toEqual(["api-ping"]);
    expect(context.apis[0]?.hasContractModule).toBe(true);
    expect(context.partials.map((p) => p.path)).toEqual(["app/dashboard/counter.partial.tsx"]);
    expect(context.islands.map((p) => p.path)).toEqual(["app/dashboard/chart.island.tsx"]);
    expect(context.slots.map((p) => p.path)).toEqual(["spec/slots/dashboard.slot.ts"]);
    expect(context.contracts.map((p) => p.path)).toEqual(["spec/contracts/ping.contract.ts"]);
    expect(context.env[0]).toMatchObject({ path: ".env.example", kind: "template", redacted: true });
    expect(context.commands.context).toBe("mandu agent context --json");
    expect(context.agentWorkflow.canonical).toEqual(["context", "plan", "apply", "verify", "repair"]);
  });

  it("writes and reads .mandu/agent-manifest.json", async () => {
    const context = await buildAgentContext(root, {
      includeDiagnose: false,
      includeGit: false,
    });
    const result = await writeAgentManifest(root, context);

    expect(result.path).toBe(agentManifestPath(root));
    const manifest = await readAgentManifest(root);
    expect(manifest?.schemaVersion).toBe(1);
    expect(manifest?.project.name).toBe("agent-app");
    expect(manifest?.agentWorkflow.canonical).toEqual(["context", "plan", "apply", "verify", "repair"]);
  });

  it("builds a deterministic agent plan from intent", () => {
    const plan = buildAgentPlan({
      intent: "add dashboard page with API contract and partial island",
    });

    expect(plan.framework).toBe("mandu");
    expect(plan.intent).toBe("add dashboard page with API contract and partial island");
    expect(plan.domains).toContain("route");
    expect(plan.domains).toContain("api");
    expect(plan.domains).toContain("contract");
    expect(plan.domains).toContain("hydration");
    expect(plan.filesToCreate).toContain("app/dashboard/page.tsx");
    expect(plan.filesToCreate).toContain("app/api/<name>/route.ts");
    expect(plan.mcpTools).toContain("mandu.agent.verify");
    expect(plan.mcpTools).toContain("mandu.contract.validate");
    expect(plan.verification.map((cmd) => cmd.command)).toContain("bun run typecheck");
  });

  it("writes a plan and previews apply actions without mutating files", async () => {
    const plan = buildAgentPlan({
      intent: "add dashboard page with API contract and partial island",
    });
    const written = await writeAgentPlan(root, plan);
    expect(written.path).toBe(agentPlanPath(root));

    const report = await buildAgentApplyReport(root);
    expect(report.ok).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.intent).toBe(plan.intent);
    expect(report.actions.some((action) => action.kind === "mcp_tool")).toBe(true);
    expect(report.actions.some((action) => action.kind === "manual_edit")).toBe(true);
    expect(report.actions.every((action) => action.applied === false)).toBe(true);

    const result = await writeAgentApplyReport(root, report);
    expect(result.path).toBe(path.join(root, ".mandu", "agent-apply.json"));
    expect(JSON.parse(await fs.readFile(result.path, "utf8")).intent).toBe(plan.intent);
  });

  it("syncs agent workflow artifacts for Codex, Claude, and Gemini", async () => {
    const report = await buildAgentSyncReport(root, { target: "all" });

    expect(report.ok).toBe(true);
    expect(report.profile).toBe("agent-core");
    expect(report.workflow).toEqual(["context", "plan", "apply", "verify", "repair"]);
    expect(report.files.map((file) => file.path)).toContain(".mandu/agent-sync/codex/AGENTS.md");
    expect(report.files.map((file) => file.path)).toContain(".mandu/agent-sync/claude/CLAUDE.md");
    expect(report.files.map((file) => file.path)).toContain(".mandu/agent-sync/gemini/GEMINI.md");
    const codex = await fs.readFile(path.join(root, ".mandu", "agent-sync", "codex", "AGENTS.md"), "utf8");
    expect(codex).toContain("context -> plan -> apply -> verify -> repair");
    expect(codex).toContain("MANDU_MCP_PROFILE=agent-core");
  });

  it("builds and writes the agent verify report", async () => {
    const report = await buildAgentVerifyReport(root, {
      includeDiagnose: false,
      includeGit: false,
      includeGuard: false,
      includeContract: false,
    });

    expect(report.framework).toBe("mandu");
    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual(["internal-api", "manifest"]);
    expect(report.suggestedCommands.map((cmd) => cmd.command)).toContain("bun run typecheck");
    expect(report.nextRepairInput).toBe(".mandu/agent-verify.json");

    const result = await writeAgentVerifyReport(root, report);
    expect(result.path).toBe(agentVerifyReportPath(root));
    const parsed = JSON.parse(await fs.readFile(result.path, "utf8"));
    expect(parsed.project.name).toBe("agent-app");
  });

  it("records changed file reasons and warns on internal API edits", async () => {
    const version = await runGit(root, ["--version"]);
    if (!version.ok) return;

    expect((await runGit(root, ["init"])).ok).toBe(true);
    await runGit(root, ["config", "user.email", "agent@example.com"]);
    await runGit(root, ["config", "user.name", "Agent"]);
    expect((await runGit(root, ["add", "."])).ok).toBe(true);
    expect((await runGit(root, ["commit", "-m", "initial"])).ok).toBe(true);

    await writeFile(root, "packages/core/src/runtime/internal-change.ts", "export const value = 1;\n");

    const report = await buildAgentVerifyReport(root, {
      includeDiagnose: false,
      includeGuard: false,
      includeContract: false,
    });

    const reason = report.changedFileReasons.find(
      (entry) => entry.file === "packages/core/src/runtime/internal-change.ts",
    );
    expect(reason?.internalApi).toBe(true);
    expect(reason?.recommendedChecks).toContain("bun run check:public-api && bun run check:target-boundaries");
    expect(report.diagnostics.some((diag) => diag.code === "MANDU_VERIFY_INTERNAL_API_EDIT")).toBe(true);
    expect(report.suggestedCommands.map((cmd) => cmd.command)).toContain(
      "bun run check:public-api && bun run check:target-boundaries",
    );
  });

  it("turns a verify report into repair actions", async () => {
    await writeAgentVerifyReport(root, {
      schemaVersion: 1,
      framework: "mandu",
      generatedAt: new Date().toISOString(),
      project: {
        name: "agent-app",
        version: "1.2.3",
        root,
        packageManager: "bun",
        configFile: null,
      },
      changedFiles: [],
      changedFileReasons: [],
      gitAvailable: false,
      notes: [],
      ok: false,
      checks: [],
      diagnostics: [
        {
          code: "MANDU_VERIFY_MANIFEST_UNAVAILABLE",
          severity: "warning",
          title: "Routes manifest unavailable",
          cause: "missing",
          suggestedFix: {
            type: "run_command",
            command: "mandu build",
            description: "Build the project.",
          },
          repairable: true,
          source: "test",
        },
      ],
      suggestedCommands: [],
      nextRepairInput: ".mandu/agent-verify.json",
    });

    const report = await buildAgentRepairReport(root);
    expect(report.status).toBe("ready");
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0]).toMatchObject({
      diagnosticCode: "MANDU_VERIFY_MANIFEST_UNAVAILABLE",
      kind: "run_command",
      command: "mandu build",
      safeToApply: false,
    });

    const result = await writeAgentRepairReport(root, report);
    expect(result.path).toBe(agentRepairReportPath(root));
    expect(JSON.parse(await fs.readFile(result.path, "utf8")).status).toBe("ready");
  });
});
