import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { composeSummary, writeSummary } from "../src/report";
import { readJson } from "../src/fs";
import type { SummaryJson, OracleLevel } from "../src/types";

describe("report", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "ate-report-test-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("should compose summary with required fields", () => {
    // Setup
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const params = {
      repoRoot,
      runId: "run-123",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      exitCode: 0,
      oracleLevel: "L1" as OracleLevel,
    };

    // Execute
    const summary = composeSummary(params);

    // Assert
    expect(summary.schemaVersion).toBe(1);
    expect(summary.runId).toBe("run-123");
    expect(summary.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(summary.finishedAt).toBe("2026-01-01T00:05:00.000Z");
    expect(summary.ok).toBe(true);
  });

  test("should set ok=false when exitCode is non-zero", () => {
    // Setup
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const params = {
      repoRoot,
      runId: "run-124",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      exitCode: 1,
      oracleLevel: "L1" as OracleLevel,
    };

    // Execute
    const summary = composeSummary(params);

    // Assert
    expect(summary.ok).toBe(false);
  });

  test("should include oracle results", () => {
    // Setup
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const params = {
      repoRoot,
      runId: "run-125",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      exitCode: 0,
      oracleLevel: "L1" as OracleLevel,
    };

    // Execute
    const summary = composeSummary(params);

    // Assert
    expect(summary.oracle).toBeDefined();
    expect(summary.oracle.level).toBe("L1");
    expect(summary.oracle.l0).toBeDefined();
    expect(summary.oracle.l1).toBeDefined();
    expect(summary.oracle.l2).toBeDefined();
    expect(summary.oracle.l3).toBeDefined();
  });

  test("should include playwright metadata", () => {
    // Setup
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const params = {
      repoRoot,
      runId: "run-126",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      exitCode: 0,
      oracleLevel: "L1" as OracleLevel,
    };

    // Execute
    const summary = composeSummary(params);

    // Assert
    expect(summary.playwright).toBeDefined();
    expect(summary.playwright.exitCode).toBe(0);
    expect(summary.playwright.reportDir).toContain("reports");
    expect(summary.playwright.jsonReportPath).toBeDefined();
    expect(summary.playwright.junitPath).toBeDefined();
  });

  test("should include mandu paths", () => {
    // Setup
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const params = {
      repoRoot,
      runId: "run-127",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      exitCode: 0,
      oracleLevel: "L1" as OracleLevel,
    };

    // Execute
    const summary = composeSummary(params);

    // Assert
    expect(summary.mandu).toBeDefined();
    expect(summary.mandu.interactionGraphPath).toContain("interaction-graph.json");
    expect(summary.mandu.selectorMapPath).toContain("selector-map.json");
    expect(summary.mandu.scenariosPath).toContain("scenarios");
  });

  test("should include heal metadata", () => {
    // Setup
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const params = {
      repoRoot,
      runId: "run-128",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      exitCode: 1,
      oracleLevel: "L1" as OracleLevel,
      heal: {
        suggestions: [
          { kind: "selector-map", title: "Update selector", diff: "..." },
        ],
      },
    };

    // Execute
    const summary = composeSummary(params);

    // Assert
    expect(summary.heal).toBeDefined();
    expect(summary.heal.attempted).toBe(true);
    expect(summary.heal.suggestions).toHaveLength(1);
    expect(summary.heal.suggestions[0].kind).toBe("selector-map");
  });

  test("should include impact analysis", () => {
    // Setup
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const params = {
      repoRoot,
      runId: "run-129",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      exitCode: 0,
      oracleLevel: "L1" as OracleLevel,
      impact: {
        changedFiles: ["app/page.tsx", "lib/utils.ts"],
        selectedRoutes: ["/", "/about"],
        mode: "subset" as const,
      },
    };

    // Execute
    const summary = composeSummary(params);

    // Assert
    expect(summary.impact).toBeDefined();
    expect(summary.impact.mode).toBe("subset");
    expect(summary.impact.changedFiles).toHaveLength(2);
    expect(summary.impact.selectedRoutes).toHaveLength(2);
  });

  test("should use default impact when not provided", () => {
    // Setup
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const params = {
      repoRoot,
      runId: "run-130",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      exitCode: 0,
      oracleLevel: "L1" as OracleLevel,
    };

    // Execute
    const summary = composeSummary(params);

    // Assert
    expect(summary.impact.mode).toBe("full");
    expect(summary.impact.changedFiles).toEqual([]);
    expect(summary.impact.selectedRoutes).toEqual([]);
  });

  test("writeSummary should create file", () => {
    // Setup
    const repoRoot = join(testDir, `write-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const summary: SummaryJson = {
      schemaVersion: 1,
      runId: "run-131",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      ok: true,
      oracle: {
        level: "L1",
        l0: { ok: true, errors: [] },
        l1: { ok: true, signals: [] },
        l2: { ok: true, signals: [] },
        l3: { ok: true, notes: [] },
      },
      playwright: {
        exitCode: 0,
        reportDir: "/reports/run-131",
        jsonReportPath: "/reports/latest/report.json",
        junitPath: "/reports/latest/junit.xml",
      },
      mandu: {
        interactionGraphPath: "/.mandu/interaction-graph.json",
        selectorMapPath: "/.mandu/selector-map.json",
        scenariosPath: "/.mandu/scenarios/generated.json",
      },
      heal: {
        attempted: false,
        suggestions: [],
      },
      impact: {
        mode: "full",
        changedFiles: [],
        selectedRoutes: [],
      },
    };

    // Execute
    const summaryPath = writeSummary(repoRoot, "run-131", summary);

    // Assert
    expect(summaryPath).toContain("run-131");
    expect(summaryPath).toContain("summary.json");
    expect(existsSync(summaryPath)).toBe(true);

    const written = readJson<SummaryJson>(summaryPath);
    expect(written.runId).toBe("run-131");
    expect(written.ok).toBe(true);
  });

  test("should handle L0 oracle level", () => {
    // Setup
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const params = {
      repoRoot,
      runId: "run-132",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      exitCode: 0,
      oracleLevel: "L0" as OracleLevel,
    };

    // Execute
    const summary = composeSummary(params);

    // Assert
    expect(summary.oracle.level).toBe("L0");
  });

  test("should handle L2 oracle level", () => {
    // Setup
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const params = {
      repoRoot,
      runId: "run-133",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      exitCode: 0,
      oracleLevel: "L2" as OracleLevel,
    };

    // Execute
    const summary = composeSummary(params);

    // Assert
    expect(summary.oracle.level).toBe("L2");
  });

  test("should handle L3 oracle level", () => {
    // Setup
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const params = {
      repoRoot,
      runId: "run-134",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      exitCode: 0,
      oracleLevel: "L3" as OracleLevel,
    };

    // Execute
    const summary = composeSummary(params);

    // Assert
    expect(summary.oracle.level).toBe("L3");
  });

  test("writeSummary should create reports directory", () => {
    // Setup
    const repoRoot = join(testDir, `auto-create-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const summary: SummaryJson = {
      schemaVersion: 1,
      runId: "run-135",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      ok: true,
      oracle: {
        level: "L1",
        l0: { ok: true, errors: [] },
        l1: { ok: true, signals: [] },
        l2: { ok: true, signals: [] },
        l3: { ok: true, notes: [] },
      },
      playwright: {
        exitCode: 0,
        reportDir: "",
        jsonReportPath: "",
        junitPath: "",
      },
      mandu: {},
      heal: { attempted: false, suggestions: [] },
      impact: { mode: "full", changedFiles: [], selectedRoutes: [] },
    };

    // Execute
    writeSummary(repoRoot, "run-135", summary);

    // Assert
    const reportsDir = join(repoRoot, ".mandu", "reports", "run-135");
    expect(existsSync(reportsDir)).toBe(true);
  });

  test("should write pretty-printed JSON", async () => {
    // Setup
    const repoRoot = join(testDir, `pretty-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const summary: SummaryJson = {
      schemaVersion: 1,
      runId: "run-136",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:05:00.000Z",
      ok: true,
      oracle: {
        level: "L1",
        l0: { ok: true, errors: [] },
        l1: { ok: true, signals: [] },
        l2: { ok: true, signals: [] },
        l3: { ok: true, notes: [] },
      },
      playwright: { exitCode: 0, reportDir: "", jsonReportPath: "", junitPath: "" },
      mandu: {},
      heal: { attempted: false, suggestions: [] },
      impact: { mode: "full", changedFiles: [], selectedRoutes: [] },
    };

    // Execute
    const summaryPath = writeSummary(repoRoot, "run-136", summary);

    // Assert - read raw file content
    const content = await Bun.file(summaryPath).text();
    const parsed = JSON.parse(content);

    // Should be pretty-printed (has indentation)
    expect(content.includes("\n")).toBe(true);
    expect(content.includes("  ")).toBe(true);
  });
});
