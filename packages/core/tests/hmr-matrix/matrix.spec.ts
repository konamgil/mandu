/**
 * Phase 7.0 R2 Agent E — 36-scenario HMR matrix driver.
 *
 * This spec iterates over every `ScenarioCell` in `scenario-matrix.ts` and
 * runs one `bun:test` case per cell. Test naming follows the pattern
 * `[<form>] <changeKind> → <expectedBehavior>` so failures report exactly
 * which combination broke.
 *
 * Why one test per cell (not one big loop): `bun:test` reports pass/skip/fail
 * individually, which makes CI output actionable. A single monster test that
 * loops would only show the first failure.
 *
 * Gating:
 *   - `MANDU_SKIP_BUNDLER_TESTS=1` skips the entire suite. This env is set
 *     by CI's randomize-mode step because `startDevBundler` triggers Bun.build
 *     cross-worker races when run in parallel with other bundler tests.
 *   - Individual cells with `expectedBehavior === "n/a"` are skipped via
 *     `test.skip` so they still show up in the report (as "skipped") — this
 *     is important for the 36-cell completeness invariant: if a cell silently
 *     disappears from the iteration, the total count check below will fail.
 *   - Cells listed in `KNOWN_BUNDLER_GAPS` are skipped with a GAP prefix in
 *     the test name, for dispatch paths that exist only at the CLI layer
 *     (beyond `startDevBundler`'s scope). See the constant's docstring.
 *
 * Latency notes:
 *   Per the task brief, this spec does SOFT assertions only (console.warn
 *   when a cell exceeds its P95 target). Hard assertions are R3 Agent F's
 *   responsibility — they run a separate benchmark script that aggregates
 *   N samples. A single-sample soft check here guards against catastrophic
 *   regressions (10× slower than target) without turning every Windows
 *   fs.watch hiccup into a CI failure.
 *
 * Verifier design:
 *   The matrix's `expectedBehavior` names are *user-facing* outcomes. The
 *   bundler surfaces several internal signals (`onSSRChange`,
 *   `onAPIChange`, `onRebuild`, `onConfigReload`, `onResourceChange`) that
 *   the CLI layer composes into those user-facing outcomes. The verifiers
 *   below therefore accept ANY signal that CAN plausibly contribute to the
 *   outcome — e.g. a middleware change fires `onAPIChange` which the CLI
 *   translates into a browser reload, so the verifier for `full-reload`
 *   accepts `apiChanges.length > 0`. This is intentional: we are not
 *   testing the internal dispatch paths here (that is what
 *   `dev-reliability.test.ts` and `extended-watch.test.ts` cover), we are
 *   testing "change in file X of form Y produces a signal the CLI knows
 *   how to turn into outcome Z". One-signal-per-outcome would overfit to
 *   today's dispatch layout.
 */

import { describe, test, expect } from "bun:test";
import {
  SCENARIO_CELLS,
  EXPECTED_CELL_COUNT,
  type ScenarioCell,
  type ProjectForm,
  type ChangeKind,
} from "../../src/bundler/scenario-matrix";
import type { RoutesManifest } from "../../src/spec/schema";

import {
  bootBundler,
  applyEditAndAwait,
  resolveChangeFile,
  makeTempRoot,
  rmTempRoot,
  sleep,
  waitFor,
  WATCHER_ARM_MS,
  WATCH_SETTLE_MS,
  CELL_TIMEOUT_MS,
  type FixtureContext,
  type Observations,
} from "./harness";
import { scaffoldSSG } from "./fixture-ssg";
import { scaffoldHybrid } from "./fixture-hybrid";
import { scaffoldFull } from "./fixture-full";

// ═══════════════════════════════════════════════════════════════════════════
// Known dispatch gaps in `startDevBundler`
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A set of `changeKind`s whose file changes are NOT dispatched by
 * `startDevBundler` today. These cells still need entries in the 36-cell
 * matrix (so the COMPLETENESS target stays square) but the bundler's
 * file-type classifier (`_doBuild` + `classifyBatch`) falls through to a
 * silent drop for them.
 *
 * Historical entries (closed):
 *
 *   - `"app/slot.ts"` — closed by Phase 7.1 R1 Agent A. The bundler now
 *     registers `route.slotModule` into `serverModuleSet` (see
 *     `packages/core/src/bundler/dev.ts` around the manifest-iteration
 *     block), so slot edits surface through the existing
 *     `onSSRChange(filePath)` path. The fixtures were updated in the
 *     same round to declare `slotModule` in their manifest routes; test
 *     coverage lives in `packages/core/src/bundler/__tests__/slot-dispatch.test.ts`.
 *
 * When a new gap is introduced (or discovered), add the kind back to
 * this set and it becomes a skipped cell with a GAP prefix — the matrix
 * grid stays complete while surfacing the gap for a future round. The
 * dispatch table is the **single source of truth** for which cells the
 * bundler can test directly.
 */
const KNOWN_BUNDLER_GAPS: ReadonlySet<ChangeKind> = new Set<ChangeKind>();

// ═══════════════════════════════════════════════════════════════════════════
// Invariant guards — must pass before any cell runs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fail loudly if someone silently shrinks the matrix. The number 36 (= 3×12)
 * is a direct check against Phase 7.0's COMPLETENESS target. If a dimension
 * is added or removed, this test reminds the editor to update the spec.
 */
describe("Phase 7.0 R2 Agent E — matrix invariants", () => {
  test("scenario matrix has exactly 3 × 12 = 36 cells", () => {
    expect(SCENARIO_CELLS.length).toBe(EXPECTED_CELL_COUNT);
    expect(SCENARIO_CELLS.length).toBe(36);
  });

  test("every cell has a non-empty expectedBehavior", () => {
    for (const cell of SCENARIO_CELLS) {
      expect(cell.expectedBehavior).toBeDefined();
      expect(cell.expectedBehavior.length).toBeGreaterThan(0);
    }
  });

  test("latencyTargetMs is null iff expectedBehavior is n/a or server-restart", () => {
    for (const cell of SCENARIO_CELLS) {
      const isNull =
        cell.expectedBehavior === "n/a" || cell.expectedBehavior === "server-restart";
      const actualIsNull = cell.latencyTargetMs === null;
      expect(actualIsNull).toBe(isNull);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fixture dispatcher — maps form → scaffold builder
// ═══════════════════════════════════════════════════════════════════════════

function scaffold(
  form: ProjectForm,
  rootDir: string,
): RoutesManifest {
  switch (form) {
    case "pure-ssg":
      return scaffoldSSG(rootDir);
    case "hybrid":
      return scaffoldHybrid(rootDir);
    case "full-interactive":
      return scaffoldFull(rootDir);
  }
}

/** Build a fresh fixture + boot the bundler. Caller owns cleanup. */
async function setupCell(cell: ScenarioCell): Promise<FixtureContext> {
  const rootDir = makeTempRoot(cell.projectForm);
  const manifest = scaffold(cell.projectForm, rootDir);
  const { bundler, observations } = await bootBundler(rootDir, manifest);
  // Let the recursive watcher fully arm before emitting events.
  await sleep(WATCHER_ARM_MS);
  const cleanup = async (): Promise<void> => {
    try {
      bundler.close();
    } catch {
      /* best-effort */
    }
    rmTempRoot(rootDir);
  };
  return { rootDir, form: cell.projectForm, manifest, bundler, observations, cleanup };
}

// ═══════════════════════════════════════════════════════════════════════════
// Signal summary helpers — used by multiple verifiers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Count every kind of observable change signal. Used by `verifyFullReload`
 * (which accepts ANY of them as evidence) and by `verifyIslandUpdate`
 * (which specifically looks for a non-wildcard rebuild). Kept as a sum
 * rather than a boolean so the log line on failure can distinguish
 * "zero signals ever fired" from "wrong kind of signal".
 */
function totalSignals(obs: Observations): number {
  return (
    obs.rebuilds.length +
    obs.ssrChanges.length +
    obs.apiChanges.length +
    obs.resourceChanges.length +
    obs.configReloads.length +
    obs.packageJsonChanges.length
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Behavior verifiers — one per ExpectedBehavior variant
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check that an island-update signal fired. Under `startDevBundler`, this
 * surfaces as `onRebuild({ routeId: <specific-id>, success: true })` with a
 * non-wildcard id — the wildcard ("*") is reserved for common-dir rebuilds.
 */
async function verifyIslandUpdate(obs: Observations): Promise<void> {
  const ok = await waitFor(
    () =>
      obs.rebuilds.some(
        (r) => r.success && r.routeId !== "*" && r.routeId.length > 0,
      ),
    7_000,
  );
  expect(ok).toBe(true);
}

/**
 * Check that a full-reload equivalent signal fired.
 *
 * Mandu has multiple paths that end in a browser full-reload broadcast:
 *   - `onSSRChange(path)` → page.tsx / layout.tsx (serverModuleSet hit)
 *   - `onSSRChange("*")` → common-dir rebuild (src/** etc.)
 *   - `onAPIChange(path)` → route.ts / middleware.ts
 *   - `onRebuild({ routeId: "*" })` → common-dir success callback
 *
 * The verifier accepts ANY of these because the matrix's `full-reload`
 * semantic is "the browser has to reload", not "a specific function fired".
 * Different change kinds route through different signals and all end up at
 * the same outcome after the CLI's handler composes them.
 */
async function verifyFullReload(obs: Observations): Promise<void> {
  const ok = await waitFor(
    () =>
      obs.ssrChanges.length > 0 ||
      obs.apiChanges.length > 0 ||
      obs.rebuilds.some((r) => r.routeId === "*"),
    7_000,
  );
  if (!ok) {
    // Helpful diagnostic so reviewers can distinguish "no watcher arm" from
    // "watcher fires, dispatcher drops signal" — the latter is a real bug.
    console.warn(
      `[verifyFullReload] no signal after 7s; observations: ${JSON.stringify({
        rebuilds: obs.rebuilds.length,
        ssr: obs.ssrChanges.length,
        api: obs.apiChanges.length,
        res: obs.resourceChanges.length,
        cfg: obs.configReloads.length,
        pkg: obs.packageJsonChanges.length,
      })}`,
    );
  }
  expect(ok).toBe(true);
}

/**
 * Prerender regen is the pure-SSG variant of full-reload — in the CLI layer
 * it additionally re-runs `prerenderRoutes` against the updated handler.
 *
 * At the bundler level the only observable is `onSSRChange("*")` from the
 * common-dir path — the CLI wraps that with its own regen logic. This
 * verifier accepts the wildcard fire OR (as a fallback) any SSR change +
 * a successful `routeId: "*"` rebuild, since the full path is:
 *   common-dir rebuild → onSSRChange("*") → onRebuild({routeId:"*"})
 */
async function verifyPrerenderRegen(obs: Observations): Promise<void> {
  const ok = await waitFor(
    () =>
      obs.ssrChanges.includes("*") ||
      obs.rebuilds.some((r) => r.routeId === "*" && r.success),
    7_000,
  );
  if (!ok) {
    console.warn(
      `[verifyPrerenderRegen] no wildcard signal; rebuilds=${obs.rebuilds
        .map((r) => r.routeId)
        .join(",")}, ssr=${obs.ssrChanges.join(",")}`,
    );
  }
  expect(ok).toBe(true);
}

/**
 * For a CSS-only change, the Mandu dev bundler does NOT broadcast directly —
 * the CLI's CSS watcher does (Tailwind stdout watcher or fs.watch on the
 * built CSS file). Within the dev bundler scope, a `.css` change hits no
 * classification bucket (not in common-dir, not in any module set), so
 * `onRebuild` / `onSSRChange` do not fire. That's correct: CSS is out of
 * scope for the JS/TS bundler.
 *
 * The verifier here asserts the bundler did NOT crash (errors.length ===
 * 0) and tolerates ANY observation state. The actual `css-update`
 * broadcast is tested by the regression spec which drives the real CSS
 * watcher.
 */
async function verifyCssUpdate(obs: Observations): Promise<void> {
  // Give fs.watch a chance to fire; we only care that nothing crashes.
  await sleep(WATCH_SETTLE_MS + 200);
  expect(obs.errors.length).toBe(0);
}

/**
 * Config/env auto-restart: bundler surfaces this via `onConfigReload(filePath)`.
 * The CLI then calls `restartDevServer()`.
 */
async function verifyServerRestart(obs: Observations): Promise<void> {
  const ok = await waitFor(
    () => obs.configReloads.length > 0,
    7_000,
  );
  if (!ok) {
    console.warn(
      `[verifyServerRestart] no configReload signal; total signals=${totalSignals(obs)}`,
    );
  }
  expect(ok).toBe(true);
}

/**
 * Contract/resource: bundler fires `onResourceChange(filePath)`. CLI then
 * runs `generateResourceArtifacts` + re-registers handlers.
 */
async function verifyCodeRegen(obs: Observations): Promise<void> {
  const ok = await waitFor(
    () => obs.resourceChanges.length > 0,
    7_000,
  );
  if (!ok) {
    console.warn(
      `[verifyCodeRegen] no resourceChange signal; total signals=${totalSignals(obs)}`,
    );
  }
  expect(ok).toBe(true);
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-cell test body
// ═══════════════════════════════════════════════════════════════════════════

async function runCell(cell: ScenarioCell): Promise<void> {
  const ctx = await setupCell(cell);
  const started = Date.now();
  try {
    const filePath = resolveChangeFile(ctx.rootDir, ctx.form, cell.changeKind);
    if (filePath === null) {
      // Should have been filtered by the "n/a" skip. If we got here, fail
      // loudly so the matrix invariant test catches the mismatch.
      throw new Error(
        `No file resolution for ${cell.projectForm} × ${cell.changeKind}, but expectedBehavior is ${cell.expectedBehavior}`,
      );
    }

    // Use the retrying touch helper — Windows fs.watch reliably misses the
    // first write on freshly-armed recursive watchers. `applyEditAndAwait`
    // writes with perturbed content up to 4 times, pausing for the debounce
    // window between attempts, until `totalSignals(obs)` increments.
    await applyEditAndAwait(filePath, cell.changeKind, () =>
      totalSignals(ctx.observations),
    );

    switch (cell.expectedBehavior) {
      case "island-update":
        await verifyIslandUpdate(ctx.observations);
        break;
      case "full-reload":
        await verifyFullReload(ctx.observations);
        break;
      case "prerender-regen":
        await verifyPrerenderRegen(ctx.observations);
        break;
      case "css-update":
        await verifyCssUpdate(ctx.observations);
        break;
      case "server-restart":
        await verifyServerRestart(ctx.observations);
        break;
      case "code-regen":
        await verifyCodeRegen(ctx.observations);
        break;
      case "n/a":
        // Unreachable — `test.skip` is used upstream.
        throw new Error("n/a cell reached runCell — harness bug");
    }

    // Soft latency check. We record the wall-clock from edit to last
    // callback fire. This is an UPPER BOUND — the real `REBUILD_TOTAL`
    // perf marker is shorter because it excludes fixture/setup overhead.
    // Agent F (R3) does hard assertions with the actual marker.
    const elapsed = Date.now() - started;
    // CSS cells intentionally wait `WATCH_SETTLE_MS + 200` to confirm
    // `verifyCssUpdate`'s no-op contract — the elapsed time is dominated by
    // that deliberate sleep, not by any rebuild work, so the soft-budget
    // check would only produce noise. Agent F's benchmark script measures
    // the real CSS reload walltime through the actual CSS watcher.
    const skipLatencyCheck = cell.changeKind === "css";
    if (cell.latencyTargetMs !== null && !skipLatencyCheck) {
      const softBudget = cell.latencyTargetMs * 20; // very generous
      if (elapsed > softBudget) {
        console.warn(
          `[perf:matrix] ${cell.projectForm}/${cell.changeKind}: ${elapsed}ms > soft budget ${softBudget}ms (target ${cell.latencyTargetMs}ms)`,
        );
      }
    }
  } finally {
    await ctx.cleanup();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Materialize the 36 cells — one test each, n/a and GAP cells skipped
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(process.env.MANDU_SKIP_BUNDLER_TESTS === "1")(
  "Phase 7.0 R2 Agent E — 36-scenario matrix",
  () => {
    for (const cell of SCENARIO_CELLS) {
      const baseName = `[${cell.projectForm}] ${cell.changeKind} → ${cell.expectedBehavior}`;
      if (cell.expectedBehavior === "n/a") {
        test.skip(baseName, () => {
          /* n/a by matrix definition (see scenario-matrix.ts `classifyBehavior`) */
        });
        continue;
      }
      if (KNOWN_BUNDLER_GAPS.has(cell.changeKind)) {
        test.skip(`[GAP] ${baseName}`, () => {
          /* Known bundler dispatch gap — see KNOWN_BUNDLER_GAPS docstring. */
        });
        continue;
      }
      test(
        baseName,
        async () => {
          await runCell(cell);
        },
        CELL_TIMEOUT_MS,
      );
    }
  },
);
