import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFullPipeline } from "../src/pipeline";
import type { AutoPipelineOptions } from "../src/pipeline";

describe("pipeline", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "ate-pipeline-test-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function setupMinimalProject(): string {
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    // Create minimal tsconfig
    const tsconfigContent = {
      compilerOptions: {
        target: "ES2020",
        module: "commonjs",
        jsx: "react",
        strict: true,
        esModuleInterop: true,
      },
    };
    writeFileSync(join(repoRoot, "tsconfig.json"), JSON.stringify(tsconfigContent, null, 2));

    // Create minimal src with a route
    const srcDir = join(repoRoot, "src");
    mkdirSync(srcDir, { recursive: true });

    const routeContent = `
      import React from "react";

      export default function HomePage() {
        return <div>Home</div>;
      }
    `;
    writeFileSync(join(srcDir, "page.tsx"), routeContent);

    // Create minimal playwright config
    const testsDir = join(repoRoot, "tests", "e2e");
    mkdirSync(testsDir, { recursive: true });

    const configContent = `
      import { defineConfig } from "@playwright/test";
      export default defineConfig({
        testDir: ".",
        timeout: 5000,
        use: { baseURL: "http://localhost:3333" },
      });
    `;
    writeFileSync(join(testsDir, "playwright.config.ts"), configContent);

    return repoRoot;
  }

  test("should run full pipeline successfully", async () => {
    // Setup
    const repoRoot = setupMinimalProject();

    // Execute
    const options: AutoPipelineOptions = {
      repoRoot,
      oracleLevel: "L0",
      ci: true,
    };

    const result = await runFullPipeline(options);

    // Assert
    expect(result).toBeDefined();
    expect(result.steps.extract.ok).toBe(true);
    expect(result.steps.generate.ok).toBe(true);
    expect(result.steps.run.ok).toBeDefined();
    expect(result.steps.run.runId).toMatch(/^run-\d+$/);
    expect(result.steps.report.ok).toBe(true);
    expect(result.steps.report.summaryPath).toBeDefined();
  }, 30000); // Increased timeout for full pipeline

  test("should skip impact analysis when not requested", async () => {
    // Setup
    const repoRoot = setupMinimalProject();

    // Execute
    const options: AutoPipelineOptions = {
      repoRoot,
      oracleLevel: "L0",
      ci: true,
      useImpactAnalysis: false,
    };

    const result = await runFullPipeline(options);

    // Assert
    expect(result.steps.impact).toBeUndefined();
  }, 30000);

  test("should run all steps when extraction succeeds", async () => {
    // Setup
    const repoRoot = setupMinimalProject();

    // Execute
    const options: AutoPipelineOptions = {
      repoRoot,
      oracleLevel: "L1",
      ci: true,
    };

    const result = await runFullPipeline(options);

    // Assert - 모든 단계가 실행되어야 함
    expect(result.steps.extract.ok).toBe(true);
    expect(result.steps.generate.ok).toBe(true);
    expect(result.steps.run.runId).toBeDefined();
    expect(result.steps.report.ok).toBe(true);
  }, 30000);

  test("should not run heal when autoHeal is false", async () => {
    // Setup
    const repoRoot = setupMinimalProject();

    // Execute
    const options: AutoPipelineOptions = {
      repoRoot,
      oracleLevel: "L0",
      ci: true,
      autoHeal: false,
    };

    const result = await runFullPipeline(options);

    // Assert
    expect(result.steps.heal).toBeUndefined();
  }, 30000);
});
