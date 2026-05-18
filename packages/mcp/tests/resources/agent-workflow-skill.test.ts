import { describe, expect, it } from "bun:test";
import { getSkill, listSkills } from "../../src/resources/skills";

describe("mandu-agent-workflow MCP skill", () => {
  it("is the first skill in the static catalog", () => {
    const skills = listSkills();
    expect(skills[0]?.id).toBe("mandu-agent-workflow");
    expect(skills[0]?.description).toContain("context -> plan -> apply -> verify -> repair");
  });

  it("documents the canonical workflow and official agent tools", async () => {
    const skill = await getSkill("mandu-agent-workflow");

    expect(skill?.content).toContain("context -> plan -> apply -> verify -> repair");
    expect(skill?.content).toContain("mandu.agent.context");
    expect(skill?.content).toContain("mandu.agent.plan");
    expect(skill?.content).toContain("mandu.agent.apply");
    expect(skill?.content).toContain("mandu.agent.verify");
    expect(skill?.content).toContain("mandu.agent.repair");
    expect(skill?.content).toContain("Domain skills are addenda");
  });
});
