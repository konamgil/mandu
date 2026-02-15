import { readFileSync, existsSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { getAtePaths, ensureDir } from "./fs";
import type { HealInput } from "./types";
import { parseTrace, generateAlternativeSelectors } from "./trace-parser";
import { execSync } from "node:child_process";

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

export type FailureCategory = "selector" | "timeout" | "assertion" | "unknown";

export interface FeedbackAnalysis {
  category: FailureCategory;
  suggestions: HealSuggestion[];
  autoApplicable: boolean;
  priority: number; // 1-10, higher = more confident
  reasoning: string;
}

export interface FeedbackInput {
  repoRoot: string;
  runId: string;
  autoApply?: boolean;
}

export interface ApplyHealInput {
  repoRoot: string;
  runId: string;
  healIndex: number;
  createBackup?: boolean;
}

export interface ApplyHealResult {
  success: boolean;
  appliedFile: string;
  backupPath?: string;
  error?: string;
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

/**
 * Analyze test failure feedback and categorize for heal suggestions
 */
export function analyzeFeedback(input: FeedbackInput): FeedbackAnalysis {
  const healResult = heal({
    repoRoot: input.repoRoot,
    runId: input.runId,
  });

  if (!healResult.attempted || healResult.suggestions.length === 0) {
    return {
      category: "unknown",
      suggestions: [],
      autoApplicable: false,
      priority: 0,
      reasoning: "No healing suggestions available",
    };
  }

  // Categorize failure based on suggestions
  const hasSelector = healResult.suggestions.some((s) => s.kind === "selector-map");
  const hasTestCode = healResult.suggestions.some((s) => s.kind === "test-code");
  const onlyNotes = healResult.suggestions.every((s) => s.kind === "note");

  let category: FailureCategory = "unknown";
  let autoApplicable = false;
  let priority = 5;
  let reasoning = "";

  if (hasSelector) {
    category = "selector";
    // Auto-apply selector-map changes only (safe)
    autoApplicable = true;
    priority = 8;
    reasoning = "Failed locator detected. Selector-map update is safe to auto-apply.";
  } else if (hasTestCode) {
    category = "assertion";
    // Test code changes require manual review
    autoApplicable = false;
    priority = 6;
    reasoning = "Test code modification suggested. Manual review required.";
  } else if (onlyNotes) {
    const noteText = healResult.suggestions[0]?.title.toLowerCase() || "";
    if (noteText.includes("timeout")) {
      category = "timeout";
      priority = 4;
      reasoning = "Timeout detected. May require wait time adjustment.";
    } else {
      category = "unknown";
      priority = 3;
      reasoning = "Unable to categorize failure automatically.";
    }
    autoApplicable = false;
  }

  return {
    category,
    suggestions: healResult.suggestions,
    autoApplicable: autoApplicable && (input.autoApply ?? false),
    priority,
    reasoning,
  };
}

/**
 * Check if git working directory has uncommitted changes
 */
function hasUncommittedChanges(repoRoot: string): boolean {
  try {
    const result = execSync("git status --porcelain", {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return result.trim().length > 0;
  } catch {
    // Not a git repo or git not available
    return false;
  }
}

/**
 * Apply a heal suggestion diff to the actual file
 */
export function applyHeal(input: ApplyHealInput): ApplyHealResult {
  const paths = getAtePaths(input.repoRoot);
  const reportDir = join(paths.reportsDir, input.runId);

  // Get heal suggestions
  const healResult = heal({
    repoRoot: input.repoRoot,
    runId: input.runId,
  });

  if (!healResult.attempted || healResult.suggestions.length === 0) {
    return {
      success: false,
      appliedFile: "",
      error: "No heal suggestions available",
    };
  }

  if (input.healIndex < 0 || input.healIndex >= healResult.suggestions.length) {
    return {
      success: false,
      appliedFile: "",
      error: `Invalid heal index: ${input.healIndex} (available: 0-${healResult.suggestions.length - 1})`,
    };
  }

  const suggestion = healResult.suggestions[input.healIndex];

  // Only apply selector-map or test-code suggestions
  if (suggestion.kind === "note") {
    return {
      success: false,
      appliedFile: "",
      error: "Cannot apply note-type suggestions",
    };
  }

  // Safety check: require backup if working directory is dirty
  const createBackup = input.createBackup ?? true;
  if (!createBackup && hasUncommittedChanges(input.repoRoot)) {
    return {
      success: false,
      appliedFile: "",
      error: "Backup required: git working directory has uncommitted changes",
    };
  }

  let targetFile: string;
  let backupPath: string | undefined;

  try {
    if (suggestion.kind === "selector-map") {
      targetFile = paths.selectorMapPath;

      // Create backup
      if (createBackup) {
        ensureDir(reportDir);
        backupPath = join(reportDir, `selector-map.backup-${Date.now()}.json`);
        if (existsSync(targetFile)) {
          copyFileSync(targetFile, backupPath);
        }
      }

      // Apply selector-map diff
      const currentContent = existsSync(targetFile)
        ? JSON.parse(readFileSync(targetFile, "utf8"))
        : { version: "1.0.0" };

      // Extract selector and alternatives from metadata
      const { selector, alternatives } = suggestion.metadata || {};
      if (!selector || !alternatives || alternatives.length === 0) {
        throw new Error("Invalid suggestion metadata");
      }

      // Update selector-map
      currentContent[selector] = {
        fallbacks: alternatives,
      };

      writeFileSync(targetFile, JSON.stringify(currentContent, null, 2), "utf8");
    } else if (suggestion.kind === "test-code") {
      // Test code modification - extract file path from metadata
      const testFile = suggestion.metadata?.testFile;
      if (!testFile) {
        throw new Error("No test file specified in suggestion metadata");
      }

      targetFile = join(input.repoRoot, testFile);

      if (!existsSync(targetFile)) {
        throw new Error(`Test file not found: ${targetFile}`);
      }

      // Create backup
      if (createBackup) {
        ensureDir(reportDir);
        backupPath = join(reportDir, `${testFile.replace(/\//g, "_")}.backup-${Date.now()}`);
        copyFileSync(targetFile, backupPath);
      }

      // Apply test code diff (simple string replacement)
      const { selector, alternatives } = suggestion.metadata || {};
      if (!selector || !alternatives || alternatives.length === 0) {
        throw new Error("Invalid suggestion metadata");
      }

      const content = readFileSync(targetFile, "utf8");
      const newContent = content.replace(
        new RegExp(`locator\\(['"\`]${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"\`]\\)`, "g"),
        `locator('${alternatives[0]}')`,
      );

      writeFileSync(targetFile, newContent, "utf8");
    } else {
      return {
        success: false,
        appliedFile: "",
        error: `Unsupported suggestion kind: ${suggestion.kind}`,
      };
    }

    return {
      success: true,
      appliedFile: targetFile,
      backupPath,
    };
  } catch (err) {
    return {
      success: false,
      appliedFile: targetFile!,
      backupPath,
      error: String(err),
    };
  }
}
