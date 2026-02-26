import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { GuardDecisionManager } from "../../src/kitchen/api/guard-decisions";
import fs from "fs";
import path from "path";
import os from "os";

describe("GuardDecisionManager", () => {
  let tmpDir: string;
  let manager: GuardDecisionManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-decisions-"));
    fs.mkdirSync(path.join(tmpDir, ".mandu"), { recursive: true });
    manager = new GuardDecisionManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should start with empty decisions", async () => {
    const decisions = await manager.load();
    expect(decisions).toHaveLength(0);
  });

  it("should save and load a decision", async () => {
    const saved = await manager.save({
      violationKey: "no-cross-layer::src/app/page.tsx",
      action: "approve",
      ruleId: "no-cross-layer",
      filePath: "src/app/page.tsx",
      reason: "Intentional dependency",
    });

    expect(saved.id).toBeTruthy();
    expect(saved.decidedAt).toBeTruthy();
    expect(saved.action).toBe("approve");

    // Reload from disk
    const freshManager = new GuardDecisionManager(tmpDir);
    const loaded = await freshManager.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].ruleId).toBe("no-cross-layer");
  });

  it("should replace existing decision for same violationKey", async () => {
    await manager.save({
      violationKey: "rule1::file.ts",
      action: "approve",
      ruleId: "rule1",
      filePath: "file.ts",
    });

    await manager.save({
      violationKey: "rule1::file.ts",
      action: "reject",
      ruleId: "rule1",
      filePath: "file.ts",
    });

    const decisions = await manager.load();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].action).toBe("reject");
  });

  it("should remove a decision by id", async () => {
    const saved = await manager.save({
      violationKey: "rule1::file.ts",
      action: "approve",
      ruleId: "rule1",
      filePath: "file.ts",
    });

    const removed = await manager.remove(saved.id);
    expect(removed).toBe(true);

    const decisions = await manager.load();
    expect(decisions).toHaveLength(0);
  });

  it("should return false when removing non-existent id", async () => {
    const removed = await manager.remove("nonexistent");
    expect(removed).toBe(false);
  });

  it("should check isApproved correctly", async () => {
    await manager.save({
      violationKey: "rule1::file.ts",
      action: "approve",
      ruleId: "rule1",
      filePath: "file.ts",
    });

    expect(await manager.isApproved("rule1", "file.ts")).toBe(true);
    expect(await manager.isApproved("rule1", "other.ts")).toBe(false);
    expect(await manager.isApproved("rule2", "file.ts")).toBe(false);
  });
});
