import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAtePaths } from "./fs";
import type { HealInput } from "./types";

export interface HealSuggestion {
  kind: "selector-map" | "note";
  title: string;
  diff: string; // unified diff suggestion (no auto-commit)
}

/**
 * Minimal Healing Engine (skeleton)
 * - Reads Playwright JSON report and proposes selector-map fallback suggestions.
 * - Does NOT auto-commit or patch files.
 */
export function heal(input: HealInput): { attempted: true; suggestions: HealSuggestion[] } {
  const paths = getAtePaths(input.repoRoot);
  const jsonReportPath = join(paths.reportsDir, input.runId || "latest", "playwright-report.json");

  let text = "";
  try {
    text = readFileSync(jsonReportPath, "utf8");
  } catch {
    return { attempted: true, suggestions: [{ kind: "note", title: "No Playwright JSON report found", diff: "" }] };
  }

  const suggestions: HealSuggestion[] = [];

  if (text.includes("locator") && text.includes("not found")) {
    suggestions.push({
      kind: "selector-map",
      title: "Locator not found → consider updating selector-map fallback",
      diff: [
        "--- a/.mandu/selector-map.json",
        "+++ b/.mandu/selector-map.json",
        "@@",
        " {",
        "-  \"note\": \"add fallback here\"",
        "+  \"note\": \"suggested: map missing mandu-id to alternative locators\"",
        " }",
        "",
      ].join("\n"),
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({ kind: "note", title: "No healing suggestion (skeleton)", diff: "" });
  }

  return { attempted: true, suggestions };
}
