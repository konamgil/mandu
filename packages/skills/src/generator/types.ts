/**
 * Skills Generator — Types
 *
 * Produces per-project `.claude/skills/<project>-*.md` files that
 * capture the specific routes, resources, guard preset, and stack of
 * the host project. Official skills (`packages/skills/generated/skills/`) remain
 * the fallback/default, these are an additive overlay.
 */

/** Guard analyzer output. */
export interface GuardAnalysis {
  /** Detected preset name (e.g. "mandu", "fsd"). */
  preset?: string;
  /** Total number of violations in the latest report, if readable. */
  violationCount?: number;
  /** Top violation rules (most frequent). */
  topRules?: Array<{ ruleId: string; count: number }>;
  /** Whether a guard report was found at .mandu/guard-report.json. */
  reportPresent: boolean;
}

/** Manifest analyzer output — distilled route info for skill templates. */
export interface ManifestAnalysis {
  /** Whether a manifest.json was found. */
  present: boolean;
  /** Count of all routes. */
  totalRoutes: number;
  /** Count by kind. */
  apiRoutes: number;
  pageRoutes: number;
  /** Names of resources (from shared/resources). */
  resources: string[];
  /** Top 10 routes (short list for the skill body). */
  sampleRoutes: Array<{
    id: string;
    pattern?: string;
    kind?: string;
    methods?: string[];
  }>;
}

/** Stack analyzer output — dependencies actually installed. */
export interface StackAnalysis {
  /** Mandu core version. */
  manduCore?: string;
  /** Is React present? */
  hasReact: boolean;
  /** Is Tailwind CSS present? */
  hasTailwind: boolean;
  /** Is Playwright present? */
  hasPlaywright: boolean;
  /** Is Bun the runtime? */
  bunRuntime: boolean;
  /** Other runtime packages of interest. */
  extras: string[];
}

/** Combined analysis. */
export interface ProjectAnalysis {
  /** Absolute repo root. */
  repoRoot: string;
  /** Detected project name (from package.json). */
  projectName: string;
  /** Manifest details. */
  manifest: ManifestAnalysis;
  /** Guard details. */
  guard: GuardAnalysis;
  /** Stack details. */
  stack: StackAnalysis;
}

/** Options for `generateSkillsForProject`. */
export interface GenerateSkillsOptions {
  /** Repo to analyze. Defaults to cwd. */
  repoRoot: string;
  /** Output directory. Defaults to `<repoRoot>/.claude/skills`. */
  outDir?: string;
  /** Overwrite existing project skills. Default false. */
  regenerate?: boolean;
  /** Don't write anything, just return the plan. Default false. */
  dryRun?: boolean;
  /**
   * Skill kinds to emit. Defaults to all three.
   * - glossary: domain terms extracted from resources + routes
   * - conventions: preset + Mandu-specific conventions
   * - workflow: common commands + recipes for this stack
   */
  kinds?: Array<"glossary" | "conventions" | "workflow">;
}

/** One emitted file. */
export interface GeneratedSkillFile {
  /** Absolute target path. */
  path: string;
  /** File contents (markdown). */
  content: string;
  /** Skill ID (e.g. `<project>-domain-glossary`). */
  id: string;
  /** Whether this was actually written to disk. */
  written: boolean;
  /** Whether it was skipped (already existed, no regenerate). */
  skipped: boolean;
}

/** Top-level generator result. */
export interface GenerateSkillsResult {
  analysis: ProjectAnalysis;
  files: GeneratedSkillFile[];
  dryRun: boolean;
}
