export * from "./types";
export * as ATEFS from "./fs";
export { ATEFileError, ensureDir, readJson, writeJson, fileExists, getAtePaths } from "./fs";

export { extract } from "./extractor";
export { generateAndWriteScenarios } from "./scenario";
export { generatePlaywrightSpecs } from "./codegen";
export { runPlaywright } from "./runner";
export { composeSummary, writeSummary, generateReport } from "./report";
export type { ReportFormat, GenerateReportOptions } from "./report";
export { generateHtmlReport } from "./reporter/html";
export type { HtmlReportOptions, HtmlReportResult } from "./reporter/html";
export { heal, analyzeFeedback, applyHeal } from "./heal";
export type {
  HealSuggestion,
  FeedbackAnalysis,
  FeedbackInput,
  ApplyHealInput,
  ApplyHealResult,
  FailureCategory,
} from "./heal";
export { computeImpact } from "./impact";
export * from "./selector-map";
export { parseTrace, generateAlternativeSelectors } from "./trace-parser";
export type { TraceAction, FailedLocator, TraceParseResult } from "./trace-parser";

// Oracle and domain detection
export { detectDomain, detectDomainFromRoute, detectDomainFromSource } from "./domain-detector";
export type { AppDomain, DomainDetectionResult } from "./domain-detector";
export { generateL1Assertions, upgradeL0ToL1, getAssertionCount, createDefaultOracle } from "./oracle";
export type { OracleResult } from "./oracle";

import type { ExtractInput, GenerateInput, RunInput, ImpactInput, HealInput, OracleLevel } from "./types";
import { getAtePaths } from "./fs";

/**
 * High-level ATE pipeline helpers (JSON in/out)
 */
export async function ateExtract(input: ExtractInput) {
  const { extract } = await import("./extractor");
  return extract(input);
}

export async function ateGenerate(input: GenerateInput) {
  const paths = getAtePaths(input.repoRoot);
  const oracleLevel = input.oracleLevel ?? ("L1" as OracleLevel);
  // generate scenarios then specs - lazy load codegen and scenario
  const { generateAndWriteScenarios } = await import("./scenario");
  const { generatePlaywrightSpecs } = await import("./codegen");

  generateAndWriteScenarios(input.repoRoot, oracleLevel);
  const res = generatePlaywrightSpecs(input.repoRoot, { onlyRoutes: input.onlyRoutes });
  return {
    ok: true,
    scenariosPath: paths.scenariosPath,
    generatedSpecs: res.files,
  };
}

export async function ateRun(input: RunInput) {
  const startedAt = new Date().toISOString();
  const { runPlaywright } = await import("./runner");
  const run = await runPlaywright(input);
  const finishedAt = new Date().toISOString();
  return { ok: run.exitCode === 0, ...run, startedAt, finishedAt };
}

export async function ateReport(params: {
  repoRoot: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  oracleLevel: OracleLevel;
  impact?: { changedFiles: string[]; selectedRoutes: string[]; mode: "full" | "subset" };
  format?: "json" | "html" | "both";
}) {
  const { composeSummary, writeSummary, generateReport } = await import("./report");
  const summary = composeSummary({
    repoRoot: params.repoRoot,
    runId: params.runId,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    exitCode: params.exitCode,
    oracleLevel: params.oracleLevel,
    impact: params.impact,
  });
  const summaryPath = writeSummary(params.repoRoot, params.runId, summary);

  const format = params.format ?? "both";
  const reportPaths = await generateReport({
    repoRoot: params.repoRoot,
    runId: params.runId,
    format,
  });

  return { ok: true, summaryPath, summary, reportPaths };
}

export async function ateImpact(input: ImpactInput) {
  const { computeImpact } = await import("./impact");
  const result = await computeImpact(input);
  return { ok: true, ...result };
}

export async function ateHeal(input: HealInput) {
  const { heal } = await import("./heal");
  return { ok: true, ...heal(input) };
}

export { runFullPipeline } from "./pipeline";
export type { AutoPipelineOptions, AutoPipelineResult } from "./pipeline";
