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
  layoutDepth: number;
  metadataKind?: string;
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

export type AgentRepairStatus = "ready" | "nothing_to_repair" | "input_missing";

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
  warnings: string[];
  nextVerifyCommand: string;
}

export interface BuildAgentRepairOptions {
  from?: string;
  apply?: boolean;
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

export interface AgentPlan {
  schemaVersion: 1;
  framework: "mandu";
  generatedAt: string;
  intent: string;
  domains: AgentDomain[];
  filesToRead: string[];
  filesToCreate: string[];
  filesToModify: string[];
  mcpTools: string[];
  risks: AgentPlanRisk[];
  verification: AgentSuggestedCommand[];
  notes: string[];
  executable: false;
}

export interface BuildAgentPlanOptions {
  intent: string;
}

export interface AgentApplyReport {
  schemaVersion: 1;
  framework: "mandu";
  generatedAt: string;
  ok: boolean;
  dryRun: boolean;
  sourcePlan: string;
  intent: string;
  domains: AgentDomain[];
  actions: Array<{
    kind: "mcp_tool" | "read_file" | "manual_edit" | "verify";
    description: string;
    tool?: string;
    file?: string;
    command?: string;
    applied: false;
  }>;
  warnings: string[];
  nextVerifyCommand: string;
}

export interface BuildAgentApplyOptions {
  from?: string;
  dryRun?: boolean;
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
