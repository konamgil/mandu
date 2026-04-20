/**
 * @mandujs/core/scheduler
 *
 * Thin, production-minded wrapper around `Bun.cron` (Bun 1.3.12+). Adds four
 * things the native API doesn't give on its own:
 *
 *   1. **Overlap prevention** — a second tick that fires while the previous
 *      handler is still pending increments `skipCount` instead of running the
 *      body concurrently. Native `Bun.cron` documents the same guarantee but
 *      we also enforce it defensively and surface the skip count.
 *   2. **Per-tick timeout (soft)** — `timeoutMs` logs a warning and clears the
 *      in-flight flag so the *next* scheduled tick can run; it does NOT abort
 *      the current handler (Bun.cron has no cancellation primitive). The
 *      original handler keeps running; we just stop blocking future ticks on
 *      it. This is the best you can do against a hung job without killing the
 *      process.
 *   3. **Dev-mode skip** — jobs marked `skipInDev: true` are not registered
 *      when `NODE_ENV !== "production"`. They still appear in `status()` with
 *      zero counters so dashboards don't have to special-case them.
 *   4. **Graceful shutdown** — `stop()` prevents new ticks immediately and
 *      resolves once all in-flight handlers settle.
 *
 * Single-process assumption: there is NO distributed lock, NO persistent queue,
 * and NO cross-instance coordination. Running two processes with the same
 * `defineCron` config will fire each job on every process. Use a queue
 * (BullMQ, PG-boss, SQS) if you need exactly-once or multi-instance semantics.
 *
 * At-most-once on restart: if the process dies between ticks, the missed tick
 * is lost — `Bun.cron` computes "next fire" from the moment it starts, not
 * from a persisted schedule. Document this for any job whose absence matters.
 *
 * @example
 * ```ts
 * import { defineCron } from "@mandujs/core/scheduler";
 *
 * const jobs = defineCron({
 *   "clean:sessions": {
 *     schedule: "*\/15 * * * *",
 *     run: async () => { await db.exec("DELETE FROM sessions WHERE expires_at < now()"); },
 *     skipInDev: true,
 *   },
 *   "daily:report": {
 *     schedule: "0 3 * * *",
 *     run: async ({ scheduledAt }) => { await emailReport(scheduledAt); },
 *     timeoutMs: 5 * 60_000,
 *   },
 * });
 *
 * jobs.start();
 * // ...later, on shutdown:
 * await jobs.stop();
 * ```
 *
 * @module scheduler
 */

import { validateCronExpression, validateTimezone } from "./validate";
export { validateCronExpression, validateTimezone } from "./validate";

/** Context passed to each job handler. */
export interface CronContext {
  /** Job name (the key under which the job was registered). */
  name: string;
  /** The scheduled firing time (close to, but not exactly, now). */
  scheduledAt: Date;
  /**
   * Lightweight namespaced logger. Avoids forcing consumers to import the full
   * `@mandujs/core/logging` surface from inside a cron handler. Writes through
   * to `console.*` with a `[scheduler:<name>]` prefix.
   */
  log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * Where a job may execute. Consumers declare `runOn` on each job so a single
 * config can drive BOTH the local Bun runtime AND Cloudflare Workers Cron
 * Triggers:
 *
 *   - `"bun"`     — register with `Bun.cron()` at server boot.
 *   - `"workers"` — emit into `wrangler.toml` `[triggers] crons = [...]` at
 *                   build time; `createWorkersHandler` dispatches to the
 *                   handler on `scheduled(event)` invocation.
 *
 * Omitting the field defaults to `["bun", "workers"]` so a single job runs
 * everywhere it can without ceremony.
 */
export type CronRuntime = "bun" | "workers";

/** Configuration for a single cron job. */
export interface CronJobConfig {
  /** Crontab expression. Examples: "*\/15 * * * *", "0 3 * * *", "@daily". */
  schedule: string;
  /** Job handler. May be async; return value is ignored. */
  run: (ctx: CronContext) => void | Promise<void>;
  /** Skip registration in dev mode (NODE_ENV !== "production"). Default: false. */
  skipInDev?: boolean;
  /**
   * Soft timeout in ms. On timeout, a warning is logged and the in-flight flag
   * clears so the next tick can run. The current handler is NOT aborted —
   * Bun.cron has no cancellation primitive. Default: unlimited.
   */
  timeoutMs?: number;
  /**
   * IANA timezone for the schedule (e.g., `"UTC"`, `"America/New_York"`).
   * Passed through to `Bun.cron` which interprets the crontab expression
   * against this zone. **Not supported on Cloudflare Workers** — Workers cron
   * triggers always fire in UTC; emit a warning but still emit the crontab.
   *
   * Default: host system timezone (Bun.cron's default).
   */
  timezone?: string;
  /**
   * Runtimes on which this job should execute. When the job is instantiated
   * via `_defineCronWith` on a Bun host, only entries including `"bun"` are
   * registered with `Bun.cron`. The CLI emits wrangler triggers only for
   * entries including `"workers"`. Default: `["bun", "workers"]`.
   */
  runOn?: CronRuntime[];
}

/**
 * Declarative cron job definition (array form). Mirrors `CronJobConfig` but
 * lifts `name` inside the object so a single flat array can be passed:
 *
 * ```ts
 * export const cleanupJob = defineCron({
 *   name: 'cleanup-expired-sessions',
 *   schedule: '0 * * * *',
 *   timezone: 'UTC',
 *   runOn: ['bun', 'workers'],
 *   handler: async (ctx) => { ... },
 * });
 * ```
 *
 * `handler` is the canonical field name (Cloudflare convention); `run` is
 * accepted as an alias to match the existing object-form API.
 */
export interface CronDef {
  /** Unique job name. Used for logs, status(), and as the Map key internally. */
  name: string;
  /** Crontab expression or `@alias`. */
  schedule: string;
  /** Handler invoked on every tick. Canonical field. */
  handler?: (ctx: CronContext) => void | Promise<void>;
  /** Alias for `handler` — matches the object-form `CronJobConfig.run`. */
  run?: (ctx: CronContext) => void | Promise<void>;
  /** See {@link CronJobConfig.skipInDev}. */
  skipInDev?: boolean;
  /** See {@link CronJobConfig.timeoutMs}. */
  timeoutMs?: number;
  /** See {@link CronJobConfig.timezone}. */
  timezone?: string;
  /** See {@link CronJobConfig.runOn}. */
  runOn?: CronRuntime[];
}

/** Observable status for a single job. */
export interface CronJobStatus {
  /** Epoch ms of the last completed run, or null if never run. */
  lastRunAt: number | null;
  /** Duration of the last completed run in ms, or null if never run. */
  lastDurationMs: number | null;
  /** True while a handler is executing. */
  inFlight: boolean;
  /** Number of handler invocations that reached completion (including errors). */
  runCount: number;
  /** Number of ticks dropped because the previous run had not finished. */
  skipCount: number;
  /** Number of handler invocations that threw. */
  errorCount: number;
}

/** Handle returned by {@link defineCron}. */
export interface CronRegistration {
  /** Schedule all non-dev-skipped jobs. Idempotent — calling twice is a no-op. */
  start(): void;
  /** Stop accepting new ticks and wait for any in-flight handler to finish. */
  stop(): Promise<void>;
  /** Snapshot per-job statistics. */
  status(): Record<string, CronJobStatus>;
}

/** Minimal shape of the thing `Bun.cron` returns. */
interface CronJobHandle {
  stop?: () => void | Promise<void>;
}

/**
 * Function shape used to register a cron schedule. Matches `Bun.cron` but kept
 * abstract so tests can inject a controllable fake.
 *
 * @internal
 */
export type CronScheduleFn = (
  schedule: string,
  handler: () => void | Promise<void>,
) => CronJobHandle | void;

interface BunCronGlobal {
  cron?: CronScheduleFn;
}

/**
 * Resolves `Bun.cron` at call time. Throws a clear, actionable error when the
 * runtime doesn't provide it — matches the `auth/password.ts` style.
 */
function getBunCron(): CronScheduleFn {
  const g = globalThis as unknown as { Bun?: BunCronGlobal };
  if (!g.Bun || typeof g.Bun.cron !== "function") {
    throw new Error(
      "[@mandujs/core/scheduler] Bun.cron is unavailable — this module requires the Bun runtime (>= 1.3.12).",
    );
  }
  return g.Bun.cron;
}

/** Per-job mutable runtime state. */
interface JobState {
  readonly name: string;
  readonly config: CronJobConfig;
  readonly skipped: boolean;
  handle: CronJobHandle | null;
  status: CronJobStatus;
  /** Resolves when the in-flight handler (if any) finishes. */
  inFlightSettle: Promise<void> | null;
}

/**
 * Public `defineCron` — registers one or more cron jobs. Accepts two shapes:
 *
 *   1. Object-form: `defineCron({ name1: CronJobConfig, name2: CronJobConfig })`
 *      — the original API, preserved for backwards compatibility.
 *
 *   2. Array / single-entry form: `defineCron(CronDef | CronDef[])` — the
 *      flat-object shape documented in the Phase 18.λ spec. `name` is
 *      embedded in the object and `handler` is the canonical handler field
 *      (aliased as `run` for symmetry).
 *
 * Returns a `CronRegistration` handle. Does NOT auto-start — call `.start()`
 * from your server boot sequence (or let `startServer()` do it for you when
 * `scheduler.jobs` is set in `mandu.config.ts`).
 *
 * Schedule strings are validated synchronously via {@link validateCronExpression}
 * so malformed cron expressions fail fast at module-load time instead of
 * producing a silent "never fires" at runtime.
 */
export function defineCron(
  input: Record<string, CronJobConfig> | CronDef | CronDef[],
): CronRegistration {
  const jobs = normalizeDefineCronInput(input);
  // Probe lazily so `defineCron({})` with no entries can still be called in
  // environments without `Bun.cron`. When the user actually goes to `start()`,
  // the probe runs — matching `getBunPassword()` behaviour.
  return _defineCronWith(jobs, (schedule, handler) => getBunCron()(schedule, handler));
}

/**
 * Normalize the public `defineCron` input into the internal
 * `Record<string, CronJobConfig>` shape. Validates schedule + timezone fields
 * at the boundary so downstream code can assume they're well-formed.
 *
 * @internal — exported for test coverage only.
 */
export function normalizeDefineCronInput(
  input: Record<string, CronJobConfig> | CronDef | CronDef[],
): Record<string, CronJobConfig> {
  const out: Record<string, CronJobConfig> = {};

  const defs: CronDef[] = Array.isArray(input)
    ? input
    : isCronDef(input)
      ? [input as CronDef]
      : []; // fall through to the object-form branch below.

  if (defs.length > 0) {
    for (const def of defs) {
      if (typeof def.name !== "string" || def.name.length === 0) {
        throw new Error(
          `[@mandujs/core/scheduler] defineCron: every CronDef must have a non-empty "name" field.`,
        );
      }
      if (out[def.name] !== undefined) {
        throw new Error(
          `[@mandujs/core/scheduler] defineCron: duplicate job name "${def.name}".`,
        );
      }
      validateCronExpression(def.schedule);
      if (def.timezone !== undefined) validateTimezone(def.timezone);
      const handler = def.handler ?? def.run;
      if (typeof handler !== "function") {
        throw new Error(
          `[@mandujs/core/scheduler] defineCron: job "${def.name}" must define a "handler" (or "run") function.`,
        );
      }
      out[def.name] = {
        schedule: def.schedule,
        run: handler,
        skipInDev: def.skipInDev,
        timeoutMs: def.timeoutMs,
        timezone: def.timezone,
        runOn: def.runOn,
      };
    }
    return out;
  }

  // Object-form branch.
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [name, cfg] of Object.entries(input as Record<string, CronJobConfig>)) {
      if (!cfg || typeof cfg !== "object") {
        throw new Error(
          `[@mandujs/core/scheduler] defineCron: job "${name}" config must be an object.`,
        );
      }
      validateCronExpression(cfg.schedule);
      if (cfg.timezone !== undefined) validateTimezone(cfg.timezone);
      if (typeof cfg.run !== "function") {
        throw new Error(
          `[@mandujs/core/scheduler] defineCron: job "${name}" must define a "run" function.`,
        );
      }
      out[name] = cfg;
    }
  }

  return out;
}

function isCronDef(v: unknown): v is CronDef {
  return (
    typeof v === "object" &&
    v !== null &&
    "name" in (v as Record<string, unknown>) &&
    "schedule" in (v as Record<string, unknown>) &&
    (typeof (v as CronDef).handler === "function" ||
      typeof (v as CronDef).run === "function")
  );
}

/**
 * Return the list of jobs slated to run on a given runtime. Default `runOn`
 * for any job that omits the field is `["bun", "workers"]`, so a job with no
 * `runOn` key runs everywhere.
 */
export function filterJobsForRuntime<T extends { runOn?: CronRuntime[] }>(
  jobs: T[],
  runtime: CronRuntime,
): T[] {
  return jobs.filter((j) => {
    const runOn = j.runOn && j.runOn.length > 0 ? j.runOn : ["bun", "workers"];
    return runOn.includes(runtime);
  });
}

/**
 * Core constructor. Exposed for tests so they can inject a controllable fake
 * scheduler and drive ticks deterministically without touching real cron.
 *
 * @internal
 */
export function _defineCronWith(
  jobs: Record<string, CronJobConfig>,
  scheduleFn: CronScheduleFn,
): CronRegistration {
  const isProd =
    typeof process !== "undefined" && process.env?.NODE_ENV === "production";

  // Freeze the job set at definition time — no add/remove after construction.
  const names = Object.keys(jobs);
  const states: Map<string, JobState> = new Map();
  for (const name of names) {
    const config = jobs[name];
    // A job is "skipped" on this Bun host if:
    //   (a) skipInDev=true and we're not in prod, OR
    //   (b) runOn is set and does not include "bun" (workers-only, etc.).
    const runOn = config.runOn && config.runOn.length > 0 ? config.runOn : ["bun", "workers"];
    const skipped =
      (config.skipInDev === true && !isProd) || !runOn.includes("bun");
    states.set(name, {
      name,
      config,
      skipped,
      handle: null,
      status: {
        lastRunAt: null,
        lastDurationMs: null,
        inFlight: false,
        runCount: 0,
        skipCount: 0,
        errorCount: 0,
      },
      inFlightSettle: null,
    });
  }

  let started = false;
  let stopping = false;

  function makeTickHandler(state: JobState): () => Promise<void> {
    return async () => {
      // No new ticks once we've started stopping.
      if (stopping) return;

      // Overlap prevention: if the previous invocation is still running, skip.
      if (state.status.inFlight) {
        state.status.skipCount += 1;
        return;
      }

      state.status.inFlight = true;
      const startedAt = Date.now();

      const prefix = `[scheduler:${state.name}]`;
      const ctx: CronContext = {
        name: state.name,
        scheduledAt: new Date(startedAt),
        log: {
          info: (...args: unknown[]) => { console.log(prefix, ...args); },
          warn: (...args: unknown[]) => { console.warn(prefix, ...args); },
          error: (...args: unknown[]) => { console.error(prefix, ...args); },
        },
      };

      // The promise that future ticks (and `stop()`) wait on. We capture it
      // in a variable so the `.finally()` can resolve the outer promise even
      // if `run()` itself throws synchronously.
      let settleResolve!: () => void;
      const settle = new Promise<void>((r) => {
        settleResolve = r;
      });
      state.inFlightSettle = settle;

      const runAndCount = (async () => {
        try {
          await state.config.run(ctx);
        } catch (error) {
          state.status.errorCount += 1;
          // Error isolation — never let a handler crash the process.
          console.error(
            `[scheduler] job ${state.name} failed:`,
            error,
          );
        }
      })();

      // Decide whether to wait for the handler or give up after timeout.
      const timeoutMs = state.config.timeoutMs;
      if (typeof timeoutMs === "number" && timeoutMs > 0) {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeoutMarker = Symbol("timeout");
        const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
          timeoutHandle = setTimeout(() => resolve(timeoutMarker), timeoutMs);
        });

        const winner = await Promise.race([runAndCount.then(() => null), timeoutPromise]);

        if (winner === timeoutMarker) {
          // Handler is still running on its own. Log, clear inFlight so the
          // next tick can fire, but do NOT attempt to cancel — Bun.cron has
          // no cancellation and calling back into the handler would risk
          // double-execution.
          console.warn(
            `[scheduler] job ${state.name} exceeded timeoutMs=${timeoutMs} — future ticks may run while the previous handler is still executing.`,
          );
          state.status.runCount += 1;
          state.status.lastRunAt = Date.now();
          state.status.lastDurationMs = Date.now() - startedAt;
          state.status.inFlight = false;
          settleResolve();
          state.inFlightSettle = null;
          return;
        }

        // Handler finished first — clear the timeout to avoid a leaked timer.
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
      } else {
        await runAndCount;
      }

      state.status.runCount += 1;
      state.status.lastRunAt = Date.now();
      state.status.lastDurationMs = Date.now() - startedAt;
      state.status.inFlight = false;
      settleResolve();
      state.inFlightSettle = null;
    };
  }

  function start(): void {
    if (started) return;
    started = true;
    stopping = false;
    for (const state of states.values()) {
      if (state.skipped) continue;
      const tick = makeTickHandler(state);
      const handle = scheduleFn(state.config.schedule, tick);
      state.handle = handle ?? null;
    }
  }

  async function stop(): Promise<void> {
    if (!started) return;
    stopping = true;
    // Tell each underlying cron to stop firing new ticks. Handles returned
    // from `Bun.cron` may be void (docs show `await Bun.cron.remove(name)` as
    // the alternate shape), so we defensively handle both.
    const stopPromises: Array<Promise<void>> = [];
    for (const state of states.values()) {
      if (state.handle && typeof state.handle.stop === "function") {
        const r = state.handle.stop();
        if (r && typeof (r as Promise<void>).then === "function") {
          stopPromises.push(r as Promise<void>);
        }
      }
      state.handle = null;
    }
    if (stopPromises.length > 0) {
      await Promise.allSettled(stopPromises);
    }
    // Wait for any in-flight handler to settle.
    const inflight: Array<Promise<void>> = [];
    for (const state of states.values()) {
      if (state.inFlightSettle) inflight.push(state.inFlightSettle);
    }
    if (inflight.length > 0) {
      await Promise.allSettled(inflight);
    }
    started = false;
  }

  function status(): Record<string, CronJobStatus> {
    const out: Record<string, CronJobStatus> = {};
    for (const [name, state] of states) {
      // Snapshot (shallow clone) so callers can't mutate internal state.
      out[name] = { ...state.status };
    }
    return out;
  }

  return { start, stop, status };
}
