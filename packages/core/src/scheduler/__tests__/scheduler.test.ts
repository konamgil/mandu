/**
 * @mandujs/core/scheduler tests
 *
 * These tests inject a controllable fake scheduler via `_defineCronWith`
 * so we never touch `Bun.cron` directly. This keeps the suite fast,
 * deterministic, and independent of Bun runtime version (`Bun.cron` only
 * landed in 1.3.12). The fake captures the tick callback for each job and
 * exposes a `tick()` method the test drives manually.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  _defineCronWith,
  defineCron,
  type CronJobConfig,
  type CronScheduleFn,
} from "../index";

/**
 * Minimal scheduler fake: records `(schedule, handler)` pairs, lets the test
 * drive ticks, and returns a stop-able handle so we can assert graceful
 * shutdown behaviour.
 */
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
      if (!entry) throw new Error(`No schedule at index ${index}`);
      await entry.handler();
    },
  };
}

/** Drain microtasks so inFlight promises settle without advancing timers. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// Preserve NODE_ENV across tests that mutate it.
let originalNodeEnv: string | undefined;

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV;
});

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe("@mandujs/core/compat/scheduler — defineCron (public surface)", () => {
  it("returns a handle with start, stop, and status methods", () => {
    const reg = defineCron({});
    expect(typeof reg.start).toBe("function");
    expect(typeof reg.stop).toBe("function");
    expect(typeof reg.status).toBe("function");
  });

  it("accepts an empty job set; start and stop are no-ops", async () => {
    const reg = defineCron({});
    // Neither call should touch Bun.cron — if it did, this test would blow up
    // in environments where Bun.cron isn't present (Bun < 1.3.12).
    reg.start();
    await reg.stop();
    expect(reg.status()).toEqual({});
  });
});

describe("@mandujs/core/compat/scheduler — scheduling", () => {
  it("registers each job via the injected scheduleFn with its crontab expression", () => {
    const { scheduleFn, schedules } = makeFakeScheduler();

    const reg = _defineCronWith(
      {
        "clean:sessions": { schedule: "*/15 * * * *", run: () => {} },
        "daily:report": { schedule: "0 3 * * *", run: () => {} },
      },
      scheduleFn,
    );

    reg.start();

    expect(schedules).toHaveLength(2);
    expect(schedules.map((s) => s.schedule).sort()).toEqual([
      "*/15 * * * *",
      "0 3 * * *",
    ]);
  });

  it("calls the handler once per tick and updates status counters", async () => {
    const { scheduleFn, tick } = makeFakeScheduler();
    const run = mock(async () => {});

    const reg = _defineCronWith(
      { "j1": { schedule: "* * * * *", run } },
      scheduleFn,
    );
    reg.start();

    await tick(0);
    expect(run).toHaveBeenCalledTimes(1);
    const s1 = reg.status().j1;
    expect(s1.runCount).toBe(1);
    expect(s1.errorCount).toBe(0);
    expect(s1.skipCount).toBe(0);
    expect(s1.inFlight).toBe(false);
    expect(typeof s1.lastRunAt).toBe("number");
    expect(typeof s1.lastDurationMs).toBe("number");
    expect((s1.lastDurationMs as number) >= 0).toBe(true);

    await tick(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(reg.status().j1.runCount).toBe(2);
  });

  it("passes a CronContext with the job name and scheduledAt Date", async () => {
    const { scheduleFn, tick } = makeFakeScheduler();
    const seen: Array<{ name: string; scheduledAt: Date }> = [];

    const reg = _defineCronWith(
      {
        "ctx-job": {
          schedule: "* * * * *",
          run: (ctx) => {
            seen.push({ name: ctx.name, scheduledAt: ctx.scheduledAt });
          },
        },
      },
      scheduleFn,
    );
    reg.start();

    await tick(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe("ctx-job");
    expect(seen[0].scheduledAt).toBeInstanceOf(Date);
    // Within a reasonable clock skew (1 minute) of wall time.
    const delta = Math.abs(Date.now() - seen[0].scheduledAt.getTime());
    expect(delta).toBeLessThan(60_000);
  });
});

describe("@mandujs/core/compat/scheduler — error isolation", () => {
  it("increments errorCount when the handler throws and continues on next tick", async () => {
    const { scheduleFn, tick } = makeFakeScheduler();
    // Silence the expected console.error so test output stays clean.
    const originalError = console.error;
    console.error = mock(() => {});

    try {
      let calls = 0;
      const reg = _defineCronWith(
        {
          "err": {
            schedule: "* * * * *",
            run: async () => {
              calls++;
              if (calls === 1) throw new Error("boom");
            },
          },
        },
        scheduleFn,
      );
      reg.start();

      await tick(0);
      const afterFirst = reg.status().err;
      expect(afterFirst.errorCount).toBe(1);
      expect(afterFirst.runCount).toBe(1);
      expect(afterFirst.inFlight).toBe(false);

      await tick(0); // second tick should still run despite prior error
      const afterSecond = reg.status().err;
      expect(afterSecond.errorCount).toBe(1);
      expect(afterSecond.runCount).toBe(2);

      // Sanity: console.error was invoked with our namespaced prefix.
      const errorMock = console.error as unknown as { mock: { calls: unknown[] } };
      expect(errorMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      console.error = originalError;
    }
  });
});

describe("@mandujs/core/compat/scheduler — overlap prevention", () => {
  it("skips a tick when the previous invocation is still pending", async () => {
    const { scheduleFn, tick } = makeFakeScheduler();

    // Controllable promise so the first tick's handler hangs until we release it.
    let release!: () => void;
    const hang = new Promise<void>((r) => {
      release = r;
    });
    const run = mock(async () => {
      await hang;
    });

    const reg = _defineCronWith(
      { "slow": { schedule: "* * * * *", run } },
      scheduleFn,
    );
    reg.start();

    // Fire tick 1 (hangs).
    const first = tick(0);
    await flushMicrotasks();
    expect(reg.status().slow.inFlight).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);

    // Fire tick 2 while tick 1 is still pending — must skip.
    await tick(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(reg.status().slow.skipCount).toBe(1);

    // Fire tick 3 — also skips.
    await tick(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(reg.status().slow.skipCount).toBe(2);

    // Release the hung handler; subsequent ticks should run again.
    release();
    await first;

    await tick(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(reg.status().slow.skipCount).toBe(2); // unchanged
    expect(reg.status().slow.runCount).toBe(2);
  });
});

describe("@mandujs/core/compat/scheduler — dev-mode skip", () => {
  it("does not schedule jobs with skipInDev=true when NODE_ENV !== 'production'", () => {
    process.env.NODE_ENV = "development";
    const { scheduleFn, schedules } = makeFakeScheduler();

    const reg = _defineCronWith(
      {
        "prod-only": { schedule: "* * * * *", run: () => {}, skipInDev: true },
        "always":    { schedule: "* * * * *", run: () => {} },
      },
      scheduleFn,
    );
    reg.start();

    // Only the non-skipped job registered.
    expect(schedules).toHaveLength(1);

    // Status still reports the skipped job with zero counters so observability
    // dashboards don't have to special-case its absence.
    const status = reg.status();
    expect(status["prod-only"]).toBeDefined();
    expect(status["prod-only"].runCount).toBe(0);
    expect(status["always"]).toBeDefined();
  });

  it("DOES schedule skipInDev jobs when NODE_ENV === 'production'", async () => {
    process.env.NODE_ENV = "production";
    const { scheduleFn, schedules, tick } = makeFakeScheduler();
    const run = mock(() => {});

    const reg = _defineCronWith(
      { "prod-only": { schedule: "* * * * *", run, skipInDev: true } },
      scheduleFn,
    );
    reg.start();

    expect(schedules).toHaveLength(1);
    await tick(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(reg.status()["prod-only"].runCount).toBe(1);
  });
});

describe("@mandujs/core/compat/scheduler — timeout", () => {
  it("marks the tick as completed after timeoutMs and clears inFlight so the next tick can fire", async () => {
    const { scheduleFn, tick } = makeFakeScheduler();
    // Silence the expected console.warn.
    const originalWarn = console.warn;
    console.warn = mock(() => {});

    try {
      // A handler that never resolves on its own — only the timeout will
      // release the scheduler from "in-flight".
      const run = mock(() => new Promise<void>(() => {}));

      const reg = _defineCronWith(
        {
          "slow": {
            schedule: "* * * * *",
            run,
            timeoutMs: 10,
          },
        },
        scheduleFn,
      );
      reg.start();

      // First tick hangs, then times out after 10ms.
      await tick(0);
      expect(run).toHaveBeenCalledTimes(1);

      const afterTimeout = reg.status().slow;
      expect(afterTimeout.inFlight).toBe(false);
      expect(afterTimeout.runCount).toBe(1);

      // Second tick can now fire since inFlight is cleared.
      await tick(0);
      expect(run).toHaveBeenCalledTimes(2);
      expect(reg.status().slow.runCount).toBe(2);

      const warnMock = console.warn as unknown as { mock: { calls: unknown[] } };
      expect(warnMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("@mandujs/core/compat/scheduler — shutdown", () => {
  it("stop() waits for in-flight handlers to complete before resolving", async () => {
    const { scheduleFn, tick } = makeFakeScheduler();

    let release!: () => void;
    const hang = new Promise<void>((r) => {
      release = r;
    });
    let handlerFinished = false;

    const reg = _defineCronWith(
      {
        "slow": {
          schedule: "* * * * *",
          run: async () => {
            await hang;
            handlerFinished = true;
          },
        },
      },
      scheduleFn,
    );
    reg.start();

    // Kick off a tick and wait for it to be observed in-flight.
    const tickPromise = tick(0);
    await flushMicrotasks();
    expect(reg.status().slow.inFlight).toBe(true);

    // stop() should be pending until the handler finishes.
    let stopResolved = false;
    const stopPromise = reg.stop().then(() => {
      stopResolved = true;
    });

    await flushMicrotasks();
    expect(stopResolved).toBe(false);
    expect(handlerFinished).toBe(false);

    // Release the handler; stop() should now resolve.
    release();
    await tickPromise;
    await stopPromise;
    expect(handlerFinished).toBe(true);
    expect(stopResolved).toBe(true);
  });

  it("stop() invokes each underlying schedule's stop() so no new ticks fire", async () => {
    const { scheduleFn, schedules } = makeFakeScheduler();

    const reg = _defineCronWith(
      {
        "a": { schedule: "* * * * *", run: () => {} },
        "b": { schedule: "* * * * *", run: () => {} },
      },
      scheduleFn,
    );
    reg.start();
    await reg.stop();

    expect(schedules[0].stop).toHaveBeenCalledTimes(1);
    expect(schedules[1].stop).toHaveBeenCalledTimes(1);
  });

  it("start() then stop() then start() is a clean restart; counters are preserved", async () => {
    const { scheduleFn, schedules, tick } = makeFakeScheduler();
    const run = mock(() => {});

    const reg = _defineCronWith(
      { "j": { schedule: "* * * * *", run } },
      scheduleFn,
    );

    reg.start();
    await tick(0);
    expect(reg.status().j.runCount).toBe(1);

    await reg.stop();
    expect(reg.status().j.runCount).toBe(1); // preserved

    // Second start() re-registers with the fake.
    reg.start();
    expect(schedules).toHaveLength(2);

    // New handler was registered; drive it via its new index.
    await tick(1);
    expect(reg.status().j.runCount).toBe(2);
  });

  it("start() is idempotent — calling twice does not double-register", () => {
    const { scheduleFn, schedules } = makeFakeScheduler();

    const reg = _defineCronWith(
      { "j": { schedule: "* * * * *", run: () => {} } },
      scheduleFn,
    );

    reg.start();
    reg.start();
    expect(schedules).toHaveLength(1);
  });
});

describe("@mandujs/core/compat/scheduler — status shape", () => {
  it("returns a fully populated CronJobStatus for every registered job", () => {
    const { scheduleFn } = makeFakeScheduler();
    const jobs: Record<string, CronJobConfig> = {
      "a": { schedule: "* * * * *", run: () => {} },
      "b": { schedule: "* * * * *", run: () => {}, skipInDev: true },
    };
    process.env.NODE_ENV = "development";

    const reg = _defineCronWith(jobs, scheduleFn);
    reg.start();

    const status = reg.status();
    expect(Object.keys(status).sort()).toEqual(["a", "b"]);

    for (const s of Object.values(status)) {
      expect(s).toHaveProperty("lastRunAt");
      expect(s).toHaveProperty("lastDurationMs");
      expect(s).toHaveProperty("inFlight");
      expect(s).toHaveProperty("runCount");
      expect(s).toHaveProperty("skipCount");
      expect(s).toHaveProperty("errorCount");
      expect(s.lastRunAt).toBeNull();
      expect(s.lastDurationMs).toBeNull();
      expect(s.inFlight).toBe(false);
      expect(s.runCount).toBe(0);
      expect(s.skipCount).toBe(0);
      expect(s.errorCount).toBe(0);
    }
  });

  it("returns a shallow-cloned snapshot so callers cannot mutate internal state", async () => {
    const { scheduleFn, tick } = makeFakeScheduler();
    const reg = _defineCronWith(
      { "j": { schedule: "* * * * *", run: () => {} } },
      scheduleFn,
    );
    reg.start();
    await tick(0);

    const snap = reg.status();
    snap.j.runCount = 999;
    expect(reg.status().j.runCount).toBe(1);
  });
});

describe("@mandujs/core/compat/scheduler — public defineCron probe", () => {
  it("throws a clear error when Bun.cron is unavailable and start() is invoked", () => {
    // Bun 1.3.10 (the test environment here) does not expose Bun.cron. The
    // module should surface a readable error that names the required version.
    const hasBunCron =
      typeof (globalThis as { Bun?: { cron?: unknown } }).Bun?.cron === "function";

    const reg = defineCron({
      "noop": { schedule: "* * * * *", run: () => {} },
    });

    if (hasBunCron) {
      // Bun.cron exists — defineCron should succeed. We can't reliably call
      // real .stop() here without waiting for real cron, so just verify start
      // doesn't throw.
      expect(() => reg.start()).not.toThrow();
      // Best effort cleanup.
      void reg.stop();
    } else {
      expect(() => reg.start()).toThrow(/Bun\.cron is unavailable/);
    }
  });
});
