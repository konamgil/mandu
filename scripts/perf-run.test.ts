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
        budgets: {
          initial_js_bundle_kb: {
            budget: 0,
            warningThresholdPct: 10,
            baseline: 0,
          },
        },
      }),
      { initial_js_bundle_kb: 0.1 },
    );

    expect(result.status).toBe("fail");
    expect(result.failureReason).toBe("budget");
    expect(result.regressionFromBaselinePct).toBeNull();
  });
});
