/**
 * Phase B.2 — `mandu_ate_recall` + `mandu_ate_remember` MCP tool tests.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ateRecallToolDefinitions,
  ateRecallTools,
} from "../../src/tools/ate-recall";
import {
  ateRememberToolDefinitions,
  ateRememberTools,
} from "../../src/tools/ate-remember";
import { memoryFilePath } from "@mandujs/ate";

describe("mandu_ate_remember + mandu_ate_recall", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mcp-ate-memory-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("tool definitions use snake_case", () => {
    expect(ateRecallToolDefinitions[0].name).toBe("mandu_ate_recall");
    expect(ateRememberToolDefinitions[0].name).toBe("mandu_ate_remember");
  });

  test("remember writes one event and creates the file", async () => {
    const h = ateRememberTools(root);
    const res = (await h.mandu_ate_remember({
      repoRoot: root,
      event: {
        kind: "intent_history",
        intent: "write signup boundary",
        agent: "unit-test",
        resulting: { saved: ["tests/e2e/signup.spec.ts"] },
      },
    })) as { ok: boolean; written: boolean };
    expect(res.ok).toBe(true);
    expect(res.written).toBe(true);
    expect(existsSync(memoryFilePath(root))).toBe(true);
  });

  test("remember rejects malformed event", async () => {
    const h = ateRememberTools(root);
    const res = (await h.mandu_ate_remember({
      repoRoot: root,
      event: { kind: "intent_history" /* missing agent + resulting */ },
    })) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe("string");
  });

  test("recall finds the remembered event via intent match", async () => {
    const remember = ateRememberTools(root);
    await remember.mandu_ate_remember({
      repoRoot: root,
      event: {
        kind: "intent_history",
        intent: "write signup boundary",
        agent: "unit-test",
        resulting: { saved: ["tests/e2e/signup.spec.ts"] },
      },
    });

    const h = ateRecallTools(root);
    const res = (await h.mandu_ate_recall({
      repoRoot: root,
      intent: "signup boundary",
    })) as { ok: boolean; events: Array<{ kind: string }> };
    expect(res.ok).toBe(true);
    expect(res.events.some((e) => e.kind === "intent_history")).toBe(true);
  });
});
