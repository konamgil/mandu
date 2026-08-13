import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import path from "path";
import { getSkill, listSkills } from "../../src/resources/skills/loader";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..");
const GENERATED_ROOT = path.join(
  REPO_ROOT,
  "packages",
  "mcp",
  "src",
  "resources",
  "generated-skills",
);
const CANONICAL_ROOT = path.join(REPO_ROOT, "skills", "official");
const OFFICIAL_SKILLS = [
  "mandu-agent-workflow",
  "mandu-fs-routes",
  "mandu-contract",
  "mandu-hydration",
  "mandu-guard",
  "mandu-testing",
] as const;

describe("Mandu official skills", () => {
  it("exposes exactly the six official skills", () => {
    expect(listSkills().map((skill) => skill.id)).toEqual([...OFFICIAL_SKILLS]);
  });

  it("loads generated skills that are byte-identical to the canonical source", async () => {
    for (const skillId of OFFICIAL_SKILLS) {
      const canonical = readFileSync(path.join(CANONICAL_ROOT, skillId, "SKILL.md"), "utf8");
      const generated = readFileSync(path.join(GENERATED_ROOT, skillId, "SKILL.md"), "utf8");
      expect(generated).toBe(canonical);
      expect(await getSkill(skillId)).not.toBeNull();
    }
  });

  it("keeps deployment and specialist guidance outside the official skill surface", () => {
    const ids = listSkills().map((skill) => skill.id);
    expect(ids).not.toContain("mandu-deployment");
    expect(ids).not.toContain("mandu-performance");
    expect(ids).not.toContain("mandu-security");
    expect(ids).not.toContain("mandu-ui");
  });
});
