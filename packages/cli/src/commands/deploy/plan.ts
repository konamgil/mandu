import type * as __ManduMandujsCoreDeployTypes0 from "@mandujs/core/compat/deploy/index";
/**
 * `mandu deploy:plan` — infer per-route deploy intent and write
 * `.mandu/deploy.intent.json`.
 *
 * Issue #250 — Phase 1 M2.
 *
 * Flow:
 *   1. Load `mandu.config.ts` (for `brain.telemetryOptOut`).
 *   2. Resolve the routes manifest (same path the deploy command uses).
 *   3. Load the previous intent cache (empty when first run).
 *   4. Call `planDeploy()` from `@mandujs/core/deploy` — pure function
 *      returns the next cache + a per-route diff.
 *   5. Render the diff. `added`/`changed` rows show old → new runtime,
 *      `pinned` rows are marked as user-explicit, `unchanged` are
 *      collapsed unless `--verbose`.
 *   6. Validate every non-static intent against the route shape via
 *      `isStaticIntentValidFor`. Validation warnings are surfaced but
 *      do not block the write — adapters re-validate before deploy.
 *   7. When `--apply` (or interactive `y`), atomically write the cache.
 *      `--dry-run` (or interactive `N`) leaves the file untouched.
 *
 * The brain inferer (M4) will plug in via `--use-brain` — for now the
 * heuristic is the only inferer and the flag is reserved.
 */

import path from "node:path";
import {
  buildDeployInferenceContext,
  emptyDeployIntentCache,
  extractExplicitIntents,
  inferDeployIntentHeuristic,
  inferDeployIntentWithBrain,
  isStaticIntentValidFor,
  loadDeployIntentCache,
  mergeExplicitIntents,
  planDeploy,
  saveDeployIntentCache,
  type DeployIntentCache,
  type InferenceResult,
  type DeployInferenceContext,
  type PlanDiffEntry,
  type PlanDiffEntryKind,
} from "@mandujs/core/compat/deploy/index";
import type { RoutesManifest } from "@mandujs/core";
import { resolveBrainAdapter } from "@mandujs/core/compat/brain/index";
import { resolveManifest } from "../../util/manifest";
import { CLI_ERROR_CODES } from "../../errors/codes";

// ─── CLI surface ──────────────────────────────────────────────────────

export interface DeployPlanOptions {
  /** Override cwd — tests inject a fixture root. */
  cwd?: string;
  /**
   * Skip the confirmation prompt and write the cache file. CI-friendly.
   * Mutually exclusive with `dryRun: true` (caller should not set both).
   */
  apply?: boolean;
  /**
   * Print the plan without writing the cache. Default in non-TTY
   * environments unless `--apply` is set.
   */
  dryRun?: boolean;
  /**
   * Force re-inference even when the source hash matches the previous
   * cache entry. Use after upgrading the framework or when the
   * heuristic rules changed.
   */
  reinfer?: boolean;
  /**
   * Reserved for M4 (brain inferer). Pass `true` to call OpenAI/Anthropic
   * for validation; ignored in M2 — the heuristic is the only path.
   */
  useBrain?: boolean;
  /**
   * Show `unchanged` rows in the diff. Default off — only changed
   * entries surface so the operator can audit them quickly.
   */
  verbose?: boolean;
  /** Print callback (default `console.log`). Tests inject a buffer. */
  log?: (msg: string) => void;
  /** Error print callback (default `console.error`). */
  error?: (msg: string) => void;
  /**
   * Confirmation prompt — defaults to a stdin y/N reader. Tests inject
   * a deterministic stub. Skipped entirely when `apply: true`.
   */
  prompt?: (question: string) => Promise<boolean>;
  /** Override `Date.now()` ISO string — primarily for test determinism. */
  now?: () => string;
  /**
   * Inject a custom inferer (the brain inferer plugs in here in M4).
   * Defaults to the offline heuristic.
   */
  infer?: (ctx: DeployInferenceContext) => Promise<InferenceResult> | InferenceResult;
}

export interface DeployPlanResult {
  /** Process exit code — 0 success, 1 fatal error, 2 declined write. */
  exitCode: number;
  /** Final cache (written if `applied`, otherwise the would-be next state). */
  cache: DeployIntentCache;
  /** Diff entries the renderer surfaced. */
  diff: PlanDiffEntry[];
  /** Validation warnings (intent vs route shape). */
  warnings: string[];
  /** True when the cache file was actually written. */
  applied: boolean;
}

// ─── Runner ───────────────────────────────────────────────────────────

export async function deployPlan(
  options: DeployPlanOptions = {},
): Promise<DeployPlanResult> {
  const log = options.log ?? ((m: string) => console.log(m));
  const error = options.error ?? ((m: string) => console.error(m));
  const cwd = options.cwd ?? process.cwd();

  // ── 1. Manifest
  let manifest: RoutesManifest;
  try {
    const resolved = await resolveManifest(cwd);
    manifest = resolved.manifest;
    if (resolved.warnings.length > 0) {
      for (const w of resolved.warnings) log(`(manifest) ${w}`);
    }
  } catch (err) {
    error(
      `[${CLI_ERROR_CODES.DEPLOY_PLAN_MANIFEST_FAILED}] Failed to resolve routes manifest: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { exitCode: 1, cache: emptyDeployIntentCache(), diff: [], warnings: [], applied: false };
  }

  // ── 2. Previous cache
  const rawPrevious = await loadDeployIntentCache(cwd).catch((err) => {
    error(
      `Existing .mandu/deploy.intent.json is invalid: ${err instanceof Error ? err.message : String(err)}`,
    );
    error("Aborting — fix or delete the file before re-running deploy:plan.");
    return null;
  });
  if (rawPrevious === null) {
    return { exitCode: 1, cache: emptyDeployIntentCache(), diff: [], warnings: [], applied: false };
  }

  // ── 2.5. Extract explicit `.deploy()` intents from filling modules.
  // Merge them into the previous cache as `source: "explicit"` BEFORE
  // planDeploy runs — explicit entries are protected from inference,
  // so the user's `.deploy()` always wins (issue #250 M5).
  const extracted = await extractExplicitIntents(cwd, manifest);
  for (const ext of extracted.errors) {
    log(`(filling.deploy) ${ext.routeId}: ${ext.reason}`);
  }
  const previous = await mergeExplicitIntents(rawPrevious, extracted.entries, cwd, manifest);

  // ── 3. Resolve inferer
  // The default is the offline heuristic. `--use-brain` resolves the
  // OAuth-backed brain adapter and wraps the heuristic with it — the
  // brain confirms or refines each route without ever blocking the
  // pipeline (failures fall back to heuristic silently). When the
  // resolver returns `template`/`needsLogin`, brain wrapping is
  // skipped with a warning the operator sees in the plan output.
  let infer = options.infer;
  let brainModel = "heuristic";
  if (!infer && options.useBrain) {
    const resolution = await resolveBrainAdapter({
      adapter: "auto",
      projectRoot: cwd,
    });
    if (resolution.resolved === "template") {
      log(
        resolution.needsLogin
          ? "⚠ --use-brain: no cloud token found. Run `mandu brain login --provider=openai` then re-run with --use-brain. Falling back to heuristic for now."
          : "⚠ --use-brain: telemetryOptOut blocks the brain. Falling back to heuristic.",
      );
    } else {
      infer = inferDeployIntentWithBrain({ adapter: resolution.adapter });
      brainModel = `${resolution.resolved}+heuristic`;
      log(`🧠 Using brain (${resolution.resolved}) to refine heuristic intents.`);
    }
  }

  // ── 4. Plan
  const result = await planDeploy({
    rootDir: cwd,
    manifest,
    previous,
    reinfer: options.reinfer === true,
    now: options.now,
    infer,
    brainModel,
  });

  // ── 4. Validation pass — surface intents that contradict route shape
  const warnings: string[] = [];
  for (const route of manifest.routes) {
    const entry = result.cache.intents[route.id];
    if (!entry) continue;
    const ctx = await buildDeployInferenceContext(cwd, route);
    const validation = isStaticIntentValidFor(entry.intent, {
      isDynamic: ctx.isDynamic,
      hasGenerateStaticParams: ctx.hasGenerateStaticParams,
      kind: ctx.kind,
    });
    if (!validation.ok) {
      warnings.push(`${route.id} (${route.pattern}): ${validation.reason}`);
    }
  }

  // ── 5. Render
  log("Mandu deploy:plan — inferred intents");
  log("─".repeat(48));
  log(renderDiffSummary(result.diff));
  log("");
  for (const line of renderDiffLines(result.diff, { verbose: options.verbose === true })) {
    log(line);
  }
  if (warnings.length > 0) {
    log("");
    log("⚠ Intent validation warnings:");
    for (const w of warnings) log(`   ${w}`);
  }

  const hasChanges = result.diff.some(
    (d) => d.kind === "added" || d.kind === "changed" || d.kind === "removed",
  );

  // ── 6. Apply or skip
  if (!hasChanges && previous.intents && Object.keys(previous.intents).length > 0) {
    log("");
    log("✓ No changes — cache is up to date.");
    return { exitCode: 0, cache: result.cache, diff: result.diff, warnings, applied: false };
  }

  let approved = options.apply === true;
  if (!approved && options.dryRun !== true) {
    log("");
    const ask = options.prompt ?? defaultYesNoPrompt;
    approved = await ask("Write .mandu/deploy.intent.json? [y/N]: ");
  }

  if (!approved) {
    log("");
    log(
      options.dryRun
        ? "Dry run complete — cache file untouched."
        : "Skipped — cache file untouched.",
    );
    return { exitCode: options.dryRun ? 0 : 2, cache: result.cache, diff: result.diff, warnings, applied: false };
  }

  await saveDeployIntentCache(cwd, result.cache);
  log("");
  log(`✓ Wrote ${path.join(".mandu", "deploy.intent.json")} — ${Object.keys(result.cache.intents).length} routes.`);
  return { exitCode: 0, cache: result.cache, diff: result.diff, warnings, applied: true };
}

// ─── Diff rendering ───────────────────────────────────────────────────

const KIND_ICONS: Record<PlanDiffEntryKind, string> = {
  added: "+",
  changed: "~",
  removed: "-",
  pinned: "📌",
  unchanged: "·",
};

export function renderDiffSummary(diff: readonly PlanDiffEntry[]): string {
  const counts: Record<PlanDiffEntryKind, number> = {
    added: 0,
    changed: 0,
    removed: 0,
    pinned: 0,
    unchanged: 0,
  };
  for (const d of diff) counts[d.kind]++;
  const parts: string[] = [];
  if (counts.added) parts.push(`${counts.added} added`);
  if (counts.changed) parts.push(`${counts.changed} changed`);
  if (counts.removed) parts.push(`${counts.removed} removed`);
  if (counts.pinned) parts.push(`${counts.pinned} pinned`);
  if (counts.unchanged) parts.push(`${counts.unchanged} unchanged`);
  return parts.length > 0 ? parts.join(", ") : "no routes";
}

export function renderDiffLines(
  diff: readonly PlanDiffEntry[],
  opts: { verbose: boolean },
): string[] {
  const out: string[] = [];
  for (const entry of diff) {
    if (entry.kind === "unchanged" && !opts.verbose) continue;
    const icon = KIND_ICONS[entry.kind];
    const next = entry.next;
    const prev = entry.previous;
    const heading = `${icon} ${entry.routeId.padEnd(40)} ${entry.pattern}`;
    out.push(heading);
    if (next) {
      const summary = `   runtime: ${formatTransition(prev?.intent.runtime, next.intent.runtime)}, cache: ${formatCache(next.intent.cache)}, visibility: ${next.intent.visibility}`;
      out.push(summary);
      if (entry.kind !== "pinned") {
        out.push(`   rationale: ${next.rationale}`);
      } else {
        out.push("   (explicit override — not re-inferred)");
      }
    } else if (prev) {
      out.push(`   runtime: ${prev.intent.runtime} → (removed)`);
    }
  }
  return out;
}

function formatTransition(prev: string | undefined, next: string): string {
  if (!prev || prev === next) return next;
  return `${prev} → ${next}`;
}

function formatCache(cache: __ManduMandujsCoreDeployTypes0.DeployIntent["cache"]): string {
  if (cache === "no-store" || cache === "public") return cache;
  const bits: string[] = [];
  if (cache.maxAge !== undefined) bits.push(`maxAge=${cache.maxAge}`);
  if (cache.sMaxAge !== undefined) bits.push(`sMaxAge=${cache.sMaxAge}`);
  if (cache.swr !== undefined) bits.push(`swr=${cache.swr}`);
  return bits.length > 0 ? `{ ${bits.join(", ")} }` : "{}";
}

// ─── Default y/N prompt ───────────────────────────────────────────────

async function defaultYesNoPrompt(question: string): Promise<boolean> {
  process.stdout.write(question);
  return new Promise<boolean>((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      if (buf.includes("\n")) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve(/^\s*y/i.test(buf));
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

// Re-use the existing heuristic by default — exported for tests.
export { inferDeployIntentHeuristic };
