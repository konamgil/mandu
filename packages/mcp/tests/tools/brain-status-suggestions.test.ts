/**
 * mandu.brain.status — tier-keyed suggestions (#237 Concern 4).
 *
 * Covers:
 *   - openai tier → heal + doctor suggestion strings.
 *   - anthropic tier → same heal + doctor suggestions.
 *   - ollama tier → login-upgrade suggestion.
 *   - template tier → login-upgrade suggestion.
 *   - unknown / empty tier → empty list (no spurious suggestions).
 *
 * We test `buildBrainStatusSuggestions` directly so the tier → string
 * mapping is pinned without needing a credential store stub.
 */
import { describe, test, expect } from "bun:test";
import { buildBrainStatusSuggestions } from "../../src/tools/brain";

describe("mandu.brain.status — suggestions (#237 Concern 4)", () => {
  test("openai tier produces the heal + doctor suggestion strings", () => {
    const suggestions = buildBrainStatusSuggestions("openai");
    expect(suggestions.length).toBe(2);
    expect(
      suggestions.some(
        (s) =>
          s.includes("mandu.ate.heal") &&
          (s.includes("mandu.ate.run") || s.includes("mandu.ate.auto_pipeline")),
      ),
    ).toBe(true);
    expect(
      suggestions.some(
        (s) => s.includes("mandu.brain.doctor") && s.includes("mandu.guard.check"),
      ),
    ).toBe(true);
  });

  test("anthropic tier produces the heal + doctor suggestion strings", () => {
    const suggestions = buildBrainStatusSuggestions("anthropic");
    expect(suggestions.length).toBe(2);
    expect(suggestions.some((s) => s.includes("mandu.ate.heal"))).toBe(true);
    expect(suggestions.some((s) => s.includes("mandu.brain.doctor"))).toBe(
      true,
    );
  });

  test("ollama tier produces the login-upgrade suggestion", () => {
    const suggestions = buildBrainStatusSuggestions("ollama");
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]).toMatch(/mandu brain login/);
    expect(suggestions[0]).toMatch(/openai|anthropic/);
  });

  test("template tier produces the login-upgrade suggestion", () => {
    const suggestions = buildBrainStatusSuggestions("template");
    expect(suggestions.length).toBe(1);
    expect(suggestions[0]).toMatch(/mandu brain login/);
  });

  test("unknown tier returns an empty suggestion list (no spurious pointers)", () => {
    expect(buildBrainStatusSuggestions("")).toEqual([]);
    expect(buildBrainStatusSuggestions("something-else")).toEqual([]);
  });
});
