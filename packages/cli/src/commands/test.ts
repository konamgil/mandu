/**
 * `mandu test` — integrated test runner.
 *
 * ## Phase 12.1 — unit + integration (implemented):
 *   - `mandu test`                → unit + integration
 *   - `mandu test unit`           → unit tests only
 *   - `mandu test integration`    → integration tests only
 *   - `mandu test all`            → alias for `mandu test`
 *
 * ## Phase 12.2 — E2E via ATE wrap:
 *   - `mandu test --e2e`          → invoke ATE E2E codegen + runner
 *   - `mandu test --e2e --heal`   → additionally run the heal loop
 *   - `mandu test --e2e --dry-run`→ print the plan, do not spawn
 *
 * ## Phase 12.3 — coverage + watch + snapshot:
 *   - `mandu test --coverage`     → `bun test --coverage` + optional E2E LCOV
 *                                   merged into `.mandu/coverage/lcov.info`
 *   - `mandu test --watch`        → chokidar watch app/ src/ packages/
 *                                   and re-run affected tests on change
 *   - `mandu test --watch --dry-run` → print the watch plan, exit 0
 *
 * ## Phase 18.σ — unified reporter + per-metric threshold enforcement:
 *   - `mandu test --reporter=<fmt>` → emit human/json/junit/lcov via
 *                                     `@mandujs/core/testing` reporter
 *   - `mandu.config.ts → test.coverage.thresholds.{lines,branches,
 *     functions,statements}` → per-metric coverage gates. The CLI
 *     exits non-zero with a breakdown showing actual vs expected.
 *
 * ## Flag matrix
 *
 * | Flag              | Purpose                                          |
 * | ----------------- | ------------------------------------------------ |
 * | `--filter <g>`    | forwarded to `bun test --filter`                 |
 * | `--coverage`      | bun coverage + E2E coverage + lcov merge        |
 * | `--bail`          | stop on first failure                            |
 * | `--update-snapshots` / `-u` | regenerate snapshot files              |
 * | `--watch`         | chokidar watch → re-run affected                 |
 * | `--e2e`           | run ATE E2E pipeline after unit/integration      |
 * | `--heal`          | run ATE heal loop after an E2E failure           |
 * | `--dry-run`       | print plan and exit 0 (only valid with --e2e/--watch) |
 * | `--reporter <fmt>`| human|json|junit|lcov (default: human)           |
 *
 * See `packages/core/src/config/validate.ts` → `TestConfigSchema`
 * for the shape of the configurable `test` block.
 *
 * ## Exit codes (CTO contract — Agent E Phase 12.2/12.3)
 *
 * |  0 | pass (or dry-run)                                    |
 * |  1 | test failure (assertions failed OR threshold miss)   |
 * |  2 | infra failure (spawn error, timeout, unexpected)     |
 * |  3 | usage error (unknown subcommand / bad flags)         |
 * |  4 | config error (missing playwright, missing config)    |
 */

import { Glob } from "bun";
import path from "path";
import fs from "fs";
import { loadManduConfig } from "@mandujs/core/config/mandu";
import {
  resolveTestConfig,
  type ValidatedTestConfig,
} from "@mandujs/core/config/validate";
import {
  checkCoverageThresholds,
  emptyReport,
  formatReport,
  formatThresholdFailure,
  parseLcovSummary,
  type Coverage,
  type CoverageThresholds,
  type ReporterFormat,
  type TestReport,
} from "@mandujs/core/testing";
import { theme } from "../terminal";
import { CLI_ERROR_CODES, printCLIError } from "../errors";

/** Supported subcommand target. `"all"` expands to unit + integration. */
export type TestTarget = "all" | "unit" | "integration";

/** Flags parsed out of the CLI options map. */
export interface TestOptions {
  /** Glob-sub filter forwarded to `bun test --filter`. */
  filter?: string;
  /** Enable watch mode — re-run affected tests on file changes. */
  watch?: boolean;
  /** Emit coverage report via `bun test --coverage` + LCOV merge. */
  coverage?: boolean;
  /** Stop on first failure (forwarded as `--bail`). */
  bail?: boolean;
  /** Regenerate snapshot files. */
  updateSnapshots?: boolean;
  /** Override the working directory — defaults to `process.cwd()`. */
  cwd?: string;
  /** Phase 12.2 — enable the ATE E2E pipeline after unit/integration. */
  e2e?: boolean;
  /** Phase 12.2 — run the ATE heal loop on E2E failure (requires --e2e). */
  heal?: boolean;
  /**
   * Phase 12.2/12.3 — print the plan for --e2e / --watch and exit 0.
   * Does nothing for plain unit/integration mode.
   */
  dryRun?: boolean;
  /** Phase 12.2 — base URL Playwright connects to. */
  baseURL?: string;
  /** Phase 12.2 — CI mode (forwarded to Playwright). */
  ci?: boolean;
  /** Phase 12.2 — limit E2E to a subset of route ids. */
  onlyRoutes?: string[];
  /** Phase 18.σ — unified reporter output format. Default `"human"`. */
  reporter?: ReporterFormat;
}

// ═══════════════════════════════════════════════════════════════════════════
// Discovery
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve every file path matching any of the `include` patterns and *not*
 * matching any of the `exclude` patterns. Results are absolute, deduped,
 * and sorted for deterministic ordering.
 *
 * Uses Bun's native `Glob.scan` (no external deps). Patterns are
 * interpreted relative to `cwd`; absolute patterns are passed through
 * unchanged.
 */
export async function discoverTestFiles(
  cwd: string,
  include: readonly string[],
  exclude: readonly string[],
): Promise<string[]> {
  const seen = new Set<string>();

  for (const pattern of include) {
    const glob = new Glob(pattern);
    for await (const hit of glob.scan({ cwd, absolute: true, onlyFiles: true })) {
      seen.add(hit.split(path.sep).join("/"));
    }
  }

  const excludeGlobs = exclude.map((p) => new Glob(p));
  const results: string[] = [];
  for (const file of seen) {
    const relative = path.relative(cwd, file).split(path.sep).join("/");
    const excluded = excludeGlobs.some(
      (g) => g.match(file) || g.match(relative),
    );
    if (!excluded) results.push(file);
  }

  results.sort();
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// Test runner
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the `bun test` argv for a resolved file set. Exported for unit tests
 * so we can assert flag composition without actually spawning a subprocess.
 */
export function buildBunTestArgs(
  files: readonly string[],
  opts: TestOptions,
  timeoutMs: number,
): string[] {
  const args = ["test"];
  // `--watch` is intentionally NOT forwarded here: our own watcher owns the
  // re-run loop, and `bun test --watch` would short-circuit the affected-
  // file mapping. See `runWatchMode()` below.
  if (opts.coverage) args.push("--coverage");
  if (opts.bail) args.push("--bail");
  if (opts.updateSnapshots) args.push("--update-snapshots");
  if (opts.filter) args.push("--filter", opts.filter);
  args.push("--timeout", String(timeoutMs));
  for (const f of files) args.push(f);
  return args;
}

/**
 * Spawn `bun test` with the resolved argv. Returns the exit code verbatim so
 * callers map non-zero to `false` (failed run) and zero to `true`.
 */
export async function spawnBunTest(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const proc = Bun.spawn(["bun", ...args], {
    cwd,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

/**
 * Resolve the configured glob set for a single `target`.
 */
export async function resolveTargetFiles(
  cwd: string,
  target: "unit" | "integration",
  config: ValidatedTestConfig,
): Promise<string[]> {
  const block = config[target];
  return discoverTestFiles(cwd, block.include, block.exclude);
}

/**
 * Run a single target end-to-end. Returns `true` on zero exit code.
 */
async function runTarget(
  target: "unit" | "integration",
  config: ValidatedTestConfig,
  opts: TestOptions,
  cwd: string,
): Promise<boolean> {
  const files = await resolveTargetFiles(cwd, target, config);
  if (files.length === 0) {
    printCLIError(CLI_ERROR_CODES.TEST_NO_MATCH, { target });
    return false;
  }

  console.log(
    `${theme.heading(`mandu test ${target}`)} ${theme.muted(`(${files.length} file${files.length === 1 ? "" : "s"})`)}`,
  );

  const args = buildBunTestArgs(files, opts, config[target].timeout);
  const exitCode = await spawnBunTest(args, cwd);

  if (exitCode !== 0) {
    printCLIError(CLI_ERROR_CODES.TEST_RUNNER_FAILED, {
      target,
      exitCode: String(exitCode),
    });
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 12.2 — E2E (--e2e, --heal, --dry-run)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the ATE E2E pipeline for the current project.
 */
export async function runE2EPipeline(opts: {
  cwd: string;
  dryRun: boolean;
  heal: boolean;
  coverage: boolean;
  baseURL?: string;
  ci?: boolean;
  onlyRoutes?: string[];
}): Promise<{ ok: boolean; lcovPath: string | null }> {
  const {
    buildE2EPlan,
    describeE2ECodegenPlan,
    planE2ERun,
    describeE2ERunPlan,
    runE2E,
    ateExtract,
    ateGenerate,
    ateHeal,
    findMissingPlaywright,
  } = await import("@mandujs/ate");

  const codegenPlan = buildE2EPlan({
    repoRoot: opts.cwd,
    onlyRoutes: opts.onlyRoutes,
    oracleLevel: "L1",
  });
  const runPlan = planE2ERun({
    repoRoot: opts.cwd,
    baseURL: opts.baseURL,
    ci: opts.ci,
    coverage: opts.coverage,
    onlyRoutes: opts.onlyRoutes,
  });

  if (opts.dryRun) {
    console.log(theme.heading("mandu test --e2e --dry-run"));
    console.log(describeE2ECodegenPlan(codegenPlan));
    console.log("");
    console.log(describeE2ERunPlan(runPlan));
    if (opts.heal) {
      console.log("");
      console.log(theme.muted("(heal loop would run after the Playwright exit)"));
    }
    return { ok: true, lcovPath: runPlan.lcovPath };
  }

  try {
    await ateExtract({ repoRoot: opts.cwd });
  } catch (err: unknown) {
    console.error(
      theme.error(
        `ATE extract failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return { ok: false, lcovPath: null };
  }

  try {
    await ateGenerate({
      repoRoot: opts.cwd,
      oracleLevel: "L1",
      onlyRoutes: opts.onlyRoutes,
    });
  } catch (err: unknown) {
    console.error(
      theme.error(
        `ATE generate failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return { ok: false, lcovPath: null };
  }

  const missing = findMissingPlaywright(opts.cwd);
  if (missing) {
    printCLIError(CLI_ERROR_CODES.TEST_E2E_PLAYWRIGHT_MISSING);
    return { ok: false, lcovPath: null };
  }

  const result = await runE2E({
    repoRoot: opts.cwd,
    baseURL: opts.baseURL,
    ci: opts.ci,
    coverage: opts.coverage,
    onlyRoutes: opts.onlyRoutes,
  });

  const ok = result.exitCode === 0;
  if (!ok && opts.heal) {
    try {
      const healOut = await ateHeal({ repoRoot: opts.cwd, runId: "latest" });
      console.log(theme.heading("mandu test --heal"));
      console.log(JSON.stringify(healOut, null, 2));
    } catch (err: unknown) {
      console.error(
        theme.error(
          `Heal loop errored (ignored): ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }

  return { ok, lcovPath: result.lcovPath };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 12.3 — coverage (LCOV merge) + Phase 18.σ threshold enforcement
// ═══════════════════════════════════════════════════════════════════════════

/**
 * After a successful `--coverage` run we gather every LCOV source Bun or
 * Playwright emitted, merge them, and write the canonical output to
 * `.mandu/coverage/lcov.info`.
 */
export async function mergeCoverageOutputs(opts: {
  cwd: string;
  e2eLcov: string | null;
}): Promise<{ outputPath: string | null; files: number }> {
  const { mergeAndWriteLcov } = await import("@mandujs/ate");

  const inputs: Array<{
    label: string;
    source: { kind: "file"; path: string };
  }> = [];

  const candidates = [
    path.join(opts.cwd, "coverage", "lcov.info"),
    path.join(opts.cwd, ".mandu", "coverage", "unit.lcov"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      inputs.push({ label: "unit", source: { kind: "file", path: c } });
      break;
    }
  }

  if (opts.e2eLcov && fs.existsSync(opts.e2eLcov)) {
    inputs.push({ label: "e2e", source: { kind: "file", path: opts.e2eLcov } });
  }

  const res = mergeAndWriteLcov({ repoRoot: opts.cwd, inputs });
  return { outputPath: res.outputPath, files: res.summary.files };
}

/**
 * Phase 12.3 legacy — single-line-threshold check. Retained so the
 * `CLI_E065` emission path stays intact when only the legacy
 * `coverage.lines` shorthand is configured.
 *
 * Returns `true` when thresholds are met (or none configured).
 */
export function enforceCoverageThreshold(
  lcovPath: string,
  thresholdPct: number | undefined,
): boolean {
  if (!thresholdPct || thresholdPct <= 0) return true;
  if (!fs.existsSync(lcovPath)) return true;

  const body = fs.readFileSync(lcovPath, "utf8");
  let lf = 0;
  let lh = 0;
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("LF:")) lf += Number(line.slice(3)) || 0;
    else if (line.startsWith("LH:")) lh += Number(line.slice(3)) || 0;
  }
  if (lf === 0) return true;
  const actual = (lh / lf) * 100;
  if (actual + 1e-9 < thresholdPct) {
    printCLIError(CLI_ERROR_CODES.TEST_COVERAGE_THRESHOLD, {
      actual: actual.toFixed(2),
      expected: String(thresholdPct),
    });
    return false;
  }
  return true;
}

/**
 * Resolve the effective per-metric thresholds from a
 * `ValidatedTestConfig`. Hoists the legacy `coverage.lines` /
 * `coverage.branches` shorthand into the `thresholds` sub-block
 * unless explicit values already shadow them. Returns `undefined`
 * when nothing is configured.
 */
export function resolveEffectiveThresholds(
  config: ValidatedTestConfig,
): CoverageThresholds | undefined {
  const { coverage } = config;
  const thresholds: {
    lines?: number;
    branches?: number;
    functions?: number;
    statements?: number;
  } = { ...(coverage.thresholds ?? {}) };
  if (thresholds.lines === undefined && coverage.lines !== undefined) {
    thresholds.lines = coverage.lines;
  }
  if (thresholds.branches === undefined && coverage.branches !== undefined) {
    thresholds.branches = coverage.branches;
  }
  const hasAny =
    thresholds.lines !== undefined ||
    thresholds.branches !== undefined ||
    thresholds.functions !== undefined ||
    thresholds.statements !== undefined;
  return hasAny ? (thresholds as CoverageThresholds) : undefined;
}

/**
 * Phase 18.σ — per-metric threshold check. Parses the merged LCOV,
 * builds a {@link Coverage} block, and delegates to the pure
 * `checkCoverageThresholds` comparator in the reporter module.
 *
 * Returns `true` when all configured metrics meet their target (or
 * nothing is configured). Emits a human-readable breakdown to stderr
 * on failure (per metric: actual vs expected).
 */
export function enforceCoverageThresholds(
  lcovPath: string,
  thresholds: CoverageThresholds | undefined,
): { ok: boolean; coverage?: Coverage } {
  if (!thresholds) return { ok: true };
  if (!fs.existsSync(lcovPath)) return { ok: true };
  const body = fs.readFileSync(lcovPath, "utf8");
  const coverage = parseLcovSummary(body);
  const result = checkCoverageThresholds(coverage, thresholds);
  if (!result.ok) {
    const breakdown = formatThresholdFailure(result);
    // Structured error for CI log scrapers (CLI_E065 + per-metric body).
    for (const b of result.breakdown.filter((x) => !x.ok)) {
      printCLIError(CLI_ERROR_CODES.TEST_COVERAGE_THRESHOLD, {
        actual: `${b.actual.toFixed(2)}`,
        expected: String(b.expected),
      });
    }
    // Additional human block (un-prefixed) listing every failing metric.
    if (breakdown) console.error(breakdown);
  }
  return { ok: result.ok, coverage };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 18.σ — Reporter dispatch
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compose a `TestReport` from the run outcomes. In the current
 * pipeline we don't capture per-case results (bun test's TAP stream
 * is not parsed), so the report carries an empty `tests[]` but
 * complete coverage + timestamps. This is still valuable for CI —
 * JUnit consumers treat zero-case suites as "empty but not failed",
 * and `--reporter=json` still gives machine-readable coverage.
 *
 * Future work: parse `bun test --reporter=tap` to populate `tests[]`.
 */
export function buildTestReport(options: {
  suite: string;
  coverage?: Coverage;
  startedAt: number;
}): TestReport {
  return {
    ...emptyReport(options.suite, "combined"),
    coverage: options.coverage,
    durationMs: Math.max(0, Date.now() - options.startedAt),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Emit the report to stdout in the selected format. For `lcov` the
 * body is re-emitted only when a coverage block is present; callers
 * with no coverage get a no-op (matches tooling like `codecov` which
 * reads stdin and exits silently on empty input).
 */
export function emitReport(
  report: TestReport,
  format: ReporterFormat,
): void {
  const body = formatReport(report, format);
  if (body) process.stdout.write(body.endsWith("\n") ? body : body + "\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 12.3 — Watch mode (with Phase 18.σ UX convergence)
// ═══════════════════════════════════════════════════════════════════════════

/** A plan describing what `--watch` will do. Used by --dry-run. */
export interface WatchPlan {
  readonly watchDirs: string[];
  readonly debounceMs: number;
  readonly targets: TestTarget[];
  readonly initialFileCount: number;
}

/**
 * Resolve the list of directories we will watch.
 */
export function resolveWatchDirs(cwd: string): string[] {
  const candidates = ["app", "src", "packages"];
  return candidates
    .map((rel) => path.join(cwd, rel))
    .filter((abs) => {
      try {
        return fs.statSync(abs).isDirectory();
      } catch {
        return false;
      }
    });
}

/**
 * Plan-only variant — computes what the watcher would do without
 * starting any file handle. Called from `--dry-run`.
 */
export async function planWatch(
  _opts: TestOptions,
  cwd: string,
  config: ValidatedTestConfig,
): Promise<WatchPlan> {
  const watchDirs = resolveWatchDirs(cwd);
  const unit = await resolveTargetFiles(cwd, "unit", config);
  const integration = await resolveTargetFiles(cwd, "integration", config);

  return {
    watchDirs,
    debounceMs: 200,
    targets: ["unit", "integration"],
    initialFileCount: unit.length + integration.length,
  };
}

/** Render the watch plan as a human-readable block. */
export function describeWatchPlan(plan: WatchPlan): string {
  const lines: string[] = [];
  lines.push("mandu test --watch plan");
  lines.push(`  debounce:    ${plan.debounceMs}ms`);
  lines.push(`  targets:     ${plan.targets.join(", ")}`);
  lines.push(`  test files:  ${plan.initialFileCount}`);
  lines.push(`  watch dirs:  ${plan.watchDirs.length}`);
  for (const d of plan.watchDirs) lines.push(`    - ${d}`);
  return lines.join("\n");
}

/**
 * Map a set of changed files to the test files that should re-run.
 * See original Phase 12.3 docs for the algorithm.
 */
export function computeAffectedTests(params: {
  changedFiles: readonly string[];
  testFiles: readonly string[];
  readFile?: (abs: string) => string;
}): string[] {
  const changed = params.changedFiles.map((f) => f.split(path.sep).join("/"));
  const tests = params.testFiles.map((f) => f.split(path.sep).join("/"));
  const read =
    params.readFile ?? ((abs: string) => fs.readFileSync(abs, "utf8"));

  const affected = new Set<string>();
  for (const c of changed) {
    if (tests.includes(c)) affected.add(c);
  }

  const sourceChanges = changed.filter((c) => !tests.includes(c));
  if (sourceChanges.length === 0) return Array.from(affected).sort();

  const needles = sourceChanges.map((c) => {
    const base = path.basename(c);
    const stem = base.replace(/\.[a-z]+$/i, "");
    return { base, stem, full: c };
  });

  for (const testAbs of tests) {
    let body = "";
    try {
      body = read(testAbs);
    } catch {
      continue;
    }
    for (const n of needles) {
      if (
        body.includes(n.base) ||
        body.includes(n.stem) ||
        body.includes(n.full)
      ) {
        affected.add(testAbs);
        break;
      }
    }
  }

  return Array.from(affected).sort();
}

/**
 * Phase 18.σ — print a unified watch header. Mirrors the human-format
 * reporter heading so the stdout stays consistent across modes.
 */
function printWatchHeader(subtitle: string): void {
  // Clear the screen the way most watchers do — ESC [2J ESC [H.
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[2J\x1b[H");
  }
  console.log(theme.heading("mandu test · watch"));
  console.log(theme.muted(subtitle));
  console.log(
    theme.muted(`Shortcuts: q=quit, r=rerun all, Enter=rerun affected`),
  );
}

/**
 * Run the watch loop. Non-returning until SIGINT / SIGTERM / `q` key.
 *
 * Phase 18.σ UX convergence:
 *  - Console cleared + unified header on every rerun.
 *  - Keyboard shortcuts: `q` quits, `r` forces full rerun, Enter
 *    re-runs pending/affected tests.
 *
 * The file-watcher internals (chokidar + affected-test mapping) are
 * unchanged from Phase 12.3 — this function only extends the UX.
 */
export async function runWatchMode(
  opts: TestOptions,
  cwd: string,
  config: ValidatedTestConfig,
): Promise<boolean> {
  const watchDirs = resolveWatchDirs(cwd);
  if (watchDirs.length === 0) {
    printCLIError(CLI_ERROR_CODES.TEST_WATCH_NO_WATCH_DIRS);
    return false;
  }

  const chokidarMod = await import("chokidar");
  const chokidar = chokidarMod.default ?? chokidarMod;

  const testFiles = [
    ...(await resolveTargetFiles(cwd, "unit", config)),
    ...(await resolveTargetFiles(cwd, "integration", config)),
  ];

  printWatchHeader(
    `Watching ${watchDirs.length} director${watchDirs.length === 1 ? "y" : "ies"} (debounce 200ms). Press Ctrl+C or q to stop.`,
  );

  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let queued = false;
  const DEBOUNCE = 200;

  const runBatch = async (files: string[], label: string): Promise<void> => {
    printWatchHeader(`${label} · ${files.length} file(s)`);
    for (const f of files) console.log(theme.muted(`  - ${f}`));
    const args = buildBunTestArgs(files, opts, config.unit.timeout);
    const code = await spawnBunTest(args, cwd);
    console.log(
      code === 0
        ? theme.success(`[watch] PASS`)
        : theme.error(`[watch] FAIL (exit ${code})`),
    );
  };

  const trigger = async (): Promise<void> => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      while (pending.size > 0) {
        const batch = Array.from(pending);
        pending.clear();
        queued = false;

        const affected = computeAffectedTests({
          changedFiles: batch,
          testFiles,
        });
        if (affected.length === 0) {
          console.log(
            theme.muted(`[watch] ${batch.length} change(s), no affected test`),
          );
          if (!queued) break;
          continue;
        }

        await runBatch(affected, "Re-running affected");
        if (!queued) break;
      }
    } finally {
      running = false;
    }
  };

  const rerunAll = async (): Promise<void> => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await runBatch([...testFiles], "Re-running ALL");
    } finally {
      running = false;
    }
  };

  const handle = (abs: string): void => {
    const norm = abs.split(path.sep).join("/");
    pending.add(norm);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void trigger();
    }, DEBOUNCE);
  };

  const watcher = chokidar.watch(watchDirs, {
    ignoreInitial: true,
    ignored: [/node_modules/, /\.git/, /\.mandu/, /dist/],
  });

  watcher.on("add", handle);
  watcher.on("change", handle);
  watcher.on("unlink", handle);
  watcher.on("error", (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(theme.error(`[watch] watcher error: ${message}`));
  });

  const shutdown = (): void => {
    try {
      if (process.stdin.isTTY && typeof (process.stdin as { setRawMode?: (v: boolean) => void }).setRawMode === "function") {
        (process.stdin as { setRawMode: (v: boolean) => void }).setRawMode(false);
      }
    } catch { /* no-op */ }
    void watcher.close();
    if (timer) clearTimeout(timer);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Phase 18.σ — keyboard shortcuts (q / r / Enter). We only bind
  // when stdin is a TTY; CI pipes stay as-is.
  if (process.stdin.isTTY) {
    try {
      const stdin = process.stdin as NodeJS.ReadStream & {
        setRawMode?: (v: boolean) => void;
      };
      if (typeof stdin.setRawMode === "function") stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf8");
      stdin.on("data", (data: string | Buffer) => {
        const key = typeof data === "string" ? data : data.toString("utf8");
        if (key === "q" || key === "\x03" /* Ctrl+C */) shutdown();
        else if (key === "r") void rerunAll();
        else if (key === "\r" || key === "\n") void trigger();
      });
    } catch {
      // Non-interactive fallback: no keyboard shortcuts — watcher still works.
    }
  }

  await new Promise<void>(() => {
    /* intentionally unresolved — shutdown via SIGINT / q */
  });
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Main CLI entry point. Resolves config, dispatches to the requested target,
 * and reports outcomes via the standard `theme.*` / `printCLIError` channels.
 */
export async function testCommand(
  target: TestTarget,
  opts: TestOptions = {},
): Promise<boolean> {
  const cwd = opts.cwd ?? process.cwd();
  const rawConfig = await loadManduConfig(cwd);
  const config = resolveTestConfig(rawConfig.test);
  const reporter: ReporterFormat = opts.reporter ?? "human";
  const startedAt = Date.now();

  if (target !== "all" && target !== "unit" && target !== "integration") {
    printCLIError(CLI_ERROR_CODES.TEST_UNKNOWN_TARGET, { target });
    return false;
  }

  // ─── Phase 12.3 — Watch mode ──────────────────────────────────────
  if (opts.watch) {
    if (opts.dryRun) {
      const plan = await planWatch(opts, cwd, config);
      console.log(describeWatchPlan(plan));
      return true;
    }
    return runWatchMode(opts, cwd, config);
  }

  // ─── Phase 12.2 — E2E-only dry-run short-circuit ──────────────────
  if (opts.e2e && opts.dryRun) {
    const out = await runE2EPipeline({
      cwd,
      dryRun: true,
      heal: Boolean(opts.heal),
      coverage: Boolean(opts.coverage),
      baseURL: opts.baseURL,
      ci: opts.ci,
      onlyRoutes: opts.onlyRoutes,
    });
    return out.ok;
  }

  // ─── Regular unit/integration pipeline ────────────────────────────
  let unitOk = true;
  let integrationOk = true;

  if (target === "unit") {
    unitOk = await runTarget("unit", config, opts, cwd);
  } else if (target === "integration") {
    integrationOk = await runTarget("integration", config, opts, cwd);
  } else {
    unitOk = await runTarget("unit", config, opts, cwd);
    if (!unitOk && opts.bail) return false;
    integrationOk = await runTarget("integration", config, opts, cwd);
  }

  const bunOk = unitOk && integrationOk;

  // ─── Phase 12.2 — E2E leg after bun test ──────────────────────────
  let e2eLcovPath: string | null = null;
  let e2eOk = true;
  if (opts.e2e) {
    const e2eOut = await runE2EPipeline({
      cwd,
      dryRun: false,
      heal: Boolean(opts.heal),
      coverage: Boolean(opts.coverage),
      baseURL: opts.baseURL,
      ci: opts.ci,
      onlyRoutes: opts.onlyRoutes,
    });
    e2eOk = e2eOut.ok;
    e2eLcovPath = e2eOut.lcovPath;
  }

  // ─── Phase 12.3 + 18.σ — Coverage merge + threshold check ─────────
  let coverage: Coverage | undefined;
  let thresholdsOk = true;
  if (opts.coverage) {
    const merged = await mergeCoverageOutputs({ cwd, e2eLcov: e2eLcovPath });
    if (merged.outputPath) {
      console.log(
        theme.muted(
          `[coverage] merged ${merged.files} file record(s) → ${merged.outputPath}`,
        ),
      );
      const effectiveThresholds = resolveEffectiveThresholds(config);
      const threshRes = enforceCoverageThresholds(
        merged.outputPath,
        effectiveThresholds,
      );
      thresholdsOk = threshRes.ok;
      coverage = threshRes.coverage ?? parseLcovFileSafe(merged.outputPath);
      if (coverage && merged.outputPath) {
        coverage = { ...coverage, lcovPath: merged.outputPath };
      }
    }
  }

  // ─── Phase 18.σ — Reporter dispatch ───────────────────────────────
  // `human` mode matches the legacy stdout (headers + per-target
  // success messages are already emitted above by `runTarget`). We
  // only append a unified trailer in non-human formats to avoid double
  // output for interactive users.
  if (reporter !== "human") {
    const report = buildTestReport({
      suite: `mandu test ${target}`,
      coverage,
      startedAt,
    });
    emitReport(report, reporter);
  }

  return bunOk && e2eOk && thresholdsOk;
}

/** Helper — parse an LCOV file into a {@link Coverage}, tolerating absence. */
function parseLcovFileSafe(lcovPath: string): Coverage | undefined {
  try {
    if (!fs.existsSync(lcovPath)) return undefined;
    const body = fs.readFileSync(lcovPath, "utf8");
    return parseLcovSummary(body);
  } catch {
    return undefined;
  }
}
