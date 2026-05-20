/**
 * Profile Coverage Governance
 *
 * Cross-validates `TOOL_MODULES` against profile classification.
 * Fails when a new tool category is left unclassified — preventing
 * silent default-profile bloat as atomic tools are added over time.
 */
import { describe, it, expect } from "bun:test";
import { TOOL_MODULES } from "../src/tools";
import { PROFILE_CATEGORIES, EXPERT_ONLY_CATEGORIES } from "../src/profiles";

describe("profile coverage governance", () => {
  it("every TOOL_MODULES category is classified into a profile or expert-only", () => {
    const classified = new Set<string>([
      ...PROFILE_CATEGORIES["agent-core"]!,
      ...PROFILE_CATEGORIES["agent-full"]!,
      ...EXPERT_ONLY_CATEGORIES,
    ]);

    const unclassified = TOOL_MODULES
      .map((m) => m.category)
      .filter((cat) => !classified.has(cat));

    if (unclassified.length > 0) {
      throw new Error(
        `Unclassified tool categories detected: [${unclassified.join(", ")}]\n` +
          `  Add each one to packages/mcp/src/profiles.ts in either:\n` +
          `    - PROFILE_CATEGORIES["agent-core"]  (canonical agent loop)\n` +
          `    - PROFILE_CATEGORIES["agent-full"]  (domain work)\n` +
          `    - EXPERT_ONLY_CATEGORIES            (internal plumbing)`,
      );
    }

    expect(unclassified).toEqual([]);
  });

  it("EXPERT_ONLY_CATEGORIES contains no stale entries", () => {
    const actual = new Set(TOOL_MODULES.map((m) => m.category));
    const stale = [...EXPERT_ONLY_CATEGORIES].filter((cat) => !actual.has(cat));

    if (stale.length > 0) {
      throw new Error(
        `EXPERT_ONLY_CATEGORIES has entries no longer present in TOOL_MODULES: ` +
          `[${stale.join(", ")}]. Remove them from packages/mcp/src/profiles.ts.`,
      );
    }

    expect(stale).toEqual([]);
  });

  it("agent-full and EXPERT_ONLY_CATEGORIES are disjoint", () => {
    const overlap = PROFILE_CATEGORIES["agent-full"]!.filter((cat) =>
      EXPERT_ONLY_CATEGORIES.has(cat),
    );

    if (overlap.length > 0) {
      throw new Error(
        `Categories cannot be both agent-full and expert-only: [${overlap.join(", ")}]. ` +
          `Choose one classification in packages/mcp/src/profiles.ts.`,
      );
    }

    expect(overlap).toEqual([]);
  });

  it("agent-core and EXPERT_ONLY_CATEGORIES are disjoint", () => {
    const overlap = PROFILE_CATEGORIES["agent-core"]!.filter((cat) =>
      EXPERT_ONLY_CATEGORIES.has(cat),
    );
    expect(overlap).toEqual([]);
  });

  it("classification covers exactly the TOOL_MODULES universe (no duplicates, no omissions)", () => {
    const actual = new Set(TOOL_MODULES.map((m) => m.category));
    const classified = new Set<string>([
      ...PROFILE_CATEGORIES["agent-core"]!,
      ...PROFILE_CATEGORIES["agent-full"]!,
      ...EXPERT_ONLY_CATEGORIES,
    ]);

    // Every classified category must exist
    for (const cat of classified) {
      expect(actual.has(cat)).toBe(true);
    }
    // Every actual category must be classified
    for (const cat of actual) {
      expect(classified.has(cat)).toBe(true);
    }
  });
});
