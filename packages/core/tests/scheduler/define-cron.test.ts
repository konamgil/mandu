/**
 * `defineCron` — public surface regression tests (Phase 18.λ).
 *
 * Covers the new array/single-entry form, validation, runOn filtering, and
 * timezone coercion. The existing object-form suite at
 * `packages/core/src/scheduler/__tests__/scheduler.test.ts` covers the
 * runtime scheduling semantics (overlap prevention, timeouts, etc.) — this
 * suite focuses on the NEW surface the Phase 18.λ spec adds.
 */

import { describe, expect, it } from "bun:test";
import {
  defineCron,
  normalizeDefineCronInput,
  filterJobsForRuntime,
  validateCronExpression,
  validateTimezone,
  type CronDef,
} from "../../src/scheduler";

describe("defineCron — array form (Phase 18.λ)", () => {
  it("accepts a single CronDef object and returns a CronRegistration", () => {
    const def: CronDef = {
      name: "cleanup-expired-sessions",
      schedule: "0 * * * *",
      timezone: "UTC",
      runOn: ["bun", "workers"],
      handler: async () => {},
    };
    const reg = defineCron(def);
    expect(typeof reg.start).toBe("function");
    expect(typeof reg.stop).toBe("function");
    expect(typeof reg.status).toBe("function");
    expect(Object.keys(reg.status())).toEqual(["cleanup-expired-sessions"]);
  });

  it("accepts an array of CronDef objects and preserves declaration order", () => {
    const reg = defineCron([
      { name: "a", schedule: "* * * * *", handler: () => {} },
      { name: "b", schedule: "0 * * * *", handler: () => {} },
      { name: "c", schedule: "@daily", handler: () => {} },
    ]);
    expect(Object.keys(reg.status())).toEqual(["a", "b", "c"]);
  });

  it("accepts `run` as an alias for `handler`", () => {
    const reg = defineCron([
      { name: "aliased", schedule: "* * * * *", run: () => {} },
    ]);
    expect(Object.keys(reg.status())).toEqual(["aliased"]);
  });

  it("rejects a CronDef missing both handler and run", () => {
    expect(() =>
      // Intentionally cast: the compile-time error is correct, but users
      // hand off untyped JS from config files so runtime validation matters.
      defineCron([{ name: "x", schedule: "* * * * *" } as unknown as CronDef]),
    ).toThrow(/defineCron|non-empty/);
  });

  it("rejects a CronDef with an empty name", () => {
    expect(() =>
      defineCron([{ name: "", schedule: "* * * * *", handler: () => {} }]),
    ).toThrow(/non-empty "name"/);
  });

  it("rejects duplicate job names in a single array", () => {
    expect(() =>
      defineCron([
        { name: "dup", schedule: "* * * * *", handler: () => {} },
        { name: "dup", schedule: "0 * * * *", handler: () => {} },
      ]),
    ).toThrow(/duplicate job name "dup"/);
  });

  it("validates the cron expression at definition time", () => {
    expect(() =>
      defineCron([
        { name: "bad", schedule: "not a cron", handler: () => {} },
      ]),
    ).toThrow(/invalid cron expression/);

    expect(() =>
      defineCron([
        { name: "bad-alias", schedule: "@notreal", handler: () => {} },
      ]),
    ).toThrow(/invalid cron alias/);
  });

  it("validates the timezone at definition time", () => {
    expect(() =>
      defineCron([
        {
          name: "tz",
          schedule: "* * * * *",
          timezone: "Not/A_Real_Zone",
          handler: () => {},
        },
      ]),
    ).toThrow(/unknown IANA timezone/);
  });
});

describe("normalizeDefineCronInput", () => {
  it("passes through the object form unchanged (backwards compat)", () => {
    const normalized = normalizeDefineCronInput({
      "legacy-job": { schedule: "* * * * *", run: () => {} },
    });
    expect(Object.keys(normalized)).toEqual(["legacy-job"]);
    expect(normalized["legacy-job"].schedule).toBe("* * * * *");
  });

  it("maps array-form CronDef → Record<string, CronJobConfig>", () => {
    const normalized = normalizeDefineCronInput([
      {
        name: "j1",
        schedule: "0 * * * *",
        timezone: "America/New_York",
        runOn: ["bun"],
        handler: () => {},
      },
    ]);
    expect(normalized.j1).toBeDefined();
    expect(normalized.j1.schedule).toBe("0 * * * *");
    expect(normalized.j1.timezone).toBe("America/New_York");
    expect(normalized.j1.runOn).toEqual(["bun"]);
    expect(typeof normalized.j1.run).toBe("function");
  });
});

describe("validateCronExpression", () => {
  it("accepts standard 5-field expressions", () => {
    expect(() => validateCronExpression("* * * * *")).not.toThrow();
    expect(() => validateCronExpression("0 * * * *")).not.toThrow();
    expect(() => validateCronExpression("*/15 * * * *")).not.toThrow();
    expect(() => validateCronExpression("0 3 * * *")).not.toThrow();
    expect(() => validateCronExpression("0 9-17 * * 1-5")).not.toThrow();
    expect(() => validateCronExpression("1,15,30 * * Jan-Jun Mon")).not.toThrow();
  });

  it("accepts named aliases", () => {
    for (const alias of ["@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"]) {
      expect(() => validateCronExpression(alias)).not.toThrow();
    }
  });

  it("rejects wrong field counts", () => {
    expect(() => validateCronExpression("* * * *")).toThrow(/5 space-separated fields/);
    expect(() => validateCronExpression("* * * * * *")).toThrow(/5 space-separated fields/);
  });

  it("rejects out-of-range numeric fields", () => {
    expect(() => validateCronExpression("60 * * * *")).toThrow(/out of range/); // minute max 59
    expect(() => validateCronExpression("* 24 * * *")).toThrow(/out of range/); // hour max 23
    expect(() => validateCronExpression("* * 32 * *")).toThrow(/out of range/); // dom max 31
    expect(() => validateCronExpression("* * * 13 *")).toThrow(/out of range/); // month max 12
  });

  it("rejects empty / non-string input", () => {
    expect(() => validateCronExpression("")).toThrow(/invalid cron expression/);
    expect(() => validateCronExpression("   ")).toThrow();
  });
});

describe("validateTimezone", () => {
  it("accepts common IANA zones", () => {
    expect(() => validateTimezone("UTC")).not.toThrow();
    expect(() => validateTimezone("America/New_York")).not.toThrow();
    expect(() => validateTimezone("Asia/Seoul")).not.toThrow();
    expect(() => validateTimezone("Europe/London")).not.toThrow();
  });

  it("rejects unknown zones", () => {
    expect(() => validateTimezone("Not/Real")).toThrow(/unknown IANA timezone/);
    expect(() => validateTimezone("America/Atlantis")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateTimezone("")).toThrow(/non-empty IANA string/);
  });
});

describe("filterJobsForRuntime", () => {
  it("includes jobs with no runOn on both bun and workers (default)", () => {
    const jobs = [{ name: "a", runOn: undefined }, { name: "b", runOn: [] }];
    expect(filterJobsForRuntime(jobs, "bun")).toHaveLength(2);
    expect(filterJobsForRuntime(jobs, "workers")).toHaveLength(2);
  });

  it("filters bun-only jobs out of the workers set", () => {
    const jobs: Array<{ name: string; runOn: ("bun" | "workers")[] }> = [
      { name: "a", runOn: ["bun"] },
      { name: "b", runOn: ["bun", "workers"] },
      { name: "c", runOn: ["workers"] },
    ];
    expect(filterJobsForRuntime(jobs, "bun").map((j) => j.name)).toEqual(["a", "b"]);
    expect(filterJobsForRuntime(jobs, "workers").map((j) => j.name)).toEqual(["b", "c"]);
  });
});
