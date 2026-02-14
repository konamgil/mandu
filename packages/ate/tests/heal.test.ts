import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { heal } from "../src/heal";
import type { HealInput } from "../src/types";

describe("heal", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "ate-heal-test-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("should return note when no report found", () => {
    const input: HealInput = {
      repoRoot: testDir,
      runId: "nonexistent",
    };

    const result = heal(input);

    expect(result.attempted).toBe(true);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].kind).toBe("note");
    expect(result.suggestions[0].title).toContain("No Playwright JSON report found");
  });

  test("should detect failed locators from trace", () => {
    // Setup
    const manduDir = join(testDir, ".mandu");
    const reportsDir = join(manduDir, "reports");
    const runDir = join(reportsDir, "test-run-1");

    mkdirSync(manduDir, { recursive: true });
    mkdirSync(reportsDir, { recursive: true });
    mkdirSync(runDir, { recursive: true });

    // Mock Playwright report with failed locator
    const mockReport = {
      config: {
        rootDir: "/test/project",
      },
      suites: [
        {
          title: "Login Tests",
          tests: [
            {
              title: "should login successfully",
              results: [
                {
                  steps: [
                    {
                      title: "click getByRole('button', { name: 'Submit' })",
                      error: {
                        message: "locator('getByRole(\"button\", { name: \"Submit\" })') not found",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const reportPath = join(runDir, "playwright-report.json");
    writeFileSync(reportPath, JSON.stringify(mockReport));

    // Execute
    const input: HealInput = {
      repoRoot: testDir,
      runId: "test-run-1",
    };

    const result = heal(input);

    // Assert
    expect(result.attempted).toBe(true);
    expect(result.suggestions.length).toBeGreaterThan(0);

    const selectorMapSuggestion = result.suggestions.find((s) => s.kind === "selector-map");
    expect(selectorMapSuggestion).toBeDefined();
    expect(selectorMapSuggestion?.diff).toContain("--- a/.mandu/selector-map.json");
    expect(selectorMapSuggestion?.diff).toContain("+++ b/.mandu/selector-map.json");
  });

  test("should generate alternative selectors", () => {
    // Setup with CSS ID selector failure
    const manduDir = join(testDir, ".mandu");
    const reportsDir = join(manduDir, "reports");
    const runDir = join(reportsDir, "test-run-2");

    mkdirSync(manduDir, { recursive: true });
    mkdirSync(reportsDir, { recursive: true });
    mkdirSync(runDir, { recursive: true });

    const mockReport = {
      config: { rootDir: "/test" },
      suites: [
        {
          tests: [
            {
              title: "test",
              results: [
                {
                  steps: [
                    {
                      title: "click #submit-button",
                      error: {
                        message: "locator('#submit-button') not found",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const reportPath = join(runDir, "playwright-report.json");
    writeFileSync(reportPath, JSON.stringify(mockReport));

    const input: HealInput = {
      repoRoot: testDir,
      runId: "test-run-2",
    };

    const result = heal(input);

    expect(result.attempted).toBe(true);

    const suggestion = result.suggestions.find((s) => s.kind === "selector-map");
    expect(suggestion).toBeDefined();
    expect(suggestion?.metadata?.selector).toBe("#submit-button");
    expect(suggestion?.metadata?.alternatives).toBeDefined();
    expect(suggestion?.metadata?.alternatives?.length).toBeGreaterThanOrEqual(3);
  });

  test("should generate unified diff with proper format", () => {
    // Setup
    const manduDir = join(testDir, ".mandu");
    const reportsDir = join(manduDir, "reports");
    const runDir = join(reportsDir, "test-run-3");

    mkdirSync(manduDir, { recursive: true });
    mkdirSync(reportsDir, { recursive: true });
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
                      title: "fill .username-input",
                      error: {
                        message: "locator('.username-input') not found",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const reportPath = join(runDir, "playwright-report.json");
    writeFileSync(reportPath, JSON.stringify(mockReport));

    const input: HealInput = {
      repoRoot: testDir,
      runId: "test-run-3",
    };

    const result = heal(input);

    const suggestion = result.suggestions.find((s) => s.kind === "selector-map");
    expect(suggestion).toBeDefined();

    const diff = suggestion!.diff;

    // Verify unified diff format
    expect(diff).toMatch(/^--- a\/.mandu\/selector-map\.json$/m);
    expect(diff).toMatch(/^\+\+\+ b\/.mandu\/selector-map\.json$/m);
    expect(diff).toMatch(/^@@ /m);
    expect(diff).toContain("+");
  });

  test("should handle multiple failed locators", () => {
    // Setup
    const manduDir = join(testDir, ".mandu");
    const reportsDir = join(manduDir, "reports");
    const runDir = join(reportsDir, "test-run-4");

    mkdirSync(manduDir, { recursive: true });
    mkdirSync(reportsDir, { recursive: true });
    mkdirSync(runDir, { recursive: true });

    const mockReport = {
      suites: [
        {
          tests: [
            {
              title: "multi-step test",
              results: [
                {
                  steps: [
                    {
                      title: "click #button1",
                      error: { message: "locator('#button1') not found" },
                    },
                    {
                      title: "fill #input1",
                      error: { message: "locator('#input1') timeout" },
                    },
                    {
                      title: "click .submit",
                      error: { message: "locator('.submit') failed" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const reportPath = join(runDir, "playwright-report.json");
    writeFileSync(reportPath, JSON.stringify(mockReport));

    const input: HealInput = {
      repoRoot: testDir,
      runId: "test-run-4",
    };

    const result = heal(input);

    expect(result.attempted).toBe(true);

    const selectorMapSuggestions = result.suggestions.filter((s) => s.kind === "selector-map");
    expect(selectorMapSuggestions.length).toBeGreaterThanOrEqual(3);

    // Verify each failed locator has suggestions
    const selectors = selectorMapSuggestions.map((s) => s.metadata?.selector);
    expect(selectors).toContain("#button1");
    expect(selectors).toContain("#input1");
    expect(selectors).toContain(".submit");
  });

  test("should return note when no failed locators found", () => {
    // Setup with successful test
    const manduDir = join(testDir, ".mandu");
    const reportsDir = join(manduDir, "reports");
    const runDir = join(reportsDir, "test-run-5");

    mkdirSync(manduDir, { recursive: true });
    mkdirSync(reportsDir, { recursive: true });
    mkdirSync(runDir, { recursive: true });

    const mockReport = {
      suites: [
        {
          tests: [
            {
              title: "successful test",
              results: [
                {
                  steps: [
                    {
                      title: "click button",
                      // No error - test passed
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const reportPath = join(runDir, "playwright-report.json");
    writeFileSync(reportPath, JSON.stringify(mockReport));

    const input: HealInput = {
      repoRoot: testDir,
      runId: "test-run-5",
    };

    const result = heal(input);

    expect(result.attempted).toBe(true);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].kind).toBe("note");
    expect(result.suggestions[0].title).toContain("No failed locators");
  });
});
