/**
 * @mandujs/skills - Claude Code Plugin for Mandu Framework
 *
 * Programmatic API for installing and managing Mandu skills
 * in Claude Code projects.
 */

import { readdir, readFile, writeFile, mkdir, access, copyFile } from "fs/promises";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Root of the @mandujs/skills package */
const PACKAGE_ROOT = resolve(__dirname, "..");

/**
 * Available skill IDs.
 *
 * Two families:
 * - Task-shaped skills (domain knowledge — "how to make an API", "what is
 *   an Island", etc.)
 * - `mandu-mcp-*` workflow skills (MCP tool orchestration — "when editing,
 *   run ate_auto_pipeline + guard_check + doctor in parallel"). See #234.
 *
 * The MCP workflow skills are loaded alongside the task-shaped ones so
 * agents see both "what" (domain) and "how to invoke" (orchestration).
 * `mandu-mcp-index` is the always-on router that points to the other
 * `mandu-mcp-*` skills.
 */
export const SKILL_IDS = [
  // Task-shaped (domain knowledge)
  "mandu-create-feature",
  "mandu-create-api",
  "mandu-debug",
  "mandu-explain",
  "mandu-guard-guide",
  "mandu-deploy",
  "mandu-slot",
  "mandu-fs-routes",
  "mandu-hydration",
  // Workflow-shaped (MCP tool orchestration — #234)
  "mandu-mcp-index",
  "mandu-mcp-orient",
  "mandu-mcp-create-flow",
  "mandu-mcp-verify",
  "mandu-mcp-safe-change",
  "mandu-mcp-deploy",
] as const;

export type SkillId = (typeof SKILL_IDS)[number];

export interface InstallOptions {
  /** Target project directory (defaults to cwd) */
  targetDir?: string;
  /** Overwrite existing files */
  force?: boolean;
  /** Only install specific skills */
  skills?: SkillId[];
  /** Skip MCP config setup */
  skipMcp?: boolean;
  /** Skip Claude settings setup */
  skipSettings?: boolean;
  /** Dry run - report what would be done without writing files */
  dryRun?: boolean;
}

export interface InstallResult {
  installed: string[];
  skipped: string[];
  errors: string[];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deep-merge two JSON objects. Arrays are replaced, not merged.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];

    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>
      );
    } else {
      result[key] = srcVal;
    }
  }

  return result;
}

/**
 * Install Mandu skills into a project.
 *
 * Copies skill SKILL.md files from `skills/<id>/SKILL.md` to
 * `<targetDir>/.claude/skills/<id>/SKILL.md`.
 *
 * Directory layout follows the Claude Code skills spec — each skill lives
 * in its own subdirectory with a `SKILL.md` manifest inside, so that
 * auxiliary assets (scripts, examples, resources) can sit alongside it.
 * See: https://docs.claude.com/en/docs/claude-code/skills
 *
 * (Closes #197 — prior releases wrote flat `<id>.md` files, which Claude
 * Code silently skipped because the directory layout did not match.)
 */
export async function installSkills(options: InstallOptions = {}): Promise<InstallResult> {
  const targetDir = options.targetDir || process.cwd();
  const force = options.force ?? false;
  const skillIds = options.skills ?? [...SKILL_IDS];
  const dryRun = options.dryRun ?? false;

  const result: InstallResult = {
    installed: [],
    skipped: [],
    errors: [],
  };

  // 1. Install skill files to .claude/skills/<id>/SKILL.md
  const skillsDir = join(targetDir, ".claude", "skills");
  if (!dryRun) {
    await mkdir(skillsDir, { recursive: true });
  }

  for (const skillId of skillIds) {
    const srcPath = join(PACKAGE_ROOT, "skills", skillId, "SKILL.md");
    const skillSubdir = join(skillsDir, skillId);
    const destPath = join(skillSubdir, "SKILL.md");
    const relLabel = `skills/${skillId}/SKILL.md`;

    try {
      if (!force && (await fileExists(destPath))) {
        result.skipped.push(`${relLabel} (exists)`);
        continue;
      }

      if (dryRun) {
        result.installed.push(`${relLabel} (dry-run)`);
        continue;
      }

      // Ensure the skill's subdirectory exists before copying. `mkdir`
      // with `recursive: true` is idempotent — safe to re-run across
      // skills even when the parent already exists.
      await mkdir(skillSubdir, { recursive: true });
      await copyFile(srcPath, destPath);
      result.installed.push(relLabel);
    } catch (err) {
      result.errors.push(`${relLabel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Setup .mcp.json (merge, don't overwrite)
  if (!options.skipMcp) {
    const mcpPath = join(targetDir, ".mcp.json");
    try {
      const templateContent = await readFile(
        join(PACKAGE_ROOT, "templates", ".mcp.json"),
        "utf-8"
      );
      const templateConfig = JSON.parse(templateContent);

      if (await fileExists(mcpPath)) {
        if (force) {
          if (!dryRun) {
            const existing = JSON.parse(await readFile(mcpPath, "utf-8"));
            const merged = deepMerge(existing, templateConfig);
            await writeFile(mcpPath, JSON.stringify(merged, null, 2) + "\n");
          }
          result.installed.push(".mcp.json (merged)");
        } else {
          // Check if mandu server already configured
          const existing = JSON.parse(await readFile(mcpPath, "utf-8"));
          if (existing.mcpServers?.mandu) {
            result.skipped.push(".mcp.json (mandu server exists)");
          } else {
            if (!dryRun) {
              const merged = deepMerge(existing, templateConfig);
              await writeFile(mcpPath, JSON.stringify(merged, null, 2) + "\n");
            }
            result.installed.push(".mcp.json (mandu server added)");
          }
        }
      } else {
        if (!dryRun) {
          await writeFile(mcpPath, JSON.stringify(templateConfig, null, 2) + "\n");
        }
        result.installed.push(".mcp.json (created)");
      }
    } catch (err) {
      result.errors.push(`.mcp.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Setup .claude/settings.json (merge hooks and permissions)
  if (!options.skipSettings) {
    const settingsPath = join(targetDir, ".claude", "settings.json");
    try {
      const templateContent = await readFile(
        join(PACKAGE_ROOT, "templates", ".claude", "settings.json"),
        "utf-8"
      );
      const templateSettings = JSON.parse(templateContent);

      if (!dryRun) {
        await mkdir(join(targetDir, ".claude"), { recursive: true });
      }

      if (await fileExists(settingsPath)) {
        if (force) {
          if (!dryRun) {
            const existing = JSON.parse(await readFile(settingsPath, "utf-8"));
            const merged = deepMerge(existing, templateSettings);
            await writeFile(settingsPath, JSON.stringify(merged, null, 2) + "\n");
          }
          result.installed.push(".claude/settings.json (merged)");
        } else {
          result.skipped.push(".claude/settings.json (exists, use --force to merge)");
        }
      } else {
        if (!dryRun) {
          await writeFile(settingsPath, JSON.stringify(templateSettings, null, 2) + "\n");
        }
        result.installed.push(".claude/settings.json (created)");
      }
    } catch (err) {
      result.errors.push(`.claude/settings.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

/**
 * Get the path to a skill SKILL.md file in the package
 */
export function getSkillPath(skillId: SkillId): string {
  return join(PACKAGE_ROOT, "skills", skillId, "SKILL.md");
}

/**
 * Get the path to a template file in the package
 */
export function getTemplatePath(relativePath: string): string {
  return join(PACKAGE_ROOT, "templates", relativePath);
}

/**
 * List all available skill IDs
 */
export function listSkillIds(): readonly SkillId[] {
  return SKILL_IDS;
}

// ============================================================================
// Per-project skills generator (Phase 14.1)
// ============================================================================

export {
  generateSkillsForProject,
  analyzeProject,
  analyzeManifest,
  analyzeGuard,
  analyzeStack,
  buildGlossarySkill,
  buildConventionsSkill,
  buildWorkflowSkill,
  listGeneratedSkills,
} from "./generator/index.js";

export type {
  GenerateSkillsOptions,
  GenerateSkillsResult,
  GeneratedSkillFile,
  ProjectAnalysis,
  ManifestAnalysis,
  GuardAnalysis,
  StackAnalysis,
} from "./generator/index.js";
