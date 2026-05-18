import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

const MCP_ROOT = path.join(import.meta.dir, "..", "..");
const SKILLS_ROOT = path.join(MCP_ROOT, "src", "resources", "skills");

function readSkillDoc(relativePath: string): string {
  return readFileSync(path.join(SKILLS_ROOT, relativePath), "utf8");
}

describe("mandu-hydration MCP skill guidance", () => {
  it("documents the supported island API and inline partial boundary", () => {
    const skill = readSkillDoc("mandu-hydration/SKILL.md");

    expect(skill).toContain("island({ setup, render })");
    expect(skill).toContain('Do not call `island("visible", Component)`');
    expect(skill).toContain("Islands are page-level client bundles");
    expect(skill).toContain("use `partial()`");
  });

  it("does not use removed <Island priority> JSX examples", () => {
    const docs = [
      readSkillDoc("mandu-hydration/SKILL.md"),
      readSkillDoc("mandu-hydration/rules/hydration-island-setup.md"),
      readSkillDoc("mandu-hydration/rules/hydration-priority-visible.md"),
      readSkillDoc("guides.ts"),
      readSkillDoc("recipes.ts"),
    ];

    for (const doc of docs) {
      expect(doc).not.toContain("<Island priority=");
    }
  });

  it("uses partial Render examples for inline client regions", () => {
    const guidesAndRecipes = `${readSkillDoc("guides.ts")}\n${readSkillDoc("recipes.ts")}`;

    expect(guidesAndRecipes).toContain("partial({");
    expect(guidesAndRecipes).toContain("CounterPartial.Render");
    expect(guidesAndRecipes).toContain('island("visible"');
    expect(guidesAndRecipes).toContain("는 지원하지 않습니다");
  });
});
