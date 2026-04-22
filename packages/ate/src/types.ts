export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

// ────────────────────────────────────────────────────────────────────────────
// ATE monitor events — structured payloads streamed through
// `@mandujs/core`'s singleton `eventBus` under `type: "ate"`.
//
// Every ATE run emits a deterministic sequence that downstream
// subscribers (activity-monitor, SQLite store, agent tail tools) can
// render without re-parsing stdout. The shape below is the **data**
// portion of `ObservabilityEvent.data` — the outer envelope is the
// generic `ObservabilityEvent` type from `@mandujs/core/observability`.
//
// Event kinds (in canonical order):
//   1. run_start          — once per runSpec/runSpecs invocation
//   2. spec_progress      — phase boundaries inside a spec (best-effort)
//   3. spec_done          — after each spec terminates
//   4. failure_captured   — full FailureV1 object attached to a failing spec
//   5. artifact_saved     — each trace/screenshot/dom write
//   6. run_end            — once, summarizing the whole run
//
// `runId` is stable across every event in the same run so consumers
// can correlate. `graphVersion` is forwarded from the ATE graph.
// ────────────────────────────────────────────────────────────────────────────

import type { FailureV1 } from "../schemas/failure.v1";

export interface AteRunStartEvent {
  kind: "run_start";
  runId: string;
  specPaths: string[];
  shard?: { current: number; total: number };
  graphVersion: string;
}

export interface AteSpecProgressEvent {
  kind: "spec_progress";
  runId: string;
  specPath: string;
  phase: "loading" | "executing" | "capturing_artifacts";
}

export interface AteSpecDoneEvent {
  kind: "spec_done";
  runId: string;
  specPath: string;
  status: "pass" | "fail" | "skip";
  durationMs: number;
  assertions?: number;
}

export interface AteFailureCapturedEvent {
  kind: "failure_captured";
  runId: string;
  specPath: string;
  failure: FailureV1;
}

export interface AteArtifactSavedEvent {
  kind: "artifact_saved";
  runId: string;
  specPath?: string;
  /**
   * Artifact classification. Renamed from the roadmap's `kind` to avoid
   * colliding with the outer event discriminator (`kind: "artifact_saved"`).
   * Serialized as `artifactKind` on the wire.
   */
  artifactKind: "trace" | "screenshot" | "dom" | "other";
  path: string;
  sizeBytes: number;
}

export interface AteRunEndEvent {
  kind: "run_end";
  runId: string;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  graphVersion: string;
}

/**
 * Discriminated union of every ate monitor payload (shape of
 * `ObservabilityEvent.data` when `type === "ate"`). Subscribers can
 * narrow on `kind` cleanly:
 *
 *   eventBus.on("ate", (e) => {
 *     const data = e.data as AteMonitorEvent;
 *     if (data.kind === "spec_done" && data.status === "fail") { ... }
 *   });
 *
 * NOTE: `AteArtifactSavedEvent` uses `artifactKind` for its artifact
 * classification (trace/screenshot/dom/other) to avoid collision with
 * the outer event discriminator `kind: "artifact_saved"`.
 */
export type AteMonitorEvent =
  | AteRunStartEvent
  | AteSpecProgressEvent
  | AteSpecDoneEvent
  | AteFailureCapturedEvent
  | AteArtifactSavedEvent
  | AteRunEndEvent;

/**
 * Enumerated list of every supported ate monitor event kind. Keep in
 * sync with the discriminated union above.
 */
export const ATE_MONITOR_EVENT_KINDS = [
  "run_start",
  "spec_progress",
  "spec_done",
  "failure_captured",
  "artifact_saved",
  "run_end",
] as const satisfies ReadonlyArray<AteMonitorEvent["kind"]>;


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
    /**
     * Phase A.1 additions (optional — older consumers that only read
     * `{ routes, navigations, modals, actions }` keep working). These
     * counts reflect the expanded extractor scope: filling handlers,
     * slot loader files, client island files, and page-level form
     * occurrences.
     */
    fillings?: number;
    slots?: number;
    islands?: number;
    forms?: number;
  };
}

/**
 * Resolved `generateStaticParams` sample set for a dynamic route. Each
 * entry is one concrete param combination — catch-all params are
 * stored as string[]. Extracted statically from array-literal exports
 * when the exported function has no free variables; otherwise omitted.
 */
export interface StaticParamSample {
  params: Record<string, string | string[]>;
}

export type InteractionNode =
  // route — existing shape, extended with optional `staticParams` sample
  // set + `routeId` (derived from file path with `/` → `-`, normalized
  // for cross-node references).
  | {
      kind: "route";
      id: string;
      file: string;
      path: string;
      methods?: string[];
      hasIsland?: boolean;
      hasContract?: boolean;
      hasSse?: boolean;
      hasAction?: boolean;
      isRedirect?: boolean;
      /** Dynamic route only — up to N concrete param sets extracted from generateStaticParams. */
      staticParams?: StaticParamSample[];
      /** Normalized id derived from `path` (e.g. "/api/signup" → "api-signup"). */
      routeId?: string;
    }
  // modal — existing shape, extended to optionally point at the route
  // it belongs to.
  | { kind: "modal"; id: string; file: string; name: string; routeId?: string }
  // action — existing shape (Filling `.action(name, handler)` or top-level
  // action registration). Extended with routeId.
  | { kind: "action"; id: string; file: string; name: string; routeId?: string }
  // filling — server-side handler module (`.post()`/`.get()`/...). The
  // route-kind node can coexist with a filling node for the same file
  // (route represents the URL, filling represents the handler's
  // middleware/method surface).
  | {
      kind: "filling";
      id: string;
      file: string;
      routeId: string;
      methods: string[];
      /**
       * Middleware chain detected from `.use(xxx())` calls. Each entry is
       * the identifier/callee text (e.g. "withSession", "csrf").
       */
      middlewareNames: string[];
      /**
       * Named actions registered via `.action("name", handler)`.
       */
      actions: string[];
    }
  // slot — `*.slot.ts(x)` file registering a server-side data loader
  // for a page route. Surface in context so agent knows the typed
  // output contract exists.
  | { kind: "slot"; id: string; file: string; name: string; routeId?: string }
  // island — `*.client.ts(x)` or `*.island.ts(x)` file.
  | { kind: "island"; id: string; file: string; name: string; routeId?: string }
  // form — page-level `<form action="...">` or `<Form>` occurrence,
  // captured so agents know the page's interactive surface without
  // re-parsing the source.
  | { kind: "form"; id: string; file: string; action?: string; method?: string; routeId?: string };

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
  baseURL?: string;
  ci?: boolean;
  headless?: boolean;
  browsers?: ("chromium" | "firefox" | "webkit")[];
  /** Filter test execution to specs matching these route paths (e.g. ["/api/users", "/dashboard"]) */
  onlyRoutes?: string[];
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
