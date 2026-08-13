import { loadManduConfig } from "@mandujs/core/config";
import { runExtendedDiagnose } from "@mandujs/core/compat/diagnose/index";
import {
  checkWithHealing,
  healAll,
  type GuardConfig,
  type GuardPreset,
} from "@mandujs/core/guard";
import { getRootDir } from "../util/fs";

export interface FixOptions {
  apply?: boolean;
  file?: string;
  json?: boolean;
  preset?: string;
  verify?: boolean;
  build?: boolean;
}

interface FixStage {
  name: "guard-heal" | "diagnose" | "build-verify";
  ok: boolean;
  passed: boolean;
  summary: string;
  details?: unknown;
}

interface FixReport {
  success: boolean;
  apply: boolean;
  verify: boolean;
  stages: FixStage[];
  suggestions: string[];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runGuardHealing(rootDir: string, options: FixOptions): Promise<FixStage> {
  const projectConfig = await loadManduConfig(rootDir).catch(() => null);
  const config: GuardConfig = {
    ...(projectConfig?.guard ?? {}),
    preset: (options.preset as GuardPreset | undefined) ?? projectConfig?.guard?.preset ?? "mandu",
  };
  const result = await checkWithHealing(config, rootDir);
  const items = options.file
    ? result.items.filter((item) => item.violation.filePath.includes(options.file!))
    : result.items;

  if (options.apply && items.length > 0) {
    const healed = await healAll({ ...result, items });
    const remaining = items.length - healed.fixed;
    return {
      name: "guard-heal",
      ok: true,
      passed: remaining === 0,
      summary: remaining === 0
        ? `Applied ${healed.fixed} Guard fix(es).`
        : `Applied ${healed.fixed} Guard fix(es); ${remaining} remain.`,
      details: { totalViolations: items.length, remaining, ...healed },
    };
  }

  return {
    name: "guard-heal",
    ok: true,
    passed: items.length === 0,
    summary: items.length === 0
      ? "No architecture violations found."
      : `Found ${items.length} Guard violation(s); ${items.filter((item) => item.healing.primary.autoFix).length} auto-fixable.`,
    details: {
      totalViolations: items.length,
      violations: items.map((item) => ({
        file: item.violation.filePath,
        rule: item.violation.ruleName,
        suggestion: item.healing.primary.explanation,
      })),
    },
  };
}

async function runBuildVerification(captureOutput: boolean): Promise<{ passed: boolean; output?: string[] }> {
  const { build } = await import("./build");
  if (!captureOutput) return { passed: await build() };

  const output: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const write = (...args: unknown[]) => output.push(args.map(String).join(" "));
  console.log = write;
  console.error = write;
  try {
    return { passed: await build(), output };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function printHumanReport(report: FixReport): void {
  console.log("Mandu Fix");
  for (const stage of report.stages) {
    console.log(`\nStage: ${stage.name}`);
    console.log(`- Status: ${stage.passed ? "pass" : "fail"}`);
    console.log(`- Summary: ${stage.summary}`);
  }
  if (report.suggestions.length > 0) {
    console.log("\nNext steps:");
    for (const suggestion of report.suggestions) console.log(`- ${suggestion}`);
  }
}

export async function fix(options: FixOptions = {}): Promise<boolean> {
  const rootDir = getRootDir();
  const stages: FixStage[] = [];
  const suggestions: string[] = [];
  const shouldRunBuildVerify = options.verify === true && options.build !== false;

  try {
    const guard = await runGuardHealing(rootDir, options);
    stages.push(guard);
    if (!guard.passed && !options.apply) suggestions.push("Run `mandu fix --apply` or review the reported Guard violations.");

    const diagnose = await runExtendedDiagnose(rootDir);
    stages.push({
      name: "diagnose",
      ok: true,
      passed: diagnose.healthy,
      summary: diagnose.healthy
        ? "Diagnostics passed."
        : `${diagnose.errorCount} blocking diagnostic check(s) failed.`,
      details: diagnose,
    });
    for (const check of diagnose.checks) {
      if (!check.ok && check.suggestion) suggestions.push(check.suggestion);
    }

    if (shouldRunBuildVerify) {
      const buildResult = await runBuildVerification(options.json === true);
      stages.push({
        name: "build-verify",
        ok: true,
        passed: buildResult.passed,
        summary: buildResult.passed ? "Build verification passed." : "Build verification failed.",
        details: buildResult.output ? { output: buildResult.output } : undefined,
      });
    }
  } catch (error) {
    stages.push({
      name: stages.length === 0 ? "guard-heal" : "diagnose",
      ok: false,
      passed: false,
      summary: toErrorMessage(error),
    });
  }

  const report: FixReport = {
    success: stages.length > 0 && stages.every((stage) => stage.ok && stage.passed),
    apply: options.apply === true,
    verify: shouldRunBuildVerify,
    stages,
    suggestions: [...new Set(suggestions)],
  };

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printHumanReport(report);
  return report.success;
}
