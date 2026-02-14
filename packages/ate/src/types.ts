export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

export type OracleLevel = "L0" | "L1" | "L2" | "L3";

export interface AtePaths {
  repoRoot: string;
  manduDir: string; // .mandu
  interactionGraphPath: string;
  selectorMapPath: string;
  scenariosPath: string;
  reportsDir: string;
  autoE2eDir: string;
  manualE2eDir: string;
}

export interface ExtractInput {
  repoRoot: string;
  tsconfigPath?: string;
  routeGlobs?: string[];
  buildSalt?: string;
}

export interface InteractionGraph {
  schemaVersion: 1;
  generatedAt: string;
  buildSalt: string;
  nodes: InteractionNode[];
  edges: InteractionEdge[];
  stats: {
    routes: number;
    navigations: number;
    modals: number;
    actions: number;
  };
}

export type InteractionNode =
  | { kind: "route"; id: string; file: string; path: string }
  | { kind: "modal"; id: string; file: string; name: string }
  | { kind: "action"; id: string; file: string; name: string };

export type InteractionEdge =
  | { kind: "navigate"; from?: string; to: string; file: string; source: string }
  | { kind: "openModal"; from?: string; modal: string; file: string; source: string }
  | { kind: "runAction"; from?: string; action: string; file: string; source: string };

export interface GenerateInput {
  repoRoot: string;
  oracleLevel?: OracleLevel;
  onlyRoutes?: string[];
}

export interface RunInput {
  repoRoot: string;
  /** Optional run id to correlate artifacts/logs across steps. */
  runId?: string;
  baseURL?: string;
  ci?: boolean;
  headless?: boolean;
  browsers?: ("chromium" | "firefox" | "webkit")[];
}

export interface ImpactInput {
  repoRoot: string;
  base?: string;
  head?: string;
}

export interface HealInput {
  repoRoot: string;
  runId: string;
}

export interface SummaryJson {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  metrics?: {
    specsExecuted: number;
    specsFailed: number;
    selectedRoutes: number;
  };
  oracle: {
    level: OracleLevel;
    l0: { ok: boolean; errors: string[] };
    l1: { ok: boolean; signals: string[] };
    l2: { ok: boolean; signals: string[] };
    l3: { ok: boolean; notes: string[] };
  };
  playwright: {
    exitCode: number;
    reportDir: string;
    jsonReportPath?: string;
    junitPath?: string;
  };
  mandu: {
    interactionGraphPath?: string;
    selectorMapPath?: string;
    scenariosPath?: string;
  };
  heal: {
    attempted: boolean;
    suggestions: Array<{ kind: string; title: string; diff: string }>;
  };
  impact: {
    mode: "full" | "subset";
    changedFiles: string[];
    selectedRoutes: string[];
  };
}
