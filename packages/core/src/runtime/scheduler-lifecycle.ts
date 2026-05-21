import type { CronDef, CronRegistration } from "../scheduler";
import type * as SchedulerModule from "../scheduler";
import type * as SchedulerCronMiddlewareModule from "../middleware/scheduler-cron";

export interface RuntimeSchedulerOptions {
  jobs?: CronDef[];
  disabled?: boolean;
}

export interface RuntimeSchedulerLifecycle {
  stop(): void;
}

export function startRuntimeSchedulerLifecycle(
  schedulerOption: RuntimeSchedulerOptions | undefined,
): RuntimeSchedulerLifecycle {
  let schedulerRegistration: CronRegistration | null = null;
  let clearActiveRegistration = (): void => {};

  const jobDefs = schedulerOption?.jobs ?? [];
  const schedulerDisabled = schedulerOption?.disabled === true;

  if (jobDefs.length > 0 && !schedulerDisabled) {
    try {
      const { defineCron } = require("../scheduler") as typeof SchedulerModule;
      const { setActiveSchedulerRegistration } = require("../middleware/scheduler-cron") as typeof SchedulerCronMiddlewareModule;
      schedulerRegistration = defineCron(jobDefs);
      schedulerRegistration.start();
      setActiveSchedulerRegistration(schedulerRegistration);
      clearActiveRegistration = () => setActiveSchedulerRegistration(null);

      const bunJobCount = Object.keys(schedulerRegistration.status()).filter((name) => {
        const def = jobDefs.find((job) => job.name === name);
        const runOn = def?.runOn && def.runOn.length > 0 ? def.runOn : ["bun", "workers"];
        return runOn.includes("bun");
      }).length;

      console.log(
        `⏰ Scheduler: ${bunJobCount} cron job(s) registered on Bun runtime` +
          (jobDefs.length !== bunJobCount
            ? ` (${jobDefs.length - bunJobCount} workers-only — see wrangler.toml)`
            : ""),
      );
    } catch (err) {
      console.error(
        "❌ [scheduler] failed to start — HTTP server continues without cron jobs:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    stop(): void {
      if (!schedulerRegistration) return;
      const reg = schedulerRegistration;
      schedulerRegistration = null;
      void reg.stop()
        .then(() => clearActiveRegistration())
        .catch((err) => {
          console.error("[scheduler] shutdown error:", err);
        });
    },
  };
}
