import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeFeedback, applyHeal } from "../src/heal";
import type { FeedbackInput, ApplyHealInput } from "../src/heal";

describe("heal integration - feedback & apply", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "ate-heal-integration-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("analyzeFeedback should categorize selector failures correctly", () => {
    // Setup with selector failure
    const manduDir = join(testDir, ".mandu");
    const reportsDir = join(manduDir, "reports");
    const runDir = join(reportsDir, "feedback-test-1");

    mkdirSync(runDir, { recursive: true });

    const mockReport = {
      suites: [
        {
          tests: [
            {
              title: "login test",
              results: [
                {
                  steps: [
                    {
                      title: "click #login-button",
                      error: { message: "locator('#login-button') not found" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    writeFileSync(join(runDir, "playwright-report.json"), JSON.stringify(mockReport));

    const input: FeedbackInput = {
      repoRoot: testDir,
      runId: "feedback-test-1",
      autoApply: false,
    };

    const result = analyzeFeedback(input);

    expect(result.category).toBe("selector");
    expect(result.priority).toBeGreaterThan(5);
    expect(result.autoApplicable).toBe(false); // autoApply is false
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.reasoning).toContain("Selector-map");
  });

  test("analyzeFeedback with autoApply=true should mark selector changes as auto-applicable", () => {
    // Setup
    const manduDir = join(testDir, ".mandu");
    const reportsDir = join(manduDir, "reports");
    const runDir = join(reportsDir, "feedback-test-2");

    mkdirSync(runDir, { recursive: true });

    const mockReport = {
      suites: [
        {
          tests: [
            {
              title: "form test",
              results: [
                {
                  steps: [
                    {
                      title: "fill .email-input",
                      error: { message: "locator('.email-input') timeout" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    writeFileSync(join(runDir, "playwright-report.json"), JSON.stringify(mockReport));

    const input: FeedbackInput = {
      repoRoot: testDir,
      runId: "feedback-test-2",
      autoApply: true,
    };

    const result = analyzeFeedback(input);

    expect(result.category).toBe("selector");
    expect(result.autoApplicable).toBe(true); // selector-map safe + autoApply=true
    expect(result.priority).toBe(8);
  });

  test("applyHeal should apply selector-map changes", () => {
    // Setup
    const manduDir = join(testDir, ".mandu");
    const reportsDir = join(manduDir, "reports");
    const runDir = join(reportsDir, "apply-test-1");

    mkdirSync(runDir, { recursive: true });

    const mockReport = {
      suites: [
        {
          tests: [
            {
              title: "button test",
              results: [
                {
                  steps: [
                    {
                      title: "click #submit-btn",
                      error: { message: "locator('#submit-btn') not found" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    writeFileSync(join(runDir, "playwright-report.json"), JSON.stringify(mockReport));

    const input: ApplyHealInput = {
      repoRoot: testDir,
      runId: "apply-test-1",
      healIndex: 0, // First suggestion (selector-map)
      createBackup: true,
    };

    const result = applyHeal(input);

    expect(result.success).toBe(true);
    expect(result.appliedFile).toContain("selector-map.json");
    expect(result.backupPath).toBeDefined();

    // Verify selector-map.json was created/updated
    const selectorMapPath = join(manduDir, "selector-map.json");
    expect(existsSync(selectorMapPath)).toBe(true);

    const selectorMap = JSON.parse(readFileSync(selectorMapPath, "utf8"));
    expect(selectorMap["#submit-btn"]).toBeDefined();
    expect(selectorMap["#submit-btn"].fallbacks).toBeDefined();
    expect(selectorMap["#submit-btn"].fallbacks.length).toBeGreaterThan(0);

    // Backup is only created if file existed before
    // In this case, selector-map.json didn't exist, so no backup
    // (backupPath would be defined but file won't exist)
  });

  test("applyHeal should reject invalid healIndex", () => {
    // Setup
    const manduDir = join(testDir, ".mandu");
    const reportsDir = join(manduDir, "reports");
    const runDir = join(reportsDir, "apply-test-2");

    mkdirSync(runDir, { recursive: true });

    const mockReport = {
      suites: [
        {
          tests: [
            {
              title: "test",
              results: [
                {
                  steps: [
                    {
                      title: "click button",
                      error: { message: "locator('button') not found" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    writeFileSync(join(runDir, "playwright-report.json"), JSON.stringify(mockReport));

    const input: ApplyHealInput = {
      repoRoot: testDir,
      runId: "apply-test-2",
      healIndex: 999, // Invalid index
      createBackup: true,
    };

    const result = applyHeal(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid heal index");
  });

  test("applyHeal should reject note-type suggestions", () => {
    // Setup with no failures (will generate note)
    const manduDir = join(testDir, ".mandu");
    const reportsDir = join(manduDir, "reports");
    const runDir = join(reportsDir, "apply-test-3");

    mkdirSync(runDir, { recursive: true });

    const mockReport = {
      suites: [
        {
          tests: [
            {
              title: "success test",
              results: [
                {
                  steps: [
                    {
                      title: "click button",
                      // No error - successful
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    writeFileSync(join(runDir, "playwright-report.json"), JSON.stringify(mockReport));

    const input: ApplyHealInput = {
      repoRoot: testDir,
      runId: "apply-test-3",
      healIndex: 0,
      createBackup: true,
    };

    const result = applyHeal(input);

    expect(result.success).toBe(false);
    expect(result.error).toContain("note-type");
  });

  test("applyHeal should create backup by default", () => {
    // Setup
    const manduDir = join(testDir, ".mandu");
    const reportsDir = join(manduDir, "reports");
    const runDir = join(reportsDir, "apply-test-4");

    mkdirSync(runDir, { recursive: true });

    // Create existing selector-map
    const selectorMapPath = join(manduDir, "selector-map.json");
    writeFileSync(
      selectorMapPath,
      JSON.stringify({
        version: "1.0.0",
        "#existing-selector": { fallbacks: ["backup-selector"] },
      }),
    );

    const mockReport = {
      suites: [
        {
          tests: [
            {
              title: "test",
              results: [
                {
                  steps: [
                    {
                      title: "click #new-selector",
                      error: { message: "locator('#new-selector') failed" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    writeFileSync(join(runDir, "playwright-report.json"), JSON.stringify(mockReport));

    const input: ApplyHealInput = {
      repoRoot: testDir,
      runId: "apply-test-4",
      healIndex: 0,
      // createBackup not specified - should default to true
    };

    const result = applyHeal(input);

    expect(result.success).toBe(true);
    expect(result.backupPath).toBeDefined();

    // Verify backup contains old content
    if (result.backupPath) {
      const backup = JSON.parse(readFileSync(result.backupPath, "utf8"));
      expect(backup["#existing-selector"]).toBeDefined();
      expect(backup["#existing-selector"].fallbacks).toContain("backup-selector");
    }

    // Verify new selector-map has both old and new
    const updatedMap = JSON.parse(readFileSync(selectorMapPath, "utf8"));
    expect(updatedMap["#existing-selector"]).toBeDefined();
    expect(updatedMap["#new-selector"]).toBeDefined();
  });

  test("analyzeFeedback should handle empty report gracefully", () => {
    const input: FeedbackInput = {
      repoRoot: testDir,
      runId: "nonexistent-run",
      autoApply: false,
    };

    const result = analyzeFeedback(input);

    expect(result.category).toBe("unknown");
    expect(result.autoApplicable).toBe(false);
    expect(result.priority).toBeLessThan(5); // Should be low priority
    // heal() returns a note when no report found
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0].kind).toBe("note");
  });
});
