import { describe, expect, test } from "bun:test";
import {
  compareScenarioMetrics,
  type PerfScenario,
} from "./perf-run";

function scenario(overrides: Partial<PerfScenario> = {}): PerfScenario {
  return {
    id: "test-scenario",
    app: "starter",
    status: "active",
    mode: "prod",
    url: "/",
    runner: "scripts/perf-run.ts",
    measuredMetrics: ["ssr_ttfb_p95_ms"],
    budgets: {
      ssr_ttfb_p95_ms: {
        budget: 500,
        warningThresholdPct: 10,
        baseline: 100,
      },
    },
    notes: "test",
    ...overrides,
  };
}

describe("perf metric comparison", () => {
  test("warns when a metric regresses more than 10 percent from baseline", () => {
    const [result] = compareScenarioMetrics(scenario(), {
      ssr_ttfb_p95_ms: 111,
    });

    expect(result.status).toBe("warn");
    expect(result.failureReason).toBeNull();
    expect(result.regressionFromBaselinePct).toBe(11);
  });

  test("uses zero budgets to enforce zero-JS routes", () => {
    const [result] = compareScenarioMetrics(
      scenario({
        measuredMetrics: ["initial_js_bundle_kb"],
        measurementExpectations: { initialJs: "required" },
        budgets: {
          initial_js_bundle_kb: {
            budget: 0,
            warningThresholdPct: 10,
            baseline: 0,
          },
        },
      }),
      { initial_js_bundle_kb: 0.1 },
      {
        initialJs: {
          discoveredCount: 1,
          downloadedCount: 1,
          failedUrls: [],
        },
      },
    );

    expect(result.status).toBe("fail");
    expect(result.failureReason).toBe("budget");
    expect(result.regressionFromBaselinePct).toBeNull();
  });

  test("fails a required JavaScript measurement when discovery returns zero assets", () => {
    const [result] = compareScenarioMetrics(
      scenario({
        measuredMetrics: ["initial_js_bundle_kb"],
        measurementExpectations: { initialJs: "required" },
        budgets: {
          initial_js_bundle_kb: {
            budget: 1200,
            warningThresholdPct: 10,
            baseline: 1000,
          },
        },
      }),
      { initial_js_bundle_kb: 0 },
      {
        initialJs: {
          discoveredCount: 0,
          downloadedCount: 0,
          failedUrls: [],
        },
      },
    );

    expect(result.status).toBe("fail");
    expect(result.failureReason).toBe("measurement-invalid");
    expect(result.validityError).toContain("no JavaScript assets");
  });

  test("accepts an evidence-backed zero-JS route", () => {
    const [result] = compareScenarioMetrics(
      scenario({
        measuredMetrics: ["initial_js_bundle_kb"],
        measurementExpectations: { initialJs: "zero" },
        budgets: {
          initial_js_bundle_kb: {
            budget: 0,
            warningThresholdPct: 10,
            baseline: 0,
          },
        },
      }),
      { initial_js_bundle_kb: 0 },
      {
        initialJs: {
          discoveredCount: 0,
          downloadedCount: 0,
          failedUrls: [],
        },
      },
    );

    expect(result.status).toBe("pass");
    expect(result.validityError).toBeNull();
  });

  test("fails a required hydration measurement when islands disappear", () => {
    const [result] = compareScenarioMetrics(
      scenario({
        measuredMetrics: ["hydration_p95_ms"],
        measurementExpectations: { hydration: "required" },
        budgets: {
          hydration_p95_ms: {
            budget: 350,
            warningThresholdPct: 10,
            baseline: 10,
          },
        },
      }),
      { hydration_p95_ms: 0 },
      {
        hydration: {
          samples: [{
            hydrationTime: 0,
            islandCount: 0,
            totalIslandCount: 0,
            hydrationErrorCount: 0,
          }],
        },
      },
    );

    expect(result.status).toBe("fail");
    expect(result.failureReason).toBe("measurement-invalid");
    expect(result.validityError).toContain("found no islands");
  });

  test("accepts zero hydration only when the scenario declares none", () => {
    const [result] = compareScenarioMetrics(
      scenario({
        measuredMetrics: ["hydration_p95_ms"],
        measurementExpectations: { hydration: "none" },
        budgets: {
          hydration_p95_ms: {
            budget: 350,
            warningThresholdPct: 10,
            baseline: 0,
          },
        },
      }),
      { hydration_p95_ms: 0 },
      {
        hydration: {
          samples: [{
            hydrationTime: 0,
            islandCount: 0,
            totalIslandCount: 0,
            hydrationErrorCount: 0,
          }],
        },
      },
    );

    expect(result.status).toBe("pass");
    expect(result.validityError).toBeNull();
  });

  test("fails expected hydration when benchmark evidence is missing", () => {
    const [result] = compareScenarioMetrics(
      scenario({
        measuredMetrics: ["hydration_p95_ms"],
        measurementExpectations: { hydration: "required" },
        budgets: {
          hydration_p95_ms: {
            budget: 350,
            warningThresholdPct: 10,
            baseline: 10,
          },
        },
      }),
      {},
    );

    expect(result.status).toBe("fail");
    expect(result.failureReason).toBe("measurement-invalid");
    expect(result.validityError).toBe("Hydration benchmark samples are missing.");
  });

  test("fails initial JavaScript measurement when any discovered asset is unavailable", () => {
    const [result] = compareScenarioMetrics(
      scenario({
        measuredMetrics: ["initial_js_bundle_kb"],
        measurementExpectations: { initialJs: "required" },
        budgets: {
          initial_js_bundle_kb: {
            budget: 1200,
            warningThresholdPct: 10,
            baseline: 1000,
          },
        },
      }),
      { initial_js_bundle_kb: 0 },
      {
        initialJs: {
          discoveredCount: 1,
          downloadedCount: 0,
          failedUrls: ["http://localhost/missing.js (404)"],
        },
      },
    );

    expect(result.status).toBe("fail");
    expect(result.validityError).toContain("Failed to download 1");
  });
});
