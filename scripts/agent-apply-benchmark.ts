#!/usr/bin/env bun
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  buildAgentApplyReport,
  buildExecutableAgentPlan,
  type AgentOperationInput,
} from "../packages/core/src/agent/index";
import { writeAgentPlan } from "../packages/core/src/agent/plan";

interface BenchmarkTask {
  id: string;
  operation: AgentOperationInput;
  initialContent?: string;
}

export interface AgentApplyBenchmarkResult {
  schemaVersion: 1;
  tasks: number;
  succeeded: number;
  successRate: number;
  outOfScopeWrites: number;
  rollbackAttempts: number;
  rollbackSucceeded: number;
  rollbackRate: number;
  stalePreconditions: number;
  userChangesPreserved: number;
  preservationRate: number;
  ok: boolean;
}

function writeEffect(content: string): AgentOperationInput["effect"] {
  return { type: "write", content, encoding: "utf8" };
}

function benchmarkTasks(): BenchmarkTask[] {
  const tasks: BenchmarkTask[] = [];
  for (let index = 0; index < 5; index += 1) {
    tasks.push({
      id: `route-${index}`,
      operation: {
        kind: "route.create",
        target: `app/benchmark-route-${index}/page.tsx`,
        effect: writeEffect(
          `export default function Page() { return <main>Route ${index}</main>; }\n`,
        ),
      },
    });
  }
  for (let index = 0; index < 5; index += 1) {
    tasks.push({
      id: `api-${index}`,
      operation: {
        kind: "api.create",
        target: `app/api/benchmark-${index}/route.ts`,
        effect: writeEffect(
          `export function GET() { return Response.json({ task: ${index} }); }\n`,
        ),
      },
    });
  }
  for (let index = 0; index < 4; index += 1) {
    tasks.push({
      id: `contract-${index}`,
      initialContent: `export const contractVersion = ${index};\n`,
      operation: {
        kind: "contract.update",
        target: `spec/contracts/benchmark-${index}.contract.ts`,
        effect: writeEffect(`export const contractVersion = ${index + 1};\n`),
      },
    });
  }
  for (let index = 0; index < 4; index += 1) {
    tasks.push({
      id: `guard-${index}`,
      initialContent: `export const layer = "unsafe-${index}";\n`,
      operation: {
        kind: "guard.safe-fix",
        target: `src/layers/benchmark-${index}.ts`,
        effect: writeEffect(`export const layer = "safe-${index}";\n`),
      },
    });
  }
  tasks.push({
    id: "file-create",
    operation: {
      kind: "file.create",
      target: "src/benchmark-created.ts",
      effect: writeEffect("export const createdByTypedApply = true;\n"),
    },
  });
  tasks.push({
    id: "generated-refresh",
    initialContent: `${JSON.stringify({ version: 1, routes: [] }, null, 2)}\n`,
    operation: {
      kind: "generated.refresh",
      target: ".mandu/routes.manifest.json",
      effect: writeEffect(`${JSON.stringify({ version: 1, routes: [], refreshed: true }, null, 2)}\n`),
    },
  });
  return tasks;
}

async function writeFile(root: string, target: string, content: string): Promise<void> {
  const absolute = path.join(root, target);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf8");
}

async function exists(root: string, target: string): Promise<boolean> {
  try {
    await fs.stat(path.join(root, target));
    return true;
  } catch {
    return false;
  }
}

export async function runAgentApplyBenchmark(): Promise<AgentApplyBenchmarkResult> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-agent-apply-gate-"));
  try {
    await writeFile(root, "package.json", `${JSON.stringify({ name: "agent-apply-gate" }, null, 2)}\n`);
    await writeFile(root, ".mandu/routes.manifest.json", `${JSON.stringify({ version: 1, routes: [] }, null, 2)}\n`);

    const tasks = benchmarkTasks();
    let succeeded = 0;
    let outOfScopeWrites = 0;
    for (const task of tasks) {
      if (task.initialContent !== undefined) {
        await writeFile(root, task.operation.target, task.initialContent);
      }
      const plan = await buildExecutableAgentPlan(root, {
        intent: `benchmark ${task.id}`,
        idempotencyKey: `benchmark-${task.id}`,
        operations: [task.operation],
      });
      await writeAgentPlan(root, plan);
      const receipt = await buildAgentApplyReport(root, { dryRun: false });
      if (receipt.ok && receipt.status === "applied") succeeded += 1;
      outOfScopeWrites += receipt.changedFiles.filter((file) => !plan.scope.includes(file)).length;
    }

    const rollbackAttempts = 6;
    let rollbackSucceeded = 0;
    for (let index = 0; index < rollbackAttempts - 1; index += 1) {
      const first = `src/rollback-${index}-a.ts`;
      const second = `src/rollback-${index}-b.ts`;
      const plan = await buildExecutableAgentPlan(root, {
        intent: `rollback probe ${index}`,
        idempotencyKey: `rollback-probe-${index}`,
        operations: [
          { kind: "file.create", target: first, effect: writeEffect("export const a = true;\n") },
          { kind: "file.create", target: second, effect: writeEffect("export const b = true;\n") },
        ],
      });
      await writeAgentPlan(root, plan);
      const receipt = await buildAgentApplyReport(root, {
        dryRun: false,
        failureAfterOperations: 2,
      });
      if (
        receipt.status === "rolled_back" &&
        receipt.rollback.ok === true &&
        !(await exists(root, first)) &&
        !(await exists(root, second))
      ) {
        rollbackSucceeded += 1;
      }
    }

    const contract = "spec/contracts/api-todos.contract.ts";
    const manifest = ".mandu/manifest.json";
    const contractBefore = await fs.readFile(path.join(import.meta.dir, "../demo/todo-app", contract), "utf8");
    const manifestBefore = JSON.stringify({
      version: 1, env: "production", buildTime: "2026-01-01T00:00:00Z",
      bundles: { todo: { js: "/todo.js", dependencies: [] } },
      shared: { runtime: "/runtime.js", vendor: "/vendor.js" },
    });
    await writeFile(root, contract, contractBefore);
    await writeFile(root, manifest, manifestBefore);
    const todoPlan = await buildExecutableAgentPlan(root, {
      intent: "Change the todo API contract and detect a corrupt build manifest",
      operations: [
        { kind: "contract.update", target: contract, effect: writeEffect(contractBefore.replace('"low"', '"low", "urgent"')) },
        { kind: "generated.refresh", target: manifest, effect: writeEffect("{truncated") },
      ],
      verification: [{
        id: "verify-build-manifest", kind: "agent.verify", command: "mandu agent verify",
        reason: "Verify generated build artifacts", required: true, includeDiagnose: true,
      }],
    });
    await writeAgentPlan(root, todoPlan);
    const todoReceipt = await buildAgentApplyReport(root, { dryRun: false });
    if (
      todoReceipt.status === "rolled_back" && todoReceipt.rollback.ok &&
      todoReceipt.verification.some((step) => !step.ok && step.diagnostics.some(
        (diagnostic) => diagnostic.code === "MANDU_DIAGNOSE_MANIFEST_FRESHNESS" && /invalid JSON/.test(diagnostic.cause),
      )) &&
      await fs.readFile(path.join(root, contract), "utf8") === contractBefore &&
      await fs.readFile(path.join(root, manifest), "utf8") === manifestBefore
    ) {
      rollbackSucceeded += 1;
    }

    const stalePreconditions = 5;
    let userChangesPreserved = 0;
    for (let index = 0; index < stalePreconditions; index += 1) {
      const target = `src/stale-${index}.ts`;
      await writeFile(root, target, "export const value = 1;\n");
      const plan = await buildExecutableAgentPlan(root, {
        intent: `stale precondition probe ${index}`,
        idempotencyKey: `stale-probe-${index}`,
        operations: [
          {
            kind: "file.patch-with-hash",
            target,
            effect: writeEffect("export const value = 2;\n"),
          },
        ],
      });
      await writeAgentPlan(root, plan);
      const userEdit = `// user edit ${index}\n`;
      await writeFile(root, target, userEdit);
      const receipt = await buildAgentApplyReport(root, { dryRun: false });
      if (
        receipt.status === "blocked" &&
        await fs.readFile(path.join(root, target), "utf8") === userEdit
      ) {
        userChangesPreserved += 1;
      }
    }

    const successRate = succeeded / tasks.length;
    const rollbackRate = rollbackSucceeded / rollbackAttempts;
    const preservationRate = userChangesPreserved / stalePreconditions;
    return {
      schemaVersion: 1,
      tasks: tasks.length,
      succeeded,
      successRate,
      outOfScopeWrites,
      rollbackAttempts,
      rollbackSucceeded,
      rollbackRate,
      stalePreconditions,
      userChangesPreserved,
      preservationRate,
      ok:
        successRate >= 0.85 &&
        outOfScopeWrites === 0 &&
        rollbackRate === 1 &&
        preservationRate === 1,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const result = await runAgentApplyBenchmark();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
