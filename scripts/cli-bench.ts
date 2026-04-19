/**
 * Phase 7.2.S3 — CLI-layer latency bench (Agent A).
 *
 * # Why this exists
 *
 * `scripts/hmr-bench.ts` measures the bundler's file → callback chain
 * by driving `startDevBundler` directly in-process. That's the right call
 * for per-cell rebuild measurements, but it bypasses:
 *
 *   - Bun process spawn + module resolution
 *   - `validateAndReport` → env load → lockfile check → route scan
 *   - `createBundledImporter` factory + handler registration
 *   - `Bun.serve` main/HMR server startup
 *   - DevTools + Fast Refresh vendor shim builds
 *
 * Those are EXACTLY what dominates cold dev start (Phase 7.1 bench §4
 * attributed 910 ms P95 to this full chain). The CLI-layer bench spawns
 * `mandu dev` as a subprocess, pipes stdout, and times the "ready in
 * <N>ms" log line — giving us honest walltime from user perspective.
 *
 * # What this script measures
 *
 * Two modes, both running `N` iterations on `demo/starter` (or a fixture
 * from CLI flag `--fixture`):
 *
 *   1. **Cold** — first iteration only. `.mandu/vendor-cache` is wiped
 *      before spawn. This represents "fresh clone + first dev start".
 *
 *   2. **Warm** — remaining iterations. `.mandu/vendor-cache` from the
 *      cold iter is preserved; Tier 2 cache hit should fire.
 *
 * Results reported as P50 / P95 / P99 per mode plus raw samples.
 *
 * Optional: `--perf` sets `MANDU_PERF=1` in the spawned env so each boot:*
 * perf marker is logged. We re-emit the parsed markers per-iteration for
 * Agent D's follow-up bench analysis.
 *
 * # Usage
 *
 *   bun run scripts/cli-bench.ts                         # 10 iter, demo/starter
 *   ITERATIONS=20 bun run scripts/cli-bench.ts           # custom sample size
 *   FIXTURE_DIR=/path/to/app bun run scripts/cli-bench.ts
 *   MANDU_PERF=1 bun run scripts/cli-bench.ts --perf     # dump per-iter markers
 *
 * Bail conditions:
 *   - Ready not emitted within 30 s → timeout error, skip iter.
 *   - SIGKILL if the child doesn't respond to SIGTERM within 5 s.
 */

import { spawn, ChildProcess } from "node:child_process";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

// ═══════════════════════════════════════════════════════════════════════
// Knobs
// ═══════════════════════════════════════════════════════════════════════

const ITERATIONS = Number(process.env.ITERATIONS ?? "10");
const READY_TIMEOUT_MS = 30_000;
/** Minimum wait between kills so TIME_WAIT doesn't collide. */
const BETWEEN_ITERS_MS = 400;
/** Sampling window for stdout polling. */
const POLL_MS = 50;
/** How long to wait for SIGTERM before escalating to SIGKILL. */
const TERM_GRACE_MS = 5_000;

const FIXTURE_DIR =
  process.env.FIXTURE_DIR ??
  path.resolve(import.meta.dir, "..", "demo/starter");

const CLI_ENTRY = path.resolve(
  import.meta.dir,
  "..",
  "packages/cli/src/main.ts",
);

const PERF_MODE =
  process.argv.includes("--perf") || process.env.MANDU_PERF === "1";

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

interface IterResult {
  readyMs: number | null;
  reportedMs: number | null;
  perfLines: string[];
  timedOut: boolean;
  port: number;
  idx: number;
  mode: "cold" | "warm";
}

interface Stats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Pct(samples, p) with linear interp. `samples` must be pre-sorted.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const w = rank - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function summarize(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: samples.reduce((a, b) => a + b, 0) / (samples.length || 1),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

/** Wipe `.mandu/vendor-cache/` under the fixture — use between cold reps. */
function wipeVendorCache(fixtureDir: string): void {
  const cachePath = path.join(fixtureDir, ".mandu", "vendor-cache");
  try {
    rmSync(cachePath, { recursive: true, force: true });
  } catch {
    // Ignore — dir may not exist on fresh fixtures.
  }
}

/**
 * Make sure the fixture has a runnable `mandu.config.ts`. The bench only
 * reads/writes the config when it's missing, so users who've customized
 * their `demo/starter` won't see surprising overwrites.
 */
function ensureConfig(fixtureDir: string): void {
  const cfg = path.join(fixtureDir, "mandu.config.ts");
  if (!existsSync(cfg)) {
    writeFileSync(
      cfg,
      'export default { server: { port: 3333 }, guard: { realtime: false } };\n',
    );
  }
}

/**
 * Spawn `mandu dev --port <port>` and wait for "ready in <N>ms" in stdout.
 * Returns the walltime observed by this script, the `<N>` value that
 * Mandu itself reported, any `[perf]` lines if MANDU_PERF=1, and a
 * `timedOut` flag for caller aggregation.
 */
async function runIter(idx: number, mode: "cold" | "warm"): Promise<IterResult> {
  // Random ephemeral port keeps iterations independent of each other.
  const port = 45000 + Math.floor(Math.random() * 15000);
  let readyAt: number | null = null;
  let reportedMs: number | null = null;
  const perfLines: string[] = [];

  const child: ChildProcess = spawn(
    "bun",
    ["run", CLI_ENTRY, "dev", "--port", String(port)],
    {
      cwd: FIXTURE_DIR,
      env: {
        ...process.env,
        MANDU_PERF: PERF_MODE ? "1" : process.env.MANDU_PERF ?? "",
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    },
  );

  const t0 = Bun.nanoseconds();
  let buf = "";

  const handle = (chunk: Buffer): void => {
    const text = chunk.toString("utf-8");
    buf += text;

    if (readyAt === null) {
      // `renderDevReadySummary` emits "ready in <N>ms"; match once.
      const m = buf.match(/ready in (\d+)ms/);
      if (m) {
        readyAt = Bun.nanoseconds();
        reportedMs = Number(m[1]);
      }
    }

    if (PERF_MODE) {
      for (const line of text.split("\n")) {
        if (line.startsWith("[perf]")) perfLines.push(line);
      }
    }
  };
  child.stdout?.on("data", handle);
  child.stderr?.on("data", handle);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (readyAt === null && Date.now() < deadline) {
    if (child.exitCode !== null) break;
    await sleep(POLL_MS);
  }

  const timedOut = readyAt === null;

  // Cleanup — SIGTERM, escalate to SIGKILL after grace.
  try {
    child.kill("SIGTERM");
  } catch {
    // process may have already exited
  }

  // Wait for child to exit before escalating.
  const termDeadline = Date.now() + TERM_GRACE_MS;
  while (child.exitCode === null && Date.now() < termDeadline) {
    await sleep(POLL_MS);
  }

  if (child.exitCode === null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // terminal state anyway
    }
  }

  return {
    readyMs: readyAt !== null ? (readyAt - t0) / 1e6 : null,
    reportedMs,
    perfLines,
    timedOut,
    port,
    idx,
    mode,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Report formatting
// ═══════════════════════════════════════════════════════════════════════

function fmtStats(label: string, stats: Stats): string {
  return (
    `${label}:\n` +
    `  count=${stats.count}  ` +
    `P50=${stats.p50.toFixed(1)}ms  ` +
    `P95=${stats.p95.toFixed(1)}ms  ` +
    `P99=${stats.p99.toFixed(1)}ms  ` +
    `mean=${stats.mean.toFixed(1)}ms  ` +
    `min=${stats.min.toFixed(1)}ms  ` +
    `max=${stats.max.toFixed(1)}ms`
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  // Sanity — fixture must be a real project.
  if (!existsSync(path.join(FIXTURE_DIR, "package.json"))) {
    console.error(`[cli-bench] FIXTURE_DIR is not a project: ${FIXTURE_DIR}`);
    process.exit(1);
  }
  ensureConfig(FIXTURE_DIR);

  console.log(`[cli-bench] fixture: ${FIXTURE_DIR}`);
  console.log(`[cli-bench] cli:     ${CLI_ENTRY}`);
  console.log(`[cli-bench] iter:    ${ITERATIONS}`);
  console.log(`[cli-bench] perf:    ${PERF_MODE ? "on" : "off"}`);
  console.log();

  // Cold: wipe cache, run 1 iter. Warm: leave cache, run remaining iters.
  wipeVendorCache(FIXTURE_DIR);
  console.log("[cli-bench] cold (cache wiped)…");
  const coldResult = await runIter(0, "cold");
  logIter(coldResult);

  await sleep(BETWEEN_ITERS_MS);

  const warmResults: IterResult[] = [];
  for (let i = 1; i < ITERATIONS; i++) {
    console.log(`[cli-bench] warm iter ${i}/${ITERATIONS - 1}…`);
    const r = await runIter(i, "warm");
    warmResults.push(r);
    logIter(r);
    await sleep(BETWEEN_ITERS_MS);
  }

  // Aggregate.
  const coldSamples: number[] = coldResult.readyMs !== null ? [coldResult.readyMs] : [];
  const warmSamples = warmResults
    .map((r) => r.readyMs)
    .filter((x): x is number => x !== null);

  console.log();
  console.log("─── Results ──────────────────────────────────────────────");
  if (coldSamples.length > 0) {
    console.log(
      `Cold (1 sample): ${coldSamples[0]!.toFixed(1)}ms (reported by CLI: ${coldResult.reportedMs}ms)`,
    );
  } else {
    console.log("Cold: TIMEOUT");
  }

  console.log();
  if (warmSamples.length === 0) {
    console.log("Warm: no successful iterations");
  } else {
    console.log(fmtStats("Warm (walltime)", summarize(warmSamples)));
    const reported = warmResults
      .map((r) => r.reportedMs)
      .filter((x): x is number => x !== null);
    if (reported.length > 0) {
      console.log(fmtStats("Warm (CLI-reported)", summarize(reported)));
    }
  }

  const timeouts = warmResults.filter((r) => r.timedOut).length;
  if (timeouts > 0 || coldResult.timedOut) {
    console.warn(
      `\n[cli-bench] ${timeouts + (coldResult.timedOut ? 1 : 0)} / ${ITERATIONS} iterations timed out`,
    );
  }

  if (PERF_MODE && warmResults.length > 0) {
    console.log("\n─── Per-iter perf markers (first warm iter) ───");
    for (const line of warmResults[0]!.perfLines) {
      console.log(`  ${line}`);
    }
  }

  // Write a JSON artifact for later analysis.
  const outDir = path.resolve(import.meta.dir, "..", "docs/bun");
  try {
    mkdirSync(outDir, { recursive: true });
  } catch {
    // already exists
  }
  const outFile = path.join(outDir, "phase-7-2-cli-bench-results.json");
  try {
    writeFileSync(
      outFile,
      JSON.stringify(
        {
          startedAt: new Date().toISOString(),
          fixture: FIXTURE_DIR,
          iterations: ITERATIONS,
          perfMode: PERF_MODE,
          cold: coldResult,
          warm: warmResults,
          warmStats: warmSamples.length > 0 ? summarize(warmSamples) : null,
        },
        null,
        2,
      ),
    );
    console.log(`\n[cli-bench] results written to ${outFile}`);
  } catch (err) {
    console.warn(
      `[cli-bench] failed to write results artifact: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function logIter(r: IterResult): void {
  if (r.timedOut || r.readyMs === null) {
    console.log(`  [${r.mode}#${r.idx}] TIMEOUT (port ${r.port})`);
    return;
  }
  const delta = r.reportedMs !== null ? `(CLI: ${r.reportedMs}ms)` : "";
  console.log(
    `  [${r.mode}#${r.idx}] ready=${r.readyMs.toFixed(1)}ms ${delta} (port ${r.port})`,
  );
}

main()
  .then(() => {
    // Clean exit — without this, leftover stream listeners can keep the
    // event loop alive until the Node GC reaps them, which on Windows
    // can be tens of seconds.
    process.exit(0);
  })
  .catch((err) => {
    console.error("[cli-bench] fatal:", err);
    process.exit(1);
  });
