/**
 * Scheduler runtime tests (Phase 18.λ).
 *
 * Exercises the `_defineCronWith` dispatcher through a controllable fake
 * scheduler to validate:
 *
 *   - runOn filtering (bun-only / workers-only / both)
 *   - Context surface (`ctx.log.*` exists and prefixes messages)
 *   - Schedule string propagation to the underlying scheduler
 *   - Timezone config survives normalization
 *   - Graceful shutdown for array-form jobs
 *
 * We deliberately avoid `Bun.cron` directly — the suite at
 * `packages/core/src/scheduler/__tests__/scheduler.test.ts` already covers
 * shutdown/overlap/error-isolation semantics end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  _defineCronWith,
  defineCron,
  normalizeDefineCronInput,
  type CronScheduleFn,
} from "../../src/scheduler";

interface FakeSchedule {
  schedule: string;
  handler: () => void | Promise<void>;
  stop: ReturnType<typeof mock>;
}

function makeFakeScheduler(): {
  scheduleFn: CronScheduleFn;
  schedules: FakeSchedule[];
  tick(index: number): Promise<void>;
} {
  const schedules: FakeSchedule[] = [];
  const scheduleFn: CronScheduleFn = (schedule, handler) => {
    const stop = mock(() => {});
    schedules.push({ schedule, handler, stop });
    return { stop };
  };
  return {
    scheduleFn,
    schedules,
    async tick(index: number): Promise<void> {
      const entry = schedules[index];
      if (!entry) throw new Error(`no schedule at index ${index}`);
      await entry.handler();
    },
  };
}

let originalNodeEnv: string | undefined;
beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production"; // ensure skipInDev doesn't mask runOn logic
});
afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("scheduler runtime — runOn filter", () => {
  it("registers a job on Bun when runOn is omitted (default both)", () => {
    const { scheduleFn, schedules } = makeFakeScheduler();
    const normalized = normalizeDefineCronInput([
      { name: "default-both", schedule: "* * * * *", handler: () => {} },
    ]);
    const reg = _defineCronWith(normalized, scheduleFn);
    reg.start();
    expect(schedules).toHaveLength(1);
    expect(schedules[0].schedule).toBe("* * * * *");
    // Status includes the job.
    expect(Object.keys(reg.status())).toEqual(["default-both"]);
  });

  it("registers a job when runOn explicitly includes 'bun'", () => {
    const { scheduleFn, schedules } = makeFakeScheduler();
    const normalized = normalizeDefineCronInput([
      { name: "bun-only", schedule: "0 * * * *", runOn: ["bun"], handler: () => {} },
      {
        name: "both",
        schedule: "0 0 * * *",
        runOn: ["bun", "workers"],
        handler: () => {},
      },
    ]);
    const reg = _defineCronWith(normalized, scheduleFn);
    reg.start();
    expect(schedules).toHaveLength(2);
    expect(schedules.map((s) => s.schedule).sort()).toEqual(["0 * * * *", "0 0 * * *"]);
  });

  it("does NOT register workers-only jobs with the Bun scheduler", async () => {
    const { scheduleFn, schedules } = makeFakeScheduler();
    const run = mock(() => {});
    const normalized = normalizeDefineCronInput([
      {
        name: "workers-only",
        schedule: "0 0 * * *",
        runOn: ["workers"],
        handler: run,
      },
    ]);
    const reg = _defineCronWith(normalized, scheduleFn);
    reg.start();
    // No entries registered on the Bun fake — the job is a no-op on Bun.
    expect(schedules).toHaveLength(0);
    // But it still appears in status() so observability dashboards can
    // render its existence.
    expect(reg.status()["workers-only"]).toBeDefined();
    expect(reg.status()["workers-only"].runCount).toBe(0);
    expect(run).toHaveBeenCalledTimes(0);
  });
});

describe("scheduler runtime — ctx.log", () => {
  it("passes a CronContext with a log.info/warn/error trio", async () => {
    const { scheduleFn, tick } = makeFakeScheduler();
    const originalLog = console.log;
    console.log = mock(() => {});

    try {
      type Captured = { info: unknown; warn: unknown; error: unknown };
      let captured: Captured | null = null;
      const normalized = normalizeDefineCronInput([
        {
          name: "logger",
          schedule: "* * * * *",
          handler: (ctx) => {
            captured = {
              info: typeof ctx.log.info,
              warn: typeof ctx.log.warn,
              error: typeof ctx.log.error,
            };
            ctx.log.info("hello");
          },
        },
      ]);
      const reg = _defineCronWith(normalized, scheduleFn);
      reg.start();
      await tick(0);

      expect(captured).not.toBeNull();
      expect(captured as unknown as Captured).toEqual({
        info: "function",
        warn: "function",
        error: "function",
      });

      // The log line was emitted through console.log with the namespaced prefix.
      const logMock = console.log as unknown as { mock: { calls: unknown[][] } };
      const matched = logMock.mock.calls.some((c) => String(c[0]).includes("[scheduler:logger]"));
      expect(matched).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });
});

describe("scheduler runtime — timezone survives normalization", () => {
  it("preserves timezone field through defineCron → CronJobConfig", () => {
    const normalized = normalizeDefineCronInput([
      {
        name: "tz",
        schedule: "0 9 * * *",
        timezone: "America/New_York",
        handler: () => {},
      },
    ]);
    expect(normalized.tz.timezone).toBe("America/New_York");
  });
});

describe("scheduler runtime — graceful shutdown for array-form", () => {
  it("stop() invokes each underlying schedule's stop()", async () => {
    const { scheduleFn, schedules } = makeFakeScheduler();
    const normalized = normalizeDefineCronInput([
      { name: "a", schedule: "* * * * *", handler: () => {} },
      { name: "b", schedule: "0 * * * *", handler: () => {} },
    ]);
    const reg = _defineCronWith(normalized, scheduleFn);
    reg.start();
    await reg.stop();
    for (const s of schedules) {
      expect(s.stop).toHaveBeenCalledTimes(1);
    }
  });
});

describe("scheduler runtime — defineCron public entrypoint", () => {
  it("returns a handle whose status matches the registered job names", () => {
    const reg = defineCron([
      { name: "j1", schedule: "* * * * *", handler: () => {} },
      { name: "j2", schedule: "0 * * * *", handler: () => {} },
    ]);
    expect(Object.keys(reg.status()).sort()).toEqual(["j1", "j2"]);
  });

  it("empty array is a no-op (no Bun.cron probe)", async () => {
    // Passing `[]` must not touch Bun.cron even if the runtime doesn't
    // provide it — matches the empty-record-form contract.
    const reg = defineCron([]);
    reg.start();
    await reg.stop();
    expect(reg.status()).toEqual({});
  });
});
