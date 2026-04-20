/**
 * `cron-wrangler` — regression tests for the `mandu build --target=workers`
 * cron-emission pipeline (Phase 18.λ).
 *
 * We verify the PURE `extractWorkersCrons` helper here (no filesystem, no
 * bundler). End-to-end emission through `emitWorkersBundle` already has
 * broad coverage in the workers-emitter suite; this file narrowly asserts
 * the schedule-selection logic.
 */

import { describe, expect, it } from "bun:test";
import type { CronDef } from "@mandujs/core/scheduler";
import { extractWorkersCrons } from "../cron-wrangler";

function job(partial: Partial<CronDef> & { name: string; schedule: string }): CronDef {
  return {
    handler: () => {},
    ...partial,
  };
}

describe("extractWorkersCrons — workers-eligible filter", () => {
  it("returns empty result for undefined / empty input", () => {
    expect(extractWorkersCrons(undefined)).toEqual({
      crons: [],
      warnings: [],
      excludedCount: 0,
    });
    expect(extractWorkersCrons([])).toEqual({
      crons: [],
      warnings: [],
      excludedCount: 0,
    });
  });

  it("includes jobs with runOn omitted (default runs everywhere)", () => {
    const r = extractWorkersCrons([
      job({ name: "a", schedule: "0 * * * *" }),
      job({ name: "b", schedule: "0 0 * * *" }),
    ]);
    expect(r.crons).toEqual(["0 * * * *", "0 0 * * *"]);
    expect(r.excludedCount).toBe(0);
  });

  it("excludes jobs whose runOn omits 'workers'", () => {
    const r = extractWorkersCrons([
      job({ name: "local", schedule: "* * * * *", runOn: ["bun"] }),
      job({ name: "both", schedule: "0 * * * *", runOn: ["bun", "workers"] }),
      job({ name: "edge", schedule: "@daily", runOn: ["workers"] }),
    ]);
    expect(r.crons).toEqual(["0 * * * *", "@daily"]);
    expect(r.excludedCount).toBe(1);
  });

  it("de-duplicates identical schedule strings", () => {
    const r = extractWorkersCrons([
      job({ name: "a", schedule: "0 * * * *" }),
      job({ name: "b", schedule: "0 * * * *" }), // dup schedule, distinct job
      job({ name: "c", schedule: "0 0 * * *" }),
    ]);
    expect(r.crons).toEqual(["0 * * * *", "0 0 * * *"]);
  });

  it("preserves declaration order (first occurrence wins)", () => {
    const r = extractWorkersCrons([
      job({ name: "c", schedule: "@hourly" }),
      job({ name: "a", schedule: "0 * * * *" }),
      job({ name: "b", schedule: "@daily" }),
    ]);
    expect(r.crons).toEqual(["@hourly", "0 * * * *", "@daily"]);
  });
});

describe("extractWorkersCrons — warnings", () => {
  it("warns when a non-UTC timezone is declared for a workers-eligible job", () => {
    const r = extractWorkersCrons([
      job({
        name: "tz",
        schedule: "0 9 * * *",
        timezone: "America/New_York",
      }),
    ]);
    expect(r.crons).toEqual(["0 9 * * *"]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/timezone "America\/New_York"/);
    expect(r.warnings[0]).toMatch(/UTC only/);
  });

  it("does NOT warn when timezone is UTC (the Workers default)", () => {
    const r = extractWorkersCrons([
      job({ name: "tz", schedule: "0 9 * * *", timezone: "UTC" }),
    ]);
    expect(r.warnings).toHaveLength(0);
  });

  it("warns when skipInDev is true for a workers-eligible job", () => {
    const r = extractWorkersCrons([
      job({ name: "sk", schedule: "* * * * *", skipInDev: true }),
    ]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/skipInDev: true/);
    expect(r.warnings[0]).toMatch(/no effect on Workers/);
  });

  it("does NOT warn about timezone / skipInDev for bun-only jobs", () => {
    const r = extractWorkersCrons([
      job({
        name: "local",
        schedule: "* * * * *",
        runOn: ["bun"],
        timezone: "America/New_York",
        skipInDev: true,
      }),
    ]);
    expect(r.warnings).toHaveLength(0);
    expect(r.excludedCount).toBe(1);
  });

  it("skips jobs with an empty schedule string and warns", () => {
    const r = extractWorkersCrons([
      job({ name: "empty", schedule: "" }),
      job({ name: "ok", schedule: "* * * * *" }),
    ]);
    expect(r.crons).toEqual(["* * * * *"]);
    expect(r.warnings.some((w) => w.includes('job "empty"'))).toBe(true);
  });
});
