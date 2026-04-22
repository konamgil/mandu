/**
 * run — unified spec runner (Phase A.2).
 *
 * Wraps Playwright or bun:test depending on the spec file:
 *   - `**\/*.spec.ts` under `tests/e2e/**` → Playwright
 *   - everything else (including `tests/**\/*.test.ts`) → bun:test
 *
 * Returns a discriminated `RunResult`:
 *   - pass: `{ status: "pass", durationMs, assertions, graphVersion }`
 *   - fail: a full `FailureV1` envelope (re-validated through the Zod
 *     schema before return — invalid shapes are a bug in the
 *     translator, not in the test).
 *
 * Sharding: `{ shard: { current, total } }` is forwarded to Playwright
 * as `--shard=<c>/<t>`. For bun:test we implement a hash-based partition
 * — only specs whose `sha256(path) % total === (current-1)` run. This
 * keeps CI sharding opaque to the test author.
 *
 * Artifacts: on failure we emit trace.zip / screenshot.png / dom.html
 * into `.mandu/ate-artifacts/<runId>/` via `artifact-store`. Paths land
 * on `failure.trace.{path,screenshot,dom}` before the failure escapes.
 *
 * Freshness: every result carries `graphVersion` so agents can
 * invalidate their context cache when the route / contract surface
 * shifts.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { failureV1Schema, type FailureV1, type FailureKind } from "../schemas/failure.v1";
import {
  ensureArtifactDir,
  newRunId,
  pruneArtifacts,
  resolveArtifactPaths,
  stageArtifact,
  writeTextArtifact,
} from "./artifact-store";
import {
  appendRunHistory,
  computeFlakeScore,
  lastPassedAt,
} from "./flake-detector";
import { graphVersionFromGraph } from "./graph-version";
import { readJson, fileExists, getAtePaths } from "./fs";
import {
  emitRunStart,
  emitSpecProgress,
  emitSpecDone,
  emitFailureCaptured,
  emitRunEnd,
} from "./run-events";
import type { InteractionGraph } from "./types";

export interface ShardSpec {
  current: number;
  total: number;
}

export interface RunSpecOptions {
  repoRoot: string;
  /** Relative or absolute spec path. */
  spec: string;
  headed?: boolean;
  trace?: boolean;
  shard?: ShardSpec;
  /** Force a runner. Auto-detected from extension when omitted. */
  runner?: "playwright" | "bun";
  /**
   * Override runId generation — lets tests assert deterministic
   * artifact paths.
   */
  runId?: string;
  /**
   * Injected run executor — tests use this to skip spawning. Receives
   * the resolved runner name + argv + env. Should return the raw
   * runner exit code, stdout, stderr.
   */
  exec?: RunnerExec;
}

export interface RunnerExecInput {
  runner: "playwright" | "bun";
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export interface RunnerExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Millis spent inside the runner itself. */
  durationMs: number;
}

export type RunnerExec = (input: RunnerExecInput) => Promise<RunnerExecResult>;

export interface PassResult {
  status: "pass";
  durationMs: number;
  assertions: number;
  graphVersion: string;
  runId: string;
  runner: "playwright" | "bun";
}

export type RunResult = PassResult | FailureV1;

// ────────────────────────────────────────────────────────────────────────────
// Public entry point
// ────────────────────────────────────────────────────────────────────────────

export async function runSpec(options: RunSpecOptions): Promise<RunResult> {
  const runId = options.runId ?? newRunId();
  const runner = options.runner ?? detectRunner(options.spec);
  const graphVersion = loadGraphVersion(options.repoRoot);

  const exec = options.exec ?? defaultExec;

  const { command, args, env, specPath } = buildInvocation(
    runner,
    options,
    runId,
  );

  const started = Date.now();

  // ── run_start — single entry covering this spec. `specPaths` is a
  // list even for a single-spec run so the shape matches batch calls.
  emitRunStart({
    runId,
    specPaths: [specPath],
    shard: options.shard,
    graphVersion,
  });

  // Phase boundary: loading → about to hand off to runner.
  emitSpecProgress({ runId, specPath, phase: "loading" });

  let runnerResult: RunnerExecResult;
  try {
    emitSpecProgress({ runId, specPath, phase: "executing" });
    runnerResult = await exec({
      runner,
      command,
      args,
      env,
      cwd: options.repoRoot,
    });
  } catch (err) {
    const totalDur = Date.now() - started;
    const failure = translateExecError(err, {
      repoRoot: options.repoRoot,
      specPath,
      runId,
      graphVersion,
      runner,
    });
    emitFailureCaptured({ runId, specPath, failure });
    emitSpecDone({
      runId,
      specPath,
      status: "fail",
      durationMs: totalDur,
    });
    recordHistory(options.repoRoot, failure, runId, totalDur);
    pruneArtifacts(options.repoRoot);
    emitRunEnd({
      runId,
      passed: 0,
      failed: 1,
      skipped: 0,
      durationMs: totalDur,
      graphVersion,
    });
    return failure;
  }

  if (runnerResult.exitCode === 0) {
    const durationMs = runnerResult.durationMs ?? Date.now() - started;
    const assertions = extractAssertionCount(runnerResult);
    const pass: PassResult = {
      status: "pass",
      durationMs,
      assertions,
      graphVersion,
      runId,
      runner,
    };
    appendRunHistory(options.repoRoot, {
      specPath,
      runId,
      status: "pass",
      durationMs: pass.durationMs,
      timestamp: new Date().toISOString(),
      graphVersion,
    });
    pruneArtifacts(options.repoRoot);
    emitSpecDone({
      runId,
      specPath,
      status: "pass",
      durationMs,
      assertions,
    });
    emitRunEnd({
      runId,
      passed: 1,
      failed: 0,
      skipped: 0,
      durationMs,
      graphVersion,
    });
    return pass;
  }

  // Non-zero exit — classify and translate to failure.v1.
  // Artifact capture happens inside translateFailure → collectArtifacts;
  // those writes emit their own `artifact_saved` events.
  emitSpecProgress({ runId, specPath, phase: "capturing_artifacts" });
  const translated = translateFailure({
    runner,
    repoRoot: options.repoRoot,
    specPath,
    runId,
    graphVersion,
    runnerResult,
  });

  emitFailureCaptured({ runId, specPath, failure: translated });
  emitSpecDone({
    runId,
    specPath,
    status: "fail",
    durationMs: runnerResult.durationMs,
  });
  recordHistory(options.repoRoot, translated, runId, runnerResult.durationMs);
  pruneArtifacts(options.repoRoot);
  emitRunEnd({
    runId,
    passed: 0,
    failed: 1,
    skipped: 0,
    durationMs: runnerResult.durationMs,
    graphVersion,
  });
  return translated;
}

// ────────────────────────────────────────────────────────────────────────────
// Runner detection + invocation building
// ────────────────────────────────────────────────────────────────────────────

function detectRunner(spec: string): "playwright" | "bun" {
  const normalized = spec.replace(/\\/g, "/");
  // Playwright convention: anything under `tests/e2e/`, OR any file
  // explicitly marked `.e2e.ts` / `.pw.ts`. Anything else (`.test.ts`,
  // `.spec.ts` outside `tests/e2e`) is routed to bun:test.
  if (
    /(^|\/)tests\/e2e\//.test(normalized) ||
    /\.e2e\.tsx?$/.test(normalized) ||
    /\.pw\.tsx?$/.test(normalized)
  ) {
    return "playwright";
  }
  return "bun";
}

function buildInvocation(
  runner: "playwright" | "bun",
  options: RunSpecOptions,
  runId: string,
): { command: string; args: string[]; env: NodeJS.ProcessEnv; specPath: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.MANDU_ATE_RUN_ID = runId;

  if (runner === "playwright") {
    const args = ["x", "playwright", "test", options.spec];
    if (options.headed) args.push("--headed");
    if (options.trace !== false) args.push("--trace=on");
    if (options.shard) {
      args.push(`--shard=${options.shard.current}/${options.shard.total}`);
    }
    return { command: "bun", args, env, specPath: options.spec };
  }

  // bun:test
  const args = ["test", options.spec];
  if (options.shard) {
    // Hash-based partitioning: only run when the spec path maps to the
    // current shard. We encode the filter as an env var the test harness
    // can read — if it doesn't, the runner still executes every file
    // and sharding silently degrades (acceptable fallback).
    env.MANDU_ATE_SHARD_CURRENT = String(options.shard.current);
    env.MANDU_ATE_SHARD_TOTAL = String(options.shard.total);
    if (!specInShard(options.spec, options.shard)) {
      // Don't execute — mark as pass with 0 assertions (matching how
      // Playwright's `--shard` silently skips off-shard specs).
      // We emit a single-case noop by pointing bun:test at /dev/null.
      // Using a nonexistent file causes exit 0 with "no tests found".
      args[1] = "__mandu_ate_shard_skip__";
    }
  }
  return { command: "bun", args, env, specPath: options.spec };
}

function specInShard(spec: string, shard: ShardSpec): boolean {
  if (shard.total <= 1) return true;
  const digest = createHash("sha256").update(spec, "utf8").digest();
  const slot = digest.readUInt32BE(0) % shard.total;
  // `current` is 1-based, `slot` is 0-based.
  return slot === shard.current - 1;
}

// ────────────────────────────────────────────────────────────────────────────
// Default exec — spawns a process with stdio pipes.
// ────────────────────────────────────────────────────────────────────────────

const defaultExec: RunnerExec = async (input) => {
  const started = Date.now();
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
  const exitCode: number = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        child.kill("SIGTERM");
        reject(new Error("runSpec: runner timed out after 10 minutes"));
      },
      10 * 60 * 1000,
    );
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  return {
    exitCode,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
    durationMs: Date.now() - started,
  };
};

// ────────────────────────────────────────────────────────────────────────────
// Failure translation
// ────────────────────────────────────────────────────────────────────────────

interface TranslateArgs {
  runner: "playwright" | "bun";
  repoRoot: string;
  specPath: string;
  runId: string;
  graphVersion: string;
  runnerResult: RunnerExecResult;
}

function translateFailure(args: TranslateArgs): FailureV1 {
  const classified = classifyFailure(args.runnerResult);
  const { kind, detail, hint } = classified;

  const trace = collectArtifacts(args, classified);
  const flakeScore = computeFlakeScore(args.repoRoot, args.specPath);
  const lastPass = lastPassedAt(args.repoRoot, args.specPath);

  const base = {
    status: "fail" as const,
    healing: {
      auto: [] as Array<{ change: string; old?: string; new?: string; confidence?: number; reason?: string }>,
      requires_llm: kind === "contract_mismatch" || kind === "semantic_divergence",
      hint,
    },
    flakeScore,
    lastPassedAt: lastPass,
    graphVersion: args.graphVersion,
    trace,
    observedAt: new Date().toISOString(),
    specPath: args.specPath,
    runId: args.runId,
    durationMs: args.runnerResult.durationMs,
  };

  // Build the discriminated object then re-parse via Zod to enforce
  // the contract. If the translator ever produces an invalid shape
  // we prefer a loud error in tests over silent drift.
  const shaped = { ...base, kind, detail } as unknown as FailureV1;
  const parsed = failureV1Schema.safeParse(shaped);
  if (!parsed.success) {
    // Fall back to fixture_missing as a safe default — agents will see
    // a hint pointing to the translator bug.
    const fallback: FailureV1 = {
      ...base,
      kind: "fixture_missing",
      detail: {
        fixtureName: "unknown",
        suggestion: `ATE runner translator emitted an invalid failure shape: ${parsed.error.issues[0]?.message ?? "unknown"}`,
      },
    };
    return failureV1Schema.parse(fallback);
  }
  return parsed.data;
}

function translateExecError(
  err: unknown,
  ctx: {
    repoRoot: string;
    specPath: string;
    runId: string;
    graphVersion: string;
    runner: "playwright" | "bun";
  },
): FailureV1 {
  const message = err instanceof Error ? err.message : String(err);
  const fallback: FailureV1 = {
    status: "fail",
    kind: "fixture_missing",
    detail: {
      fixtureName: "runner",
      suggestion: `Runner failed to execute: ${message}`,
    },
    healing: { auto: [], requires_llm: false, hint: "Runner did not start — check bun/playwright install." },
    flakeScore: computeFlakeScore(ctx.repoRoot, ctx.specPath),
    lastPassedAt: lastPassedAt(ctx.repoRoot, ctx.specPath),
    graphVersion: ctx.graphVersion,
    trace: {},
    observedAt: new Date().toISOString(),
    specPath: ctx.specPath,
    runId: ctx.runId,
  };
  return failureV1Schema.parse(fallback);
}

interface ClassifiedFailure {
  kind: FailureKind;
  detail: unknown;
  hint?: string;
}

function classifyFailure(runnerResult: RunnerExecResult): ClassifiedFailure {
  const text = `${runnerResult.stdout}\n${runnerResult.stderr}`.toLowerCase();

  // Order matters — check specific markers before generic ones.
  if (
    text.includes("contract mismatch") ||
    /expected \S+ to match schema/.test(text) ||
    text.includes("zodError".toLowerCase()) ||
    text.includes("contract_violation")
  ) {
    return {
      kind: "contract_mismatch",
      detail: extractContractDetail(runnerResult) ?? {
        route: "<unknown>",
        violations: [],
      },
      hint: "Response shape diverged from the declared contract — either the contract or the spec needs to update.",
    };
  }

  if (
    /403/.test(text) &&
    (text.includes("csrf") || text.includes("x-csrf") || text.includes("_csrf"))
  ) {
    return {
      kind: "csrf_invalid",
      detail: extractCsrfDetail(runnerResult),
      hint: "CSRF token missing or stale — confirm createTestSession is used and _csrf field is present.",
    };
  }

  if (/429/.test(text) || text.includes("rate limit") || text.includes("rate_limit")) {
    return {
      kind: "rate_limit_exceeded",
      detail: extractRateLimitDetail(runnerResult),
      hint: "Rate limit bucket not reset between cases — reset the limiter in the test fixture.",
    };
  }

  if (
    text.includes("hydration timeout") ||
    text.includes("data-hydrated") ||
    /island.*never.*hydrat/.test(text)
  ) {
    return {
      kind: "hydration_timeout",
      detail: extractHydrationDetail(runnerResult),
      hint: "Island exceeded hydration timeout — bump waitForIsland timeout or profile client bundle.",
    };
  }

  if (
    text.includes("unexpected redirect") ||
    text.includes("redirect to") ||
    /expected.*but.*redirected/.test(text)
  ) {
    return {
      kind: "redirect_unexpected",
      detail: extractRedirectDetail(runnerResult),
      hint: "Redirect target changed — inspect middleware chain ordering.",
    };
  }

  if (
    text.includes("fixture") &&
    (text.includes("not found") || text.includes("missing") || text.includes("undefined"))
  ) {
    return {
      kind: "fixture_missing",
      detail: extractFixtureDetail(runnerResult),
      hint: "Required fixture not wired — import from @mandujs/core/testing.",
    };
  }

  if (text.includes("expectsemantic") || text.includes("semantic_divergence")) {
    return {
      kind: "semantic_divergence",
      detail: {
        claim: extractSemanticClaim(runnerResult),
        oraclePending: true,
      },
      hint: "expectSemantic queued for agent judgement — call mandu_ate_oracle_pending.",
    };
  }

  // Default: selector drift. Most common failure mode in an E2E run.
  return {
    kind: "selector_drift",
    detail: extractSelectorDetail(runnerResult),
    hint: undefined,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Detail extractors — very lightweight; we parse what's easy and fall
// through to safe defaults otherwise. Runner stdout / stderr is the
// only input; richer data (Playwright trace) is picked up separately
// by `collectArtifacts`.
// ────────────────────────────────────────────────────────────────────────────

function extractSelectorDetail(r: RunnerExecResult): unknown {
  const text = `${r.stdout}\n${r.stderr}`;
  const selectorMatch = text.match(/selector\s+["'`]([^"'`]+)["'`]/i) ??
    text.match(/locator\(["'`]([^"'`]+)["'`]\)/);
  const old = selectorMatch?.[1] ?? "<unknown-selector>";
  return {
    old,
    domCandidates: [],
  };
}

function extractContractDetail(r: RunnerExecResult): unknown {
  const text = `${r.stdout}\n${r.stderr}`;
  const routeMatch = text.match(/route[:\s]+([\w/-]+)/i);
  return {
    route: routeMatch?.[1] ?? "<unknown-route>",
    violations: [],
  };
}

function extractCsrfDetail(r: RunnerExecResult): unknown {
  const text = `${r.stdout}\n${r.stderr}`;
  const routeMatch = text.match(/route[:\s]+([\w/-]+)/i) ?? text.match(/(\/[\w/-]+)/);
  return {
    route: routeMatch?.[1] ?? "<unknown-route>",
    status: 403 as const,
    reason: "csrf token missing or invalid",
  };
}

function extractRateLimitDetail(r: RunnerExecResult): unknown {
  const text = `${r.stdout}\n${r.stderr}`;
  const routeMatch = text.match(/route[:\s]+([\w/-]+)/i) ?? text.match(/(\/[\w/-]+)/);
  return {
    route: routeMatch?.[1] ?? "<unknown-route>",
    status: 429 as const,
  };
}

function extractHydrationDetail(r: RunnerExecResult): unknown {
  const text = `${r.stdout}\n${r.stderr}`;
  const islandMatch = text.match(/island[:\s]+["']?([\w-]+)["']?/i);
  const msMatch = text.match(/(\d+)\s*ms/);
  return {
    island: islandMatch?.[1] ?? "<unknown-island>",
    waitedMs: msMatch ? Number.parseInt(msMatch[1], 10) : 0,
  };
}

function extractRedirectDetail(r: RunnerExecResult): unknown {
  const text = `${r.stdout}\n${r.stderr}`;
  const fromMatch = text.match(/from\s+["'`]?([^"'`\s]+)["'`]?/i);
  const toMatch = text.match(/to\s+["'`]?([^"'`\s]+)["'`]?/i);
  return {
    from: fromMatch?.[1] ?? "<unknown>",
    expectedTo: toMatch?.[1] ?? "<unknown>",
    actualTo: "<unknown>",
    chain: [],
  };
}

function extractFixtureDetail(r: RunnerExecResult): unknown {
  const text = `${r.stdout}\n${r.stderr}`;
  const nameMatch = text.match(/fixture[:\s]+["'`]?([\w]+)["'`]?/i);
  return {
    fixtureName: nameMatch?.[1] ?? "<unknown>",
  };
}

function extractSemanticClaim(r: RunnerExecResult): string {
  const text = `${r.stdout}\n${r.stderr}`;
  const claimMatch = text.match(/claim[:\s]+["'`]?([^\n"'`]+)["'`]?/i);
  return claimMatch?.[1]?.trim() ?? "<unknown-claim>";
}

function extractAssertionCount(r: RunnerExecResult): number {
  const text = `${r.stdout}`;
  const expectMatch = text.match(/(\d+)\s+pass/);
  if (expectMatch) return Number.parseInt(expectMatch[1], 10);
  const assertionsMatch = text.match(/(\d+)\s+assertions?/);
  if (assertionsMatch) return Number.parseInt(assertionsMatch[1], 10);
  return 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Artifact collection — happens BEFORE the failure object is returned
// so any runner-emitted file (trace.zip) is relocated into the
// artifact store, not garbage-collected with the tmp dir.
// ────────────────────────────────────────────────────────────────────────────

function collectArtifacts(
  args: TranslateArgs,
  _classified: ClassifiedFailure,
): FailureV1["trace"] {
  const trace: FailureV1["trace"] = {};
  ensureArtifactDir(args.repoRoot, args.runId);

  // Playwright trace.zip conventionally lands at
  // `<repoRoot>/test-results/**/trace.zip`. We try a couple of stable
  // locations; if none exist, we skip.
  if (args.runner === "playwright") {
    const candidates = [
      join(args.repoRoot, "test-results", "trace.zip"),
      join(args.repoRoot, "playwright-report", "trace.zip"),
      join(args.repoRoot, ".mandu", "reports", "latest", "trace.zip"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        const staged = stageArtifact(args.repoRoot, args.runId, c, "trace.zip", args.specPath);
        if (staged) {
          trace.path = staged;
          break;
        }
      }
    }
    const shot = join(args.repoRoot, "test-results", "screenshot.png");
    if (existsSync(shot)) {
      const staged = stageArtifact(args.repoRoot, args.runId, shot, "screenshot.png", args.specPath);
      if (staged) trace.screenshot = staged;
    }
  }

  // Always dump the raw stdout+stderr as a "dom.html"-equivalent text
  // so agents always have *something* to chew on.
  const combined = [
    "<!-- ATE runner output — stdout followed by stderr -->",
    args.runnerResult.stdout,
    "<!-- stderr -->",
    args.runnerResult.stderr,
  ].join("\n");
  const domPath = writeTextArtifact(
    args.repoRoot,
    args.runId,
    "dom.html",
    combined,
    args.specPath,
  );
  trace.dom = domPath;

  // Also persist the structured diagnostic envelope pre-finalization
  // for post-mortem tooling.
  const paths = resolveArtifactPaths(args.repoRoot, args.runId);
  if (!trace.path && !trace.screenshot && !trace.dom) {
    // nothing captured — keep trace as {}
  }
  void paths;
  return trace;
}

// ────────────────────────────────────────────────────────────────────────────
// History helper
// ────────────────────────────────────────────────────────────────────────────

function recordHistory(
  repoRoot: string,
  failure: FailureV1,
  runId: string,
  durationMs: number,
): void {
  try {
    appendRunHistory(repoRoot, {
      specPath: failure.specPath ?? "<unknown>",
      runId,
      status: "fail",
      durationMs,
      timestamp: new Date().toISOString(),
      graphVersion: failure.graphVersion,
      failureKind: failure.kind,
    });
  } catch {
    // History is best-effort — never break the caller on a history
    // write failure.
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Graph version lookup — reads the extractor output and hashes it.
// ────────────────────────────────────────────────────────────────────────────

function loadGraphVersion(repoRoot: string): string {
  const paths = getAtePaths(repoRoot);
  if (!fileExists(paths.interactionGraphPath)) {
    return graphVersionFromGraph(null);
  }
  try {
    const graph = readJson<InteractionGraph>(paths.interactionGraphPath);
    return graphVersionFromGraph(graph);
  } catch {
    return graphVersionFromGraph(null);
  }
}
