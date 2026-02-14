import { existsSync } from "node:fs";
import { getAtePaths, readJson, writeJson } from "./fs";

/**
 * Selector Map Schema
 * Maps mandu-id to multiple selector strategies for resilient UI testing
 */
export interface SelectorMap {
  schemaVersion: 1;
  generatedAt: string;
  entries: SelectorMapEntry[];
}

export interface SelectorMapEntry {
  manduId: string;
  file: string;
  element: string; // e.g., "button", "input", "a"
  primary: SelectorStrategy;
  alternatives: SelectorStrategy[];
}

export interface SelectorStrategy {
  type: "mandu-id" | "text" | "class" | "xpath" | "role";
  value: string;
  priority: number; // 0 = highest
}

/**
 * Read selector-map.json from .mandu directory
 */
export function readSelectorMap(repoRoot: string): SelectorMap | null {
  const paths = getAtePaths(repoRoot);
  if (!existsSync(paths.selectorMapPath)) {
    return null;
  }
  return readJson<SelectorMap>(paths.selectorMapPath);
}

/**
 * Write selector-map.json to .mandu directory
 */
export function writeSelectorMap(repoRoot: string, map: SelectorMap): void {
  const paths = getAtePaths(repoRoot);
  writeJson(paths.selectorMapPath, map);
}

/**
 * Initialize empty selector map
 */
export function initSelectorMap(): SelectorMap {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    entries: [],
  };
}

/**
 * Add or update a selector entry
 */
export function addSelectorEntry(
  map: SelectorMap,
  entry: Omit<SelectorMapEntry, "alternatives"> & { alternatives?: SelectorStrategy[] }
): SelectorMap {
  const existing = map.entries.findIndex((e) => e.manduId === entry.manduId);

  const fullEntry: SelectorMapEntry = {
    ...entry,
    alternatives: entry.alternatives ?? [],
  };

  if (existing >= 0) {
    map.entries[existing] = fullEntry;
  } else {
    map.entries.push(fullEntry);
  }

  map.generatedAt = new Date().toISOString();
  return map;
}

/**
 * Generate alternative selectors for a given mandu-id element
 *
 * Fallback chain priority:
 * 0. mandu-id (primary)
 * 1. text-based (exact text match)
 * 2. class-based (CSS class)
 * 3. xpath (structural fallback)
 * 4. role (ARIA role)
 */
export function generateAlternatives(opts: {
  manduId: string;
  element: string;
  text?: string;
  className?: string;
  ariaRole?: string;
}): SelectorStrategy[] {
  const alternatives: SelectorStrategy[] = [];

  // Text-based selector
  if (opts.text) {
    alternatives.push({
      type: "text",
      value: `:has-text("${opts.text}")`,
      priority: 1,
    });
  }

  // Class-based selector
  if (opts.className) {
    alternatives.push({
      type: "class",
      value: `.${opts.className}`,
      priority: 2,
    });
  }

  // ARIA role selector
  if (opts.ariaRole) {
    alternatives.push({
      type: "role",
      value: `role=${opts.ariaRole}`,
      priority: 3,
    });
  }

  // XPath fallback (structural)
  const xpathValue = `//${opts.element}[@data-mandu-id="${opts.manduId}"]`;
  alternatives.push({
    type: "xpath",
    value: xpathValue,
    priority: 4,
  });

  return alternatives.sort((a, b) => a.priority - b.priority);
}

/**
 * Get selector entry by mandu-id
 */
export function getSelectorEntry(
  map: SelectorMap,
  manduId: string
): SelectorMapEntry | undefined {
  return map.entries.find((e) => e.manduId === manduId);
}

/**
 * Build Playwright .or() chain from selector entry
 * Returns: page.locator(primary).or(alt1).or(alt2)...
 */
export function buildPlaywrightLocatorChain(entry: SelectorMapEntry): string {
  const primaryLocator = `page.locator('[data-mandu-id="${entry.manduId}"]')`;

  if (entry.alternatives.length === 0) {
    return primaryLocator;
  }

  const alternativeChains = entry.alternatives
    .map((alt) => {
      switch (alt.type) {
        case "text":
          return `page.locator('${entry.element}${alt.value}')`;
        case "class":
          return `page.locator('${entry.element}${alt.value}')`;
        case "role":
          return `page.getByRole('${alt.value.replace("role=", "")}')`;
        case "xpath":
          return `page.locator('xpath=${alt.value}')`;
        default:
          return null;
      }
    })
    .filter(Boolean);

  if (alternativeChains.length === 0) {
    return primaryLocator;
  }

  return `${primaryLocator}.or(${alternativeChains.join(").or(")})`;
}

/**
 * Remove selector entry by mandu-id
 */
export function removeSelectorEntry(map: SelectorMap, manduId: string): SelectorMap {
  map.entries = map.entries.filter((e) => e.manduId !== manduId);
  map.generatedAt = new Date().toISOString();
  return map;
}
