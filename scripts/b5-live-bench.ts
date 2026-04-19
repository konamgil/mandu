/**
 * Phase 7.2.R2 D — B5 live HIT end-to-end bench.
 *
 * # Why this exists
 *
 * `cli-bench.ts` measures cold+warm dev boot walltime. `hmr-bench.ts`
 * measures per-cell rebuild time in-process (via `startDevBundler`). Neither
 * exercises the B5 (`incr:cache-hit` / `incr:cache-miss`) path on a real,
 * live `mandu dev` subprocess — exactly the path the Phase 7.1 R2 D report
 * flagged as "not wired" (since revalidated as stale by A).
 *
 * This script:
 *   1. Spawns `mandu dev` on `demo/starter` with `MANDU_PERF=1`.
 *   2. Waits for "ready in …ms".
 *   3. Edits three different file categories N times each, pausing between
 *      edits long enough to clear the watcher debounce:
 *        a. single SSR file (`app/page.tsx`) — triggers `handleSSRChange`
 *           with `ssr:handler-reload` wrapping; we measure that marker.
 *        b. single API route file (`app/api/lab/route.ts`) — triggers
 *           `handleAPIChange` which does NOT wrap in SSR_HANDLER_RELOAD but
 *           DOES exercise the same `registerManifestHandlers` path
 *           internally; we look for `incr:cache-hit` / `incr:cache-miss` as
 *           completion signal since that's what B5 actually touches.
 *        c. wildcard-adjacent common-dir file (`src/playground-shell.tsx`) —
 *           goes through `handleSSRChange` but with wildcard so
 *           incremental path is bypassed (full invalidation, no hits).
 *   4. Parses stdout for every [perf] line, buckets them per edit window,
 *      and tallies cache-hit vs cache-miss counts per category.
 *   5. Reports per-edit perf breakdown + aggregate hit/miss ratio per
 *      category.
 *
 * # Assertions
 *
 *   - Single SSR reload P95 ≤ 30 ms (for the `ssr:handler-reload` marker).
 *   - Single file path MUST produce cache-hits > 0 for unrelated importers.
 *   - Wildcard path MUST NOT advertise false cache-hits (wildcard is
 *     intentionally a full invalidation).
 *
 * # Usage
 *
 *   bun run scripts/b5-live-bench.ts                  # default: 10 iter/cat
 *   ITERATIONS=20 bun run scripts/b5-live-bench.ts
 *
 * References:
 *   docs/bun/phase-7-2-team-plan.md §2, §6
 *   docs/bun/phase-7-1-benchmarks.md §6.2 (the original "wire-up stale" claim)
 *   packages/cli/src/util/handlers.ts
 *   packages/cli/src/util/bun.ts
 */

import { spawn, ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";

// ═══════════════════════════════════════════════════════════════════════
// Knobs
// ═══════════════════════════════════════════════════════════════════════

const ITERATIONS = Number(process.env.ITERATIONS ?? "10");
/** How long the watcher debounce needs to fully flush between edits. */
const EDIT_INTERVAL_MS = 700;
/** Max wait for the dev server "ready" signal. */
const READY_TIMEOUT_MS = 30_000;
/** Max wait for a post-edit marker to arrive. */
const MARKER_WAIT_MS = 3_000;
/** Port base — randomized per run. */
const PORT_BASE = 46_000;

const ROOT_DIR = path.resolve(import.meta.dir, "..");
const FIXTURE_DIR = path.join(ROOT_DIR, "demo/starter");
const CLI_ENTRY = path.join(ROOT_DIR, "packages/cli/src/main.ts");

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

interface MarkerEvent {
  /** Full [perf] line as emitted by `@mandujs/core/perf`. */
  raw: string;
  /** Label parsed from the line (e.g. "ssr:handler-reload"). */
  label: string;
  /** Milliseconds as printed by `measure()`. */
  ms: number;
  /** The wall-clock (ms since epoch) when we observed the line. */
  observedAt: number;
}

interface EditResult {
  /** Category key — see CATEGORIES below. */
  category: string;
  /** Iteration number within the category (1-based). */
  iter: number;
  /** Walltime from writeFileSync → category-specific completion marker. */
  walltimeMs: number | null;
  /** Count of incr:cache-hit markers observed in this edit's window. */
  hits: number;
  /** Count of incr:cache-miss markers observed. */
  misses: number;
  /** Count of ssr:bundled-import markers observed (full bundles). */
  bundledImports: number;
  /** The measured ms for the completion marker chosen for the category. */
  completionMs: number | null;
  /** The primary completion marker label consumed for timing. */
  completionLabel: string | null;
  /** All markers observed during this edit's window. */
  markers: MarkerEvent[];
}

interface CategoryStats {
  label: string;
  samples: number[];
  hits: number;
  misses: number;
  bundledImports: number;
  timeouts: number;
  walltimeSamples: number[];
}

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

function summarize(samples: number[]): {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : 0,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function parsePerfLine(line: string): MarkerEvent | null {
  // Format (see packages/core/src/perf/index.ts:70):
  //   [perf] <label>: <N.MM>ms
  const m = line.match(/^\[perf\]\s+(\S+):\s+([\d.]+)ms\s*$/);
  if (!m) return null;
  return {
    raw: line,
    label: m[1]!,
    ms: Number(m[2]!),
    observedAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Edit categories
// ═══════════════════════════════════════════════════════════════════════

interface Category {
  key: string;
  description: string;
  /** Which file relative to FIXTURE_DIR to edit. */
  file: string;
  /**
   * Marker label to wait for as completion signal. Different paths fire
   * different markers:
   *   - SSR pages → `ssr:handler-reload` (handleSSRChange wraps in withPerf)
   *   - API routes → `ssr:bundled-import` (no wrapping marker, but every
   *     registerManifestHandlers call produces at least one bundled-import
   *     measure)
   *   - Wildcard / common-dir → `ssr:handler-reload` (handleSSRChange path)
   */
  completionMarker: string;
  /** Whether this edit is expected to produce cache-hits. */
  expectHit: boolean;
  /** The file's initial content, captured on first use, to restore after. */
  initialContent?: string;
}

const CATEGORIES: Category[] = [
  {
    key: "ssr-page",
    description: "Single SSR page (app/page.tsx)",
    file: "app/page.tsx",
    completionMarker: "ssr:handler-reload",
    expectHit: true,
  },
  {
    key: "api-route",
    description: "Single API route (app/api/lab/route.ts)",
    file: "app/api/lab/route.ts",
    // handleAPIChange does NOT wrap in SSR_HANDLER_RELOAD; but every call
    // into registerManifestHandlers emits at least one ssr:bundled-import
    // per registered route.
    completionMarker: "ssr:bundled-import",
    expectHit: true,
  },
  {
    key: "shared-lib",
    description: "Wildcard/common-dir file (src/playground-shell.tsx)",
    file: "src/playground-shell.tsx",
    completionMarker: "ssr:handler-reload",
    // src/** is wildcard/common-dir — intentionally cold. The SSR reload
    // path does a full invalidation; no incr:cache-hit should fire for
    // bundled imports.
    expectHit: false,
  },
];

// ═══════════════════════════════════════════════════════════════════════
// Dev server boot
// ═══════════════════════════════════════════════════════════════════════

async function bootDevServer(port: number): Promise<{
  child: ChildProcess;
  readyMs: number;
  markers: MarkerEvent[];
  stdoutBuf: string[];
}> {
  const markers: MarkerEvent[] = [];
  const stdoutBuf: string[] = [];

  const child: ChildProcess = spawn(
    "bun",
    ["run", CLI_ENTRY, "dev", "--port", String(port)],
    {
      cwd: FIXTURE_DIR,
      env: {
        ...process.env,
        MANDU_PERF: "1",
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    },
  );

  let readyAt: number | null = null;

  const handle = (chunk: Buffer): void => {
    const text = chunk.toString("utf-8");
    for (const line of text.split("\n")) {
      stdoutBuf.push(line);
      const marker = parsePerfLine(line);
      if (marker) markers.push(marker);
      if (readyAt === null && /ready in (\d+)ms/.test(line)) {
        readyAt = Date.now();
      }
    }
  };
  child.stdout?.on("data", handle);
  child.stderr?.on("data", handle);

  const startedAt = Date.now();
  const deadline = startedAt + READY_TIMEOUT_MS;
  while (readyAt === null && Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `dev server exited before ready (code=${child.exitCode}). Stdout tail:\n${stdoutBuf.slice(-20).join("\n")}`,
      );
    }
    await sleep(50);
  }

  if (readyAt === null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // process may already be gone
    }
    throw new Error(
      `dev server did not become ready within ${READY_TIMEOUT_MS} ms. Stdout tail:\n${stdoutBuf.slice(-30).join("\n")}`,
    );
  }

  return { child, readyMs: readyAt - startedAt, markers, stdoutBuf };
}

/**
 * Perform a single edit for a category + wait for the configured
 * completion marker to fire. Returns elapsed walltime + observed markers.
 */
async function runEdit(
  cat: Category,
  iter: number,
  markerStream: MarkerEvent[],
): Promise<EditResult> {
  const abs = path.join(FIXTURE_DIR, cat.file);
  if (cat.initialContent === undefined) {
    cat.initialContent = readFileSync(abs, "utf-8");
  }

  // Append a timestamped comment line to force a content change. Comments
  // don't affect module behavior so the server keeps working.
  const marker = `// b5-live-edit:${cat.key}:${iter}:${Date.now()}\n`;
  const nextContent = cat.initialContent.endsWith("\n")
    ? cat.initialContent + marker
    : cat.initialContent + "\n" + marker;

  // Snapshot the marker stream length so we can find just the markers
  // that arrive after our edit.
  const preLen = markerStream.length;
  const t0 = Date.now();
  writeFileSync(abs, nextContent, "utf-8");

  // Wait until we observe the completion marker OR timeout.
  const deadline = t0 + MARKER_WAIT_MS;
  let completion: MarkerEvent | null = null;
  while (Date.now() < deadline) {
    for (let i = preLen; i < markerStream.length; i++) {
      const ev = markerStream[i]!;
      if (ev.label === cat.completionMarker) {
        completion = ev;
        break;
      }
    }
    if (completion) break;
    await sleep(20);
  }

  // After the completion marker fires, wait a bit more (200ms) to capture
  // any trailing incr:cache-hit/miss markers that fire in parallel.
  if (completion !== null) {
    await sleep(200);
  }

  // Collect all markers that arrived during this edit window.
  const windowMarkers = markerStream.slice(preLen);
  const hits = windowMarkers.filter((m) => m.label === "incr:cache-hit").length;
  const misses = windowMarkers.filter((m) => m.label === "incr:cache-miss").length;
  const bundledImports = windowMarkers.filter(
    (m) => m.label === "ssr:bundled-import",
  ).length;

  const walltimeMs =
    completion === null ? null : completion.observedAt - t0;

  return {
    category: cat.key,
    iter,
    walltimeMs,
    hits,
    misses,
    bundledImports,
    completionMs: completion?.ms ?? null,
    completionLabel: completion?.label ?? null,
    markers: windowMarkers,
  };
}

function restoreInitialContent(cats: Category[]): void {
  for (const cat of cats) {
    if (cat.initialContent === undefined) continue;
    const abs = path.join(FIXTURE_DIR, cat.file);
    try {
      writeFileSync(abs, cat.initialContent, "utf-8");
    } catch {
      // best-effort
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  if (!existsSync(FIXTURE_DIR)) {
    console.error(`[b5-live-bench] fixture not found: ${FIXTURE_DIR}`);
    process.exit(1);
  }

  const port = PORT_BASE + Math.floor(Math.random() * 15_000);
  console.log(`[b5-live-bench] fixture: ${FIXTURE_DIR}`);
  console.log(`[b5-live-bench] port:    ${port}`);
  console.log(`[b5-live-bench] iter:    ${ITERATIONS} / category`);
  console.log();

  let child: ChildProcess | null = null;
  let markerStream: MarkerEvent[] = [];
  let bootReadyMs = 0;

  try {
    console.log("[b5-live-bench] booting dev server with MANDU_PERF=1…");
    const boot = await bootDevServer(port);
    child = boot.child;
    markerStream = boot.markers;
    bootReadyMs = boot.readyMs;
    console.log(`[b5-live-bench] ready in ${boot.readyMs}ms`);
    console.log();

    // Give the watcher its WATCHER_ARM_MS (350ms) grace + a bit more.
    await sleep(600);

    const allResults: EditResult[] = [];

    for (const cat of CATEGORIES) {
      console.log(`[b5-live-bench] ── ${cat.description} ──`);
      console.log(`  (waiting on marker '${cat.completionMarker}')`);
      for (let i = 1; i <= ITERATIONS; i++) {
        const result = await runEdit(cat, i, markerStream);
        allResults.push(result);
        if (result.walltimeMs === null) {
          console.log(
            `  #${i} TIMEOUT (no '${cat.completionMarker}' within ${MARKER_WAIT_MS} ms)`,
          );
        } else {
          const completionStr = result.completionMs !== null
            ? `${result.completionLabel}=${result.completionMs.toFixed(1)}ms`
            : "?";
          console.log(
            `  #${i} walltime=${result.walltimeMs}ms ${completionStr} bundled=${result.bundledImports} hits=${result.hits} misses=${result.misses}`,
          );
        }
        await sleep(EDIT_INTERVAL_MS);
      }
      console.log();
    }

    // Aggregate stats per category.
    const statsByCat = new Map<string, CategoryStats>();
    for (const cat of CATEGORIES) {
      const catResults = allResults.filter((r) => r.category === cat.key);
      const timed = catResults.filter((r) => r.completionMs !== null);
      const timeouts = catResults.length - timed.length;
      statsByCat.set(cat.key, {
        label: cat.description,
        samples: timed.map((r) => r.completionMs!),
        walltimeSamples: timed
          .map((r) => r.walltimeMs)
          .filter((x): x is number => x !== null),
        hits: catResults.reduce((a, r) => a + r.hits, 0),
        misses: catResults.reduce((a, r) => a + r.misses, 0),
        bundledImports: catResults.reduce((a, r) => a + r.bundledImports, 0),
        timeouts,
      });
    }

    console.log("─── Per-category completion marker (ms) ──────────────────");
    for (const [key, stat] of statsByCat) {
      if (stat.samples.length === 0) {
        console.log(
          `  [${key}] ${stat.label}: NO SAMPLES (timeouts=${stat.timeouts})`,
        );
        continue;
      }
      const s = summarize(stat.samples);
      const walls = summarize(stat.walltimeSamples);
      console.log(
        `  [${key}] ${stat.label}\n` +
          `    marker: count=${s.count} P50=${s.p50.toFixed(1)} P95=${s.p95.toFixed(1)} P99=${s.p99.toFixed(1)} mean=${s.mean.toFixed(1)}\n` +
          `    walltime: P50=${walls.p50.toFixed(0)} P95=${walls.p95.toFixed(0)}\n` +
          `    cache: hits=${stat.hits} misses=${stat.misses} bundled=${stat.bundledImports} ratio=${stat.hits + stat.misses === 0 ? "n/a" : ((stat.hits / (stat.hits + stat.misses)) * 100).toFixed(1) + "%"}`,
      );
    }
    console.log();

    // Write JSON artifact.
    const outDir = path.join(ROOT_DIR, "docs/bun");
    try {
      mkdirSync(outDir, { recursive: true });
    } catch {
      // exists
    }
    const outFile = path.join(outDir, "phase-7-2-b5-live-bench-results.json");
    const payload = {
      startedAt: new Date().toISOString(),
      port,
      readyMs: bootReadyMs,
      iterations: ITERATIONS,
      categories: CATEGORIES.map((c) => ({
        key: c.key,
        description: c.description,
        file: c.file,
        completionMarker: c.completionMarker,
        expectHit: c.expectHit,
      })),
      stats: Array.from(statsByCat.entries()).map(([key, stat]) => ({
        key,
        description: stat.label,
        count: stat.samples.length,
        timeouts: stat.timeouts,
        hits: stat.hits,
        misses: stat.misses,
        bundledImports: stat.bundledImports,
        hitRate:
          stat.hits + stat.misses === 0 ? null : stat.hits / (stat.hits + stat.misses),
        markerSummary: stat.samples.length > 0 ? summarize(stat.samples) : null,
        walltimeSummary:
          stat.walltimeSamples.length > 0 ? summarize(stat.walltimeSamples) : null,
      })),
      allResults: allResults.map((r) => ({
        category: r.category,
        iter: r.iter,
        walltimeMs: r.walltimeMs,
        completionMs: r.completionMs,
        completionLabel: r.completionLabel,
        hits: r.hits,
        misses: r.misses,
        bundledImports: r.bundledImports,
        markerLabels: r.markers.map((m) => m.label),
      })),
    };
    writeFileSync(outFile, JSON.stringify(payload, null, 2));
    console.log(`[b5-live-bench] results written to ${outFile}`);
  } finally {
    restoreInitialContent(CATEGORIES);
    if (child && child.exitCode === null) {
      try {
        child.kill("SIGTERM");
      } catch {
        // maybe already gone
      }
      // Give it a grace period.
      const killDeadline = Date.now() + 5_000;
      while (child.exitCode === null && Date.now() < killDeadline) {
        await sleep(50);
      }
      if (child.exitCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[b5-live-bench] fatal:", err);
    process.exit(1);
  });
