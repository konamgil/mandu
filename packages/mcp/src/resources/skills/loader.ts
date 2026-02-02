/**
 * Mandu MCP Skills - File-based Skill Loader
 * Agent Skills 패턴으로 구성된 스킬을 파일 시스템에서 로드
 */

import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
}

export interface RuleMeta {
  id: string;
  title: string;
  impact: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  impactDescription: string;
  tags: string[];
}

// Available skills
const SKILL_IDS = ["mandu-slot", "mandu-fs-routes", "mandu-hydration", "mandu-guard"];

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const [, yamlStr, body] = match;
  const frontmatter: Record<string, unknown> = {};

  // Simple YAML parsing (key: value pairs)
  for (const line of yamlStr.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value: unknown = line.slice(colonIndex + 1).trim();

      // Handle multiline values (description with |)
      if (value === "|") {
        continue; // Will be captured in subsequent lines
      }

      // Parse arrays (tags)
      if (typeof value === "string" && value.includes(",")) {
        value = value.split(",").map((s) => s.trim());
      }

      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

/**
 * List all available skills
 */
export function listSkills(): SkillMeta[] {
  return SKILL_IDS.map((id) => {
    const name = id.replace("mandu-", "");
    return {
      id,
      name,
      description: getSkillDescription(id),
      version: "1.0.0",
      author: "mandu",
    };
  });
}

function getSkillDescription(id: string): string {
  const descriptions: Record<string, string> = {
    "mandu-slot": "Business logic with Mandu.filling() API",
    "mandu-fs-routes": "File-system based routing patterns",
    "mandu-hydration": "Island hydration and client components",
    "mandu-guard": "Architecture enforcement and layer dependencies",
  };
  return descriptions[id] || "";
}

/**
 * Get a skill's SKILL.md content
 */
export async function getSkill(skillId: string): Promise<{ meta: SkillMeta; content: string } | null> {
  if (!SKILL_IDS.includes(skillId)) {
    return null;
  }

  const skillPath = join(__dirname, skillId, "SKILL.md");

  try {
    const content = await readFile(skillPath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    return {
      meta: {
        id: skillId,
        name: (frontmatter.name as string) || skillId,
        description: (frontmatter.description as string) || "",
        version: ((frontmatter.metadata as Record<string, string>)?.version as string) || "1.0.0",
        author: ((frontmatter.metadata as Record<string, string>)?.author as string) || "mandu",
      },
      content: body,
    };
  } catch {
    return null;
  }
}

/**
 * List rules for a skill
 */
export async function listSkillRules(skillId: string): Promise<RuleMeta[]> {
  if (!SKILL_IDS.includes(skillId)) {
    return [];
  }

  const rulesPath = join(__dirname, skillId, "rules");

  try {
    const files = await readdir(rulesPath);
    const rules: RuleMeta[] = [];

    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const ruleId = file.replace(".md", "");
      const content = await readFile(join(rulesPath, file), "utf-8");
      const { frontmatter } = parseFrontmatter(content);

      rules.push({
        id: ruleId,
        title: (frontmatter.title as string) || ruleId,
        impact: (frontmatter.impact as RuleMeta["impact"]) || "MEDIUM",
        impactDescription: (frontmatter.impactDescription as string) || "",
        tags: Array.isArray(frontmatter.tags)
          ? (frontmatter.tags as string[])
          : typeof frontmatter.tags === "string"
            ? frontmatter.tags.split(",").map((s: string) => s.trim())
            : [],
      });
    }

    // Sort by impact priority
    const impactOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return rules.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact]);
  } catch {
    return [];
  }
}

/**
 * Get a specific rule's content
 */
export async function getSkillRule(
  skillId: string,
  ruleId: string
): Promise<{ meta: RuleMeta; content: string } | null> {
  if (!SKILL_IDS.includes(skillId)) {
    return null;
  }

  const rulePath = join(__dirname, skillId, "rules", `${ruleId}.md`);

  try {
    const content = await readFile(rulePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    return {
      meta: {
        id: ruleId,
        title: (frontmatter.title as string) || ruleId,
        impact: (frontmatter.impact as RuleMeta["impact"]) || "MEDIUM",
        impactDescription: (frontmatter.impactDescription as string) || "",
        tags: Array.isArray(frontmatter.tags)
          ? (frontmatter.tags as string[])
          : typeof frontmatter.tags === "string"
            ? frontmatter.tags.split(",").map((s: string) => s.trim())
            : [],
      },
      content: body,
    };
  } catch {
    return null;
  }
}
