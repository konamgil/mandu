export * from "./types";
export {
  emitAteEvent,
  emitRunStart,
  emitSpecProgress,
  emitSpecDone,
  emitFailureCaptured,
  emitArtifactSaved,
  emitRunEnd,
} from "./run-events";
export * as ATEFS from "./fs";
export { ATEFileError, ensureDir, readJson, writeJson, fileExists, getAtePaths } from "./fs";

export { extract, readContractExamples, scanRepoWideCompanions } from "./extractor";
export {
  routeIdFromPath,
  extractStaticParamsFromSource,
  scanMiddlewareIdentifiers,
  scanFillingActionNames,
  scanFillingMethods,
  isFillingSource,
  isLikelyModalName,
} from "./extractor-utils";

// Phase A.1 — agent context + existing-spec indexer
export { indexSpecs, specsForRouteId } from "./spec-indexer";
export type { IndexedSpec, SpecIndex, SpecKind, SpecCoverage } from "./spec-indexer";
export { buildContext } from "./context-builder";
export type {
  ContextScope,
  ContextRequest,
  ContextBlob,
  RouteContextBlob,
  FillingContextBlob,
  ContractContextBlob,
  ProjectContextBlob,
  NotFoundBlob,
  MiddlewareInfo,
  ContractView,
  ContractMethodView,
  ContractMethodExample,
  FixtureRecommendations,
  ExistingSpecView,
  RelatedRouteView,
  BuildContextOptions,
} from "./context-builder";

// Phase A.3 — prompt catalog v1 (template loader + exemplar scanner + composer)
export { loadPrompt, listPrompts, PromptLoadError } from "./prompt-loader";
export type {
  LoadedPrompt,
  PromptFrontmatter,
  PromptIndexEntry,
  LoadPromptOptions,
} from "./prompt-loader";
export {
  scanExemplars,
  scanMarkers,
  scanFileSync,
  parseMarker,
} from "./exemplar-scanner";
export type {
  Exemplar,
  ParsedMarker,
  ScanOptions,
  MarkerSite,
} from "./exemplar-scanner";
export { composePrompt } from "./prompt-composer";
export type { ComposePromptInput, ComposedPrompt } from "./prompt-composer";
export { lintSpecContent } from "./spec-linter";
export type { LintDiagnostic, LintSeverity } from "./spec-linter";

// Phase A.2 — structured diagnostics, sharded runner, flake detector,
// deterministic selector-drift healer, artifact store + graphVersion.
export {
  failure,
  failureV1Schema,
  FAILURE_KINDS,
} from "../schemas/failure.v1";
export type {
  FailureV1,
  FailureKind,
  Healing,
  HealAction,
  TraceArtifacts,
} from "../schemas/failure.v1";
export { runSpec } from "./run";
export type {
  RunSpecOptions,
  RunResult,
  PassResult,
  ShardSpec,
  RunnerExec,
  RunnerExecInput,
  RunnerExecResult,
} from "./run";
export { autoHeal, applyHeal as applyAutoHeal, computeSimilarity } from "./auto-heal";
export type {
  AutoHealOptions,
  ApplyHealOptions,
  ApplyHealResult as AutoHealApplyResult,
  SimilarityInput,
} from "./auto-heal";
export {
  appendRunHistory,
  readRunHistory,
  computeFlakeScore,
  lastPassedAt,
  summarizeFlakes,
  historyFilePath,
  pruneHistory,
} from "./flake-detector";
export type {
  RunHistoryEntry,
  FlakeSummary,
  FlakeQueryOptions,
} from "./flake-detector";
export {
  resolveArtifactPaths,
  ensureArtifactDir,
  listArtifactRuns,
  pruneArtifacts,
  stageArtifact,
  writeTextArtifact,
  newRunId,
} from "./artifact-store";
export type { ArtifactPaths, ArtifactRun } from "./artifact-store";
export {
  computeGraphVersion,
  graphVersionFromGraph,
  EXTRACTOR_VERSION,
} from "./graph-version";
export type { GraphVersionInput } from "./graph-version";
export { generateAndWriteScenarios } from "./scenario";
export type { ScenarioKind, GeneratedScenario, ScenarioBundle } from "./scenario";
export { generatePlaywrightSpecs } from "./codegen";
export { runPlaywright } from "./runner";
export { composeSummary, writeSummary, generateReport } from "./report";
export type { ReportFormat, GenerateReportOptions } from "./report";
export { generateHtmlReport } from "./reporter/html";
export type { HtmlReportOptions, HtmlReportResult } from "./reporter/html";
export { heal, analyzeFeedback, applyHeal, recordHealResult } from "./heal";
export type {
  HealSuggestion,
  FeedbackAnalysis,
  FeedbackInput,
  ApplyHealInput,
  ApplyHealResult,
  FailureCategory,
} from "./heal";
export { computeImpact } from "./impact";
// Phase B.3 — impact v2 (git diff + contract diff classifier)
export { computeImpactV2, classifyContractDiff, levenshteinRatio } from "./impact/v2";
export type {
  ImpactV2Input,
  ImpactV2Result,
  ImpactSince,
  ContractDiff,
  ContractDiffKind,
  ImpactSuggestion,
} from "./impact/v2";
// Phase B.1 — boundary probe
export {
  generateProbes as generateBoundaryProbes,
  parseZodExpression,
  probesForView,
  dedupProbes,
  deriveExpectedStatus,
} from "./boundary";
export type {
  BoundaryProbe,
  ProbeCategory,
  ZodTypeView,
  GenerateProbesInput,
  GenerateProbesResult,
} from "./boundary";
// Phase B.2 — memory
export {
  appendMemoryEvent,
  readMemoryEvents,
  memoryFilePath,
  memoryStats,
  clearMemory,
  rotateNow as rotateMemoryNow,
} from "./memory/store";
export type { AppendMemoryResult, MemoryStats } from "./memory/store";
export { recallMemory, tokenOverlapScore } from "./memory/recall";
export type { RecallQuery, RecallResult } from "./memory/recall";
export { parseMemoryEvent, nowTimestamp } from "./memory/schema";
export type {
  MemoryEvent,
  MemoryEventKind,
  IntentHistoryEvent,
  RejectedSpecEvent,
  AcceptedHealingEvent,
  RejectedHealingEvent,
  PromptVersionDriftEvent,
  BoundaryGapFilledEvent,
  CoverageSnapshotEvent,
} from "./memory/schema";
// Phase B.4 — coverage metrics
export { computeCoverage } from "./coverage/compute";
export type { CoverageMetrics, ComputeCoverageOptions } from "./coverage/compute";
// Phase C.2 — mutation testing
export {
  ALL_OPERATORS as MUTATION_OPERATORS,
  OPERATOR_NAMES as MUTATION_OPERATOR_NAMES,
  runAllOperators as runAllMutationOperators,
} from "./mutation/operators";
export type {
  MutationContext,
  MutatedSourceFile,
  MutationOperator,
  MutationOperatorName,
} from "./mutation/operators";
export { runMutations, resolveTestCommand } from "./mutation/runner";
export type {
  RunMutationsInput,
  RunMutationsResult,
  MutationResult,
  MutationResultStatus,
  SpawnFn as MutationSpawnFn,
} from "./mutation/runner";
export { computeMutationReport, loadLastMutationRun } from "./mutation/report";
export type {
  MutationReport,
  MutationSurvivor,
  MutationSeverity,
  PersistedMutationRun,
} from "./mutation/report";
// Phase C.3 — RPC extraction
export { extractRpcProcedures, buildRpcContext } from "./rpc-extractor";
export type {
  RpcProcedureNode,
  RpcEndpointNode,
  RpcExtractionResult,
  RpcContextBlob,
} from "./rpc-extractor";
// Phase C.4 — oracle queue
export {
  appendOracleEntry,
  readOracleEntries,
  findOraclePending,
  setOracleVerdict,
  findOracleEntriesForSpec,
  oracleQueuePath,
} from "./oracle/queue";
export type {
  OracleQueueEntry as OracleEntry,
  OracleVerdict,
  OracleStatus,
} from "./oracle/queue";
export { generateUnitSpec, generateUnitSpecs, promptForUnitTest } from "./unit-codegen";
export type { UnitCodegenResult } from "./unit-codegen";

// Prompt library (standardized across providers)
export {
  promptFor,
  listKinds,
  loadProjectContext,
  renderContextAsXml,
  getAdapter,
  claudeAdapter,
  openaiAdapter,
  geminiAdapter,
  localAdapter,
  unitTestTemplate,
  integrationTestTemplate,
  e2eTestTemplate,
  healTemplate,
  impactTemplate,
  getTemplate,
} from "./prompts";
export type {
  PromptProvider,
  PromptKind,
  PromptMessage,
  PromptBudget,
  PromptContext,
  PromptSpecInput,
  PromptSpec,
  PromptTemplate,
  PromptAdapter,
} from "./prompts";
export * from "./selector-map";
export { parseTrace, generateAlternativeSelectors } from "./trace-parser";
export type { TraceAction, FailedLocator, TraceParseResult } from "./trace-parser";

// Oracle and domain detection
export { detectDomain, detectDomainFromRoute, detectDomainFromSource } from "./domain-detector";
export type { AppDomain, DomainDetectionResult } from "./domain-detector";
export {
  generateL1Assertions,
  generateL2Assertions,
  generateL2AssertionsFromContract,
  generateL3Assertions,
  generateL3AssertionsFromSideEffects,
  generateA11yAssertions,
  generateA11yTestBlock,
  countBehavioralAssertions,
  upgradeL0ToL1,
  getAssertionCount,
  createDefaultOracle,
} from "./oracle";
export type { OracleResult, L2Context, L3Context, A11yOptions } from "./oracle";
export {
  findContractFiles,
  findContractForRoute,
  parseContractFile,
  parseContractSource,
  inferRouteFromFileName,
} from "./contract-parser";
export type {
  ParsedContract,
  ContractField,
  ContractResponseShape,
  ContractRequestShape,
  ZodFieldKind,
} from "./contract-parser";
export {
  scanSourceForSideEffects,
  scanFileForSideEffects,
  scanRouteSideEffects,
} from "./side-effect-scanner";
export type { SideEffect, SideEffectKind, SideEffectScanResult } from "./side-effect-scanner";

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

/**
 * Phase A.1 — context for agents. Returns the JSON blob consumed by
 * the `mandu_ate_context` MCP tool. Re-exports `buildContext` under
 * the `ateXxx(...)` naming convention the rest of the package uses
 * for MCP-adjacent helpers.
 */
export async function ateContext(input: {
  repoRoot: string;
  scope: "project" | "route" | "filling" | "contract";
  id?: string;
  route?: string;
}) {
  const { buildContext } = await import("./context-builder");
  return buildContext(input.repoRoot, {
    scope: input.scope,
    id: input.id,
    route: input.route,
  });
}

export { runFullPipeline } from "./pipeline";
export type { AutoPipelineOptions, AutoPipelineResult } from "./pipeline";

// Phase 5: AI Agent Integration
export { smartSelectRoutes } from "./smart-select";
export type { SmartSelectInput, SmartSelectResult } from "./smart-select";
export { detectCoverageGaps } from "./coverage-gap";
export type { CoverageGap, CoverageGapType, CoverageGapResult } from "./coverage-gap";
export { precommitCheck } from "./precommit";
export type { PrecommitInput, PrecommitResult } from "./precommit";

// Watch mode
export { createAteWatcher } from "./watcher";
export type { AteWatchOptions, WatchTestResult, AteWatcher } from "./watcher";

// Phase 12.2 — E2E codegen + runner (Agent E)
export {
  buildE2EPlan,
  generateE2EPrompts,
  describeE2EPlan as describeE2ECodegenPlan,
} from "./e2e-codegen";
export type {
  E2ECodegenOptions,
  E2ECodegenPlan,
  E2ECodegenPlanItem,
} from "./e2e-codegen";
export {
  planE2ERun,
  runE2E,
  buildPlaywrightArgs,
  findMissingPlaywright,
  describeE2EPlan as describeE2ERunPlan,
  E2E_COVERAGE_RELATIVE,
} from "./e2e-runner";
export type {
  RunE2EInput,
  E2ERunResult,
  E2EPlan,
} from "./e2e-runner";

// Phase 12.3 — LCOV coverage merger (Agent E)
export {
  parseLcov,
  mergeRecords,
  serializeLcov,
  mergeLcovFiles,
  writeMergedLcov,
  mergeAndWriteLcov,
} from "./coverage-merger";
export type {
  LcovFileRecord,
  MergeInput,
  MergeResult,
} from "./coverage-merger";

