import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getAtePaths } from "./fs";
import type { HealInput } from "./types";
import { parseTrace, generateAlternativeSelectors } from "./trace-parser";

export interface HealSuggestion {
  kind: "selector-map" | "test-code" | "note";
  title: string;
  diff: string; // unified diff suggestion (no auto-commit)
  metadata?: {
    selector?: string;
    alternatives?: string[];
    testFile?: string;
  };
}

/**
 * Healing Engine
 * - Parses Playwright trace/report to find failed locators
 * - Generates alternative selector suggestions
 * - Creates unified diffs for selector-map.json or test files
 * - Does NOT auto-commit or patch files (user must review and apply)
 */
export function heal(input: HealInput): { attempted: true; suggestions: HealSuggestion[] } {
  const paths = getAtePaths(input.repoRoot);
  const reportDir = join(paths.reportsDir, input.runId || "latest");
  const jsonReportPath = join(reportDir, "playwright-report.json");

  // Try to read Playwright report
  if (!existsSync(jsonReportPath)) {
    return {
      attempted: true,
      suggestions: [{ kind: "note", title: "No Playwright JSON report found", diff: "" }],
    };
  }

  const suggestions: HealSuggestion[] = [];

  try {
    // Parse trace to extract failed locators
    const parseResult = parseTrace(jsonReportPath);

    if (parseResult.failedLocators.length === 0) {
      suggestions.push({
        kind: "note",
        title: "No failed locators detected in trace",
        diff: "",
      });
      return { attempted: true, suggestions };
    }

    // Generate healing suggestions for each failed locator
    for (const failed of parseResult.failedLocators) {
      const alternatives = generateAlternativeSelectors(failed.selector, failed.actionType);

      if (alternatives.length === 0) {
        suggestions.push({
          kind: "note",
          title: `Failed locator: ${failed.selector} (no alternatives)`,
          diff: "",
          metadata: {
            selector: failed.selector,
            alternatives: [],
          },
        });
        continue;
      }

      // Generate selector-map diff
      const selectorMapDiff = generateSelectorMapDiff(failed.selector, alternatives);
      suggestions.push({
        kind: "selector-map",
        title: `Update selector-map for: ${failed.selector}`,
        diff: selectorMapDiff,
        metadata: {
          selector: failed.selector,
          alternatives,
        },
      });

      // If we have test file context, generate test code diff
      if (parseResult.metadata.testFile && failed.context) {
        const testCodeDiff = generateTestCodeDiff(
          parseResult.metadata.testFile,
          failed.selector,
          alternatives[0], // Use first alternative
          failed.context,
        );

        if (testCodeDiff) {
          suggestions.push({
            kind: "test-code",
            title: `Update test code: ${failed.selector} → ${alternatives[0]}`,
            diff: testCodeDiff,
            metadata: {
              selector: failed.selector,
              alternatives,
              testFile: parseResult.metadata.testFile,
            },
          });
        }
      }
    }
  } catch (err) {
    suggestions.push({
      kind: "note",
      title: `Healing failed: ${String(err)}`,
      diff: "",
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      kind: "note",
      title: "No healing suggestions available",
      diff: "",
    });
  }

  return { attempted: true, suggestions };
}

/**
 * Generate unified diff for selector-map.json
 */
function generateSelectorMapDiff(originalSelector: string, alternatives: string[]): string {
  const escapedSelector = JSON.stringify(originalSelector);
  const alternativesJson = JSON.stringify(alternatives, null, 2).split("\n").join("\n+    ");

  const lines = [
    "--- a/.mandu/selector-map.json",
    "+++ b/.mandu/selector-map.json",
    "@@ -1,3 +1,8 @@",
    " {",
    "+  " + escapedSelector + ": {",
    "+    \"fallbacks\": " + alternativesJson,
    "+  },",
    "   \"version\": \"1.0.0\"",
    " }",
    "",
  ];

  return lines.join("\n");
}

/**
 * Generate unified diff for test code file
 */
function generateTestCodeDiff(
  testFile: string,
  originalSelector: string,
  newSelector: string,
  context: string,
): string | null {
  // Escape special regex characters
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Try to infer the line content from context
  const contextLine = context.trim();

  if (!contextLine) {
    return null;
  }

  const lines = [
    `--- a/${testFile}`,
    `+++ b/${testFile}`,
    "@@ -1,3 +1,3 @@",
    ` // ${contextLine}`,
    `-await page.locator('${originalSelector}')`,
    `+await page.locator('${newSelector}')`,
    "",
  ];

  return lines.join("\n");
}
