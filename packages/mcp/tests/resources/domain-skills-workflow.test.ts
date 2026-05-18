import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import path from "path";

const MCP_ROOT = path.join(import.meta.dir, "..", "..");
const SKILLS_ROOT = path.join(MCP_ROOT, "src", "resources", "skills");

const DOMAIN_SKILLS = [
  "mandu-composition",
  "mandu-deployment",
  "mandu-fs-routes",
  "mandu-guard",
  "mandu-hydration",
  "mandu-performance",
  "mandu-security",
  "mandu-slot",
  "mandu-styling",
  "mandu-testing",
  "mandu-ui",
] as const;

function readSkill(skillId: string): string {
  return readFileSync(path.join(SKILLS_ROOT, skillId, "SKILL.md"), "utf8");
}

describe("Mandu domain skills workflow cleanup", () => {
  it("keeps every domain skill behind the canonical agent workflow", () => {
    for (const skillId of DOMAIN_SKILLS) {
      const skill = readSkill(skillId);

      expect(skill, skillId).toContain("## Agent Workflow Contract");
      expect(skill, skillId).toContain("This skill is a Domain addendum");
      expect(skill, skillId).toContain("must not replace `mandu-agent-workflow`");
      expect(skill, skillId).toContain("Canonical workflow step:");
      expect(skill, skillId).toContain("Preferred MCP tools:");
      expect(skill, skillId).toContain("Allowed file edits:");
      expect(skill, skillId).toContain("Verification command:");
      expect(skill, skillId).toContain("mandu agent verify --changed --json --write");
      expect(skill, skillId).toContain("Common failures:");
      expect(skill, skillId).toContain("Repair path:");
      expect(skill, skillId).toContain("mandu agent repair --from .mandu/agent-verify.json --json");
    }
  });

  it("does not present low-level guard commands as the first guard workflow", () => {
    const guard = readSkill("mandu-guard");

    expect(guard).toContain("## Low-Level CLI Commands");
    expect(guard.indexOf("mandu agent verify --changed --json --write")).toBeLessThan(
      guard.indexOf("mandu guard arch --ci"),
    );
    expect(guard).not.toContain("bunx mandu guard arch");
  });

  it("keeps setup snippets framed as examples after planning", () => {
    const deployment = readSkill("mandu-deployment");
    const styling = readSkill("mandu-styling");
    const ui = readSkill("mandu-ui");

    expect(deployment).toContain("## Provider Artifact Examples");
    expect(deployment).toContain("Use these examples only after `mandu.agent.plan` selects the deploy domain");
    expect(styling).toContain("## Setup Examples");
    expect(styling).toContain("Use these examples only after `mandu.agent.plan` selects styling setup or migration");
    expect(ui).toContain("## Setup Examples");
    expect(ui).toContain("Use these examples only after `mandu.agent.plan` selects UI library setup");
  });
});
