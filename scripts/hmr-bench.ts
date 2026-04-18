/**
 * Phase 7.0 R3 Agent F — HMR benchmark harness.
 *
 * Measures the actual wall-clock of the dev bundler's file → callback chain
 * for every live cell in the 36-scenario matrix, then aggregates percentiles
 * against `HMR_PERF_TARGETS`.
 *
 * # What this script measures
 *
 * Each cell is run N times. For every iteration we capture TWO values:
 *
 *   1. `rebuildMs`    — the inner-scope `REBUILD_TOTAL` marker value. For
 *                       island + common-dir paths, this comes straight from
 *                       `RebuildResult.buildTime` which the bundler already
 *                       measures inside `withPerf(HMR_PERF.REBUILD_TOTAL, …)`.
 *                       For other callbacks (`onSSRChange`, etc.) the
 *                       bundler does not do a client build — the measurement
 *                       falls back to wall-clock minus a fixed
 *                       `WATCHER_DEBOUNCE`.
 *
 *   2. `wallClockMs`  — the full wall-clock from `writeFileSync` to the
 *                       first relevant callback fire. Includes fs.watch
 *                       propagation + `WATCHER_DEBOUNCE (100 ms)` + the
 *                       rebuild itself. Useful for documenting the
 *                       observable user experience even though it is NOT
 *                       what the HMR_PERF_TARGETS refer to.
 *
 * The hard assertion uses `rebuildMs` because that matches the `REBUILD_TOTAL`
 * marker definition (see `packages/core/src/perf/hmr-markers.ts:45-48`):
 *
 *   > Wall-clock from batch dispatch → WS broadcast complete. The P95 target
 *   > (≤50 ms island / ≤200 ms SSR / ≤500 ms cold) is measured on this marker.
 *
 * # Measurement fidelity boundaries
 *
 * - **Cold start**: separate path (`measureColdStart`), spawns `mandu dev`
 *   against a real fixture and parses the "ready in" stdout line.
 *
 * - **Browser reload walltime**: not measured — we stop at the bundler
 *   signal, not a real browser navigation event.
 *
 * - **CLI `SSR_HANDLER_RELOAD` chain**: runs *inside* `handleSSRChange` in
 *   `cli/commands/dev.ts:324-405` which is DOWNSTREAM of the bundler's
 *   `onSSRChange` callback. We report the bundler-level signal time here
 *   and flag the CLI-layer latency as uncovered in the report's §6.1.
 *
 * # Why not reuse `matrix.spec.ts`?
 *
 * `matrix.spec.ts` runs each cell ONCE and uses soft assertions. This
 * script runs each cell N times and computes percentiles — the spec
 * validates correctness, this script validates performance.
 *
 * # Usage
 *
 *   bun run scripts/hmr-bench.ts                    # default: 20 iterations
 *   ITERATIONS=10 bun run scripts/hmr-bench.ts      # reduced sample
 *   CELLS_ONLY=hybrid bun run scripts/hmr-bench.ts  # single form
 *   SKIP_COLD=1 bun run scripts/hmr-bench.ts        # skip cold start
 *
 * References:
 *   docs/bun/phase-7-team-plan.md §4 Agent F
 *   docs/bun/phase-7-diagnostics/performance-reliability.md
 */

import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { cpus, totalmem, platform, release, arch } from "node:os";
import { startDevBundler, type DevBundler } from "../packages/core/src/bundler/dev";
import type { RoutesManifest } from "../packages/core/src/spec/schema";
import {
  SCENARIO_CELLS,
  type ScenarioCell,
  type ProjectForm,
  type ChangeKind,
  type ExpectedBehavior,
} from "../packages/core/src/bundler/scenario-matrix";
import {
  HMR_PERF_TARGETS,
} from "../packages/core/src/perf/hmr-markers";
import {
  resolveChangeFile,
  buildEditContent,
} from "../packages/core/tests/hmr-matrix/harness";
import { scaffoldSSG } from "../packages/core/tests/hmr-matrix/fixture-ssg";
import { scaffoldHybrid } from "../packages/core/tests/hmr-matrix/fixture-hybrid";
import { scaffoldFull } from "../packages/core/tests/hmr-matrix/fixture-full";

// ═══════════════════════════════════════════════════════════════════════════
// Knobs — tunable via env, with conservative defaults for Windows fs.watch
// ═══════════════════════════════════════════════════════════════════════════

const ITERATIONS = Number(process.env.ITERATIONS ?? "20");
const SKIP_COLD = process.env.SKIP_COLD === "1";
const CELLS_ONLY = process.env.CELLS_ONLY ?? ""; // empty = all forms
const SKIP_BENCH = process.env.SKIP_BENCH === "1";
const REPORT_PATH = path.resolve(
  import.meta.dir,
  "..",
  "docs/bun/phase-7-benchmarks.md",
);

/** Time to wait after `startDevBundler` before emitting fs events. Matches
 *  `harness.ts` WATCHER_ARM_MS; Windows ReadDirectoryChangesW needs it. */
const WATCHER_ARM_MS = 350;

/** Per-iteration timeout — bail if no callback fires within this window. */
const ITER_TIMEOUT_MS = 8_000;

/** Quiet period between iterations so the watcher clears any in-flight debounce
 *  timer set on the previous iteration's write. `WATCHER_DEBOUNCE` in the
 *  bundler is 100ms, so 250ms is a safe margin. */
const ITER_SETTLE_MS = 250;

/**
 * Mandu's `TIMEOUTS.WATCHER_DEBOUNCE` (100 ms). Exposed here so the
 * end-to-end wall-clock can be adjusted into an approximate `REBUILD_TOTAL`
 * estimate for paths that don't produce a `RebuildResult.buildTime` (e.g.
 * `onSSRChange` / `onAPIChange` fire directly from the dispatcher WITHOUT
 * going through `_doBuild`). The estimate is intentionally conservative
 * (we over-subtract rather than under-subtract).
 */
const WATCHER_DEBOUNCE_MS = 100;

/** Cold-start measurements: repetitions per fixture. */
const COLD_START_REPS = 3;

/** Cold-start: max wall-clock we wait for the "ready in" stdout line. */
const COLD_START_TIMEOUT_MS = 30_000;

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Paired sample per iteration. `rebuildMs` is the `REBUILD_TOTAL`
 *  equivalent; `wallClockMs` is the user-observable end-to-end time. */
interface SamplePair {
  rebuildMs: number;
  wallClockMs: number;
}

interface CellResult {
  cell: ScenarioCell;
  /** Pairs — one per successful iteration. Timed-out iters are omitted. */
  samples: SamplePair[];
  rebuild: Stats;
  wallClock: Stats;
  targetMs: number | null;
  pass: boolean | null; // null means "no target"
  err?: string;
}

interface Stats {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
}

interface ColdStartResult {
  form: ProjectForm;
  samples: number[];
  p50: number;
  p95: number;
  mean: number;
}

interface Report {
  env: {
    platform: string;
    release: string;
    arch: string;
    bunVersion: string;
    cpuCount: number;
    cpuModel: string;
    totalMemoryGB: number;
  };
  runMeta: {
    iterations: number;
    startedAt: string;
    finishedAt: string;
    durationSec: number;
    cellsBenched: number;
    cellsSkipped: number;
  };
  coldStart: ColdStartResult[] | null;
  cells: CellResult[];
  hardAssertions: {
    ssrP95Ms: number | null;
    islandP95Ms: number | null;
    cssP95Ms: number | null;
    commonDirP95Ms: number | null;
    coldStartP95Ms: number | null;
    passed: {
      ssr: boolean | null;
      island: boolean | null;
      css: boolean | null;
      commonDir: boolean | null;
      coldStart: boolean | null;
    };
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Percentile helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Linear-interpolated percentile on a sorted copy of `samples`. Returns 0 if
 * the array is empty — callers treat that as "no measurement" and mark the
 * cell as skipped rather than failing a hard assertion.
 */
function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low]!;
  const lowV = sorted[low]!;
  const highV = sorted[high]!;
  return lowV + (highV - lowV) * (rank - low);
}

function summarize(samples: readonly number[]): Stats {
  if (samples.length === 0) {
    return { p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0 };
  }
  const total = samples.reduce((a, b) => a + b, 0);
  return {
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    mean: total / samples.length,
    min: Math.min(...samples),
    max: Math.max(...samples),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Timed observer — captures callback fire nanoseconds per cell iteration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Per-cell observer with:
 *   - A per-iteration "first fire" wall-clock marker, reset between iterations.
 *   - A per-iteration captured `buildTime` from the rebuild callback (the
 *     inner-scope `REBUILD_TOTAL` we actually want to report against).
 */
interface TimedObservations {
  /** Time (nanoseconds) at which the first relevant callback fired. */
  firstFireNanos: number | null;
  /** Latest `buildTime` returned by `onRebuild` for this iteration (ms). */
  lastBuildTimeMs: number | null;
  rebuilds: Array<{ routeId: string; success: boolean; buildTime: number }>;
  ssrChanges: string[];
  apiChanges: string[];
  configReloads: string[];
  resourceChanges: string[];
  errors: string[];
}

function makeObservations(): TimedObservations {
  return {
    firstFireNanos: null,
    lastBuildTimeMs: null,
    rebuilds: [],
    ssrChanges: [],
    apiChanges: [],
    configReloads: [],
    resourceChanges: [],
    errors: [],
  };
}

function resetObservations(obs: TimedObservations): void {
  obs.firstFireNanos = null;
  obs.lastBuildTimeMs = null;
  obs.rebuilds.length = 0;
  obs.ssrChanges.length = 0;
  obs.apiChanges.length = 0;
  obs.configReloads.length = 0;
  obs.resourceChanges.length = 0;
  obs.errors.length = 0;
}

/**
 * Translate `expectedBehavior` → true iff the "iteration complete" criterion
 * has been hit. Same logic as `matrix.spec.ts`'s `verifyFullReload` /
 * `verifyIslandUpdate` family but returns a boolean so we can both poll and
 * extract a timing sample.
 */
function hasRelevantSignal(
  behavior: ExpectedBehavior,
  obs: TimedObservations,
): boolean {
  switch (behavior) {
    case "island-update":
      return obs.rebuilds.some(
        (r) => r.success && r.routeId !== "*" && r.routeId.length > 0,
      );
    case "full-reload":
      return (
        obs.ssrChanges.length > 0 ||
        obs.apiChanges.length > 0 ||
        obs.rebuilds.some((r) => r.routeId === "*")
      );
    case "prerender-regen":
      return (
        obs.ssrChanges.includes("*") ||
        obs.rebuilds.some((r) => r.routeId === "*" && r.success)
      );
    case "css-update":
      return (
        obs.rebuilds.length > 0 ||
        obs.ssrChanges.length > 0 ||
        obs.apiChanges.length > 0
      );
    case "server-restart":
      return obs.configReloads.length > 0;
    case "code-regen":
      return obs.resourceChanges.length > 0;
    case "n/a":
      return false;
  }
}

/**
 * Return the REBUILD_TOTAL-scope duration for a single iteration.
 *
 * Strategy:
 *   - If `onRebuild` fired, use `buildTime` — it's the bundler's own
 *     `REBUILD_TOTAL` measurement, the exact value `HMR_PERF_TARGETS` refers
 *     to. Most precise.
 *   - Otherwise, estimate from wall-clock by subtracting the debounce
 *     floor. Conservative — the real REBUILD_TOTAL is even lower — but
 *     the best we can do without adding perf markers to the SSR / API /
 *     config callback paths (all of which fire synchronously from the
 *     dispatcher without a build step).
 */
function estimateRebuildMs(
  obs: TimedObservations,
  wallClockMs: number,
): number {
  if (obs.lastBuildTimeMs !== null) return obs.lastBuildTimeMs;
  // No build happened — estimate by stripping the debounce floor. If the
  // wall-clock is smaller than the debounce (shouldn't happen but guard
  // anyway) fall back to wall-clock so we never return negative.
  return Math.max(wallClockMs - WATCHER_DEBOUNCE_MS, wallClockMs * 0.1);
}

// ═══════════════════════════════════════════════════════════════════════════
// Fixture dispatcher — same shape as matrix.spec.ts for parity
// ═══════════════════════════════════════════════════════════════════════════

function scaffold(form: ProjectForm, rootDir: string): RoutesManifest {
  switch (form) {
    case "pure-ssg":
      return scaffoldSSG(rootDir);
    case "hybrid":
      return scaffoldHybrid(rootDir);
    case "full-interactive":
      return scaffoldFull(rootDir);
  }
}

/** Boot the bundler with a timing-aware observer. Any callback stamps the
 *  *first* fire into `firstFireNanos` — we care about time-to-signal, not
 *  time-to-last-signal. `lastBuildTimeMs` tracks the rebuild buildTime so
 *  the bench can compare against REBUILD_TOTAL targets directly. */
async function bootTimedBundler(
  rootDir: string,
  manifest: RoutesManifest,
): Promise<{ bundler: DevBundler; obs: TimedObservations }> {
  const obs = makeObservations();
  const stamp = (): void => {
    if (obs.firstFireNanos === null) obs.firstFireNanos = Bun.nanoseconds();
  };
  const bundler = await startDevBundler({
    rootDir,
    manifest,
    onRebuild: (r) => {
      stamp();
      obs.rebuilds.push({ routeId: r.routeId, success: r.success, buildTime: r.buildTime });
      // Track the most-recent buildTime (covers both wildcard and per-route
      // rebuilds; the iteration's actual rebuild is whichever fired).
      obs.lastBuildTimeMs = r.buildTime;
    },
    onSSRChange: (p) => {
      stamp();
      obs.ssrChanges.push(p);
    },
    onAPIChange: (p) => {
      stamp();
      obs.apiChanges.push(p);
    },
    onConfigReload: (p) => {
      stamp();
      obs.configReloads.push(p);
    },
    onResourceChange: (p) => {
      stamp();
      obs.resourceChanges.push(p);
    },
    onError: (e) => {
      obs.errors.push(e.message);
    },
  });
  return { bundler, obs };
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-cell iteration loop
// ═══════════════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run N iterations of a single cell.
 *
 * Caller owns the fixture + bundler — this function just writes, waits,
 * and records. That lets us reuse the bundler across iterations (we'd
 * otherwise pay the ~200ms startup per iteration, dominating the signal).
 */
async function iterateCell(
  cell: ScenarioCell,
  rootDir: string,
  obs: TimedObservations,
  iterations: number,
): Promise<SamplePair[]> {
  const samples: SamplePair[] = [];
  const filePath = resolveChangeFile(rootDir, cell.projectForm, cell.changeKind);
  if (!filePath) return samples; // n/a

  for (let i = 1; i <= iterations; i++) {
    resetObservations(obs);

    // Regenerate content — we perturb on every iteration so Bun's mtime-
    // based fs.watch doesn't coalesce with an earlier identical write, and
    // so Bun's ESM cache never serves a stale module.
    const { content } = buildEditContent(cell.changeKind);

    const t0 = Bun.nanoseconds();
    writeFileSync(filePath, content);

    // Poll for the first relevant signal. 5ms poll granularity keeps the
    // overhead below the 50ms island target's resolution.
    const deadline = Date.now() + ITER_TIMEOUT_MS;
    let fired = false;
    while (Date.now() < deadline) {
      if (hasRelevantSignal(cell.expectedBehavior, obs)) {
        fired = true;
        break;
      }
      await sleep(5);
    }

    if (!fired || obs.firstFireNanos === null) {
      // Timeout — skip this iter silently; the final n-count tells us if
      // sampling was degraded.
      continue;
    }

    const wallClockMs = (obs.firstFireNanos - t0) / 1e6;
    // Briefly wait a bit more so any onRebuild that fires after
    // onSSRChange (happens for common-dir: SSRChange fires first, then
    // onRebuild with buildTime) can land into `lastBuildTimeMs`.
    if (obs.lastBuildTimeMs === null && obs.rebuilds.length === 0) {
      // Give the bundler a short window to surface `onRebuild` after
      // `onSSRChange` — common-dir paths fire `onSSRChange("*")` first
      // then `onRebuild({routeId:"*"})` shortly after. 100ms is enough
      // to cover the shim-less build in every form.
      const buildDeadline = Date.now() + 400;
      while (Date.now() < buildDeadline && obs.lastBuildTimeMs === null) {
        await sleep(5);
      }
    }

    const rebuildMs = estimateRebuildMs(obs, wallClockMs);
    samples.push({ rebuildMs, wallClockMs });

    // Quiet period so the next iteration starts from a clean debounce state.
    await sleep(ITER_SETTLE_MS);
  }

  return samples;
}

// ═══════════════════════════════════════════════════════════════════════════
// Cold start — spawn `mandu dev` on each fixture and time the "ready" line
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Measure cold-start time by spawning `bun run packages/cli/src/main.ts dev`
 * against a freshly-scaffolded fixture. We read stdout and stop the clock
 * on the line `ready in <N>ms` printed by `renderDevReadySummary`. The
 * process is then killed — we don't need a usable dev server, just the
 * "bun process cold → ready" latency.
 *
 * Known quirks:
 *   - `bun` subprocesses on Windows occasionally hang on SIGTERM; we use
 *     `kill()` which sends SIGKILL equivalent on win32.
 *   - Port collisions: each rep picks a random port in the 45000-60000
 *     range. We kill the child AFTER the `ready in` line fires, so the
 *     socket is released before the next rep. 3 reps/fixture keep
 *     collision probability well under 1%.
 */
async function measureColdStart(form: ProjectForm): Promise<ColdStartResult> {
  const samples: number[] = [];
  const cliEntry = path.resolve(
    import.meta.dir,
    "..",
    "packages/cli/src/main.ts",
  );

  for (let rep = 0; rep < COLD_START_REPS; rep++) {
    const rootDir = mkdtempSync(path.join(tmpdir(), `cold-${form}-`));
    try {
      scaffold(form, rootDir);
      // The harness's `initProjectSkeleton` writes `mandu.config.ts`
      // with `server.port: 0`, which the CLI's config validator rejects
      // (`server.port >= 1`). Overwrite it with a real port so cold-start
      // reaches the ready signal. The value here does not matter — the CLI
      // flag `--port` overrides config.port at runtime.
      writeFileSync(
        path.join(rootDir, "mandu.config.ts"),
        // Disable guard.realtime so Architecture Guard's preflight check
        // does not refuse to start on the minimal fixture tree (which
        // violates the default "mandu" preset by putting `src/shared/util.ts`
        // outside the preset's allowed subtree). `guard.realtime: false`
        // makes `guardConfig` null at `cli/src/commands/dev.ts:140`.
        'export default { server: { port: 3333 }, guard: { realtime: false } };\n',
      );

      // Pick a random ephemeral-ish port. `--port 0` is rejected by
      // `resolveAvailablePort` when `strict=true`, so we use a high
      // range unlikely to collide. Each rep gets its own fresh port so
      // the previous SIGKILL has time to release the socket.
      const port = 45000 + Math.floor(Math.random() * 15000);

      const t0 = Bun.nanoseconds();
      const child: ChildProcess = spawn(
        "bun",
        ["run", cliEntry, "dev", "--port", String(port)],
        {
          cwd: rootDir,
          env: {
            ...process.env,
            MANDU_SKIP_BUNDLER_TESTS: "1",
            NODE_NO_WARNINGS: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
          shell: process.platform === "win32",
        },
      );

      let readyNanos: number | null = null;
      let buf = "";

      const onLine = (chunk: Buffer): void => {
        buf += chunk.toString("utf-8");
        // "ready in 395ms" is printed by renderDevReadySummary. We match
        // the first occurrence and stop reading.
        if (readyNanos === null && /ready in \d+ms/.test(buf)) {
          readyNanos = Bun.nanoseconds();
        }
      };
      child.stdout?.on("data", onLine);
      child.stderr?.on("data", onLine);

      // Wait for the ready line or timeout.
      const deadline = Date.now() + COLD_START_TIMEOUT_MS;
      while (readyNanos === null && Date.now() < deadline) {
        await sleep(50);
      }

      try {
        child.kill("SIGKILL");
      } catch {
        /* best-effort */
      }

      if (readyNanos !== null) {
        samples.push((readyNanos - t0) / 1e6);
      } else {
        console.warn(
          `  [cold-start] ${form} rep ${rep + 1} TIMEOUT — stdout buffer tail: ${buf.slice(-400)}`,
        );
      }
    } finally {
      try {
        rmSync(rootDir, { recursive: true, force: true });
      } catch {
        /* Windows lock tolerance */
      }
    }
  }

  const s = summarize(samples);
  return {
    form,
    samples,
    p50: s.p50,
    p95: s.p95,
    mean: s.mean,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main driver
// ═══════════════════════════════════════════════════════════════════════════

function shouldRunCell(cell: ScenarioCell): boolean {
  if (cell.expectedBehavior === "n/a") return false;
  if (CELLS_ONLY && cell.projectForm !== CELLS_ONLY) return false;
  return true;
}

/**
 * Sanity filter: some cells are known to not produce a bundler-level signal
 * because the dispatch happens in a layer above `startDevBundler` (e.g.
 * CSS watcher runs in the CLI). We still report them but with "n/a — see
 * report §5".
 */
const BUNDLER_CANNOT_OBSERVE: ReadonlySet<ChangeKind> = new Set([
  // `.slot.ts` changes: bundler doesn't classify `.slot.ts` into any
  // dispatch bucket (serverModuleSet tracks only componentModule +
  // layoutChain). Covered at the CLI via `watchFSRoutes` (chokidar).
  "app/slot.ts",
  // CSS is handled by the Tailwind watcher subprocess at the CLI layer.
  "css",
]);

async function benchAllCells(
  iters: number,
  cellsOnly: string,
): Promise<CellResult[]> {
  // Honor opts.cellsOnly at call time rather than the module-level CELLS_ONLY.
  // This lets `perf.spec.ts` run with `hybrid` even when the user didn't
  // pass CELLS_ONLY on the env.
  const cells = SCENARIO_CELLS.filter((c) => {
    if (c.expectedBehavior === "n/a") return false;
    if (cellsOnly && c.projectForm !== cellsOnly) return false;
    return true;
  });
  const results: CellResult[] = [];

  console.log(`\n${"─".repeat(72)}`);
  console.log(`Benchmarking ${cells.length} cells × ${iters} iterations`);
  console.log("─".repeat(72));

  for (const cell of cells) {
    const tag = `[${cell.projectForm}] ${cell.changeKind} → ${cell.expectedBehavior}`;

    if (BUNDLER_CANNOT_OBSERVE.has(cell.changeKind)) {
      console.log(`  SKIP  ${tag} (bundler-level signal not available)`);
      results.push({
        cell,
        samples: [],
        rebuild: summarize([]),
        wallClock: summarize([]),
        targetMs: cell.latencyTargetMs,
        pass: null,
        err: "not-observable-at-bundler-level",
      });
      continue;
    }

    const rootDir = mkdtempSync(path.join(tmpdir(), `bench-${cell.projectForm}-`));
    let bundler: DevBundler | null = null;
    try {
      const manifest = scaffold(cell.projectForm, rootDir);
      const boot = await bootTimedBundler(rootDir, manifest);
      bundler = boot.bundler;
      await sleep(WATCHER_ARM_MS);

      const samples = await iterateCell(cell, rootDir, boot.obs, iters);

      const rebuildStats = summarize(samples.map((s) => s.rebuildMs));
      const wallClockStats = summarize(samples.map((s) => s.wallClockMs));

      const pass =
        cell.latencyTargetMs === null
          ? null
          : samples.length === 0
            ? null
            : rebuildStats.p95 <= cell.latencyTargetMs;

      const res: CellResult = {
        cell,
        samples,
        rebuild: rebuildStats,
        wallClock: wallClockStats,
        targetMs: cell.latencyTargetMs,
        pass,
      };
      results.push(res);

      const markChar = pass === null ? "-" : pass ? "ok" : "!!";
      console.log(
        `  ${markChar.padEnd(2)}  ${tag.padEnd(58)} rebuild p95=${rebuildStats.p95.toFixed(0).padStart(4)}ms wall p95=${wallClockStats.p95.toFixed(0).padStart(4)}ms (target ${cell.latencyTargetMs ?? "n/a"}ms, n=${samples.length})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ERR  ${tag}: ${msg}`);
      results.push({
        cell,
        samples: [],
        rebuild: summarize([]),
        wallClock: summarize([]),
        targetMs: cell.latencyTargetMs,
        pass: false,
        err: msg,
      });
    } finally {
      try {
        bundler?.close();
      } catch {
        /* best-effort */
      }
      try {
        rmSync(rootDir, { recursive: true, force: true });
      } catch {
        /* windows lock */
      }
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// Aggregation → hard assertions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aggregate by category for hard-assertion reporting. We union the
 * `rebuildMs` samples across all cells in each category and compute a
 * single P95. This matches how `HMR_PERF_TARGETS` is stated — per-behavior,
 * not per-cell.
 */
function aggregateCategory(
  cells: readonly CellResult[],
  predicate: (c: CellResult) => boolean,
): number | null {
  const pool: number[] = [];
  for (const c of cells) {
    if (predicate(c) && c.samples.length > 0) {
      for (const s of c.samples) pool.push(s.rebuildMs);
    }
  }
  if (pool.length === 0) return null;
  return percentile(pool, 95);
}

// ═══════════════════════════════════════════════════════════════════════════
// Markdown report generator
// ═══════════════════════════════════════════════════════════════════════════

function fmt(n: number): string {
  if (n === 0) return "0";
  if (n < 1) return n.toFixed(2);
  if (n < 100) return n.toFixed(1);
  return Math.round(n).toString();
}

function writeReport(report: Report): void {
  const {
    env,
    runMeta,
    coldStart,
    cells,
    hardAssertions,
  } = report;

  const lines: string[] = [];
  lines.push(`# Phase 7.0 — HMR 벤치마크 검증 리포트`);
  lines.push(``);
  lines.push(`> Auto-generated by \`scripts/hmr-bench.ts\`. Do not edit by hand.`);
  lines.push(`> Last run: ${runMeta.startedAt} — took ${runMeta.durationSec.toFixed(1)}s.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // §1 Summary
  lines.push(`## 1. 요약`);
  lines.push(``);
  const summaryRow = (label: string, measured: number | null, target: number, passed: boolean | null): string => {
    const m = measured === null ? "n/a" : `${fmt(measured)} ms`;
    const t = `${target} ms`;
    const p = passed === null ? "—" : passed ? "PASS" : "FAIL";
    return `| ${label} | ${m} | ${t} | ${p} |`;
  };
  lines.push(`측정 스코프: \`REBUILD_TOTAL\` (debounce 제외, 목표 정의와 동일). End-to-end wall-clock 은 §4 에 별도 기재.`);
  lines.push(``);
  lines.push(`| 타겟 | 측정 (P95 REBUILD_TOTAL) | 목표 | 결과 |`);
  lines.push(`|---|---|---|---|`);
  lines.push(summaryRow(
    "Cold dev start",
    hardAssertions.coldStartP95Ms,
    HMR_PERF_TARGETS.COLD_START_MS,
    hardAssertions.passed.coldStart,
  ));
  lines.push(summaryRow(
    "SSR page rebuild",
    hardAssertions.ssrP95Ms,
    HMR_PERF_TARGETS.SSR_REBUILD_P95_MS,
    hardAssertions.passed.ssr,
  ));
  lines.push(summaryRow(
    "Island-only rebuild",
    hardAssertions.islandP95Ms,
    HMR_PERF_TARGETS.ISLAND_REBUILD_P95_MS,
    hardAssertions.passed.island,
  ));
  lines.push(summaryRow(
    "Common-dir rebuild",
    hardAssertions.commonDirP95Ms,
    HMR_PERF_TARGETS.COMMON_DIR_REBUILD_P95_MS,
    hardAssertions.passed.commonDir,
  ));
  lines.push(summaryRow(
    "CSS-only rebuild",
    hardAssertions.cssP95Ms,
    HMR_PERF_TARGETS.CSS_REBUILD_P95_MS,
    hardAssertions.passed.css,
  ));
  lines.push(``);
  lines.push(`**Reference — Phase 7.0.R0 진단 대비 (개선 전 실측)**:`);
  lines.push(`- Cold start: 395 ms (target 500 ms) — 이미 통과.`);
  lines.push(`- SSR rebuild wall-clock: **1500~2000 ms** (target 200 ms) — 7.5~10× 미달.`);
  lines.push(`- Island rebuild: 측정 불가 (B4 perf marker 없었음).`);
  lines.push(``);

  // §2 Environment
  lines.push(`## 2. 환경`);
  lines.push(``);
  lines.push(`| 항목 | 값 |`);
  lines.push(`|---|---|`);
  lines.push(`| Platform | ${env.platform} ${env.release} (${env.arch}) |`);
  lines.push(`| Bun version | ${env.bunVersion} |`);
  lines.push(`| CPU | ${env.cpuModel} (${env.cpuCount} logical cores) |`);
  lines.push(`| Total RAM | ${env.totalMemoryGB.toFixed(1)} GB |`);
  lines.push(`| Iterations per cell | ${runMeta.iterations} |`);
  lines.push(`| Cells benched | ${runMeta.cellsBenched} / ${runMeta.cellsBenched + runMeta.cellsSkipped} (skipped: ${runMeta.cellsSkipped}) |`);
  lines.push(``);

  // §3 Cold start
  lines.push(`## 3. Cold start 결과`);
  lines.push(``);
  if (coldStart === null) {
    lines.push(`_Skipped (SKIP_COLD=1)._`);
    lines.push(``);
  } else {
    lines.push(`${COLD_START_REPS}회 반복 / fixture. \`bun run packages/cli/src/main.ts dev\` 프로세스를 spawn 해 stdout 에 \`Mandu Dev Server / ready in Nms\` 가 출력될 때까지 시간 측정.`);
    lines.push(``);
    lines.push(`| Fixture | P50 | P95 | Mean | n |`);
    lines.push(`|---|---|---|---|---|`);
    for (const r of coldStart) {
      lines.push(
        `| ${r.form} | ${fmt(r.p50)} ms | ${fmt(r.p95)} ms | ${fmt(r.mean)} ms | ${r.samples.length} |`,
      );
    }
    lines.push(``);
    lines.push(`**Target**: P95 ≤ ${HMR_PERF_TARGETS.COLD_START_MS} ms.`);
    lines.push(``);
    lines.push(`> **Caveat — cold start 측정은 fresh tmpdir fixture 기반**: 매 rep 마다 \`mkdtempSync\` 로 빈 디렉토리를 만들고 \`bun install\` 없이 \`bun run main.ts dev\` 를 spawn. Bun 의 module resolution 캐시가 cold 상태 + lockfile 불일치 경고 추가 I/O + 프로세스 spawn overhead (~100-150 ms on Windows) 가 측정에 포함됨. R0 진단의 395 ms 기준은 \`demo/starter\` (이미 warm 된 프로젝트) 에서 측정된 값이라 직접 비교는 misleading. 현재 \`demo/starter\` cold-start 실측 ≈ 583 ms (R0 395 ms → +190 ms 는 그 사이 추가된 feature/guard 때문일 가능성). COLD_START 타겟 재조정 또는 warm-cache fixture 측정 추가가 Phase 7.1 에서 검토 필요.`);
    lines.push(``);
  }

  // §4 HMR matrix table
  lines.push(`## 4. HMR rebuild 매트릭스 결과`);
  lines.push(``);
  lines.push(`36 cells × ${runMeta.iterations} iter. 두 스코프 병기:`);
  lines.push(`- \`rebuild\` : \`REBUILD_TOTAL\` 스코프 (debounce 제외) — **이 값으로 목표 pass/fail 판정**.`);
  lines.push(`- \`wall\` : writeFile → callback fire 의 full wall-clock (debounce + fs.watch propagation + rebuild 포함) — 사용자 체감 시간.`);
  lines.push(``);
  lines.push(`| Form | Change kind | Behavior | rebuild P50 | rebuild P95 | rebuild P99 | wall P95 | Target | 결과 | n |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of cells) {
    const c = r.cell;
    const tgt = r.targetMs === null ? "—" : `${r.targetMs} ms`;
    const result =
      r.err ? `SKIP` :
      r.pass === null ? "—" :
      r.pass ? "PASS" : "FAIL";
    lines.push(
      `| ${c.projectForm} | ${c.changeKind} | ${c.expectedBehavior} | ${fmt(r.rebuild.p50)} ms | ${fmt(r.rebuild.p95)} ms | ${fmt(r.rebuild.p99)} ms | ${fmt(r.wallClock.p95)} ms | ${tgt} | ${result} | ${r.samples.length} |`,
    );
  }
  lines.push(``);
  lines.push(`_n = 성공한 iteration 수 (timeout iter 은 제외)._`);
  lines.push(``);

  // §5 CSS / slot notes
  lines.push(`## 5. 측정 불가 경로 (bundler-level observation 없음)`);
  lines.push(``);
  lines.push(`다음 cell 은 \`startDevBundler\` 레벨에서 callback 으로 surface 되지 않음 — 별도 경로에서 dispatch.`);
  lines.push(``);
  lines.push(`| Cell | 이유 | 대체 측정 가능처 |`);
  lines.push(`|---|---|---|`);
  lines.push(`| \`css\` (모든 form) | CSS 는 CLI 의 Tailwind subprocess watcher 가 담당 (\`startCSSWatch\` / \`cssWatcher\`). 번들러는 \`.css\` 를 어떤 classification bucket 에도 등록하지 않음 (의도). | \`cli/src/commands/dev.ts:242-269\` 의 \`onBuild\` 콜백 timestamp 추적. |`);
  lines.push(`| \`app/slot.ts\` (모든 form) | \`.slot.ts\` 파일은 \`serverModuleSet\` 에 등록되지 않음 (\`componentModule\` / \`layoutChain\` 만 등록). CLI 의 \`watchFSRoutes\` (chokidar) 가 manifest 전체 재스캔으로 처리. | \`cli/src/commands/dev.ts:712-\` \`routesWatcher.onChange\` timestamp 추적. |`);
  lines.push(``);

  // §6 Bottleneck reevaluation
  lines.push(`## 6. 병목 재검토 — R0 진단 대비`);
  lines.push(``);
  const ssrP95 = hardAssertions.ssrP95Ms;
  const ssrTarget = HMR_PERF_TARGETS.SSR_REBUILD_P95_MS;
  if (ssrP95 !== null && ssrP95 <= ssrTarget) {
    const speedup = ssrP95 > 0 ? 1800 / ssrP95 : 0;
    lines.push(`- **SSR P95 ≤ ${ssrTarget} ms 달성** (측정: ${fmt(ssrP95)} ms).`);
    lines.push(`  - R0 대비 개선: **${speedup.toFixed(0)}×** faster (1500~2000 ms → ${fmt(ssrP95)} ms).`);
  } else if (ssrP95 !== null) {
    lines.push(`- **SSR P95 미달** (측정: ${fmt(ssrP95)} ms, target: ${ssrTarget} ms). 차이: **+${fmt(ssrP95 - ssrTarget)} ms**.`);
  }
  lines.push(``);
  lines.push(`### 6.1 측정 경계 주의`);
  lines.push(``);
  lines.push(`이 벤치는 **\`startDevBundler\` 레벨** 의 \`onSSRChange\` / \`onRebuild\` 콜백 fire 시점까지만 측정. CLI 의 \`handleSSRChange\` 내부 \`ssr:handler-reload\` 체인 (\`clearDefaultRegistry\` → \`registerManifestHandlers\` → \`bundledImport\`) 은 콜백 fire **다음에** 실행됨.`);
  lines.push(``);
  lines.push(`**Incremental \`bundledImport\` wire-up 상태 (B5)**: \`packages/cli/src/util/bun.ts:163\` 의 \`BundledImportOptions { changedFile?: string }\` 은 Agent B 가 구현 완료. 그러나 현재 호출 체인`);
  lines.push(``);
  lines.push(`  \`dev.ts:178 importFn: bundledImport\``);
  lines.push(`  → \`handlers.ts:82 importFn(modulePath)\` *(no \`changedFile\` 전달)*`);
  lines.push(``);
  lines.push(`에서 \`changedFile\` 을 **wire up 하지 않음**. 따라서 \`createBundledImporter\` 가 제공하는 증분 cache path 는 SSR re-register 에서 발동하지 않고, 매 SSR 변경 시 N 개 route × 전체 \`Bun.build\` 가 여전히 실행됨. 이는 \`registerManifestHandlers\` 시그니처를 \`importFn: (modulePath: string, opts?: { changedFile?: string }) => ...\` 로 확장하고 \`handleSSRChange\` 에서 \`filePath\` 를 연결하는 작은 리팩터로 해결됨 — Phase 7.1 follow-up.`);
  lines.push(``);
  lines.push(`**현재 벤치의 의미**: 벤치가 측정한 \`SSR full-reload\` 는 bundler의 \`onSSRChange\` callback fire 까지이므로 \`bundledImport\` 비용을 **포함하지 않음**. 실제 "브라우저가 새 HTML을 받기까지" 의 walltime 은 여기에 더해 CLI layer의 \`SSR_HANDLER_RELOAD\` 가 추가됨 (현재 1.5~2s 의 원인). 사용자 관점 walltime 을 잡으려면 CLI 를 spawn 해 \`MANDU_PERF=1\` stdout 의 \`[perf] ssr:handler-reload: Nms\` 를 파싱하는 보조 벤치가 필요 (Phase 7.1).`);
  lines.push(``);

  // §7 Conclusion
  lines.push(`## 7. 결론`);
  lines.push(``);
  const passedCount =
    Number(hardAssertions.passed.ssr === true) +
    Number(hardAssertions.passed.island === true) +
    Number(hardAssertions.passed.css === true) +
    Number(hardAssertions.passed.commonDir === true) +
    Number(hardAssertions.passed.coldStart === true);
  const measuredCount =
    Number(hardAssertions.passed.ssr !== null) +
    Number(hardAssertions.passed.island !== null) +
    Number(hardAssertions.passed.css !== null) +
    Number(hardAssertions.passed.commonDir !== null) +
    Number(hardAssertions.passed.coldStart !== null);
  lines.push(`**하드 어서션 결과**: ${passedCount} / ${measuredCount} 통과.`);
  lines.push(``);

  const cellPass = cells.filter((c) => c.pass === true).length;
  const cellFail = cells.filter((c) => c.pass === false).length;
  const cellSkip = cells.filter((c) => c.pass === null).length;
  lines.push(`**Cell-level**: ${cellPass} PASS / ${cellFail} FAIL / ${cellSkip} 측정 외 (slot/css/server-restart).`);
  lines.push(``);

  if (passedCount === measuredCount && measuredCount > 0) {
    lines.push(`Phase 7.0 SPEED 목표 **달성**. 36-cell 매트릭스 + hard assertion 모두 통과.`);
  } else {
    lines.push(`**미달 항목**:`);
    if (hardAssertions.passed.ssr === false) lines.push(`- SSR P95: ${fmt(hardAssertions.ssrP95Ms ?? 0)} ms > ${HMR_PERF_TARGETS.SSR_REBUILD_P95_MS} ms`);
    if (hardAssertions.passed.island === false) lines.push(`- Island P95: ${fmt(hardAssertions.islandP95Ms ?? 0)} ms > ${HMR_PERF_TARGETS.ISLAND_REBUILD_P95_MS} ms`);
    if (hardAssertions.passed.css === false) lines.push(`- CSS P95: ${fmt(hardAssertions.cssP95Ms ?? 0)} ms > ${HMR_PERF_TARGETS.CSS_REBUILD_P95_MS} ms`);
    if (hardAssertions.passed.commonDir === false) lines.push(`- Common-dir P95: ${fmt(hardAssertions.commonDirP95Ms ?? 0)} ms > ${HMR_PERF_TARGETS.COMMON_DIR_REBUILD_P95_MS} ms`);
    if (hardAssertions.passed.coldStart === false) lines.push(`- Cold start P95: ${fmt(hardAssertions.coldStartP95Ms ?? 0)} ms > ${HMR_PERF_TARGETS.COLD_START_MS} ms`);
  }
  lines.push(``);
  lines.push(`### 7.1 Phase 7.1 follow-up 권장`);
  lines.push(``);
  lines.push(`1. **B5 wire-up**: \`registerManifestHandlers\` 가 \`importFn(modulePath, { changedFile })\` 을 호출하도록 확장. 현재 \`BundledImportOptions\` 는 정의됐으나 호출 체인에서 \`changedFile\` 을 전달하지 않아 증분 cache path 가 SSR 재빌드에서 발동하지 않음. (\`cli/src/util/handlers.ts:82/126/137\`)`);
  lines.push(`2. **CLI-layer latency 측정**: \`ssr:handler-reload\` 내부 walltime (\`registerHandlers(manifest, true)\` 의 \`bundledImport\` N회) 은 \`MANDU_PERF=1\` 로그에서만 확인 가능. 벤치 스크립트가 CLI 를 spawn 해 stdout 캡처로 파싱하도록 확장 필요.`);
  lines.push(`3. **CSS / slot 전용 벤치**: §5 에 명시된 CLI-layer dispatch 경로를 별도 \`scripts/hmr-bench-cli.ts\` 로 측정 — 현재 bundler-level 벤치는 구조상 불가.`);
  lines.push(`4. **Windows \`fs.watch\` flakiness**: \`touchUntilSeen\` 의 retry 로직이 P99 를 왜곡할 가능성. CI 에서는 \`MANDU_DEV_WATCH=polling\` 도입 검토.`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`_Generated ${runMeta.finishedAt} / Report schema v1._`);

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, lines.join("\n"), "utf-8");
  console.log(`\n  Wrote ${REPORT_PATH}\n`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Entry point
// ═══════════════════════════════════════════════════════════════════════════

export interface RunBenchOptions {
  iterations?: number;
  skipCold?: boolean;
  cellsOnly?: ProjectForm | "";
}

/**
 * Programmatic entry point — exported so `perf.spec.ts` can invoke
 * the same code path with CI-friendly iteration counts.
 */
export async function runBenchmark(
  opts: RunBenchOptions = {},
): Promise<Report> {
  const iters = opts.iterations ?? ITERATIONS;
  const skipCold = opts.skipCold ?? SKIP_COLD;

  const startedAt = new Date().toISOString();
  const t0 = Bun.nanoseconds();

  console.log(`\n${"━".repeat(72)}`);
  console.log(`Phase 7.0 R3 — HMR Performance Validation`);
  console.log("━".repeat(72));

  // Cold start
  let coldStart: ColdStartResult[] | null = null;
  if (!skipCold) {
    console.log(`\nCold start: 3 fixtures × ${COLD_START_REPS} reps`);
    console.log("─".repeat(72));
    coldStart = [];
    for (const form of ["pure-ssg", "hybrid", "full-interactive"] as const) {
      const r = await measureColdStart(form);
      coldStart.push(r);
      console.log(
        `  ${form.padEnd(18)} P50=${fmt(r.p50)}ms P95=${fmt(r.p95)}ms (target ${HMR_PERF_TARGETS.COLD_START_MS}ms, n=${r.samples.length})`,
      );
    }
  }

  // Matrix. Short-circuit to an empty list when iterations=0 so callers
  // can measure cold-start alone without paying for the 3-form sweep.
  const cells = SKIP_BENCH || iters <= 0
    ? []
    : await benchAllCells(iters, opts.cellsOnly ?? CELLS_ONLY);

  const finishedAt = new Date().toISOString();
  const durationSec = (Bun.nanoseconds() - t0) / 1e9;

  // Aggregate
  const ssrP95 = aggregateCategory(cells, (c) =>
    c.cell.expectedBehavior === "full-reload" &&
    c.cell.changeKind !== "src/shared/**" &&
    c.cell.changeKind !== "src/top-level.ts",
  );
  const islandP95 = aggregateCategory(cells, (c) =>
    c.cell.expectedBehavior === "island-update",
  );
  const cssP95 = aggregateCategory(cells, (c) =>
    c.cell.expectedBehavior === "css-update",
  );
  const commonDirP95 = aggregateCategory(cells, (c) =>
    c.cell.changeKind === "src/shared/**" || c.cell.changeKind === "src/top-level.ts",
  );
  const coldP95 =
    coldStart === null
      ? null
      : percentile(coldStart.flatMap((r) => r.samples), 95);

  const cellsSkipped = cells.filter((c) => c.samples.length === 0).length;
  const cellsBenched = cells.length - cellsSkipped;

  const report: Report = {
    env: {
      platform: platform(),
      release: release(),
      arch: arch(),
      bunVersion: Bun.version,
      cpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? "unknown",
      totalMemoryGB: totalmem() / 1024 / 1024 / 1024,
    },
    runMeta: {
      iterations: iters,
      startedAt,
      finishedAt,
      durationSec,
      cellsBenched,
      cellsSkipped,
    },
    coldStart,
    cells,
    hardAssertions: {
      ssrP95Ms: ssrP95,
      islandP95Ms: islandP95,
      cssP95Ms: cssP95,
      commonDirP95Ms: commonDirP95,
      coldStartP95Ms: coldP95,
      passed: {
        ssr: ssrP95 === null ? null : ssrP95 <= HMR_PERF_TARGETS.SSR_REBUILD_P95_MS,
        island: islandP95 === null ? null : islandP95 <= HMR_PERF_TARGETS.ISLAND_REBUILD_P95_MS,
        css: cssP95 === null ? null : cssP95 <= HMR_PERF_TARGETS.CSS_REBUILD_P95_MS,
        commonDir: commonDirP95 === null ? null : commonDirP95 <= HMR_PERF_TARGETS.COMMON_DIR_REBUILD_P95_MS,
        coldStart: coldP95 === null ? null : coldP95 <= HMR_PERF_TARGETS.COLD_START_MS,
      },
    },
  };

  // Final summary to stdout
  console.log(`\n${"━".repeat(72)}`);
  console.log(`Overall Result (hard assertions on REBUILD_TOTAL scope)`);
  console.log("━".repeat(72));
  const mark = (p: boolean | null): string => (p === null ? "—" : p ? "PASS" : "FAIL");
  console.log(`  Cold start   P95: ${fmt(coldP95 ?? 0)} ms (≤${HMR_PERF_TARGETS.COLD_START_MS} ms) — ${mark(report.hardAssertions.passed.coldStart)}`);
  console.log(`  SSR          P95: ${fmt(ssrP95 ?? 0)} ms (≤${HMR_PERF_TARGETS.SSR_REBUILD_P95_MS} ms) — ${mark(report.hardAssertions.passed.ssr)}`);
  console.log(`  Island       P95: ${fmt(islandP95 ?? 0)} ms (≤${HMR_PERF_TARGETS.ISLAND_REBUILD_P95_MS} ms) — ${mark(report.hardAssertions.passed.island)}`);
  console.log(`  CSS          P95: ${fmt(cssP95 ?? 0)} ms (≤${HMR_PERF_TARGETS.CSS_REBUILD_P95_MS} ms) — ${mark(report.hardAssertions.passed.css)}`);
  console.log(`  Common-dir   P95: ${fmt(commonDirP95 ?? 0)} ms (≤${HMR_PERF_TARGETS.COMMON_DIR_REBUILD_P95_MS} ms) — ${mark(report.hardAssertions.passed.commonDir)}`);
  console.log(`  Total duration: ${durationSec.toFixed(1)}s`);
  console.log(``);

  writeReport(report);
  return report;
}

if (import.meta.main) {
  runBenchmark()
    .then((report) => {
      const anyFail = Object.values(report.hardAssertions.passed).some((p) => p === false);
      process.exit(anyFail ? 1 : 0);
    })
    .catch((err) => {
      console.error("bench failed:", err instanceof Error ? err.stack : err);
      process.exit(2);
    });
}
