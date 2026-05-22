import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { agent } from "../agent";
import { getCommand } from "../registry";

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

async function capture(fn: () => Promise<boolean>): Promise<{ ok: boolean; out: string }> {
  const origLog = console.log;
  const origError = console.error;
  let out = "";
  console.log = (...args: unknown[]) => {
    out += args.join(" ") + "\n";
  };
  console.error = (...args: unknown[]) => {
    out += args.join(" ") + "\n";
  };
  try {
    const ok = await fn();
    return { ok, out };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

describe("mandu agent CLI", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-agent-cli-"));
    await writeFile(root, "package.json", JSON.stringify({ name: "cli-agent-app" }));
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
          hydration: { strategy: "island", priority: "visible", preload: false },
          boundaries: [
            {
              id: "home--0",
              routeId: "home",
              module: "src/client/HomeWidget.client.tsx",
              importSpecifier: "@/client/HomeWidget.client",
              exportName: "HomeWidget",
              localName: "HomeWidget",
              hydrate: "visible",
              ordinal: 0,
              propsSource: "inline",
              propsKeys: ["user"],
              hasSpreadProps: false,
              source: {
                file: "app/page.tsx",
                line: 5,
                column: 12,
              },
            },
          ],
        },
      ],
    }));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("is registered as the canonical agent command group", () => {
    const command = getCommand("agent");
    expect(command?.subcommands).toContain("context");
    expect(command?.subcommands).toContain("manifest");
    expect(command?.subcommands).toContain("plan");
    expect(command?.subcommands).toContain("apply");
    expect(command?.subcommands).toContain("verify");
    expect(command?.subcommands).toContain("sync");
  });

  it("prints JSON context", async () => {
    const { ok, out } = await capture(() =>
      agent({
        action: "context",
        cwd: root,
        json: true,
        includeDiagnose: false,
        includeGit: false,
      }),
    );

    expect(ok).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed.project.name).toBe("cli-agent-app");
    expect(parsed.routes).toHaveLength(1);
    expect(parsed.routes[0].boundaries[0]).toMatchObject({
      id: "home--0",
      module: "src/client/HomeWidget.client.tsx",
      importSpecifier: "@/client/HomeWidget.client",
      exportName: "HomeWidget",
      localName: "HomeWidget",
      ordinal: 0,
    });
    expect(parsed.commands.verify).toBe("mandu agent verify --changed --json");
  });

  it("writes the manifest on request", async () => {
    const { ok } = await capture(() =>
      agent({
        action: "manifest",
        cwd: root,
        write: true,
        includeDiagnose: false,
        includeGit: false,
      }),
    );

    expect(ok).toBe(true);
    const raw = await fs.readFile(path.join(root, ".mandu", "agent-manifest.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.project.name).toBe("cli-agent-app");
    expect(parsed.routes[0].boundaries[0].id).toBe("home--0");
  });

  it("prints and writes JSON plan output", async () => {
    const { ok, out } = await capture(() =>
      agent({
        action: "plan",
        cwd: root,
        intent: "add dashboard page with API contract",
        json: true,
        write: true,
      }),
    );

    expect(ok).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed.path).toBe(path.join(root, ".mandu", "agent-plan.json"));
    expect(parsed.plan.domains).toContain("route");
    expect(parsed.plan.domains).toContain("api");
    expect(parsed.plan.domains).toContain("contract");
    const raw = await fs.readFile(path.join(root, ".mandu", "agent-plan.json"), "utf8");
    expect(JSON.parse(raw).intent).toBe("add dashboard page with API contract");
  });

  it("prints JSON apply preview from the plan", async () => {
    await capture(() =>
      agent({
        action: "plan",
        cwd: root,
        intent: "add dashboard page with API contract",
        write: true,
      }),
    );

    const { ok, out } = await capture(() =>
      agent({
        action: "apply",
        cwd: root,
        json: true,
        from: ".mandu/agent-plan.json",
      }),
    );

    expect(ok).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.sourcePlan).toBe(".mandu/agent-plan.json");
    expect(parsed.actions.some((action: { kind: string }) => action.kind === "mcp_tool")).toBe(true);
  });

  it("syncs agent workflow artifacts", async () => {
    const { ok, out } = await capture(() =>
      agent({
        action: "sync",
        cwd: root,
        target: "all",
        json: true,
      }),
    );

    expect(ok).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed.profile).toBe("agent-core");
    expect(parsed.files.map((file: { path: string }) => file.path)).toContain(".mandu/agent-sync/codex/AGENTS.md");
    const raw = await fs.readFile(path.join(root, ".mandu", "agent-sync", "gemini", "GEMINI.md"), "utf8");
    expect(raw).toContain("context -> plan -> apply -> verify -> repair");
  });

  it("prints JSON verify report", async () => {
    const { ok, out } = await capture(() =>
      agent({
        action: "verify",
        cwd: root,
        json: true,
        includeDiagnose: false,
        includeGit: false,
        includeGuard: false,
        includeContract: false,
      }),
    );

    expect(ok).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.checks.map((check: { id: string }) => check.id)).toEqual(["internal-api", "manifest"]);
    expect(parsed.nextRepairInput).toBe(".mandu/agent-verify.json");
  });

  it("writes the verify report on request", async () => {
    const { ok } = await capture(() =>
      agent({
        action: "verify",
        cwd: root,
        write: true,
        includeDiagnose: false,
        includeGit: false,
        includeGuard: false,
        includeContract: false,
      }),
    );

    expect(ok).toBe(true);
    const raw = await fs.readFile(path.join(root, ".mandu", "agent-verify.json"), "utf8");
    expect(JSON.parse(raw).project.name).toBe("cli-agent-app");
  });

  it("prints JSON repair report from the verify report", async () => {
    await capture(() =>
      agent({
        action: "verify",
        cwd: root,
        write: true,
        includeDiagnose: false,
        includeGit: false,
        includeGuard: false,
        includeContract: false,
      }),
    );

    const { ok, out } = await capture(() =>
      agent({
        action: "repair",
        cwd: root,
        json: true,
      }),
    );

    expect(ok).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed.status).toBe("nothing_to_repair");
    expect(parsed.nextVerifyCommand).toBe("mandu agent verify --changed --json --write");
  });
});
