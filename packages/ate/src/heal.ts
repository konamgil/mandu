import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAtePaths, readJson } from "./fs";
import type { HealInput } from "./types";
import type { SelectorMapJson } from "./selector-map";

export interface HealSuggestion {
  kind: "selector-map" | "note";
  title: string;
  diff: string; // unified diff suggestion (no auto-commit)
}

/**
 * Minimal Healing Engine (slightly smarter)
 * - Reads Playwright JSON report (runId preferred; falls back to latest)
 * - If failures include "locator not found", proposes at least 1 concrete selector-map entry
 * - Does NOT auto-commit or patch files.
 */
export function heal(input: HealInput): { attempted: true; suggestions: HealSuggestion[] } {
  const paths = getAtePaths(input.repoRoot);

  const candidateReportPaths = [
    join(paths.reportsDir, input.runId, "playwright-report.json"),
    join(paths.reportsDir, "latest", "playwright-report.json"),
  ];

  const jsonReportPath = candidateReportPaths.find((p) => existsSync(p));
  if (!jsonReportPath) {
    return { attempted: true, suggestions: [{ kind: "note", title: "No Playwright JSON report found", diff: "" }] };
  }

  let reportText = "";
  try {
    reportText = readFileSync(jsonReportPath, "utf8");
  } catch {
    return { attempted: true, suggestions: [{ kind: "note", title: "Failed to read Playwright JSON report", diff: "" }] };
  }

  const suggestions: HealSuggestion[] = [];

  const failures = extractFailureMessages(reportText);

  const locatorNotFound = failures.find((m) => /locator/i.test(m) && /(not found|waiting for|Timeout)/i.test(m));
  if (locatorNotFound) {
    const extracted = extractCandidateSelector(locatorNotFound);

    // If we can extract something useful (manduId/testId), propose a concrete selector-map entry.
    if (extracted) {
      const selectorMapPath = paths.selectorMapPath;
      const existing = readSelectorMapOrNull(selectorMapPath);

      const alreadyHas = existing?.entries?.some((e) => e?.manduId === extracted.manduId) ?? false;

      suggestions.push({
        kind: "selector-map",
        title: alreadyHas
          ? `Existing selector-map entry found for ${extracted.manduId} (consider adding another fallback)`
          : `Add selector-map entry for ${extracted.manduId}`,
        diff: makeSelectorMapUnifiedDiff(extracted, alreadyHas),
      });
    } else {
      // Still provide a concrete (but placeholder) diff so the user has an actionable starting point.
      suggestions.push({
        kind: "selector-map",
        title: "Locator not found → add a placeholder selector-map entry (replace manduId/selector)",
        diff: makeSelectorMapUnifiedDiff(
          {
            manduId: "REPLACE_ME_MANDU_ID",
            fallbackKind: "css",
            fallbackSelector: "REPLACE_ME_WITH_A_STABLE_SELECTOR",
            evidence: "could not extract manduId/testId from failure message",
          },
          false,
        ),
      });
    }
  }

  if (suggestions.length === 0) {
    suggestions.push({ kind: "note", title: "No healing suggestion", diff: "" });
  }

  return { attempted: true, suggestions };
}

function extractFailureMessages(reportText: string): string[] {
  try {
    const parsed = JSON.parse(reportText) as any;
    const out: string[] = [];

    // Playwright JSON format varies by reporter; we best-effort traverse for "errors" and "error".
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return;

      if (typeof node.message === "string" && /Error|locator|Timeout|expect/i.test(node.message)) {
        out.push(node.message);
      }
      if (typeof node.error === "string") out.push(node.error);
      if (node.error && typeof node.error.message === "string") out.push(node.error.message);
      if (Array.isArray(node.errors)) {
        for (const e of node.errors) {
          if (typeof e === "string") out.push(e);
          else if (e && typeof e.message === "string") out.push(e.message);
        }
      }

      for (const v of Object.values(node)) {
        if (Array.isArray(v)) v.forEach(visit);
        else visit(v);
      }
    };

    visit(parsed);
    return Array.from(new Set(out)).slice(0, 50);
  } catch {
    // Fallback: cheap regex scan
    const lines = reportText.split(/\r?\n/);
    return lines.filter((l) => /locator/i.test(l) && /(not found|Timeout|waiting for)/i.test(l)).slice(0, 50);
  }
}

function extractCandidateSelector(message: string): null | { manduId: string; fallbackKind: string; fallbackSelector: string; evidence: string } {
  // 1) data-mandu-id="..."
  const manduId1 = message.match(/data-mandu-id\s*=\s*["']([^"']+)["']/i)?.[1];
  if (manduId1) {
    return {
      manduId: manduId1,
      fallbackKind: "css",
      fallbackSelector: `[data-mandu-id=\"${manduId1}\"]`,
      evidence: "extracted from data-mandu-id",
    };
  }

  // 2) getByTestId('...') / data-testid="..." (treat as manduId candidate)
  const testId = message.match(/getByTestId\((?:"|')([^"']+)(?:"|')\)/)?.[1]
    ?? message.match(/data-testid\s*=\s*["']([^"']+)["']/i)?.[1];

  if (testId) {
    return {
      manduId: testId,
      fallbackKind: "css",
      fallbackSelector: `[data-testid=\"${testId}\"]`,
      evidence: "extracted from testId",
    };
  }

  // 3) locator('css=...') fallback
  const locatorSel = message.match(/locator\((?:"|')([^"']+)(?:"|')\)/i)?.[1];
  if (locatorSel && locatorSel.length < 200) {
    // Not ideal, but better than nothing.
    return {
      manduId: "__unknown__",
      fallbackKind: "note",
      fallbackSelector: locatorSel,
      evidence: "extracted from locator()",
    };
  }

  return null;
}

function readSelectorMapOrNull(path: string): SelectorMapJson | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = readJson<SelectorMapJson>(path);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) return parsed;
  } catch {
    // ignore
  }
  return null;
}

function makeSelectorMapUnifiedDiff(extracted: { manduId: string; fallbackKind: string; fallbackSelector: string; evidence: string }, alreadyHas: boolean): string {
  // This is an advisory diff. We keep it simple and human-editable.
  const entrySnippet = extracted.fallbackKind === "css"
    ? [
        "    {",
        `      \"manduId\": \"${extracted.manduId}\",`,
        "      \"fallback\": [",
        "        {",
        "          \"kind\": \"css\",",
        `          \"selector\": \"${extracted.fallbackSelector.replace(/\\/g, "\\\\")}\"`,
        "        }",
        "      ]",
        "    }",
      ].join("\n")
    : [
        "    {",
        `      \"manduId\": \"${extracted.manduId}\",`,
        "      \"fallback\": [",
        "        {",
        "          \"kind\": \"css\",",
        "          \"selector\": \"REPLACE_ME_WITH_A_STABLE_SELECTOR\"",
        "        }",
        "      ]",
        "    }",
      ].join("\n");

  return [
    "--- a/.mandu/selector-map.json",
    "+++ b/.mandu/selector-map.json",
    "@@",
    alreadyHas
      ? ` // NOTE: ${extracted.evidence}. Add an additional fallback to the existing entry for ${extracted.manduId}.`
      : ` // NOTE: ${extracted.evidence}. Add a new entry under \"entries\".` ,
    " {",
    "   \"version\": 1,",
    "   \"buildSalt\": \"...\",",
    "   \"generatedAt\": \"...\",",
    "   \"entries\": [",
    "     ...",
    entrySnippet,
    "     ...",
    "   ]",
    " }",
    "",
  ].join("\n");
}
