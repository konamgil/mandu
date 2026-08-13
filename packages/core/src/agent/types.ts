import type { DiagnoseReport } from "../diagnose";

export type AgentWorkflowStep = "context" | "plan" | "apply" | "verify" | "repair";

export type AgentDiagnosticSeverity = "info" | "warning" | "error" | "fatal";

export interface AgentSuggestedFix {
  type: "run_command" | "create_file" | "modify_file" | "manual";
  command?: string;
  path?: string;
  description: string;
}

export interface AgentDiagnostic {
  code: string;
  severity: AgentDiagnosticSeverity;
  title: string;
  file?: string;
  line?: number;
  cause: string;
  suggestedFix?: AgentSuggestedFix;
  docs?: string;
  repairable: boolean;
  source: string;
}

export interface AgentProjectSummary {
  name: string | null;
  version: string | null;
  root: string;
  packageManager: string;
  configFile: string | null;
}

export interface AgentRouteSummary {
  id: string;
  pattern: string;
  kind: "page" | "api" | "metadata" | string;
  module: string;
  methods?: string[];
  hydration?: {
    strategy?: string;
    priority?: string;
  };
  hasClientModule: boolean;
  hasContractModule: boolean;
  boundaryCount?: number;
  boundaries?: AgentRouteBoundarySummary[];
  layoutDepth: number;
  metadataKind?: string;
}

export interface AgentRouteBoundarySummary {
  id: string;
  module: string;
  importSpecifier?: string;
  exportName: string;
  localName: string;
  ordinal: number;
  hydrate: string;
  propsSource: string;
  propsKeys: string[];
  hasSpreadProps: boolean;
  source: {
    file: string;
    line: number;
    column: number;
  };
}

export interface AgentArtifactSummary {
  path: string;
  kind: "partial" | "island" | "slot" | "contract";
}

export interface AgentGuardSummary {
  preset: string | null;
  customRules: number;
  ruleOverrides: number;
}

export interface AgentEnvFileSummary {
  path: string;
  kind: "template" | "local" | "production" | "test" | "unknown";
  redacted: true;
}

export interface AgentGitSummary {
  branch: string | null;
  changedFiles: string[];
  statusAvailable: boolean;
}

export interface AgentCommandMap {
  context: string;
  manifest: string;
  plan: string;
  apply: string;
  verify: string;
  repair: string;
  sync: string;
}

export interface AgentWorkflowCommand {
  step: AgentWorkflowStep;
  command: string;
  purpose: string;
}

export interface AgentContext {
  schemaVersion: 1;
  framework: "mandu";
  generatedAt: string;
  project: AgentProjectSummary;
  routeSource: "manifest" | "scanner" | "none";
  routes: AgentRouteSummary[];
  pages: AgentRouteSummary[];
  apis: AgentRouteSummary[];
  metadataRoutes: AgentRouteSummary[];
  partials: AgentArtifactSummary[];
  islands: AgentArtifactSummary[];
  slots: AgentArtifactSummary[];
  contracts: AgentArtifactSummary[];
  guards: AgentGuardSummary;
  env: AgentEnvFileSummary[];
  deploy: {
    intentFile: string | null;
    targets: string[];
  };
  commands: AgentCommandMap;
  agentWorkflow: {
    canonical: AgentWorkflowStep[];
    recommended: AgentWorkflowCommand[];
  };
  diagnose?: Pick<DiagnoseReport, "healthy" | "errorCount" | "warningCount" | "summary">;
  diagnostics: AgentDiagnostic[];
  git: AgentGitSummary;
  warnings: string[];
}

export interface AgentManifest {
  schemaVersion: 1;
  framework: "mandu";
  generatedAt: string;
  project: AgentProjectSummary;
  routeSource: AgentContext["routeSource"];
  routes: AgentRouteSummary[];
  apis: AgentRouteSummary[];
  layouts: string[];
  partials: AgentArtifactSummary[];
  islands: AgentArtifactSummary[];
  slots: AgentArtifactSummary[];
  contracts: AgentArtifactSummary[];
  guards: AgentGuardSummary;
  env: AgentEnvFileSummary[];
  deploy: AgentContext["deploy"];
  commands: AgentCommandMap;
  agentWorkflow: AgentContext["agentWorkflow"];
  warnings: string[];
}

export interface BuildAgentContextOptions {
  includeDiagnose?: boolean;
  includeGit?: boolean;
}

export interface AgentVerifyCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: AgentDiagnosticSeverity;
  diagnostics: number;
  details?: Record<string, unknown>;
}

export interface AgentSuggestedCommand {
  command: string;
  reason: string;
  required: boolean;
}

export interface AgentVerificationStep extends AgentSuggestedCommand {
  id: string;
  kind?: "agent.verify";
  changedOnly?: boolean;
  includeDiagnose?: boolean;
  includeGit?: boolean;
  includeGuard?: boolean;
  includeContract?: boolean;
}

export interface AgentChangedFileReason {
  file: string;
  reasons: string[];
  recommendedChecks: string[];
  internalApi: boolean;
}

export interface AgentVerifyReport {
  schemaVersion: 1;
  framework: "mandu";
  generatedAt: string;
  project: AgentProjectSummary;
  changedFiles: string[];
  changedFileReasons: AgentChangedFileReason[];
  gitAvailable: boolean;
  notes: string[];
  ok: boolean;
  checks: AgentVerifyCheck[];
  diagnostics: AgentDiagnostic[];
  suggestedCommands: AgentSuggestedCommand[];
  nextRepairInput: string;
}

export interface BuildAgentVerifyOptions {
  changedOnly?: boolean;
  includeDiagnose?: boolean;
  includeGuard?: boolean;
  includeContract?: boolean;
  includeGit?: boolean;
  base?: string;
  staged?: boolean;
}

export type AgentRepairStatus =
  | "ready"
  | "nothing_to_repair"
  | "input_missing"
  | "rolled_back"
  | "rollback_conflict";

export interface AgentRepairAction {
  diagnosticCode: string;
  kind: "run_command" | "manual" | "patch";
  description: string;
  command?: string;
  file?: string;
  safeToApply: boolean;
  applied: boolean;
}

export interface AgentRepairReport {
  schemaVersion: 1;
  framework: "mandu";
  generatedAt: string;
  ok: boolean;
  status: AgentRepairStatus;
  sourceReport: string;
  diagnostics: AgentDiagnostic[];
  actions: AgentRepairAction[];
  appliedActions: AgentRepairAction[];
  rollback?: AgentRollbackResult;
  warnings: string[];
  nextVerifyCommand: string;
}

export interface BuildAgentRepairOptions {
  from?: string;
  apply?: boolean;
  rollbackId?: string;
}

export type AgentDomain =
  | "route"
  | "api"
  | "contract"
  | "slot"
  | "hydration"
  | "guard"
  | "testing"
  | "deploy"
  | "design"
  | "docs"
  | "db"
  | "unknown";

export interface AgentPlanRisk {
  level: "low" | "medium" | "high";
  reason: string;
}

export type AgentOperationKind =
  | "file.create"
  | "file.patch-with-hash"
  | "route.create"
  | "api.create"
  | "contract.update"
  | "guard.safe-fix"
  | "generated.refresh";

export interface AgentPermission {
  kind: "read" | "write";
  path: string;
}

export interface AgentOperationPrecondition {
  exists: boolean;
  contentHash?: string;
}

export interface AgentOperationEffect {
  type: "write";
  content: string;
  encoding: "utf8";
}

export interface AgentRollbackDescriptor {
  strategy: "restore-snapshot";
}

export interface AgentOperation {
  id: string;
  kind: AgentOperationKind;
  target: string;
  precondition: AgentOperationPrecondition;
  effect: AgentOperationEffect;
  rollback: AgentRollbackDescriptor;
}

export interface AgentOperationInput {
  id?: string;
  kind: AgentOperationKind;
  target: string;
  effect: AgentOperationEffect;
}

export type AgentRollbackPolicy = "automatic" | "manual";

export interface AgentPlan {
  schemaVersion: 1;
  framework: "mandu";
  generatedAt: string;
  id: string;
  intent: string;
  baseRevision: string | null;
  idempotencyKey: string | null;
  scope: string[];
  permissions: AgentPermission[];
  operations: AgentOperation[];
  rollbackPolicy: AgentRollbackPolicy;
  domains: AgentDomain[];
  filesToRead: string[];
  filesToCreate: string[];
  filesToModify: string[];
  mcpTools: string[];
  risks: AgentPlanRisk[];
  verification: AgentVerificationStep[];
  notes: string[];
  executable: boolean;
}

export interface BuildAgentPlanOptions {
  intent: string;
}

export interface BuildExecutableAgentPlanOptions {
  intent: string;
  operations: AgentOperationInput[];
  idempotencyKey?: string;
  rollbackPolicy?: AgentRollbackPolicy;
  verification?: AgentVerificationStep[];
}

export type AgentOperationStatus =
  | "planned"
  | "applied"
  | "failed"
  | "rolled_back"
  | "skipped";

export interface AgentOperationReceipt {
  operationId: string;
  kind: AgentOperationKind;
  target: string;
  status: AgentOperationStatus;
  beforeHash: string | null;
  afterHash: string | null;
  error?: string;
}

export interface AgentVerificationResult {
  id: string;
  kind: "agent.verify";
  required: boolean;
  ok: boolean;
  checks: AgentVerifyCheck[];
  diagnostics: AgentDiagnostic[];
}

export interface AgentRollbackReceipt {
  id: string | null;
  snapshotPath: string | null;
  policy: AgentRollbackPolicy;
  attempted: boolean;
  ok: boolean | null;
  restoredFiles: string[];
  conflicts: string[];
}

export type AgentApplyStatus =
  | "preview"
  | "applied"
  | "blocked"
  | "failed"
  | "rolled_back";

export interface AgentApplyAction {
  kind: "mcp_tool" | "read_file" | "manual_edit" | "verify" | AgentOperationKind;
  description: string;
  tool?: string;
  file?: string;
  command?: string;
  applied: boolean;
}

export interface ApplyReceipt {
  schemaVersion: 1;
  framework: "mandu";
  generatedAt: string;
  receiptId: string;
  planId: string | null;
  idempotencyKey: string | null;
  baseRevision: string | null;
  startedAt: string;
  completedAt: string;
  ok: boolean;
  status: AgentApplyStatus;
  dryRun: boolean;
  replayed: boolean;
  sourcePlan: string;
  intent: string;
  domains: AgentDomain[];
  actions: AgentApplyAction[];
  operations: AgentOperationReceipt[];
  touchedFiles: string[];
  changedFiles: string[];
  verification: AgentVerificationResult[];
  rollback: AgentRollbackReceipt;
  warnings: string[];
  nextVerifyCommand: string;
}

export type AgentApplyReport = ApplyReceipt;

export interface BuildAgentApplyOptions {
  from?: string;
  dryRun?: boolean;
  /** Test-only deterministic failure injection; adapters never expose this option. */
  failureAfterOperations?: number;
}

export interface AgentRollbackResult {
  rollbackId: string;
  ok: boolean;
  restoredFiles: string[];
  conflicts: string[];
}

export type AgentSyncTarget = "codex" | "claude" | "gemini" | "all";

export interface AgentSyncFile {
  target: Exclude<AgentSyncTarget, "all">;
  path: string;
  action: "created" | "updated" | "unchanged" | "planned";
  bytes: number;
}

export interface AgentSyncReport {
  schemaVersion: 1;
  framework: "mandu";
  generatedAt: string;
  ok: boolean;
  target: AgentSyncTarget;
  profile: "agent-core";
  workflow: AgentWorkflowStep[];
  files: AgentSyncFile[];
  warnings: string[];
  nextCommands: AgentSuggestedCommand[];
}

export interface BuildAgentSyncOptions {
  target?: AgentSyncTarget;
  dryRun?: boolean;
}
