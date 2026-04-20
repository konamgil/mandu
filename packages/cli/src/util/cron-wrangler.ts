/**
 * `cron-wrangler` — helpers that translate `ManduConfig.scheduler.jobs`
 * (an array of {@link import("@mandujs/core/scheduler").CronDef}) into the
 * schedule strings consumed by `wrangler.toml`'s `[triggers] crons = [...]`
 * block.
 *
 * Runs only at build time when `mandu build --target=workers` is invoked.
 * Keeps the logic in a standalone util so `packages/cli/tests/util/` can
 * regression-test it without spinning up the full `emitWorkersBundle`
 * pipeline.
 *
 * Filter rules:
 *   - Jobs with `runOn` omitted run everywhere (`["bun", "workers"]` default).
 *   - Jobs with `runOn` set must include `"workers"` to be emitted.
 *   - Duplicate schedule strings are de-duplicated — Cloudflare accepts the
 *     same expression once, not once per job, since all jobs fire on every
 *     matched tick regardless.
 *   - Order is preserved (first occurrence wins).
 *
 * Timezone caveat: Cloudflare Workers Cron Triggers fire in **UTC only**. A
 * job that declares `timezone: "America/New_York"` will still be emitted
 * into `wrangler.toml` (the crontab expression is UTC-interpreted there),
 * and a warning is collected so the CLI can surface it to the user.
 */

import type { CronDef, CronRuntime } from "@mandujs/core/scheduler";

export interface CronWranglerExtraction {
  /**
   * De-duplicated, declaration-order list of cron schedule strings suitable
   * for `wrangler.toml` `[triggers] crons = [...]`. Empty when no workers-
   * eligible jobs are declared.
   */
  crons: string[];
  /**
   * Human-readable warnings the CLI should print to stderr. Non-fatal —
   * the build proceeds even when warnings are present. Typical contents:
   *
   *   - "job 'X' declares timezone 'America/New_York' but Workers Cron
   *      Triggers fire in UTC only."
   *   - "job 'X' has skipInDev=true — the flag is ignored on Workers."
   */
  warnings: string[];
  /** Count of jobs filtered out because their `runOn` excluded `"workers"`. */
  excludedCount: number;
}

/**
 * Given an array of `CronDef`, produce the `(crons, warnings)` tuple the
 * `emitWorkersBundle` caller forwards to `generateWranglerConfig`.
 *
 * Pure function — no I/O, no filesystem access, no environment lookups.
 * That keeps the regression tests trivial.
 */
export function extractWorkersCrons(jobs: CronDef[] | undefined): CronWranglerExtraction {
  const result: CronWranglerExtraction = {
    crons: [],
    warnings: [],
    excludedCount: 0,
  };
  if (!Array.isArray(jobs) || jobs.length === 0) return result;

  const seen = new Set<string>();

  for (const job of jobs) {
    if (!isWorkersEligible(job)) {
      result.excludedCount += 1;
      continue;
    }
    if (typeof job.schedule !== "string" || job.schedule.length === 0) {
      result.warnings.push(
        `job "${job.name}" has an empty schedule — skipped.`,
      );
      continue;
    }

    // Workers cron triggers DO NOT honour per-job timezones; they fire in
    // UTC. Users who declare a non-UTC zone should either switch to UTC on
    // Workers or run the job exclusively on Bun (`runOn: ["bun"]`). We
    // emit the cron anyway (it'll just fire on UTC wall-clock ticks).
    if (job.timezone && job.timezone !== "UTC") {
      result.warnings.push(
        `job "${job.name}" declares timezone "${job.timezone}", but ` +
          `Cloudflare Workers Cron Triggers fire in UTC only. ` +
          `Emitting schedule "${job.schedule}" against UTC — either accept ` +
          `the drift or move the job to \`runOn: ["bun"]\`.`,
      );
    }

    // `skipInDev` is a Bun-runtime concept (keyed on NODE_ENV). On Workers
    // the cron trigger is bound at deploy time; there is no dev/prod split
    // at invocation. Surface a warning so users don't silently assume the
    // flag guards their worker deploy.
    if (job.skipInDev === true) {
      result.warnings.push(
        `job "${job.name}" has \`skipInDev: true\` — this flag has no ` +
          `effect on Workers (the cron trigger fires on every deploy). ` +
          `Gate inside the handler if you want production-only behaviour.`,
      );
    }

    if (!seen.has(job.schedule)) {
      seen.add(job.schedule);
      result.crons.push(job.schedule);
    }
  }

  return result;
}

function isWorkersEligible(job: CronDef): boolean {
  const runOn: CronRuntime[] =
    Array.isArray(job.runOn) && job.runOn.length > 0
      ? (job.runOn as CronRuntime[])
      : ["bun", "workers"];
  return runOn.includes("workers");
}
