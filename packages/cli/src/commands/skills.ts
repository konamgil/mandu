/**
 * `mandu skills` — generate / list per-project Claude Code skills.
 *
 * Uses `@mandujs/skills/generator` internally. Static skills shipped in
 * the `@mandujs/skills` package are NOT touched by this command — those
 * are installed via `bunx mandu-skills install`.
 */

import { join, relative } from "node:path";
import { existsSync, readFileSync } from "node:fs";

import {
  generateSkillsForProject,
  listGeneratedSkills,
  SkillsPathEscapeError,
  type GenerateSkillsResult,
} from "@mandujs/skills/generator";
import { CLI_ERROR_CODES, printCLIError } from "../errors";

export interface SkillsGenerateOptions {
  regenerate?: boolean;
  dryRun?: boolean;
  kinds?: Array<"glossary" | "conventions" | "workflow">;
  outDir?: string;
  /** Don't prompt for confirmation on override. CLI sets this to true when --yes given. */
  yes?: boolean;
}

export interface SkillsListOptions {
  outDir?: string;
  json?: boolean;
}

function formatKB(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function computeSize(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

/**
 * `mandu skills:generate` — scan the project and write skill files.
 */
export async function skillsGenerate(options: SkillsGenerateOptions = {}): Promise<boolean> {
  const repoRoot = process.cwd();
  const dryRun = !!options.dryRun;
  const regenerate = !!options.regenerate;

  if (!existsSync(join(repoRoot, "package.json"))) {
    console.error("❌ No package.json found in current directory.");
    console.error("   Run this command inside a project root.");
    return false;
  }

  let result: GenerateSkillsResult;
  try {
    result = generateSkillsForProject({
      repoRoot,
      regenerate,
      dryRun,
      outDir: options.outDir,
      kinds: options.kinds,
    });
  } catch (err) {
    // Wave R3 L-02: surface path-escape as a proper CLI error code.
    if (err instanceof SkillsPathEscapeError) {
      printCLIError(CLI_ERROR_CODES.SKILLS_OUTPUT_ESCAPE, { path: err.path });
      return false;
    }
    console.error(
      `❌ Skill generation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  const { analysis, files } = result;

  console.log();
  console.log(`🎯 Mandu skills generator${dryRun ? " (dry-run)" : ""}`);
  console.log(`   Project: ${analysis.projectName}`);
  console.log(`   Manifest: ${analysis.manifest.present ? `${analysis.manifest.totalRoutes} routes` : "not found"}`);
  console.log(`   Guard preset: ${analysis.guard.preset ?? "(none)"}`);
  console.log(`   Stack: ${summarizeStack(analysis.stack)}`);
  console.log();

  let written = 0;
  let skipped = 0;

  for (const file of files) {
    const rel = relative(repoRoot, file.path);
    const size = formatKB(computeSize(file.content));
    if (file.written) {
      console.log(`   ✅ ${rel}  (${size})`);
      written++;
    } else if (file.skipped) {
      console.log(`   ⏭️  ${rel}  (exists — use --regenerate to overwrite)`);
      skipped++;
    } else if (dryRun) {
      console.log(`   📝 ${rel}  (${size})  [dry-run]`);
    }
  }

  console.log();
  if (dryRun) {
    console.log(`   Dry-run. Would write ${files.length} file(s). Re-run without --dry-run to apply.`);
  } else {
    console.log(`   Written: ${written}, Skipped: ${skipped}, Total: ${files.length}`);
  }
  console.log();

  return true;
}

/**
 * `mandu skills:list` — show installed generated skills.
 */
export async function skillsList(options: SkillsListOptions = {}): Promise<boolean> {
  const repoRoot = process.cwd();
  const paths = listGeneratedSkills(repoRoot, options.outDir);

  if (options.json) {
    const payload = paths.map((path) => ({
      path,
      name: path.replace(/\\/g, "/").split("/").pop()?.replace(/\.md$/, ""),
      size: existsSync(path) ? Buffer.byteLength(readFileSync(path, "utf8"), "utf8") : 0,
    }));
    console.log(JSON.stringify(payload, null, 2));
    return true;
  }

  console.log();
  console.log(`📚 Installed project skills (${paths.length})`);
  console.log();
  if (paths.length === 0) {
    console.log("   (none — run `mandu skills:generate` to create them)");
  } else {
    for (const path of paths) {
      const rel = relative(repoRoot, path);
      try {
        const size = formatKB(Buffer.byteLength(readFileSync(path, "utf8"), "utf8"));
        console.log(`   - ${rel}  (${size})`);
      } catch {
        console.log(`   - ${rel}  (unreadable)`);
      }
    }
  }
  console.log();
  return true;
}

function summarizeStack(stack: {
  bunRuntime: boolean;
  hasReact: boolean;
  hasTailwind: boolean;
  hasPlaywright: boolean;
  manduCore?: string;
}): string {
  const parts: string[] = [];
  if (stack.manduCore) parts.push(`@mandujs/core@${stack.manduCore}`);
  if (stack.bunRuntime) parts.push("Bun");
  if (stack.hasReact) parts.push("React");
  if (stack.hasTailwind) parts.push("Tailwind");
  if (stack.hasPlaywright) parts.push("Playwright");
  return parts.length > 0 ? parts.join(" + ") : "(detected: none)";
}
