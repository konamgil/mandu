import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  ateExtract,
  ateGenerate,
  ateRun,
  ateReport,
  ateHeal,
  ateImpact,
  runFullPipeline,
  analyzeFeedback,
  applyHeal,
} from "@mandujs/ate";
import type { OracleLevel } from "@mandujs/ate";

export const ateToolDefinitions: Tool[] = [
  {
    name: "mandu.ate.extract",
    description:
      "ATE Step 1 — Extract: Statically analyze the Mandu project's AST to build an interaction graph of routes, slots, contracts, and data flow. " +
      "Identifies all testable interactions without running the server. " +
      "Output is stored in .mandu/ate/extract/ and used by mandu.ate.generate.",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "Absolute path to the Mandu project root" },
        tsconfigPath: { type: "string", description: "Path to tsconfig.json (default: tsconfig.json in repoRoot)" },
        routeGlobs: {
          type: "array",
          items: { type: "string" },
          description: "Glob patterns to limit which routes are analyzed (e.g. ['app/api/**', 'app/blog/**']). Omit for all routes.",
        },
        buildSalt: {
          type: "string",
          description: "Cache invalidation salt — change this to force re-extraction even if source hasn't changed",
        },
      },
      required: ["repoRoot"],
    },
  },
  {
    name: "mandu.ate.generate",
    description:
      "ATE Step 2 — Generate: Create Playwright test scenarios from the interaction graph produced by mandu.ate.extract. " +
      "Oracle level controls assertion depth: " +
      "L0 = no assertions (smoke test only), " +
      "L1 = basic HTTP status checks, " +
      "L2 = contract schema validation (response shape matches Zod contract), " +
      "L3 = full behavioral contract (side effects, state changes, error paths). " +
      "Output: .mandu/ate/tests/*.spec.ts ready to run with Playwright.",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "Absolute path to the Mandu project root" },
        oracleLevel: {
          type: "string",
          enum: ["L0", "L1", "L2", "L3"],
          description: "Assertion depth: L0=smoke, L1=HTTP status, L2=contract schema, L3=full behavioral",
        },
        onlyRoutes: {
          type: "array",
          items: { type: "string" },
          description: "Limit test generation to specific routeIds (e.g. ['api-users', 'blog-slug']). Omit for all routes.",
        },
      },
      required: ["repoRoot"],
    },
  },
  {
    name: "mandu.ate.run",
    description:
      "ATE Step 3 — Run: Execute the generated Playwright specs against a running Mandu dev server. " +
      "Collects test artifacts (screenshots, traces, results) in .mandu/ate/runs/{runId}/. " +
      "Requires the Mandu dev server to be running (use mandu_dev_start first). " +
      "Returns a runId for use with mandu.ate.report and mandu.ate.heal.",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "Absolute path to the Mandu project root" },
        baseURL: {
          type: "string",
          description: "Dev server URL (default: http://localhost:3333). Must match the running mandu dev server.",
        },
        ci: { type: "boolean", description: "CI mode: stricter timeouts, no interactive prompts" },
        headless: { type: "boolean", description: "Run browsers headlessly (default: true)" },
        browsers: {
          type: "array",
          items: { type: "string", enum: ["chromium", "firefox", "webkit"] },
          description: "Browsers to test against (default: ['chromium'])",
        },
      },
      required: ["repoRoot"],
    },
  },
  {
    name: "mandu.ate.report",
    description:
      "ATE Step 4 — Report: Generate a test report from run artifacts. " +
      "Produces pass/fail summary, coverage by route, and failure details. " +
      "Use the runId returned by mandu.ate.run. " +
      "If tests failed, follow up with mandu.ate.heal to get fix suggestions.",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "Absolute path to the Mandu project root" },
        runId: { type: "string", description: "Run ID returned by mandu.ate.run" },
        startedAt: { type: "string", description: "ISO timestamp when run started" },
        finishedAt: { type: "string", description: "ISO timestamp when run finished" },
        exitCode: { type: "number", description: "Playwright process exit code (0=pass, non-zero=fail)" },
        oracleLevel: {
          type: "string",
          enum: ["L0", "L1", "L2", "L3"],
          description: "Oracle level used during generation (for report context)",
        },
        format: {
          type: "string",
          enum: ["json", "html", "both"],
          description: "Report format: json (machine-readable), html (visual), both (default)",
        },
        impact: {
          type: "object",
          description: "Impact analysis context — set if tests were run on a subset of routes via mandu.ate.impact",
          properties: {
            mode: { type: "string", enum: ["full", "subset"] },
            changedFiles: { type: "array", items: { type: "string" } },
            selectedRoutes: { type: "array", items: { type: "string" } },
          },
          required: ["mode", "changedFiles", "selectedRoutes"],
        },
      },
      required: ["repoRoot", "runId", "startedAt", "finishedAt", "exitCode"],
    },
  },
  {
    name: "mandu.ate.heal",
    description:
      "ATE Step 5 — Heal: Analyze test failures from a run and generate safe diff suggestions for fixing the code. " +
      "Classifies failures by root cause (schema mismatch, missing handler, wrong status, selector stale, etc.) " +
      "and produces reviewable diffs — never auto-commits or overwrites files. " +
      "Use mandu.ate.apply_heal to apply a specific suggestion after review. " +
      "Supports rollback via mandu_rollback if applied changes cause regressions.",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "Absolute path to the Mandu project root" },
        runId: { type: "string", description: "Run ID from mandu.ate.run with failures to analyze" },
      },
      required: ["repoRoot", "runId"],
    },
  },
  {
    name: "mandu.ate.impact",
    description:
      "ATE Optimization — Impact Analysis: Calculate the minimal subset of routes affected by changed files using git diff. " +
      "Avoids running the full test suite when only part of the codebase changed. " +
      "Returns selectedRoutes to pass to mandu.ate.generate (onlyRoutes) or mandu.ate.run. " +
      "Typical use: run after `git commit` to test only affected routes in CI.",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "Absolute path to the Mandu project root" },
        base: { type: "string", description: "Git base ref for diff (default: HEAD~1 or main branch)" },
        head: { type: "string", description: "Git head ref for diff (default: current working tree)" },
      },
      required: ["repoRoot"],
    },
  },
  {
    name: "mandu.ate.auto_pipeline",
    description:
      "ATE Full Pipeline — Run the complete ATE cycle in one call: " +
      "Extract AST → Generate Playwright specs → Run tests → Create report → Suggest heals. " +
      "Recommended for: initial setup, scheduled CI runs, and full regression testing. " +
      "For incremental development, prefer individual steps (extract → generate → run → report → heal). " +
      "Set useImpactAnalysis=true to automatically limit tests to changed routes.",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "Absolute path to the Mandu project root" },
        baseURL: { type: "string", description: "Dev server URL (default: http://localhost:3333)" },
        oracleLevel: {
          type: "string",
          enum: ["L0", "L1", "L2", "L3"],
          description: "Assertion depth: L0=smoke, L1=HTTP status, L2=contract schema, L3=full behavioral",
        },
        ci: { type: "boolean", description: "CI mode: stricter timeouts" },
        useImpactAnalysis: {
          type: "boolean",
          description: "Run impact analysis first and only test changed routes (faster in CI)",
        },
        base: { type: "string", description: "Git base ref for impact analysis" },
        head: { type: "string", description: "Git head ref for impact analysis" },
        autoHeal: {
          type: "boolean",
          description: "Automatically run heal analysis after failures (produces diff suggestions, never auto-applies)",
        },
        tsconfigPath: { type: "string", description: "Path to tsconfig.json" },
        routeGlobs: { type: "array", items: { type: "string" }, description: "Limit extraction to specific route patterns" },
        buildSalt: { type: "string", description: "Cache invalidation salt for extraction" },
      },
      required: ["repoRoot"],
    },
  },
  {
    name: "mandu.ate.feedback",
    description:
      "ATE Feedback — Evaluate heal suggestions from a failed run and classify which fixes are safe to auto-apply. " +
      "Safe-to-auto-apply: selector-map updates (CSS selector changes). " +
      "Requires human review: contract schema changes, handler logic, route restructuring. " +
      "Returns priority ranking of suggestions to guide review order.",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "Absolute path to the Mandu project root" },
        runId: { type: "string", description: "Run ID with heal suggestions to evaluate" },
        autoApply: {
          type: "boolean",
          description: "If true, auto-apply only selector-map changes (CSS selectors) — other changes always require review",
        },
      },
      required: ["repoRoot", "runId"],
    },
  },
  {
    name: "mandu.ate.apply_heal",
    description:
      "ATE Apply — Apply a specific heal suggestion diff to the codebase. " +
      "Always creates a backup snapshot first (use mandu_rollback to undo). " +
      "Run mandu.ate.feedback first to get the healIndex and confirm the fix is safe. " +
      "After applying, re-run mandu.ate.run to verify the fix resolved the failure.",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "Absolute path to the Mandu project root" },
        runId: { type: "string", description: "Run ID containing the heal suggestion to apply" },
        healIndex: {
          type: "number",
          description: "0-based index of the heal suggestion to apply (from mandu.ate.heal or mandu.ate.feedback results)",
        },
        createBackup: {
          type: "boolean",
          description: "Create a snapshot before applying (default: true, strongly recommended — enables mandu_rollback)",
        },
      },
      required: ["repoRoot", "runId", "healIndex"],
    },
  },
];

export function ateTools(projectRoot: string) {
  return {
    "mandu.ate.extract": async (args: Record<string, unknown>) => {
      const { repoRoot, tsconfigPath, routeGlobs, buildSalt } = args as {
        repoRoot: string;
        tsconfigPath?: string;
        routeGlobs?: string[];
        buildSalt?: string;
      };
      return await ateExtract({ repoRoot, tsconfigPath, routeGlobs, buildSalt });
    },
    "mandu.ate.generate": async (args: Record<string, unknown>) => {
      const { repoRoot, oracleLevel, onlyRoutes } = args as {
        repoRoot: string;
        oracleLevel?: OracleLevel;
        onlyRoutes?: string[];
      };
      return ateGenerate({ repoRoot, oracleLevel, onlyRoutes });
    },
    "mandu.ate.run": async (args: Record<string, unknown>) => {
      const { repoRoot, baseURL, ci, headless, browsers } = args as {
        repoRoot: string;
        baseURL?: string;
        ci?: boolean;
        headless?: boolean;
        browsers?: ("chromium" | "firefox" | "webkit")[];
      };
      return await ateRun({ repoRoot, baseURL, ci, headless, browsers });
    },
    "mandu.ate.report": async (args: Record<string, unknown>) => {
      const { repoRoot, runId, startedAt, finishedAt, exitCode, oracleLevel, format, impact } = args as {
        repoRoot: string;
        runId: string;
        startedAt: string;
        finishedAt: string;
        exitCode: number;
        oracleLevel?: OracleLevel;
        format?: "json" | "html" | "both";
        impact?: { changedFiles: string[]; selectedRoutes: string[]; mode: "full" | "subset" };
      };
      return await ateReport({
        repoRoot,
        runId,
        startedAt,
        finishedAt,
        exitCode,
        oracleLevel: oracleLevel ?? "L1",
        format: format ?? "both",
        impact,
      });
    },
    "mandu.ate.heal": async (args: Record<string, unknown>) => {
      const { repoRoot, runId } = args as { repoRoot: string; runId: string };
      return ateHeal({ repoRoot, runId });
    },
    "mandu.ate.impact": async (args: Record<string, unknown>) => {
      const { repoRoot, base, head } = args as {
        repoRoot: string;
        base?: string;
        head?: string;
      };
      return ateImpact({ repoRoot, base, head });
    },
    "mandu.ate.auto_pipeline": async (args: Record<string, unknown>) => {
      const {
        repoRoot, baseURL, oracleLevel, ci, useImpactAnalysis,
        base, head, autoHeal, tsconfigPath, routeGlobs, buildSalt,
      } = args as {
        repoRoot: string;
        baseURL?: string;
        oracleLevel?: OracleLevel;
        ci?: boolean;
        useImpactAnalysis?: boolean;
        base?: string;
        head?: string;
        autoHeal?: boolean;
        tsconfigPath?: string;
        routeGlobs?: string[];
        buildSalt?: string;
      };
      return await runFullPipeline({
        repoRoot, baseURL, oracleLevel, ci, useImpactAnalysis,
        base, head, autoHeal, tsconfigPath, routeGlobs, buildSalt,
      });
    },
    "mandu.ate.feedback": async (args: Record<string, unknown>) => {
      const { repoRoot, runId, autoApply } = args as {
        repoRoot: string;
        runId: string;
        autoApply?: boolean;
      };
      const result = analyzeFeedback({ repoRoot, runId, autoApply });
      return {
        ok: true,
        category: result.category,
        autoApplicable: result.autoApplicable,
        priority: result.priority,
        reasoning: result.reasoning,
        suggestions: result.suggestions,
      };
    },
    "mandu.ate.apply_heal": async (args: Record<string, unknown>) => {
      const { repoRoot, runId, healIndex, createBackup } = args as {
        repoRoot: string;
        runId: string;
        healIndex: number;
        createBackup?: boolean;
      };
      const result = applyHeal({ repoRoot, runId, healIndex, createBackup });
      return {
        ok: result.success,
        ...result,
      };
    },
  };
}
