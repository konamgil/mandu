import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { JsonValue, JsonObject } from "./types";

export interface TraceAction {
  type: string;
  selector?: string;
  method?: string;
  error?: string;
  params?: JsonObject;
  beforeSnapshot?: string;
  afterSnapshot?: string;
}

export interface FailedLocator {
  selector: string;
  error: string;
  context?: string;
  actionType?: string;
}

export interface TraceParseResult {
  actions: TraceAction[];
  failedLocators: FailedLocator[];
  metadata: {
    testFile?: string;
    testName?: string;
    timestamp?: string;
  };
}

/**
 * Parse Playwright trace.zip file
 * Trace format: ZIP archive containing trace JSON + resources
 *
 * @param tracePath - Path to trace.zip file
 * @returns Parsed trace with failed locators
 */
export function parseTrace(tracePath: string): TraceParseResult {
  let content: Buffer;

  try {
    content = readFileSync(tracePath);
  } catch (err) {
    throw new Error(`Failed to read trace file: ${tracePath}`);
  }

  // Playwright trace.zip is a ZIP archive
  // For MVP: assume trace is actually JSON (playwright-report.json)
  // Full ZIP parsing would require JSZip or similar

  let traceData: JsonValue;
  try {
    const text = content.toString("utf8");
    traceData = JSON.parse(text);
  } catch {
    // Try gunzip if it's compressed
    try {
      const decompressed = gunzipSync(content);
      const text = decompressed.toString("utf8");
      traceData = JSON.parse(text);
    } catch (err) {
      throw new Error(`Failed to parse trace JSON: ${String(err)}`);
    }
  }

  const result: TraceParseResult = {
    actions: [],
    failedLocators: [],
    metadata: {},
  };

  // Parse Playwright report structure
  if (typeof traceData !== "object" || !traceData || Array.isArray(traceData)) {
    return result;
  }

  const report = traceData as JsonObject;

  // Extract metadata
  if (typeof report.config === "object" && report.config) {
    const config = report.config as JsonObject;
    result.metadata.testFile = String(config.rootDir || "");
  }

  // Parse suites and tests
  const suites = Array.isArray(report.suites) ? report.suites : [];

  for (const suite of suites) {
    if (typeof suite !== "object" || !suite) continue;
    const suiteObj = suite as JsonObject;

    const tests = Array.isArray(suiteObj.tests) ? suiteObj.tests : [];

    for (const test of tests) {
      if (typeof test !== "object" || !test) continue;
      const testObj = test as JsonObject;

      result.metadata.testName = String(testObj.title || "");

      const results = Array.isArray(testObj.results) ? testObj.results : [];

      for (const testResult of results) {
        if (typeof testResult !== "object" || !testResult) continue;
        const resultObj = testResult as JsonObject;

        const steps = Array.isArray(resultObj.steps) ? resultObj.steps : [];

        for (const step of steps) {
          if (typeof step !== "object" || !step) continue;
          const stepObj = step as JsonObject;

          const action: TraceAction = {
            type: String(stepObj.title || "unknown"),
          };

          // Extract error info
          if (stepObj.error) {
            const errorObj = typeof stepObj.error === "object" && stepObj.error ? stepObj.error as JsonObject : {};
            action.error = String(errorObj.message || stepObj.error);

            // Parse locator from error message
            const errorMsg = action.error;
            const locatorMatch = errorMsg.match(/locator\(['"](.+?)['"]\)/);
            if (locatorMatch) {
              action.selector = locatorMatch[1];
            }

            // Detect failed locator
            if (errorMsg.includes("not found") || errorMsg.includes("timeout") || errorMsg.includes("failed")) {
              const selector = action.selector || extractSelectorFromTitle(String(stepObj.title || ""));

              if (selector) {
                result.failedLocators.push({
                  selector,
                  error: errorMsg,
                  context: String(stepObj.title || ""),
                  actionType: detectActionType(String(stepObj.title || "")),
                });
              }
            }
          }

          result.actions.push(action);
        }
      }
    }
  }

  return result;
}

/**
 * Extract selector from step title
 * Examples:
 * - "click getByRole('button', { name: 'Submit' })" → "getByRole('button', { name: 'Submit' })"
 * - "fill #username" → "#username"
 */
function extractSelectorFromTitle(title: string): string | null {
  // getByRole, getByText, etc.
  const playwrightMatch = title.match(/get\w+\([^)]+\)/);
  if (playwrightMatch) {
    return playwrightMatch[0];
  }

  // CSS selectors
  const cssMatch = title.match(/[#.]\w[\w-]*/);
  if (cssMatch) {
    return cssMatch[0];
  }

  // XPath
  const xpathMatch = title.match(/\/\/[\w/[\]@='".\s]+/);
  if (xpathMatch) {
    return xpathMatch[0];
  }

  return null;
}

/**
 * Detect action type from step title
 */
function detectActionType(title: string): string {
  const lower = title.toLowerCase();

  if (lower.includes("click")) return "click";
  if (lower.includes("fill") || lower.includes("type")) return "fill";
  if (lower.includes("select")) return "select";
  if (lower.includes("check")) return "check";
  if (lower.includes("navigate") || lower.includes("goto")) return "navigate";
  if (lower.includes("wait")) return "wait";

  return "unknown";
}

/**
 * Generate alternative selectors for a failed locator
 *
 * @param selector - Original failed selector
 * @param actionType - Type of action (click, fill, etc.)
 * @returns Array of alternative selectors to try
 */
export function generateAlternativeSelectors(selector: string, actionType?: string): string[] {
  const alternatives: string[] = [];

  // CSS ID → alternatives
  if (selector.startsWith("#")) {
    const id = selector.slice(1);
    alternatives.push(
      `[data-testid="${id}"]`,
      `[id="${id}"]`,
      `[name="${id}"]`,
      `[aria-label="${id}"]`,
    );
  }

  // CSS class → alternatives
  if (selector.startsWith(".")) {
    const cls = selector.slice(1);
    alternatives.push(
      `[data-testid="${cls}"]`,
      `.${cls}`,
      `[class*="${cls}"]`,
    );
  }

  // getByRole → alternatives
  if (selector.includes("getByRole")) {
    const roleMatch = selector.match(/getByRole\(['"](\w+)['"]/);
    const nameMatch = selector.match(/name:\s*['"](.+?)['"]/);

    if (roleMatch && nameMatch) {
      const role = roleMatch[1];
      const name = nameMatch[1];

      alternatives.push(
        `getByRole('${role}', { name: /${name}/i })`,
        `getByText('${name}')`,
        `[aria-label="${name}"]`,
        `button:has-text("${name}")`,
      );
    }
  }

  // getByText → alternatives
  if (selector.includes("getByText")) {
    const textMatch = selector.match(/getByText\(['"](.+?)['"]/);
    if (textMatch) {
      const text = textMatch[1];
      alternatives.push(
        `getByText(/${text}/i)`,
        `text=${text}`,
        `:has-text("${text}")`,
      );
    }
  }

  // Generic fallbacks
  if (actionType === "click" || actionType === "fill") {
    alternatives.push(
      `[data-testid="${selector}"]`,
      `[aria-label="${selector}"]`,
      `[name="${selector}"]`,
    );
  }

  // Remove duplicates
  return [...new Set(alternatives)];
}
