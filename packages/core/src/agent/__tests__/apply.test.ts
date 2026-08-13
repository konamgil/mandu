import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  buildAgentApplyReport,
  buildExecutableAgentPlan,
  rollbackAgentApply,
} from "../apply";
import { writeAgentPlan } from "../plan";

async function writeFile(root: string, relativePath: string, content: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf8");
}

async function readFile(root: string, relativePath: string): Promise<string> {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

describe("typed agent apply", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-typed-apply-"));
    await writeFile(root, "package.json", JSON.stringify({ name: "typed-apply-app" }));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("previews, applies, verifies, and replays a route.create idempotently", async () => {
    const content = "export default function Dashboard() { return <main>Dashboard</main>; }\n";
    const plan = await buildExecutableAgentPlan(root, {
      intent: "add dashboard page",
      idempotencyKey: "dashboard-v1",
      operations: [
        {
          kind: "route.create",
          target: "app/dashboard/page.tsx",
          effect: { type: "write", content, encoding: "utf8" },
        },
      ],
    });
    await writeAgentPlan(root, plan);

    const preview = await buildAgentApplyReport(root);
    expect(preview.ok).toBe(true);
    expect(preview.status).toBe("preview");
    expect(preview.operations[0]?.status).toBe("planned");
    expect(await fs.stat(path.join(root, "app/dashboard/page.tsx")).catch(() => null)).toBeNull();

    const receipt = await buildAgentApplyReport(root, { dryRun: false });
    expect(receipt.ok).toBe(true);
    expect(receipt.status).toBe("applied");
    expect(receipt.replayed).toBe(false);
    expect(receipt.changedFiles).toEqual(["app/dashboard/page.tsx"]);
    expect(receipt.verification[0]?.kind).toBe("agent.verify");
    expect(receipt.verification[0]?.ok).toBe(true);
    expect(receipt.rollback.id).toStartWith("rollback-");
    expect(await readFile(root, "app/dashboard/page.tsx")).toBe(content);

    await writeFile(root, "app/dashboard/page.tsx", "// user changed after apply\n");
    const replay = await buildAgentApplyReport(root, { dryRun: false });
    expect(replay.replayed).toBe(true);
    expect(replay.receiptId).toBe(receipt.receiptId);
    expect(await readFile(root, "app/dashboard/page.tsx")).toBe("// user changed after apply\n");
  });

  it("blocks a stale content hash without overwriting the user change", async () => {
    await writeFile(root, "spec/contracts/user.contract.ts", "export const version = 1;\n");
    const plan = await buildExecutableAgentPlan(root, {
      intent: "update user contract",
      operations: [
        {
          kind: "contract.update",
          target: "spec/contracts/user.contract.ts",
          effect: {
            type: "write",
            content: "export const version = 2;\n",
            encoding: "utf8",
          },
        },
      ],
    });
    await writeAgentPlan(root, plan);
    await writeFile(root, "spec/contracts/user.contract.ts", "// user's newer edit\n");

    const receipt = await buildAgentApplyReport(root, { dryRun: false });
    expect(receipt.ok).toBe(false);
    expect(receipt.status).toBe("blocked");
    expect(receipt.warnings.some((warning) => warning.includes("content hash precondition mismatch"))).toBe(true);
    expect(receipt.rollback.id).toBeNull();
    expect(await readFile(root, "spec/contracts/user.contract.ts")).toBe("// user's newer edit\n");
  });

  it("rejects a target moved outside the approved scope", async () => {
    const plan = await buildExecutableAgentPlan(root, {
      intent: "add safe file",
      operations: [
        {
          kind: "file.create",
          target: "src/safe.ts",
          effect: { type: "write", content: "export {};\n", encoding: "utf8" },
        },
      ],
    });
    plan.operations[0]!.target = "src/outside.ts";
    await writeAgentPlan(root, plan);

    const receipt = await buildAgentApplyReport(root, { dryRun: false });
    expect(receipt.ok).toBe(false);
    expect(receipt.status).toBe("blocked");
    expect(receipt.warnings).toContain("op-1: target is outside plan scope");
    expect(await fs.stat(path.join(root, "src/outside.ts")).catch(() => null)).toBeNull();
  });

  it("rejects a typed plan whose bound effect was changed after review", async () => {
    const plan = await buildExecutableAgentPlan(root, {
      intent: "add reviewed source file",
      operations: [
        {
          kind: "file.create",
          target: "src/reviewed.ts",
          effect: { type: "write", content: "export const reviewed = true;\n", encoding: "utf8" },
        },
      ],
    });
    plan.operations[0]!.effect.content = "export const tampered = true;\n";
    await writeAgentPlan(root, plan);

    const receipt = await buildAgentApplyReport(root, { dryRun: false });
    expect(receipt.status).toBe("blocked");
    expect(receipt.warnings).toContain(
      "plan content does not match plan.id; bind a fresh executable plan",
    );
    expect(await fs.stat(path.join(root, "src/reviewed.ts")).catch(() => null)).toBeNull();
  });

  it("rolls back every applied file after an injected mid-apply failure", async () => {
    await writeFile(root, "src/existing.ts", "export const value = 1;\n");
    const plan = await buildExecutableAgentPlan(root, {
      intent: "apply two related source changes",
      operations: [
        {
          kind: "file.patch-with-hash",
          target: "src/existing.ts",
          effect: {
            type: "write",
            content: "export const value = 2;\n",
            encoding: "utf8",
          },
        },
        {
          kind: "file.create",
          target: "src/new.ts",
          effect: { type: "write", content: "export const added = true;\n", encoding: "utf8" },
        },
      ],
    });
    await writeAgentPlan(root, plan);

    const receipt = await buildAgentApplyReport(root, {
      dryRun: false,
      failureAfterOperations: 2,
    });
    expect(receipt.ok).toBe(false);
    expect(receipt.status).toBe("rolled_back");
    expect(receipt.rollback.attempted).toBe(true);
    expect(receipt.rollback.ok).toBe(true);
    expect(receipt.rollback.restoredFiles.sort()).toEqual(["src/existing.ts", "src/new.ts"]);
    expect(await readFile(root, "src/existing.ts")).toBe("export const value = 1;\n");
    expect(await fs.stat(path.join(root, "src/new.ts")).catch(() => null)).toBeNull();
  });

  it("supports explicit rollback while preserving later conflicting edits", async () => {
    await writeFile(root, "src/value.ts", "export const value = 1;\n");
    const plan = await buildExecutableAgentPlan(root, {
      intent: "update value",
      operations: [
        {
          kind: "file.patch-with-hash",
          target: "src/value.ts",
          effect: {
            type: "write",
            content: "export const value = 2;\n",
            encoding: "utf8",
          },
        },
      ],
    });
    await writeAgentPlan(root, plan);
    const receipt = await buildAgentApplyReport(root, { dryRun: false });
    expect(receipt.rollback.id).not.toBeNull();

    const rolledBack = await rollbackAgentApply(root, receipt.rollback.id!);
    expect(rolledBack.ok).toBe(true);
    expect(await readFile(root, "src/value.ts")).toBe("export const value = 1;\n");

    const secondPlan = await buildExecutableAgentPlan(root, {
      intent: "update value again",
      operations: [
        {
          kind: "file.patch-with-hash",
          target: "src/value.ts",
          effect: {
            type: "write",
            content: "export const value = 3;\n",
            encoding: "utf8",
          },
        },
      ],
    });
    await writeAgentPlan(root, secondPlan);
    const secondReceipt = await buildAgentApplyReport(root, { dryRun: false });
    await writeFile(root, "src/value.ts", "// later user edit\n");
    const conflict = await rollbackAgentApply(root, secondReceipt.rollback.id!);
    expect(conflict.ok).toBe(false);
    expect(conflict.conflicts[0]).toContain("no longer matches");
    expect(await readFile(root, "src/value.ts")).toBe("// later user edit\n");
  });
});
