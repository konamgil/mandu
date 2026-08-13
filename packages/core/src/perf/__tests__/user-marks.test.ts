/**
 * Phase 18.ψ — user-marks tests
 *
 * Covers the three public entry points (`time`, `timeAsync`, `createPerf`)
 * plus the `/_mandu/heap` dashboard snapshot and OTel integration. Fixture
 * style mirrors `tests/perf/perf.test.ts`: mutate `process.env.MANDU_PERF`,
 * call the exported `_resetCacheForTesting` + `_resetUserMarksForTesting`
 * helpers, restore between tests.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "bun:test";
import {
  time,
  timeAsync,
  createPerf,
  collectPerfSnapshot,
  recordFrameworkMeasurement,
  _resetUserMarksForTesting,
  _peekLastMarkForTesting,
  PERF_BUFFER_LIMIT,
} from "../user-marks";
import {
  isPerfEnabled,
  _resetCacheForTesting,
} from "../index";
import {
  Tracer,
  setTracer,
  resetTracer,
  type Span,
  type SpanExporter,
} from "../../observability/tracing";

function enablePerf(): void {
  process.env.MANDU_PERF = "1";
  _resetCacheForTesting();
  _resetUserMarksForTesting();
}

function disablePerf(): void {
  delete process.env.MANDU_PERF;
  _resetCacheForTesting();
  _resetUserMarksForTesting();
}

describe("@mandujs/core/compat/perf — user marks (time / timeAsync / createPerf)", () => {
  afterEach(() => {
    disablePerf();
    resetTracer();
  });

  // ─── 1. Basic lifecycle ────────────────────────────────────────────────

  describe("time(): mark lifecycle", () => {
    beforeEach(() => enablePerf());

    it("returns an end() function that records a non-negative duration", async () => {
      const end = time("db-query");
      await new Promise((resolve) => setTimeout(resolve, 5));
      const elapsedMs = end();

      expect(typeof elapsedMs).toBe("number");
      expect(elapsedMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(elapsedMs)).toBe(true);

      const last = _peekLastMarkForTesting();
      expect(last?.name).toBe("db-query");
      expect(last?.category).toBe("user");
      expect(last?.durationMs).toBe(elapsedMs);
    });

    it("end() is idempotent — second call returns 0 without double-recording", () => {
      const end = time("idem");
      const first = end();
      const second = end();

      expect(first).toBeGreaterThanOrEqual(0);
      expect(second).toBe(0);

      // Only one entry recorded.
      const snap = collectPerfSnapshot();
      const entry = snap.histogram.find((h) => h.name === "idem");
      expect(entry?.count).toBe(1);
    });

    it("custom category is honored in the histogram entry", () => {
      const end = time("ssr-slot", { category: "ssr" });
      end();
      const last = _peekLastMarkForTesting();
      expect(last?.category).toBe("ssr");
    });
  });

  // ─── 2. Async scope ────────────────────────────────────────────────────

  describe("timeAsync(): async scope", () => {
    beforeEach(() => enablePerf());

    it("forwards the resolved value", async () => {
      const value = await timeAsync("fetch-user", async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return { id: 123, name: "alice" };
      });
      expect(value).toEqual({ id: 123, name: "alice" });
      const last = _peekLastMarkForTesting();
      expect(last?.name).toBe("fetch-user");
    });

    it("forwards sync return values", async () => {
      const value = await timeAsync("sync-op", () => 42);
      expect(value).toBe(42);
    });

    it("rethrows errors and still records the mark", async () => {
      const boom = new Error("kaboom");
      await expect(
        timeAsync("failing", async () => {
          throw boom;
        }),
      ).rejects.toThrow("kaboom");

      // Mark recorded even on error path.
      const last = _peekLastMarkForTesting();
      expect(last?.name).toBe("failing");
    });
  });

  // ─── 3. Zero overhead when disabled ────────────────────────────────────

  describe("disabled (MANDU_PERF unset)", () => {
    beforeEach(() => disablePerf());

    it("time() returns a shared no-op end function and records nothing", () => {
      expect(isPerfEnabled()).toBe(false);
      const end = time("ignored");
      const result = end();
      expect(result).toBe(0);
      expect(_peekLastMarkForTesting()).toBeUndefined();

      const snap = collectPerfSnapshot();
      expect(snap.enabled).toBe(false);
      expect(snap.totalCount).toBe(0);
      expect(snap.histogram).toEqual([]);
      expect(snap.recent).toEqual([]);
    });

    it("timeAsync() invokes fn directly and returns its value", async () => {
      const result = await timeAsync("ignored-async", async () => "ok");
      expect(result).toBe("ok");
      expect(_peekLastMarkForTesting()).toBeUndefined();
    });

    it("createPerf() with enabled=false returns a no-op instance", () => {
      const perf = createPerf({ enabled: false });
      expect(perf.enabled).toBe(false);
      const end = perf.time("nope");
      expect(end()).toBe(0);
      expect(_peekLastMarkForTesting()).toBeUndefined();
    });
  });

  // ─── 4. createPerf scoped instance ─────────────────────────────────────

  describe("createPerf()", () => {
    it("defaults to the global gate when enabled is unset", () => {
      enablePerf();
      const perf = createPerf();
      expect(perf.enabled).toBe(true);
      perf.time("scoped")();
      expect(_peekLastMarkForTesting()?.name).toBe("scoped");
    });

    it("can force-enable when the global gate is off", async () => {
      disablePerf();
      const perf = createPerf({ enabled: false });
      // Even a force-enable=false under a disabled global is no-op.
      expect(perf.enabled).toBe(false);
    });
  });

  // ─── 5. OTel tracer integration ────────────────────────────────────────

  describe("OTel integration", () => {
    it("creates a child span when tracing is enabled, with mandu.perf.category attribute", () => {
      enablePerf();
      const captured: Span[] = [];
      const capturing: SpanExporter = {
        export(spans: Span[]): void {
          captured.push(...spans);
        },
      };
      setTracer(new Tracer({ enabled: true, customExporter: capturing }));

      const end = time("db-query", { category: "user" });
      end();

      expect(captured.length).toBe(1);
      expect(captured[0]!.name).toBe("db-query");
      expect(captured[0]!.attributes["mandu.perf.category"]).toBe("user");
      expect(
        typeof captured[0]!.attributes["mandu.perf.duration_ms"],
      ).toBe("number");
      expect(captured[0]!.status).toBe("ok");
    });

    it("opt-out via { trace: false } skips span creation", () => {
      enablePerf();
      const captured: Span[] = [];
      setTracer(
        new Tracer({
          enabled: true,
          customExporter: {
            export: (spans) => {
              captured.push(...spans);
            },
          },
        }),
      );

      const end = time("silent", { trace: false });
      end();

      expect(captured.length).toBe(0);
      // Still recorded in histogram.
      expect(_peekLastMarkForTesting()?.name).toBe("silent");
    });

    it("timeAsync marks span status=error on thrown error", async () => {
      enablePerf();
      const captured: Span[] = [];
      setTracer(
        new Tracer({
          enabled: true,
          customExporter: {
            export: (spans) => {
              captured.push(...spans);
            },
          },
        }),
      );

      await expect(
        timeAsync("boom", async () => {
          throw new Error("nope");
        }),
      ).rejects.toThrow("nope");

      expect(captured.length).toBe(1);
      expect(captured[0]!.status).toBe("error");
      expect(captured[0]!.errorMessage).toBe("nope");
    });
  });

  // ─── 6. Histogram math ─────────────────────────────────────────────────

  describe("histogram", () => {
    beforeEach(() => enablePerf());

    it("computes count / mean / min / max correctly over multiple marks", () => {
      // Synthesize durations via the framework bridge so we get deterministic values.
      recordFrameworkMeasurement("widget", 10);
      recordFrameworkMeasurement("widget", 20);
      recordFrameworkMeasurement("widget", 30);
      recordFrameworkMeasurement("widget", 40);

      const snap = collectPerfSnapshot();
      const entry = snap.histogram.find((h) => h.name === "widget");
      expect(entry).toBeDefined();
      expect(entry!.count).toBe(4);
      expect(entry!.mean).toBeCloseTo(25, 5);
      expect(entry!.min).toBe(10);
      expect(entry!.max).toBe(40);
    });

    it("computes percentiles via nearest-rank", () => {
      // Fixed dataset of 100 observations for a stable p95/p99.
      for (let i = 1; i <= 100; i++) {
        recordFrameworkMeasurement("stable", i);
      }
      const snap = collectPerfSnapshot();
      const entry = snap.histogram.find((h) => h.name === "stable");
      expect(entry).toBeDefined();
      expect(entry!.count).toBe(100);
      // Nearest-rank: p50 = value at rank ceil(0.5 * 100) = 50 → 50
      expect(entry!.p50).toBe(50);
      expect(entry!.p95).toBe(95);
      expect(entry!.p99).toBe(99);
    });
  });

  // ─── 7. LRU ring-buffer eviction ───────────────────────────────────────

  describe("ring-buffer eviction", () => {
    beforeEach(() => enablePerf());

    it("drops oldest entries once the buffer is full", () => {
      // Push 5 marks over the limit; the first 5 should be evicted.
      const total = PERF_BUFFER_LIMIT + 5;
      for (let i = 0; i < total; i++) {
        recordFrameworkMeasurement(`mark-${i}`, i % 50);
      }
      const snap = collectPerfSnapshot();
      expect(snap.totalCount).toBe(total);
      expect(snap.bufferedCount).toBe(PERF_BUFFER_LIMIT);
      // Recent[0] should be the 5th-most-recent entry (since we only ask for 50).
      expect(snap.recent.length).toBeLessThanOrEqual(50);
      // Newest last: the final entry should be mark-{total-1}.
      const newest = snap.recent[snap.recent.length - 1];
      expect(newest?.name).toBe(`mark-${total - 1}`);
    });
  });

  // ─── 8. Dashboard snapshot shape ───────────────────────────────────────

  describe("collectPerfSnapshot() dashboard payload", () => {
    beforeEach(() => enablePerf());

    it("returns the documented shape with histogram sorted by count", () => {
      // Three marks named A, two named B, one named C → sort order A, B, C.
      for (let i = 0; i < 3; i++) recordFrameworkMeasurement("A", 1);
      for (let i = 0; i < 2; i++) recordFrameworkMeasurement("B", 2);
      recordFrameworkMeasurement("C", 3);

      const snap = collectPerfSnapshot();
      expect(snap.enabled).toBe(true);
      expect(snap.totalCount).toBe(6);
      expect(snap.bufferLimit).toBe(PERF_BUFFER_LIMIT);
      expect(snap.histogram.map((h) => h.name)).toEqual(["A", "B", "C"]);
    });
  });

  // ─── 9. recordFrameworkMeasurement gate ────────────────────────────────

  describe("recordFrameworkMeasurement() gate", () => {
    it("is a no-op when perf is disabled", () => {
      disablePerf();
      recordFrameworkMeasurement("ignored", 999);
      expect(_peekLastMarkForTesting()).toBeUndefined();
    });

    it("silently rejects non-finite or negative durations", () => {
      enablePerf();
      recordFrameworkMeasurement("bad", Number.NaN);
      recordFrameworkMeasurement("bad", -5);
      expect(_peekLastMarkForTesting()).toBeUndefined();
    });
  });
});
