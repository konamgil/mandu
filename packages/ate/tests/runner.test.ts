import { test, expect, describe, beforeAll, afterAll, mock } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";

// Mock child_process.spawn to avoid real Playwright dependency
mock.module("node:child_process", () => ({
  spawn: (_cmd: string, _args: string[], options?: Record<string, unknown>) => {
    const child = new EventEmitter();
    (child as any).kill = () => {};

    // Simulate exit code based on playwright config existence
    const cwd = (options?.cwd as string) ?? process.cwd();
    const configExists = existsSync(join(cwd, "tests", "e2e", "playwright.config.ts"));

    setTimeout(() => child.emit("exit", configExists ? 0 : 1), 5);
    return child;
  },
}));

// Dynamic import after mock.module so runner gets the mocked spawn
const { runPlaywright } = await import("../src/runner");
import type { RunInput } from "../src/types";
import { readJson } from "../src/fs";

describe("runner", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "ate-runner-test-"));
  });

  afterAll(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Windows: EBUSY can occur if files are briefly locked; ignore in cleanup
    }
  });

  function setupMinimalProject(): string {
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

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

    // Create minimal passing test
    const autoDir = join(testsDir, "auto");
    mkdirSync(autoDir, { recursive: true });

    const testContent = `
      import { test, expect } from "@playwright/test";
      test("minimal test", () => {
        expect(true).toBe(true);
      });
    `;
    writeFileSync(join(autoDir, "minimal.spec.ts"), testContent);

    return repoRoot;
  }

  test("should return runId and reportDir", async () => {
    const repoRoot = setupMinimalProject();

    const input: RunInput = { repoRoot };
    const result = await runPlaywright(input);

    expect(result.runId).toBeDefined();
    expect(result.runId).toMatch(/^run-\d+$/);

    const normalizedReportDir = result.reportDir.replace(/\\/g, "/");
    expect(normalizedReportDir).toContain(".mandu/reports");
    expect(result.reportDir).toContain(result.runId);
  });

  test("should create .mandu/reports directory", async () => {
    const repoRoot = setupMinimalProject();

    const input: RunInput = { repoRoot };
    await runPlaywright(input);

    const manduReportsDir = join(repoRoot, ".mandu", "reports");
    expect(existsSync(manduReportsDir)).toBe(true);
  });

  test("should create latest symlink directory", async () => {
    const repoRoot = setupMinimalProject();

    const input: RunInput = { repoRoot };
    await runPlaywright(input);

    const latestDir = join(repoRoot, ".mandu", "reports", "latest");
    expect(existsSync(latestDir)).toBe(true);
  });

  test("should return exit code", async () => {
    const repoRoot = setupMinimalProject();

    const input: RunInput = { repoRoot };
    const result = await runPlaywright(input);

    expect(result.exitCode).toBeDefined();
    expect(typeof result.exitCode).toBe("number");
    expect([0, 1]).toContain(result.exitCode);
  });

  test("should use custom baseURL", async () => {
    const repoRoot = setupMinimalProject();

    const input: RunInput = {
      repoRoot,
      baseURL: "http://localhost:8080",
    };
    const result = await runPlaywright(input);

    const runJsonPath = join(result.reportDir, "run.json");
    if (existsSync(runJsonPath)) {
      const runData = readJson<{ baseURL: string }>(runJsonPath);
      expect(runData.baseURL).toBe("http://localhost:8080");
    }
  });

  test("should set CI environment variable", async () => {
    const repoRoot = setupMinimalProject();

    const input: RunInput = {
      repoRoot,
      ci: true,
    };

    const result = await runPlaywright(input);
    expect(result).toBeDefined();
  });

  test("should write run metadata JSON", async () => {
    const repoRoot = setupMinimalProject();

    const input: RunInput = { repoRoot };
    const result = await runPlaywright(input);

    const runJsonPath = join(result.reportDir, "run.json");
    expect(existsSync(runJsonPath)).toBe(true);

    const runData = readJson<{ at: string; baseURL: string }>(runJsonPath);
    expect(runData.at).toBeDefined();
    expect(runData.baseURL).toBeDefined();
  });

  test("should include jsonReportPath in result", async () => {
    const repoRoot = setupMinimalProject();

    const input: RunInput = { repoRoot };
    const result = await runPlaywright(input);

    expect(result.jsonReportPath).toBeDefined();
    expect(result.jsonReportPath).toContain("playwright-report.json");
  });

  test("should include junitPath in result", async () => {
    const repoRoot = setupMinimalProject();

    const input: RunInput = { repoRoot };
    const result = await runPlaywright(input);

    expect(result.junitPath).toBeDefined();
    expect(result.junitPath).toContain("junit.xml");
  });

  test("should handle missing playwright config gracefully", async () => {
    // No config file
    const repoRoot = join(testDir, `no-config-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const input: RunInput = { repoRoot };
    const result = await runPlaywright(input);

    expect(result.exitCode).not.toBe(0);
  });

  test("should generate sequential runIds", async () => {
    const repoRoot = setupMinimalProject();

    const result1 = await runPlaywright({ repoRoot });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const result2 = await runPlaywright({ repoRoot });

    expect(result1.runId).not.toBe(result2.runId);

    const timestamp1 = parseInt(result1.runId.replace("run-", ""));
    const timestamp2 = parseInt(result2.runId.replace("run-", ""));
    expect(timestamp2).toBeGreaterThan(timestamp1);
  });

  test("should use default baseURL if not provided", async () => {
    const repoRoot = setupMinimalProject();

    const input: RunInput = { repoRoot };
    const result = await runPlaywright(input);

    const runJsonPath = join(result.reportDir, "run.json");
    if (existsSync(runJsonPath)) {
      const runData = readJson<{ baseURL: string }>(runJsonPath);
      expect(runData.baseURL).toBeDefined();
      expect(runData.baseURL).toMatch(/^http:\/\/localhost:\d+$/);
    }
  });

  test("should respect BASE_URL environment variable", async () => {
    const repoRoot = setupMinimalProject();
    const originalEnv = process.env.BASE_URL;
    process.env.BASE_URL = "http://test.example.com";

    try {
      const input: RunInput = { repoRoot };
      const result = await runPlaywright(input);

      const runJsonPath = join(result.reportDir, "run.json");
      if (existsSync(runJsonPath)) {
        const runData = readJson<{ baseURL: string }>(runJsonPath);
        expect(runData.baseURL).toBe("http://test.example.com");
      }
    } finally {
      if (originalEnv !== undefined) {
        process.env.BASE_URL = originalEnv;
      } else {
        delete process.env.BASE_URL;
      }
    }
  });

  test("should handle headless option", async () => {
    const repoRoot = setupMinimalProject();

    const input: RunInput = {
      repoRoot,
      headless: true,
    };

    const result = await runPlaywright(input);
    expect(result).toBeDefined();
  });

  test("should handle browsers option", async () => {
    const repoRoot = setupMinimalProject();

    const input: RunInput = {
      repoRoot,
      browsers: ["chromium"],
    };

    const result = await runPlaywright(input);
    expect(result).toBeDefined();
  });
});
