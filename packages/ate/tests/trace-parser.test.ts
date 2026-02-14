import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseTrace,
  generateAlternativeSelectors,
  type TraceParseResult,
} from "../src/trace-parser";

describe("parseTrace", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "ate-trace-test-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("should parse valid trace JSON", () => {
    const tracePath = join(testDir, "trace1.json");
    const mockTrace = {
      config: {
        rootDir: "/test/project",
      },
      suites: [
        {
          title: "Test Suite",
          tests: [
            {
              title: "test case",
              results: [
                {
                  steps: [
                    {
                      title: "click button",
                      error: {
                        message: "locator('button') not found",
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

    writeFileSync(tracePath, JSON.stringify(mockTrace));

    const result = parseTrace(tracePath);

    expect(result.actions).toBeDefined();
    expect(result.failedLocators).toBeDefined();
    expect(result.metadata).toBeDefined();
  });

  test("should extract failed locators from error messages", () => {
    const tracePath = join(testDir, "trace2.json");
    const mockTrace = {
      suites: [
        {
          tests: [
            {
              title: "login test",
              results: [
                {
                  steps: [
                    {
                      title: "click getByRole('button', { name: 'Login' })",
                      error: {
                        message: "locator('getByRole(\"button\", { name: \"Login\" })') not found",
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

    writeFileSync(tracePath, JSON.stringify(mockTrace));

    const result = parseTrace(tracePath);

    expect(result.failedLocators.length).toBeGreaterThan(0);

    const failed = result.failedLocators[0];
    expect(failed.selector).toBeDefined();
    expect(failed.error).toContain("not found");
  });

  test("should extract selector from step title", () => {
    const tracePath = join(testDir, "trace3.json");
    const mockTrace = {
      suites: [
        {
          tests: [
            {
              title: "form test",
              results: [
                {
                  steps: [
                    {
                      title: "fill #username",
                      error: {
                        message: "timeout waiting for locator",
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

    writeFileSync(tracePath, JSON.stringify(mockTrace));

    const result = parseTrace(tracePath);

    expect(result.failedLocators.length).toBe(1);
    expect(result.failedLocators[0].selector).toBe("#username");
  });

  test("should detect action types", () => {
    const tracePath = join(testDir, "trace4.json");
    const mockTrace = {
      suites: [
        {
          tests: [
            {
              title: "action types test",
              results: [
                {
                  steps: [
                    {
                      title: "click .button",
                      error: { message: "failed" },
                    },
                    {
                      title: "fill .input",
                      error: { message: "failed" },
                    },
                    {
                      title: "select .dropdown",
                      error: { message: "failed" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    writeFileSync(tracePath, JSON.stringify(mockTrace));

    const result = parseTrace(tracePath);

    expect(result.failedLocators.length).toBe(3);
    expect(result.failedLocators[0].actionType).toBe("click");
    expect(result.failedLocators[1].actionType).toBe("fill");
    expect(result.failedLocators[2].actionType).toBe("select");
  });

  test("should handle trace with no errors", () => {
    const tracePath = join(testDir, "trace5.json");
    const mockTrace = {
      suites: [
        {
          tests: [
            {
              title: "passing test",
              results: [
                {
                  steps: [
                    {
                      title: "click button",
                      // No error
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    writeFileSync(tracePath, JSON.stringify(mockTrace));

    const result = parseTrace(tracePath);

    expect(result.failedLocators).toHaveLength(0);
    expect(result.actions.length).toBeGreaterThan(0);
  });

  test("should throw error for non-existent file", () => {
    const tracePath = join(testDir, "nonexistent.json");

    expect(() => parseTrace(tracePath)).toThrow("Failed to read trace file");
  });

  test("should throw error for invalid JSON", () => {
    const tracePath = join(testDir, "invalid.json");
    writeFileSync(tracePath, "not valid json {{{");

    expect(() => parseTrace(tracePath)).toThrow("Failed to parse trace JSON");
  });
});

describe("generateAlternativeSelectors", () => {
  test("should generate alternatives for CSS ID", () => {
    const alternatives = generateAlternativeSelectors("#submit-button", "click");

    expect(alternatives.length).toBeGreaterThanOrEqual(3);
    expect(alternatives).toContain('[data-testid="submit-button"]');
    expect(alternatives).toContain('[id="submit-button"]');
  });

  test("should generate alternatives for CSS class", () => {
    const alternatives = generateAlternativeSelectors(".login-form", "click");

    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives).toContain('[data-testid="login-form"]');
    expect(alternatives.some((s) => s.includes("login-form"))).toBe(true);
  });

  test("should generate alternatives for getByRole", () => {
    const alternatives = generateAlternativeSelectors(
      "getByRole('button', { name: 'Submit' })",
      "click",
    );

    expect(alternatives.length).toBeGreaterThanOrEqual(3);
    expect(alternatives.some((s) => s.includes("Submit"))).toBe(true);
    expect(alternatives.some((s) => s.includes("getByText"))).toBe(true);
  });

  test("should generate alternatives for getByText", () => {
    const alternatives = generateAlternativeSelectors("getByText('Click me')", "click");

    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives.some((s) => s.includes("Click me"))).toBe(true);
    expect(alternatives.some((s) => s.includes(":has-text"))).toBe(true);
  });

  test("should include generic fallbacks for specific action types", () => {
    const clickAlternatives = generateAlternativeSelectors("#unknown", "click");
    const fillAlternatives = generateAlternativeSelectors("#unknown", "fill");

    expect(clickAlternatives.some((s) => s.includes("data-testid"))).toBe(true);
    expect(fillAlternatives.some((s) => s.includes("aria-label"))).toBe(true);
  });

  test("should remove duplicate alternatives", () => {
    const alternatives = generateAlternativeSelectors("#test", "click");

    const uniqueAlternatives = new Set(alternatives);
    expect(alternatives.length).toBe(uniqueAlternatives.size);
  });

  test("should handle case-insensitive role matching", () => {
    const alternatives = generateAlternativeSelectors(
      "getByRole('button', { name: 'Login' })",
    );

    const hasRegexVersion = alternatives.some((s) => s.includes("/Login/i"));
    expect(hasRegexVersion).toBe(true);
  });

  test("should return empty array when no alternatives can be generated", () => {
    const alternatives = generateAlternativeSelectors("", "unknown");

    // Should still have some generic fallbacks
    expect(Array.isArray(alternatives)).toBe(true);
  });
});
