/**
 * Integration module for `mandu init`
 *
 * Called by packages/cli/src/commands/init.ts during project scaffolding.
 * Copies skills, settings, and configures the Claude Code environment.
 *
 * Usage from init.ts:
 *   import { setupClaudeSkills } from "@mandujs/skills/init-integration";
 *   await setupClaudeSkills(targetDir);
 */

import { readFile, writeFile, mkdir, copyFile } from "fs/promises";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

import { SKILL_IDS } from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, "..");

/**
 * Skill directories containing SKILL.md files.
 *
 * Sourced from `SKILL_IDS` (src/index.ts) so `setupClaudeSkills` (dev-mode
 * `mandu init`) and `installSkills` (public CLI) always agree on the skill
 * set. Adding a new skill now requires updating one list, not two.
 */
const SKILL_DIRS: readonly string[] = SKILL_IDS;

export interface SetupResult {
  skillsInstalled: number;
  settingsCreated: boolean;
  errors: string[];
}

/**
 * Install Claude Code skills and settings into a new project.
 * Called by `mandu init` during project creation.
 *
 * This function:
 * 1. Creates .claude/skills/ directory
 * 2. Copies every skill's SKILL.md (skills/<id>/SKILL.md -> .claude/skills/<id>/SKILL.md)
 * 3. Creates .claude/settings.json with hooks and permissions
 *
 * The `<id>/SKILL.md` subdirectory layout follows the Claude Code skills
 * spec — Claude Code only recognises skills whose manifest lives in a
 * per-skill directory. Prior releases wrote flat `<id>.md` files, which
 * Claude Code silently skipped (see #197).
 *
 * NOTE: .mcp.json is handled separately by init.ts's setupMcpConfig()
 * to support merge logic for Claude, Gemini, and other agent configs.
 */
export async function setupClaudeSkills(targetDir: string): Promise<SetupResult> {
  const result: SetupResult = {
    skillsInstalled: 0,
    settingsCreated: false,
    errors: [],
  };

  // 1. Create .claude/skills/ directory
  const skillsDir = join(targetDir, ".claude", "skills");
  try {
    await mkdir(skillsDir, { recursive: true });
  } catch (err) {
    result.errors.push(`mkdir .claude/skills: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  // 2. Copy skill files (skills/<id>/SKILL.md -> .claude/skills/<id>/SKILL.md)
  for (const skillDir of SKILL_DIRS) {
    const srcPath = join(PACKAGE_ROOT, "skills", skillDir, "SKILL.md");
    const destSubdir = join(skillsDir, skillDir);
    const destPath = join(destSubdir, "SKILL.md");

    try {
      // Each skill needs its own subdirectory. `mkdir recursive` is a
      // no-op when the dir exists, so repeated calls across skills are
      // cheap and safe.
      await mkdir(destSubdir, { recursive: true });
      await copyFile(srcPath, destPath);
      result.skillsInstalled++;
    } catch (err) {
      result.errors.push(`copy ${skillDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Create .claude/settings.json
  try {
    const templatePath = join(PACKAGE_ROOT, "templates", ".claude", "settings.json");
    const templateContent = await readFile(templatePath, "utf-8");
    const settingsPath = join(targetDir, ".claude", "settings.json");
    await writeFile(settingsPath, templateContent);
    result.settingsCreated = true;
  } catch (err) {
    result.errors.push(`settings.json: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Get the count of available skills (for display in init output)
 */
export function getSkillCount(): number {
  return SKILL_DIRS.length;
}

/**
 * Get skill names (for display in init output)
 */
export function getSkillNames(): string[] {
  return [...SKILL_DIRS];
}
