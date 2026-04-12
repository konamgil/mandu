import {
  analyzeViolations,
  formatDoctorReport,
  loadManifest,
  runContractGuardCheck,
  runGuardCheck,
  initializeBrain,
  getBrain,
  type GuardViolation,
} from "@mandujs/core";
import { getChangedFiles } from "../util/git";

export interface ReviewOptions {
  base?: string;
  json?: boolean;
  staged?: boolean;
  useLLM?: boolean;
}

interface ReviewFinding {
  severity: "high" | "medium" | "low";
  source: "guard" | "contract" | "project";
  file?: string;
  message: string;
  suggestion?: string;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function includesChangedFile(changedFiles: Set<string>, value?: string): boolean {
  if (!value) return false;
  const normalized = normalizePath(value);
  return changedFiles.has(normalized);
}

function sortFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const rank = { high: 0, medium: 1, low: 2 };
  return [...findings].sort((left, right) => {
    const bySeverity = rank[left.severity] - rank[right.severity];
    if (bySeverity !== 0) return bySeverity;
    return (left.file ?? "").localeCompare(right.file ?? "");
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function review(options: ReviewOptions = {}): Promise<boolean> {
  const rootDir = process.cwd();
  const changeSet = await getChangedFiles({
    base: options.base,
    staged: options.staged,
  }, rootDir);
  const changedFiles = new Set(changeSet.files.map(normalizePath));

  const findings: ReviewFinding[] = [];
  const notes = [...changeSet.notes];
  let doctorSummary: string | undefined;

  const manifestResult = await loadManifest(`${rootDir}/.mandu/routes.manifest.json`);
  if (!manifestResult.success || !manifestResult.data) {
    notes.push("Manifest not available. Guard/contract review was skipped.");
  } else {
    const [guardResult, contractViolations] = await Promise.all([
      runGuardCheck(manifestResult.data, rootDir),
      runContractGuardCheck(manifestResult.data, rootDir),
    ]);

    const guardViolations = (guardResult.violations ?? []).filter((violation) =>
      changedFiles.size === 0 || includesChangedFile(changedFiles, violation.file)
    );

    if (guardViolations.length > 0) {
      let llmAvailable = false;
      if (options.useLLM !== false) {
        const enabled = await initializeBrain();
        const brain = getBrain();
        llmAvailable = enabled && await brain.isLLMAvailable();
      }

      const analysis = await analyzeViolations(guardViolations as GuardViolation[], {
        useLLM: options.useLLM !== false && llmAvailable,
      });
      const markdown = formatDoctorReport(analysis, "markdown");
      doctorSummary = typeof markdown === "string" ? markdown : undefined;

      for (const violation of guardViolations) {
        findings.push({
          severity: violation.severity === "warning" ? "medium" : "high",
          source: "guard",
          file: violation.file,
          message: violation.message,
          suggestion: violation.suggestion,
        });
      }
    }

    for (const violation of contractViolations) {
      const matchesChangedFile =
        changedFiles.size === 0 ||
        includesChangedFile(changedFiles, violation.file) ||
        includesChangedFile(changedFiles, violation.contractPath) ||
        includesChangedFile(changedFiles, violation.slotPath);

      if (!matchesChangedFile) {
        continue;
      }

      findings.push({
        severity: violation.ruleId === "CONTRACT_FILE_NOT_FOUND" ? "high" : "medium",
        source: "contract",
        file: violation.file,
        message: violation.message,
        suggestion: violation.suggestion,
      });
    }
  }

  const ordered = sortFindings(findings);

  if (options.json) {
    console.log(JSON.stringify({
      changedFiles: changeSet.files,
      findings: ordered,
      notes,
      doctorSummary,
    }, null, 2));
    return true;
  }

  if (ordered.length > 0) {
    console.log("Review Findings");
    for (const finding of ordered) {
      const location = finding.file ? ` ${finding.file}` : "";
      console.log(`- [${finding.severity}]${location} ${finding.message}`);
      if (finding.suggestion) {
        console.log(`  Suggestion: ${finding.suggestion}`);
      }
    }
  } else {
    console.log("No obvious findings in changed files.");
  }

  console.log(`\nChanged files: ${changeSet.files.length}`);
  if (changeSet.files.length > 0) {
    for (const file of changeSet.files.slice(0, 10)) {
      console.log(`- ${file}`);
    }
    if (changeSet.files.length > 10) {
      console.log(`- ... ${changeSet.files.length - 10} more`);
    }
  }

  if (notes.length > 0) {
    console.log("\nNotes:");
    for (const note of notes) {
      console.log(`- ${note}`);
    }
  }

  if (doctorSummary && ordered.length > 0) {
    console.log("\nDoctor summary:");
    console.log(doctorSummary);
  }

  return true;
}
