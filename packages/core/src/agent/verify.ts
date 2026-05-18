import fs from "fs/promises";
import path from "path";
import { runExtendedDiagnose } from "../diagnose";
import { runContractGuardCheck, runGuardCheck, type GuardViolation } from "../guard";
import { loadManifest } from "../spec/load";
import type { ContractViolation } from "../guard/contract-guard";
import {
  buildAgentContext,
} from "./context";
import type {
  AgentDiagnostic,
  AgentDiagnosticSeverity,
  AgentSuggestedCommand,
  AgentVerifyCheck,
  AgentVerifyReport,
  BuildAgentVerifyOptions,
} from "./types";

const AGENT_VERIFY_RELATIVE_PATH = ".mandu/agent-verify.json";

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return toPosix(value).replace(/^\.\//, "");
}

async function runGit(
  rootDir: string,
  args: string[],
  timeoutMs = 5000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  if (typeof Bun === "undefined") {
    return { ok: false, stdout: "", stderr: "Bun runtime unavailable" };
  }
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // ignore
        }
        resolve(null);
      }, timeoutMs);
    });
    const result = await Promise.race([
      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]),
      timeout,
    ]);
    if (result === null) return { ok: false, stdout: "", stderr: "git timed out" };
    const [stdout, stderr, exitCode] = result;
    return { ok: exitCode === 0, stdout, stderr };
  } catch (err) {
    return {
      ok: false,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

function toLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function collectChangedFiles(rootDir: string, options: BuildAgentVerifyOptions): Promise<{
  files: string[];
  notes: string[];
  gitAvailable: boolean;
}> {
  if (options.includeGit === false) {
    return {
      files: [],
      notes: ["Git collection disabled by caller."],
      gitAvailable: false,
    };
  }

  const notes: string[] = [];
  const files = new Set<string>();
  const inside = await runGit(rootDir, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || !inside.stdout.includes("true")) {
    return {
      files: [],
      notes: ["Git repository not detected. Agent verify falls back to project-wide diagnostics."],
      gitAvailable: false,
    };
  }

  if (options.base) {
    const diff = await runGit(rootDir, ["diff", "--name-only", `${options.base}...HEAD`]);
    if (!diff.ok) {
      notes.push(diff.stderr.trim() || `Failed to diff against base ${options.base}.`);
    } else {
      for (const file of toLines(diff.stdout)) files.add(normalizePath(file)!);
    }
  } else if (options.staged) {
    const staged = await runGit(rootDir, ["diff", "--name-only", "--cached"]);
    if (!staged.ok) {
      notes.push(staged.stderr.trim() || "Failed to read staged diff.");
    } else {
      for (const file of toLines(staged.stdout)) files.add(normalizePath(file)!);
    }
  } else {
    const [staged, unstaged, untracked] = await Promise.all([
      runGit(rootDir, ["diff", "--name-only", "--cached"]),
      runGit(rootDir, ["diff", "--name-only"]),
      runGit(rootDir, ["ls-files", "--others", "--exclude-standard"]),
    ]);
    for (const result of [staged, unstaged, untracked]) {
      if (!result.ok) {
        notes.push(result.stderr.trim() || "Failed to collect one git change set.");
        continue;
      }
      for (const file of toLines(result.stdout)) files.add(normalizePath(file)!);
    }
  }

  return {
    files: [...files].sort(),
    notes,
    gitAvailable: true,
  };
}

function mapSeverity(value: string | undefined): AgentDiagnosticSeverity {
  if (value === "warning" || value === "warn") return "warning";
  if (value === "fatal") return "fatal";
  if (value === "info") return "info";
  return "error";
}

function code(prefix: string, raw: string): string {
  return `${prefix}_${raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function diagnoseDiagnostic(check: {
  rule: string;
  severity?: string;
  message: string;
  suggestion?: string;
}): AgentDiagnostic {
  return {
    code: code("MANDU_DIAGNOSE", check.rule),
    severity: mapSeverity(check.severity ?? "error"),
    title: check.rule,
    cause: check.message,
    ...(check.suggestion
      ? {
          suggestedFix: {
            type: "manual" as const,
            description: check.suggestion,
          },
        }
      : {}),
    docs: "docs/plans/20_agent_surface_consolidation_plan.md",
    repairable: Boolean(check.suggestion),
    source: "diagnose",
  };
}

function guardDiagnostic(violation: GuardViolation, source: "guard" | "contract"): AgentDiagnostic {
  return {
    code: code(source === "guard" ? "MANDU_GUARD" : "MANDU_CONTRACT", violation.ruleId),
    severity: mapSeverity(violation.severity),
    title: violation.ruleId,
    ...(normalizePath(violation.file) ? { file: normalizePath(violation.file) } : {}),
    cause: violation.message,
    ...(violation.suggestion
      ? {
          suggestedFix: {
            type: "manual" as const,
            description: violation.suggestion,
          },
        }
      : {}),
    docs: source === "guard" ? "docs/guides/07_agent_workflow.md" : "docs/resource-architecture.md",
    repairable: Boolean(violation.suggestion),
    source,
  };
}

function matchesChanged(
  diagnostic: AgentDiagnostic,
  changed: Set<string>,
  extraFiles: Array<string | undefined> = [],
): boolean {
  if (changed.size === 0) return true;
  const candidates = [diagnostic.file, ...extraFiles]
    .map(normalizePath)
    .filter((value): value is string => Boolean(value));
  if (candidates.length === 0) return true;
  return candidates.some((file) => changed.has(file));
}

function commandSuggestions(changedFiles: string[], diagnostics: AgentDiagnostic[]): AgentSuggestedCommand[] {
  const files = changedFiles.map(normalizePath).filter((value): value is string => Boolean(value));
  const out: AgentSuggestedCommand[] = [];
  const add = (command: string, reason: string, required: boolean) => {
    if (!out.some((entry) => entry.command === command)) {
      out.push({ command, reason, required });
    }
  };

  if (files.length === 0) {
    add("bun run typecheck", "No changed-file set was available; run the broad type gate.", true);
    return out;
  }

  if (files.some((file) => /\.(ts|tsx|js|jsx)$/.test(file))) {
    add("bun run typecheck", "TypeScript/JavaScript files changed.", true);
  }

  const changedTests = files.filter((file) => /\.test\.(ts|tsx|js|jsx)$/.test(file));
  if (changedTests.length > 0) {
    add(`bun test ${changedTests.join(" ")}`, "Changed test files should still pass directly.", true);
  }

  if (files.some((file) => file.startsWith("packages/core/"))) {
    add("bun test packages/core/src packages/core/tests", "Core package files changed.", true);
  }
  if (files.some((file) => file.startsWith("packages/cli/"))) {
    add("bun test packages/cli/src", "CLI package files changed.", true);
  }
  if (files.some((file) => file.startsWith("packages/mcp/"))) {
    add("bun test packages/mcp/tests", "MCP package files changed.", true);
  }
  if (files.some((file) => file.includes("package.json") || file === "bun.lock")) {
    add("bun run check:publish", "Package metadata or lockfile changed.", true);
  }
  if (diagnostics.some((d) => d.severity === "error" || d.severity === "fatal")) {
    add("mandu agent repair --from .mandu/agent-verify.json", "Verification produced repairable diagnostics.", false);
  }

  return out;
}

function check(
  id: string,
  label: string,
  diagnostics: AgentDiagnostic[],
  details?: Record<string, unknown>,
): AgentVerifyCheck {
  const worst = diagnostics.some((d) => d.severity === "fatal")
    ? "fatal"
    : diagnostics.some((d) => d.severity === "error")
      ? "error"
      : diagnostics.some((d) => d.severity === "warning")
        ? "warning"
        : "info";
  return {
    id,
    label,
    ok: !diagnostics.some((d) => d.severity === "error" || d.severity === "fatal"),
    severity: worst,
    diagnostics: diagnostics.length,
    ...(details ? { details } : {}),
  };
}

export function agentVerifyReportPath(rootDir: string): string {
  return path.join(rootDir, AGENT_VERIFY_RELATIVE_PATH);
}

export async function buildAgentVerifyReport(
  rootDir: string = process.cwd(),
  options: BuildAgentVerifyOptions = {},
): Promise<AgentVerifyReport> {
  const root = path.resolve(rootDir);
  const changed = await collectChangedFiles(root, options);
  const changedSet = new Set(changed.files.map(normalizePath).filter((value): value is string => Boolean(value)));
  const context = await buildAgentContext(root, {
    includeDiagnose: false,
    includeGit: false,
  });
  const notes = [...changed.notes];
  const checks: AgentVerifyCheck[] = [];
  const diagnostics: AgentDiagnostic[] = [];

  if (options.includeDiagnose !== false) {
    try {
      const report = await runExtendedDiagnose(root);
      const diagnoseDiagnostics = report.checks
        .filter((item) => !item.ok)
        .map(diagnoseDiagnostic);
      diagnostics.push(...diagnoseDiagnostics);
      checks.push(check("diagnose", "Extended diagnose checks", diagnoseDiagnostics, {
        healthy: report.healthy,
        errorCount: report.errorCount,
        warningCount: report.warningCount,
      }));
    } catch (err) {
      const diag: AgentDiagnostic = {
        code: "MANDU_VERIFY_DIAGNOSE_FAILED",
        severity: "warning",
        title: "Diagnose failed",
        cause: err instanceof Error ? err.message : String(err),
        suggestedFix: {
          type: "run_command",
          command: "mandu diagnose --json",
          description: "Run diagnose directly to inspect the failure.",
        },
        docs: "docs/plans/20_agent_surface_consolidation_plan.md",
        repairable: false,
        source: "agent.verify",
      };
      diagnostics.push(diag);
      checks.push(check("diagnose", "Extended diagnose checks", [diag]));
    }
  }

  const manifestResult = await loadManifest(path.join(root, ".mandu", "routes.manifest.json"));
  if (!manifestResult.success || !manifestResult.data) {
    const diag: AgentDiagnostic = {
      code: "MANDU_VERIFY_MANIFEST_UNAVAILABLE",
      severity: "warning",
      title: "Routes manifest unavailable",
      cause: (manifestResult.errors ?? ["Routes manifest could not be loaded."]).join("; "),
      suggestedFix: {
        type: "run_command",
        command: "mandu build",
        description: "Build the project to refresh .mandu/routes.manifest.json.",
      },
      docs: "docs/guides/07_agent_workflow.md",
      repairable: true,
      source: "manifest",
    };
    diagnostics.push(diag);
    checks.push(check("manifest", "Routes manifest load", [diag]));
  } else {
    checks.push(check("manifest", "Routes manifest load", [], {
      routes: manifestResult.data.routes.length,
    }));

    if (options.includeGuard !== false) {
      const guardResult = await runGuardCheck(manifestResult.data, root);
      const guardDiagnostics = guardResult.violations
        .map((violation) => guardDiagnostic(violation, "guard"))
        .filter((diag) => !options.changedOnly || matchesChanged(diag, changedSet));
      diagnostics.push(...guardDiagnostics);
      checks.push(check("guard", "Architecture guard", guardDiagnostics, {
        changedOnly: options.changedOnly !== false,
      }));
    }

    if (options.includeContract !== false) {
      const contractViolations: ContractViolation[] = await runContractGuardCheck(manifestResult.data, root);
      const contractDiagnostics = contractViolations
        .map((violation) => ({
          violation,
          diagnostic: guardDiagnostic(violation, "contract"),
        }))
        .filter(({ violation, diagnostic }) =>
          !options.changedOnly ||
          matchesChanged(diagnostic, changedSet, [violation.contractPath, violation.slotPath]),
        )
        .map(({ diagnostic }) => diagnostic);
      diagnostics.push(...contractDiagnostics);
      checks.push(check("contract", "Contract/slot consistency", contractDiagnostics, {
        changedOnly: options.changedOnly !== false,
      }));
    }
  }

  const ok = !diagnostics.some((d) => d.severity === "error" || d.severity === "fatal");
  return {
    schemaVersion: 1,
    framework: "mandu",
    generatedAt: new Date().toISOString(),
    project: context.project,
    changedFiles: changed.files,
    gitAvailable: changed.gitAvailable,
    notes,
    ok,
    checks,
    diagnostics,
    suggestedCommands: commandSuggestions(changed.files, diagnostics),
    nextRepairInput: AGENT_VERIFY_RELATIVE_PATH,
  };
}

export async function writeAgentVerifyReport(
  rootDir: string = process.cwd(),
  report?: AgentVerifyReport,
): Promise<{ path: string; report: AgentVerifyReport }> {
  const value = report ?? await buildAgentVerifyReport(rootDir);
  const outPath = agentVerifyReportPath(rootDir);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { path: outPath, report: value };
}
