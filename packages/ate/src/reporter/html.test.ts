import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateHtmlReport } from "./html";
import type { SummaryJson } from "../types";

describe("HTML Reporter", () => {
  let testDir: string;
  let repoRoot: string;
  let runId: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "ate-html-test-"));
    repoRoot = testDir;
    runId = "test-run-001";
  });

  afterAll(() => {
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("HTML 리포트 생성 - 기본", async () => {
    // Setup
    const manduDir = join(repoRoot, ".mandu");
    const reportsDir = join(manduDir, "reports");
    const runDir = join(reportsDir, runId);

    // Create directories
    await Bun.write(join(runDir, ".gitkeep"), "");

    const summary: SummaryJson = {
      schemaVersion: 1,
      runId,
      startedAt: "2026-02-15T04:00:00.000Z",
      finishedAt: "2026-02-15T04:00:10.000Z",
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
        reportDir: runDir,
      },
      mandu: {
        interactionGraphPath: join(manduDir, "interaction-graph.json"),
        selectorMapPath: join(manduDir, "selector-map.json"),
        scenariosPath: join(manduDir, "scenarios.json"),
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

    writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");

    // Execute
    const result = await generateHtmlReport({
      repoRoot,
      runId,
      includeScreenshots: false,
    });

    // Verify
    expect(result.path).toBe(join(runDir, "index.html"));
    expect(result.size).toBeGreaterThan(0);

    const html = readFileSync(result.path, "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("ATE Test Report");
    expect(html).toContain(runId);
    expect(html).toContain("PASSED");
  });

  test("HTML 리포트 생성 - 실패 케이스 with Heal", async () => {
    const runId2 = "test-run-002";
    const manduDir = join(repoRoot, ".mandu");
    const reportsDir = join(manduDir, "reports");
    const runDir = join(reportsDir, runId2);

    await Bun.write(join(runDir, ".gitkeep"), "");

    const summary: SummaryJson = {
      schemaVersion: 1,
      runId: runId2,
      startedAt: "2026-02-15T04:00:00.000Z",
      finishedAt: "2026-02-15T04:00:10.000Z",
      ok: false,
      oracle: {
        level: "L2",
        l0: { ok: false, errors: ["TypeError at line 42"] },
        l1: { ok: false, signals: ["Console error: API failed"] },
        l2: { ok: true, signals: [] },
        l3: { ok: true, notes: [] },
      },
      playwright: {
        exitCode: 1,
        reportDir: runDir,
      },
      mandu: {
        interactionGraphPath: join(manduDir, "interaction-graph.json"),
      },
      heal: {
        attempted: true,
        suggestions: [
          {
            kind: "selector_update",
            title: "Fix button selector",
            diff: "@@ -1,1 +1,1 @@\n-click('button')\n+click('[data-testid=\"submit\"]')\n",
          },
        ],
      },
      impact: {
        mode: "subset",
        changedFiles: ["src/App.tsx"],
        selectedRoutes: ["/login"],
      },
    };

    writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");

    const result = await generateHtmlReport({
      repoRoot,
      runId: runId2,
    });

    const html = readFileSync(result.path, "utf-8");
    expect(html).toContain("FAILED");
    expect(html).toContain("TypeError at line 42");
    expect(html).toContain("Fix button selector");
    expect(html).toContain("selector_update");
    expect(html).toContain("src/App.tsx");
  });

  test("에러 처리 - summary.json 없음", async () => {
    expect(
      generateHtmlReport({
        repoRoot,
        runId: "non-existent-run",
      })
    ).rejects.toThrow("Summary 파일을 찾을 수 없습니다");
  });
});
