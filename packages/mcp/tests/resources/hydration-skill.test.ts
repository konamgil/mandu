import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

const MCP_ROOT = path.join(import.meta.dir, "..", "..");
const RESOURCE_ROOT = path.join(MCP_ROOT, "src", "resources");
const SKILLS_ROOT = path.join(RESOURCE_ROOT, "generated-skills");

function readSkillDoc(relativePath: string): string {
  return readFileSync(path.join(SKILLS_ROOT, relativePath), "utf8");
}

describe("mandu-hydration MCP skill guidance", () => {
  it("documents the official server/client boundary invariants", () => {
    const skill = readSkillDoc("mandu-hydration/SKILL.md");

    expect(skill).toContain("Server pages remain server-owned");
    expect(skill).toContain("serializable props");
    expect(skill).toContain("one build generation");
    expect(skill).toContain("mandu.agent.verify");
  });

  it("does not use removed <Island priority> JSX examples", () => {
    const docs = [
      readSkillDoc("mandu-hydration/SKILL.md"),
      readFileSync(path.join(RESOURCE_ROOT, "skills", "guides.ts"), "utf8"),
      readFileSync(path.join(RESOURCE_ROOT, "skills", "recipes.ts"), "utf8"),
    ];

    for (const doc of docs) {
      expect(doc).not.toContain("<Island priority=");
    }
  });

  it("uses partial Render examples for inline client regions", () => {
    const guidesAndRecipes = ["guides.ts", "recipes.ts"]
      .map((file) => readFileSync(path.join(RESOURCE_ROOT, "skills", file), "utf8"))
      .join("\n");

    expect(guidesAndRecipes).toContain("partial({");
    expect(guidesAndRecipes).toContain("CounterPartial.Render");
    expect(guidesAndRecipes).toContain('island("visible"');
    expect(guidesAndRecipes).toContain("는 지원하지 않습니다");
  });
});
