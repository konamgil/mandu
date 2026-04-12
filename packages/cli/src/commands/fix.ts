import { executeMcpTool } from "./mcp";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeGuardHeal(result: unknown, apply: boolean): { passed: boolean; summary: string; suggestions: string[] } {
  if (!isRecord(result)) {
    return {
      passed: false,
      summary: "Guard heal returned an unexpected response.",
      suggestions: ["Re-run `mandu fix --json` to inspect the raw tool output."],
    };
  }

  const suggestions: string[] = [];
  const message = typeof result.message === "string" ? result.message : null;
  const totalViolations = typeof result.totalViolations === "number" ? result.totalViolations : null;
  const autoFixable = typeof result.autoFixable === "number" ? result.autoFixable : null;
  const remaining = typeof result.remaining === "number" ? result.remaining : null;

  if (!apply && autoFixable && autoFixable > 0) {
    suggestions.push("Run `mandu fix --apply` to apply the primary auto-fixes.");
  }

  if (apply && remaining !== null && remaining > 0) {
    suggestions.push("Review the remaining Guard violations manually or run `mandu doctor` for deeper guidance.");
  }

  if (message) {
    return {
      passed: result.passed === true,
      summary: message,
      suggestions,
    };
  }

  if (totalViolations !== null && totalViolations > 0) {
    return {
      passed: result.passed === true,
      summary: apply
        ? `Guard heal processed ${totalViolations} violation(s).`
        : `Guard heal found ${totalViolations} violation(s).`,
      suggestions,
    };
  }

  return {
    passed: result.passed === true,
    summary: result.passed === true ? "No architecture violations found." : "Guard heal reported issues.",
    suggestions,
  };
}

function summarizeDiagnose(result: unknown): { passed: boolean; summary: string; failedChecks: string[] } {
  if (!isRecord(result)) {
    return {
      passed: false,
      summary: "Diagnose returned an unexpected response.",
      failedChecks: [],
    };
  }

  const failedChecks = Array.isArray(result.checks)
    ? result.checks
        .filter((entry) => {
          if (!isRecord(entry) || !isRecord(entry.result)) return false;
          return entry.result.error || entry.result.passed === false || entry.result.valid === false;
        })
        .map((entry) => (isRecord(entry) && typeof entry.name === "string" ? entry.name : "unknown"))
    : [];

  const blockingFailedChecks = failedChecks.filter((name) => name !== "kitchen_errors");
  const kitchenOnlyFailure = failedChecks.length > 0 && blockingFailedChecks.length === 0;

  const summary = blockingFailedChecks.length > 0
    ? `${blockingFailedChecks.length} blocking diagnostic check(s) failed.`
    : kitchenOnlyFailure
      ? "Core diagnostics passed. Kitchen diagnostics were unavailable."
      : "Diagnostics passed.";

  return {
    passed: blockingFailedChecks.length === 0,
    summary,
    failedChecks,
  };
}

async function runBuildVerification(captureOutput: boolean): Promise<{ passed: boolean; output?: string[] }> {
  const { build } = await import("./build");

  if (!captureOutput) {
    return { passed: await build() };
  }

  const captured: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  const write = (...args: unknown[]) => {
    captured.push(args.map((value) => String(value)).join(" "));
  };

  console.log = write;
  console.error = write;

  try {
    return {
      passed: await build(),
      output: captured,
    };
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

    if (stage.name === "diagnose" && isRecord(stage.details) && Array.isArray(stage.details.failedChecks) && stage.details.failedChecks.length > 0) {
      console.log(`- Failed checks: ${stage.details.failedChecks.join(", ")}`);
    }
  }

  if (report.suggestions.length > 0) {
    console.log("\nNext steps:");
    for (const suggestion of report.suggestions) {
      console.log(`- ${suggestion}`);
    }
  }
}

export async function fix(options: FixOptions = {}): Promise<boolean> {
  const stages: FixStage[] = [];
  const suggestions: string[] = [];
  const shouldRunBuildVerify = options.verify === true && options.build !== false;

  try {
    const healResult = await executeMcpTool("mandu.guard.heal", {
      autoFix: options.apply === true,
      file: options.file,
      preset: options.preset,
    });
    const healSummary = summarizeGuardHeal(healResult, options.apply === true);

    stages.push({
      name: "guard-heal",
      ok: true,
      passed: healSummary.passed,
      summary: healSummary.summary,
      details: healResult,
    });
    suggestions.push(...healSummary.suggestions);

    const diagnoseResult = await executeMcpTool("mandu.diagnose", {
      autoFix: false,
    });
    const diagnoseSummary = summarizeDiagnose(diagnoseResult);

    stages.push({
      name: "diagnose",
      ok: true,
      passed: diagnoseSummary.passed,
      summary: diagnoseSummary.summary,
      details: {
        raw: diagnoseResult,
        failedChecks: diagnoseSummary.failedChecks,
      },
    });

    if (diagnoseSummary.failedChecks.includes("kitchen_errors")) {
      suggestions.push("Start `mandu dev` if you want browser-side Kitchen diagnostics included in the verification pass.");
    }

    if (diagnoseSummary.failedChecks.some((name) => name !== "kitchen_errors")) {
      suggestions.push("Run `mandu review` or `mandu doctor` to inspect the failing Guard/contract/manifest checks in more detail.");
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

      if (!buildResult.passed) {
        suggestions.push("Inspect the build output above and re-run `mandu build` after fixing the reported errors.");
      }
    }
  } catch (error) {
    stages.push({
      name: stages.length === 0 ? "guard-heal" : "diagnose",
      ok: false,
      passed: false,
      summary: toErrorMessage(error),
    });
    suggestions.push("Re-run with `--json` to inspect raw stage output if the error persists.");
  }

  const success = stages.length > 0 && stages.every((stage) => stage.ok && stage.passed);
  const report: FixReport = {
    success,
    apply: options.apply === true,
    verify: shouldRunBuildVerify,
    stages,
    suggestions: Array.from(new Set(suggestions)),
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  return success;
}
