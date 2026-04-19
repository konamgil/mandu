/**
 * Skills Generator — Programmatic API
 *
 *   generateSkillsForProject({ repoRoot, dryRun, regenerate })
 *
 * Produces per-project `.claude/skills/<project>-*.md` files that
 * reflect the project's manifest, guard preset, and installed stack.
 * Static skills from `@mandujs/skills` continue to be the fallback;
 * generated skills are an additive overlay.
 */

import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  accessSync,
  readdirSync,
} from "node:fs";
import { join, resolve, sep, isAbsolute } from "node:path";

import { analyzeManifest } from "./analyzers/manifest-analyzer";
import { analyzeGuard } from "./analyzers/guard-analyzer";
import { analyzeStack } from "./analyzers/stack-analyzer";
import { buildGlossarySkill } from "./templates/glossary";
import { buildConventionsSkill } from "./templates/conventions";
import { buildWorkflowSkill } from "./templates/workflow";

import type {
  GenerateSkillsOptions,
  GenerateSkillsResult,
  GeneratedSkillFile,
  ProjectAnalysis,
} from "./types";

export type {
  GenerateSkillsOptions,
  GenerateSkillsResult,
  GeneratedSkillFile,
  ProjectAnalysis,
  ManifestAnalysis,
  GuardAnalysis,
  StackAnalysis,
} from "./types";

export { analyzeManifest, analyzeGuard, analyzeStack };
export { buildGlossarySkill, buildConventionsSkill, buildWorkflowSkill };

/**
 * Raised when `outDir` would resolve outside the host project root.
 * The CLI surfaces this as `CLI_E050 SKILLS_OUTPUT_ESCAPE`.
 */
export class SkillsPathEscapeError extends Error {
  readonly path: string;
  constructor(offending: string) {
    super(`Skills output directory escapes project root: ${offending}`);
    this.name = "SkillsPathEscapeError";
    this.path = offending;
  }
}

/**
 * Resolve an `outDir` inside the project root, rejecting any path that
 * escapes via absolute-reference or `..` traversal. Accepts relative
 * paths (`.claude/skills`, `.mandu/skills`) and absolute paths that
 * already live under the root.
 */
export function resolveSkillsOutDir(repoRoot: string, outDir: string): string {
  const root = resolve(repoRoot);
  const candidate = isAbsolute(outDir) ? resolve(outDir) : resolve(root, outDir);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) {
    throw new SkillsPathEscapeError(outDir);
  }
  return candidate;
}

function detectProjectName(repoRoot: string): string {
  const pkgPath = join(repoRoot, "package.json");
  if (!existsSync(pkgPath)) return basenameFromPath(repoRoot);
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    if (pkg.name && typeof pkg.name === "string") {
      // Strip scope "@foo/bar" → "bar"; replace non-id chars with "-"
      return pkg.name.replace(/^@[^/]+\//, "").replace(/[^a-zA-Z0-9_-]+/g, "-");
    }
  } catch {
    /* ignore */
  }
  return basenameFromPath(repoRoot);
}

function basenameFromPath(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/**
 * Run all analyzers and return the combined project picture.
 */
export function analyzeProject(repoRoot: string): ProjectAnalysis {
  return {
    repoRoot,
    projectName: detectProjectName(repoRoot),
    manifest: analyzeManifest(repoRoot),
    guard: analyzeGuard(repoRoot),
    stack: analyzeStack(repoRoot),
  };
}

function fileAlreadyExists(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate `.claude/skills/<project>-*.md` files for the host project.
 *
 * In dry-run mode, returns the planned files WITHOUT writing them —
 * callers can inspect `.content` before committing.
 */
export function generateSkillsForProject(
  options: GenerateSkillsOptions,
): GenerateSkillsResult {
  if (!options || !options.repoRoot) {
    throw new Error("generateSkillsForProject: repoRoot is required");
  }

  const { repoRoot, regenerate = false, dryRun = false } = options;
  const kinds = options.kinds ?? ["glossary", "conventions", "workflow"];

  const analysis = analyzeProject(repoRoot);
  const outDir = options.outDir
    ? resolveSkillsOutDir(repoRoot, options.outDir)
    : join(repoRoot, ".claude", "skills");

  if (!dryRun) {
    mkdirSync(outDir, { recursive: true });
  }

  const files: GeneratedSkillFile[] = [];

  for (const kind of kinds) {
    let id: string;
    let content: string;
    switch (kind) {
      case "glossary":
        id = `${analysis.projectName}-domain-glossary`;
        content = buildGlossarySkill(analysis);
        break;
      case "conventions":
        id = `${analysis.projectName}-conventions`;
        content = buildConventionsSkill(analysis);
        break;
      case "workflow":
        id = `${analysis.projectName}-workflow`;
        content = buildWorkflowSkill(analysis);
        break;
      default: {
        const _exhaustive: never = kind;
        throw new Error(`Unknown skill kind: ${String(_exhaustive)}`);
      }
    }

    const targetPath = join(outDir, `${id}.md`);
    const exists = fileAlreadyExists(targetPath);
    let written = false;
    let skipped = false;

    if (dryRun) {
      // nothing written
    } else if (exists && !regenerate) {
      skipped = true;
    } else {
      writeFileSync(targetPath, content, "utf8");
      written = true;
    }

    files.push({ path: targetPath, content, id, written, skipped });
  }

  return { analysis, files, dryRun };
}

/**
 * List generated skill files for a project (fast lookup for the CLI).
 */
export function listGeneratedSkills(repoRoot: string, outDir?: string): string[] {
  const dir = outDir ?? join(repoRoot, ".claude", "skills");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}
