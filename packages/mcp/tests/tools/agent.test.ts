import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { agentTools } from "../../src/tools/agent";

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

describe("mandu.agent.context MCP tool", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-agent-mcp-"));
    await writeFile(root, "package.json", JSON.stringify({ name: "mcp-agent-app" }));
    await writeFile(root, ".mandu/routes.manifest.json", JSON.stringify({
      version: 1,
      routes: [
        {
          id: "api-users",
          pattern: "/api/users",
          kind: "api",
          module: "app/api/users/route.ts",
          methods: ["GET"],
        },
      ],
    }));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns the shared agent context shape", async () => {
    const handlers = agentTools(root);
    const result = await handlers["mandu.agent.context"]({
      includeDiagnose: false,
      includeGit: false,
    }) as {
      project: { name: string };
      apis: Array<{ id: string }>;
      agentWorkflow: { canonical: string[] };
    };

    expect(result.project.name).toBe("mcp-agent-app");
    expect(result.apis.map((r) => r.id)).toEqual(["api-users"]);
    expect(result.agentWorkflow.canonical).toEqual(["context", "plan", "apply", "verify", "repair"]);
  });

  it("can write .mandu/agent-manifest.json through the context call", async () => {
    const handlers = agentTools(root);
    const result = await handlers["mandu.agent.context"]({
      includeDiagnose: false,
      includeGit: false,
      writeManifest: true,
    }) as { manifest: { written: boolean; path: string } };

    expect(result.manifest.written).toBe(true);
    expect(result.manifest.path).toBe(path.join(root, ".mandu", "agent-manifest.json"));
    const raw = await fs.readFile(result.manifest.path, "utf8");
    expect(JSON.parse(raw).project.name).toBe("mcp-agent-app");
  });

  it("returns and writes an agent plan", async () => {
    const handlers = agentTools(root);
    const result = await handlers["mandu.agent.plan"]({
      intent: "add dashboard page with API contract",
      writePlan: true,
    }) as {
      intent: string;
      domains: string[];
      plan: { written: boolean; path: string };
    };

    expect(result.intent).toBe("add dashboard page with API contract");
    expect(result.domains).toContain("route");
    expect(result.domains).toContain("api");
    expect(result.domains).toContain("contract");
    expect(result.plan.written).toBe(true);
    expect(result.plan.path).toBe(path.join(root, ".mandu", "agent-plan.json"));
    const raw = await fs.readFile(result.plan.path, "utf8");
    expect(JSON.parse(raw).intent).toBe("add dashboard page with API contract");
  });

  it("returns an agent apply preview from a plan", async () => {
    const handlers = agentTools(root);
    await handlers["mandu.agent.plan"]({
      intent: "add dashboard page with API contract",
      writePlan: true,
    });

    const result = await handlers["mandu.agent.apply"]({
      from: ".mandu/agent-plan.json",
      writeReport: true,
    }) as {
      ok: boolean;
      dryRun: boolean;
      sourcePlan: string;
      actions: Array<{ kind: string }>;
      report: { written: boolean; path: string };
    };

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.sourcePlan).toBe(".mandu/agent-plan.json");
    expect(result.actions.some((action) => action.kind === "mcp_tool")).toBe(true);
    expect(result.report.written).toBe(true);
    expect(result.report.path).toBe(path.join(root, ".mandu", "agent-apply.json"));
  });

  it("returns the shared agent verify report shape", async () => {
    const handlers = agentTools(root);
    const result = await handlers["mandu.agent.verify"]({
      includeDiagnose: false,
      includeGit: false,
      includeGuard: false,
      includeContract: false,
    }) as {
      ok: boolean;
      checks: Array<{ id: string }>;
      nextRepairInput: string;
    };

    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.id)).toEqual(["internal-api", "manifest"]);
    expect(result.nextRepairInput).toBe(".mandu/agent-verify.json");
  });

  it("can write .mandu/agent-verify.json through the verify call", async () => {
    const handlers = agentTools(root);
    const result = await handlers["mandu.agent.verify"]({
      includeDiagnose: false,
      includeGit: false,
      includeGuard: false,
      includeContract: false,
      writeReport: true,
    }) as { report: { written: boolean; path: string } };

    expect(result.report.written).toBe(true);
    expect(result.report.path).toBe(path.join(root, ".mandu", "agent-verify.json"));
    const raw = await fs.readFile(result.report.path, "utf8");
    expect(JSON.parse(raw).project.name).toBe("mcp-agent-app");
  });

  it("returns repair actions from the verify report", async () => {
    const handlers = agentTools(root);
    await handlers["mandu.agent.verify"]({
      includeDiagnose: false,
      includeGit: false,
      includeGuard: false,
      includeContract: false,
      writeReport: true,
    });

    const result = await handlers["mandu.agent.repair"]({}) as {
      status: string;
      actions: unknown[];
      nextVerifyCommand: string;
    };

    expect(result.status).toBe("nothing_to_repair");
    expect(result.actions).toHaveLength(0);
    expect(result.nextVerifyCommand).toBe("mandu agent verify --changed --json --write");
  });

  it("syncs workflow artifacts for agent clients", async () => {
    const handlers = agentTools(root);
    const result = await handlers["mandu.agent.sync"]({
      target: "all",
    }) as {
      profile: string;
      files: Array<{ path: string }>;
    };

    expect(result.profile).toBe("agent-core");
    expect(result.files.map((file) => file.path)).toContain(".mandu/agent-sync/codex/AGENTS.md");
    expect(result.files.map((file) => file.path)).toContain(".mandu/agent-sync/claude/CLAUDE.md");
    const raw = await fs.readFile(path.join(root, ".mandu", "agent-sync", "claude", "CLAUDE.md"), "utf8");
    expect(raw).toContain("context -> plan -> apply -> verify -> repair");
  });
});
