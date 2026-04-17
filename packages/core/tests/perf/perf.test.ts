/**
 * @mandujs/core/perf — measurement marker tests
 *
 * The perf module caches `MANDU_PERF` at module load. To exercise both the
 * enabled and disabled branches in a single test run, we mutate `process.env`
 * and call the exported `_resetCacheForTesting` helper.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  isPerfEnabled,
  mark,
  measure,
  withPerf,
  _resetCacheForTesting,
} from "../../src/perf/index";

function enablePerf(): void {
  process.env.MANDU_PERF = "1";
  _resetCacheForTesting();
}

function disablePerf(): void {
  delete process.env.MANDU_PERF;
  _resetCacheForTesting();
}

describe("@mandujs/core/perf", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    disablePerf();
  });

  describe("isPerfEnabled", () => {
    it("returns false when MANDU_PERF is unset", () => {
      disablePerf();
      expect(isPerfEnabled()).toBe(false);
    });

    it("returns true when MANDU_PERF=1", () => {
      enablePerf();
      expect(isPerfEnabled()).toBe(true);
    });

    it("returns false for any value other than '1'", () => {
      process.env.MANDU_PERF = "true";
      _resetCacheForTesting();
      expect(isPerfEnabled()).toBe(false);
    });
  });

  describe("mark + measure (enabled)", () => {
    beforeEach(() => enablePerf());

    it("returns a non-negative ms value and logs exactly once", async () => {
      mark("t1");
      // Non-zero delay so elapsed time is observably > 0
      await new Promise((resolve) => setTimeout(resolve, 5));
      const elapsed = measure("task one", "t1");

      expect(elapsed).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(elapsed)).toBe(true);
      expect(logSpy).toHaveBeenCalledTimes(1);

      const [line] = logSpy.mock.calls[0] as [string];
      expect(line).toMatch(/^\[perf\] task one: \d+\.\d{2}ms$/);
    });

    it("supports multiple concurrent markers", () => {
      mark("a");
      mark("b");
      const a = measure("label-a", "a");
      const b = measure("label-b", "b");
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(logSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("measure without prior mark", () => {
    it("returns 0, does not throw, does not log (enabled)", () => {
      enablePerf();
      const result = measure("never started", "missing-marker");
      expect(result).toBe(0);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("returns 0 when disabled even without mark", () => {
      disablePerf();
      const result = measure("never started", "missing-marker");
      expect(result).toBe(0);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("withPerf", () => {
    it("propagates the resolved return value (enabled)", async () => {
      enablePerf();
      const result = await withPerf("compute", () => 42);
      expect(result).toBe(42);
      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it("awaits promises and returns their value", async () => {
      enablePerf();
      const result = await withPerf("async-compute", async () => {
        await new Promise((resolve) => setTimeout(resolve, 3));
        return "done";
      });
      expect(result).toBe("done");
      expect(logSpy).toHaveBeenCalledTimes(1);
      const [line] = logSpy.mock.calls[0] as [string];
      expect(line).toMatch(/^\[perf\] async-compute: \d+\.\d{2}ms$/);
    });

    it("re-throws errors and still logs elapsed time", async () => {
      enablePerf();
      const boom = new Error("kaboom");
      await expect(
        withPerf("failing", () => {
          throw boom;
        }),
      ).rejects.toThrow("kaboom");
      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it("re-throws async rejections", async () => {
      enablePerf();
      await expect(
        withPerf("failing-async", async () => {
          throw new Error("async kaboom");
        }),
      ).rejects.toThrow("async kaboom");
      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it("invokes fn with no logging when disabled", async () => {
      disablePerf();
      const result = await withPerf("disabled-compute", () => 7);
      expect(result).toBe(7);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("no-op behaviour when disabled", () => {
    beforeEach(() => disablePerf());

    it("mark does not log", () => {
      mark("ignored");
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("mark + measure emits nothing", () => {
      mark("ignored");
      const elapsed = measure("still ignored", "ignored");
      expect(elapsed).toBe(0);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
